import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDatabase } from "../lib/db";
import {
  openPostgresPlatformDatabase,
  sqlitePlatformDatabase,
} from "../lib/platform-database";
import { openDatabase } from "../lib/sqlite";
import { migratePlatformIdentityDatabase } from "../packages/platform/services/identity-migrations";
import {
  collectCutoverInventory,
  createCutoverBackup,
  postgresCliConnection,
  postgresRestoreInvocation,
  readAndVerifyBackup,
  restoreCutoverBackup,
} from "./cutover-operations";

test("PostgreSQL CLI connection uses dbname without exposing the password", () => {
  expect(
    postgresCliConnection(
      "postgresql://operator:p%40ssword@database.example:5432/platform?sslmode=require",
    ),
  ).toEqual({
    databaseUrl: "postgresql://operator@database.example:5432/platform?sslmode=require",
    environment: { PGPASSWORD: "p@ssword" },
  });
  expect(
    postgresCliConnection("postgresql://operator:p%2540ss@database.example/platform"),
  ).toEqual({
    databaseUrl: "postgresql://operator@database.example/platform",
    environment: { PGPASSWORD: "p%40ss" },
  });
  expect(() =>
    postgresCliConnection("postgresql://operator@database.example/platform?password=secret"),
  ).toThrow("password in the URL authority");
  expect(() =>
    postgresCliConnection("postgresql://operator@database.example/platform?PASSWORD=secret"),
  ).toThrow("password in the URL authority");
  expect(() =>
    postgresCliConnection("postgresql://operator@database.example/platform?SSLPassword=secret"),
  ).toThrow("password in the URL authority");
});

test("PostgreSQL restore ignores source ownership and privileges", () => {
  expect(
    postgresRestoreInvocation(
      "postgresql://target:p%40ssword@database.example:5432/platform?sslmode=require",
      "/private/backup/platform.dump",
    ),
  ).toEqual({
    args: [
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "--no-privileges",
      "--dbname=postgresql://target@database.example:5432/platform?sslmode=require",
      "/private/backup/platform.dump",
    ],
    environment: { PGPASSWORD: "p@ssword" },
  });
});

test("failed cutover backups remove their incomplete output directory", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "agwmngr-cutover-backup-retry-"));
  try {
    const managerPath = join(sandbox, "source", "manager.db");
    const badManagerPath = join(sandbox, "source", "bad.db");
    const objectDir = join(sandbox, "source", "objects");
    const backupDir = join(sandbox, "backup");
    await mkdir(objectDir, { recursive: true });
    const manager = openDatabase(managerPath);
    migrateDatabase(manager);
    await migratePlatformIdentityDatabase(sqlitePlatformDatabase(manager));
    openDatabase(badManagerPath);

    await expect(
      createCutoverBackup({ managerDbPath: badManagerPath, objectDir, outputDir: backupDir }),
    ).rejects.toThrow();
    await expect(lstat(backupDir)).rejects.toMatchObject({ code: "ENOENT" });

    await createCutoverBackup({ managerDbPath: managerPath, objectDir, outputDir: backupDir });
    expect((await lstat(join(backupDir, "backup.json"))).isFile()).toBe(true);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("cutover inventory rejects deployment releases from another definition", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "agwmngr-cutover-release-pair-"));
  try {
    const managerPath = join(sandbox, "manager.db");
    const manager = openDatabase(managerPath);
    migrateDatabase(manager);
    const platform = sqlitePlatformDatabase(manager);
    await migratePlatformIdentityDatabase(platform);
    await platform.query(
      `INSERT INTO platform_tenants (id, name, status, created_at, updated_at)
       VALUES ('alpha', 'Alpha', 'active', 'now', 'now')`,
    );
    for (const [id, slug] of [["definition:one", "one"], ["definition:two", "two"]]) {
      await platform.query(
        `INSERT INTO platform_agent_definitions
          (id, slug, tenant_id, tenant_authority_epoch, status, version, draft_json,
           draft_digest, dependencies_json, created_by_principal_id, updated_by_principal_id,
           created_at, updated_at)
         VALUES (?, ?, 'alpha', 1, 'active', 1, '{}', ?, '[]', 'user:1', 'user:1',
                 'now', 'now')`,
        [id, slug, `draft:${slug}`],
      );
    }
    await platform.query(
      `INSERT INTO platform_agent_releases
        (id, definition_id, tenant_id, tenant_authority_epoch, number, draft_version,
         snapshot_json, dependencies_json, internal_dependencies_json, execution_json,
         runtime_type, digest, created_by_principal_id, created_at)
       VALUES ('release:two', 'definition:two', 'alpha', 1, 1, 1, '{}', '[]', '[]',
               '{}', 'builtin', 'release:two:digest', 'user:1', 'now')`,
    );
    await platform.query(
      `INSERT INTO platform_agent_deployments
        (id, tenant_id, tenant_authority_epoch, definition_id, requested_release_id,
         applied_release_id, gateway_id, gateway_authority_epoch, gateway_agent_id,
         gateway_route_id, path_prefix, desired_digest, lifecycle_state, operation_state,
         invocation_epoch, request_key, current_operation_id, last_verified_at, failure_code,
         created_by_principal_id, created_at, updated_at)
       VALUES ('deployment:one', 'alpha', 1, 'definition:one', 'release:two', 'release:two',
               'gateway:one', 1, 'agent:one', 'route:one', '/agents/one',
               'release:two:digest', 'active', 'stable', 1, 'request:one', NULL, 'now',
               NULL, 'user:1', 'now', 'now')`,
    );

    const inventory = await collectCutoverInventory({
      managerDbPath: managerPath,
      objectDir: join(sandbox, "objects"),
    });
    expect(inventory.violations).toContain(
      "deployment definition/release/Tenant mismatch: 1",
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("cutover backup restores matching rows, references and object bytes", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "agwmngr-cutover-"));
  try {
    const managerPath = join(sandbox, "source", "manager.db");
    const objectDir = join(sandbox, "source", "objects");
    await mkdir(join(sandbox, "source"), { recursive: true });
    const manager = openDatabase(managerPath);
    migrateDatabase(manager);
    manager.run(
      `INSERT INTO users
         (id, username, password_hash, is_platform_admin, status, created_at, updated_at)
       VALUES (1, 'operator', 'hash', 1, 'active', 'now', 'now')`,
    );
    manager.run(
      `INSERT INTO gateways
         (id, name, admin_addr, admin_user, admin_password_enc, status, created_at, updated_at)
       VALUES ('gateway-one', 'Gateway One', 'http://127.0.0.1:1', 'admin', 'cipher',
               'active', 'now', 'now')`,
    );

    const platform = sqlitePlatformDatabase(manager);
    await migratePlatformIdentityDatabase(platform);
    await platform.query(
      `INSERT INTO platform_principals
         (id, kind, user_id, service_name, status, created_at, updated_at)
       VALUES ('user:1', 'human', 1, NULL, 'active', 'now', 'now')`,
    );
    await platform.query(
      `INSERT INTO platform_tenants (id, name, status, created_at, updated_at)
       VALUES ('alpha', 'Alpha', 'active', 'now', 'now')`,
    );
    await platform.query(
      `INSERT INTO platform_knowledge_bases
         (id, tenant_id, tenant_authority_epoch, name, description, status,
          created_by_principal_id, created_at, updated_at)
       VALUES ('kb-one', 'alpha', 1, 'Knowledge', '', 'active', 'user:1', 'now', 'now')`,
    );
    const bytes = new TextEncoder().encode("cutover object");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const objectKey = "documents/00000000-0000-4000-8000-000000000001";
    await mkdir(join(objectDir, "documents"), { recursive: true });
    await writeFile(join(objectDir, objectKey), bytes);
    await platform.query(
      `INSERT INTO platform_knowledge_documents
         (id, knowledge_base_id, tenant_id, tenant_authority_epoch, name, mime_type,
          size_bytes, expected_hash, content_hash, object_key, status, failure_reason,
          created_by_principal_id, request_key, expires_at, object_deleted_at,
          created_at, updated_at)
       VALUES ('doc-one', 'kb-one', 'alpha', 1, 'document.txt', 'text/plain', ?, ?, ?, ?,
               'active', NULL, 'user:1', 'request-one', '2099-01-01', NULL, 'now', 'now')`,
      [bytes.byteLength, digest, digest, objectKey],
    );

    const backupDir = join(sandbox, "backup");
    const before = await collectCutoverInventory({ managerDbPath: managerPath, objectDir });
    expect(before.violations).toEqual([]);
    await createCutoverBackup({
      managerDbPath: managerPath,
      objectDir,
      outputDir: backupDir,
      now: "2026-10-22T00:00:00.000Z",
    });

    const overlappingTarget = join(sandbox, "overlapping-restore");
    await expect(
      restoreCutoverBackup({
        backupDir,
        managerDbPath: join(overlappingTarget, "manager.db"),
        objectDir: overlappingTarget,
      }),
    ).rejects.toThrow("restore targets must not overlap");
    await expect(lstat(overlappingTarget)).rejects.toMatchObject({ code: "ENOENT" });

    const restoredManager = join(sandbox, "restored", "manager.db");
    const restoredObjects = join(sandbox, "restored", "objects");
    expect(
      await restoreCutoverBackup({
        backupDir,
        managerDbPath: restoredManager,
        objectDir: restoredObjects,
      }),
    ).toEqual(before);
    expect(new Uint8Array(await readFile(join(restoredObjects, objectKey)))).toEqual(bytes);

    await writeFile(join(backupDir, "objects", objectKey), "tampered");
    await expect(readAndVerifyBackup(backupDir)).rejects.toThrow(
      "backup artifact hashes do not match",
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

const postgresUrl = process.env.PLATFORM_TEST_POSTGRES_URL;
test.skipIf(!postgresUrl)(
  "PostgreSQL cutover backup restores into an empty database",
  async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "agwmngr-cutover-postgres-"));
    const admin = openPostgresPlatformDatabase(postgresUrl!);
    const sourceName = `agwmngr_cutover_source_${crypto.randomUUID().replaceAll("-", "")}`;
    const targetName = `agwmngr_cutover_target_${crypto.randomUUID().replaceAll("-", "")}`;
    const sourceUrl = new URL(postgresUrl!);
    const targetUrl = new URL(postgresUrl!);
    sourceUrl.pathname = `/${sourceName}`;
    targetUrl.pathname = `/${targetName}`;

    try {
      await admin.query(`CREATE DATABASE ${sourceName}`);
      await admin.query(`CREATE DATABASE ${targetName}`);

      const managerPath = join(sandbox, "source", "manager.db");
      const objectDir = join(sandbox, "source", "objects");
      await mkdir(join(sandbox, "source"), { recursive: true });
      const manager = openDatabase(managerPath);
      migrateDatabase(manager);
      const platform = openPostgresPlatformDatabase(sourceUrl.toString());
      try {
        await migratePlatformIdentityDatabase(platform);
        await platform.query(
          `INSERT INTO platform_tenants (id, name, status, created_at, updated_at)
           VALUES ('cutover', 'Cutover', 'active', 'now', 'now')`,
        );
      } finally {
        await platform.close();
      }

      const backupDir = join(sandbox, "backup");
      const before = await collectCutoverInventory({
        managerDbPath: managerPath,
        objectDir,
        platformDatabaseUrl: sourceUrl.toString(),
      });
      expect(before.violations).toEqual([]);
      await createCutoverBackup({
        managerDbPath: managerPath,
        objectDir,
        outputDir: backupDir,
        platformDatabaseUrl: sourceUrl.toString(),
      });

      const restoredManager = join(sandbox, "restored", "manager.db");
      const restoredObjects = join(sandbox, "restored", "objects");
      const dumpPath = join(backupDir, "platform.dump");
      const manifestPath = join(backupDir, "backup.json");
      const validDump = await readFile(dumpPath);
      const validManifestText = await readFile(manifestPath, "utf8");
      const brokenDump = Buffer.from("not a PostgreSQL custom dump");
      await writeFile(dumpPath, brokenDump);
      const brokenManifest = JSON.parse(validManifestText);
      const dumpArtifact = brokenManifest.artifacts.find(
        (artifact: { path: string }) => artifact.path === "platform.dump",
      );
      if (!dumpArtifact) throw new Error("platform.dump is missing from the backup manifest");
      dumpArtifact.sizeBytes = brokenDump.byteLength;
      dumpArtifact.sha256 = createHash("sha256").update(brokenDump).digest("hex");
      await writeFile(manifestPath, `${JSON.stringify(brokenManifest, null, 2)}\n`);

      await expect(
        restoreCutoverBackup({
          backupDir,
          managerDbPath: restoredManager,
          objectDir: restoredObjects,
          platformDatabaseUrl: targetUrl.toString(),
        }),
      ).rejects.toThrow("pg_restore exited");
      await expect(lstat(restoredManager)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(lstat(restoredObjects)).rejects.toMatchObject({ code: "ENOENT" });

      await writeFile(dumpPath, validDump);
      await writeFile(manifestPath, validManifestText);
      expect(
        await restoreCutoverBackup({
          backupDir,
          managerDbPath: restoredManager,
          objectDir: restoredObjects,
          platformDatabaseUrl: targetUrl.toString(),
        }),
      ).toEqual(before);
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${sourceName} WITH (FORCE)`);
      await admin.query(`DROP DATABASE IF EXISTS ${targetName} WITH (FORCE)`);
      await admin.close();
      await rm(sandbox, { recursive: true, force: true });
    }
  },
  60_000,
);
