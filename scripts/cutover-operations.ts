import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  copyFile,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { openDatabase } from "../lib/sqlite";
import {
  openPostgresPlatformDatabase,
  sqlitePlatformDatabase,
} from "../lib/platform-database";
import type { PlatformDatabase } from "../packages/platform/ports/database";
import { PLATFORM_SCHEMA_VERSION } from "../packages/platform/services/identity-migrations";

const MANAGER_TABLES = [
  "users",
  "gateways",
  "user_gateways",
  "sessions",
  "audit_log",
  "manager_user_ids",
  "manager_gateway_ids",
  "manager_authority_fences",
] as const;

const PLATFORM_TABLES = [
  "platform_principals",
  "platform_tenants",
  "platform_tenant_memberships",
  "platform_service_credentials",
  "platform_issued_ids",
  "platform_authority_fences",
  "platform_tenant_gateway_grants",
  "platform_membership_add_receipts",
  "platform_catalog_offerings",
  "platform_catalog_tenant_availability",
  "platform_authored_resources",
  "platform_authored_resource_availability",
  "platform_authored_resource_revisions",
  "platform_authored_revision_refs",
  "platform_knowledge_bases",
  "platform_knowledge_documents",
  "platform_document_object_tickets",
  "platform_knowledge_base_refs",
  "platform_knowledge_document_refs",
  "platform_personal_files",
  "platform_personal_file_tickets",
  "platform_personal_file_refs",
  "platform_tenant_model_definitions",
  "platform_tenant_model_definition_versions",
  "platform_tenant_model_definition_refs",
  "platform_tenant_tool_definitions",
  "platform_tenant_tool_definition_versions",
  "platform_tenant_tool_definition_refs",
  "platform_agent_definitions",
  "platform_agent_releases",
  "platform_agent_deployments",
  "platform_deployment_operations",
  "platform_deployment_pair_fences",
  "platform_gateway_operation_leases",
  "platform_deployment_key_bindings",
  "platform_deployment_route_reservations",
  "platform_gateway_virtual_key_policies",
  "platform_deployment_invocation_contexts",
  "platform_gateway_compatibility_pairs",
  "platform_gateway_compatibility_invocation_contexts",
] as const;

export interface CutoverInventory {
  managerSchemaVersion: number;
  platformSchemaVersion: number;
  managerRows: Record<string, number>;
  platformRows: Record<string, number>;
  mappings: {
    managerUsers: number;
    humanPrincipals: number;
    liveHumanPrincipalMappings: number;
    retainedHumanPrincipalMappings: number;
    managerGateways: number;
    referencedGateways: number;
    liveGatewayMappings: number;
    retainedGatewayMappings: number;
    legacyGatewayMemberships: number;
    tenantGatewayGrants: number;
  };
  objects: {
    metadataRows: number;
    storedFiles: number;
    activeReferences: number;
    verifiedActiveReferences: number;
    orphanedFiles: string[];
  };
  violations: string[];
}

export interface BackupArtifact {
  path: string;
  sizeBytes: number;
  sha256: string;
}

export interface CutoverBackupManifest {
  formatVersion: 1;
  createdAt: string;
  storageMode: "sqlite" | "postgres";
  managerDatabase: string;
  inventory: CutoverInventory;
  artifacts: BackupArtifact[];
}

interface ObjectMetadata {
  family: string;
  object_key: string;
  size_bytes: number;
  content_hash: string | null;
  status: string;
  object_deleted_at: string | null;
}

function normalizedRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function pathIsAtOrBelow(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

async function walkFiles(root: string): Promise<string[]> {
  try {
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      throw new Error(`object root must be a real directory: ${root}`);
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`symbolic links are not allowed: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`unsupported object-store entry: ${path}`);
    }
  }
  await visit(root);
  return files.sort();
}

async function hashFile(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

async function rowCounts(
  database: PlatformDatabase,
  tables: readonly string[],
): Promise<Record<string, number>> {
  const entries = await Promise.all(
    tables.map(async (table) => {
      const [row] = await database.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
      return [table, Number(row.n)] as const;
    }),
  );
  return Object.fromEntries(entries);
}

async function platformVersion(database: PlatformDatabase): Promise<number> {
  const [row] = await database.query<{ version: number }>(
    "SELECT version FROM platform_schema_lock WHERE id = 1",
  );
  return Number(row?.version ?? -1);
}

async function objectMetadata(database: PlatformDatabase): Promise<ObjectMetadata[]> {
  return database.query<ObjectMetadata>(`
    SELECT 'document' AS family, object_key, size_bytes, content_hash, status, object_deleted_at
      FROM platform_knowledge_documents
    UNION ALL
    SELECT 'personal_file' AS family, object_key, size_bytes, content_hash, status, object_deleted_at
      FROM platform_personal_files
    ORDER BY family, object_key
  `);
}

async function scalar(database: PlatformDatabase, sql: string): Promise<number> {
  const [row] = await database.query<{ n: number }>(sql);
  return Number(row?.n ?? 0);
}

export async function collectCutoverInventory(input: {
  managerDbPath: string;
  objectDir: string;
  platformDatabaseUrl?: string;
}): Promise<CutoverInventory> {
  const manager = openDatabase(input.managerDbPath);
  manager.exec("PRAGMA foreign_keys = ON");
  const postgres = input.platformDatabaseUrl
    ? openPostgresPlatformDatabase(input.platformDatabaseUrl)
    : undefined;
  const platform = postgres ?? sqlitePlatformDatabase(manager);
  const violations: string[] = [];

  try {
    const managerSchemaVersion = Number(
      manager.get<{ user_version: number }>("PRAGMA user_version")?.user_version ?? -1,
    );
    const platformSchemaVersion = await platformVersion(platform);
    if (managerSchemaVersion !== 4) {
      violations.push(`manager schema is v${managerSchemaVersion}, expected v4`);
    }
    if (platformSchemaVersion !== PLATFORM_SCHEMA_VERSION) {
      violations.push(
        `platform schema is v${platformSchemaVersion}, expected v${PLATFORM_SCHEMA_VERSION}`,
      );
    }

    for (const row of manager.all<{ table: string; rowid: number; parent: string }>(
      "PRAGMA foreign_key_check",
    )) {
      violations.push(`manager foreign-key violation: ${row.table}:${row.rowid}->${row.parent}`);
    }

    const managerRows = Object.fromEntries(
      MANAGER_TABLES.map((table) => [
        table,
        Number(manager.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0),
      ]),
    );
    const platformRows = await rowCounts(platform, PLATFORM_TABLES);

    const humanRows = await platform.query<{ user_id: number }>(
      "SELECT user_id FROM platform_principals WHERE kind = 'human' ORDER BY user_id",
    );
    const managerUserIds = new Set(
      manager.all<{ id: number }>("SELECT id FROM users").map((row) => Number(row.id)),
    );
    const liveHumanPrincipalMappings = humanRows.filter((row) =>
      managerUserIds.has(Number(row.user_id))
    ).length;

    const gatewayRows = await platform.query<{ gateway_id: string }>(`
      SELECT gateway_id FROM platform_tenant_gateway_grants
      UNION SELECT source_gateway_id AS gateway_id FROM platform_catalog_offerings
        WHERE source_gateway_id IS NOT NULL
      UNION SELECT gateway_id FROM platform_agent_deployments
      UNION SELECT gateway_id FROM platform_gateway_virtual_key_policies
      UNION SELECT gateway_id FROM platform_gateway_compatibility_pairs
      ORDER BY gateway_id
    `);
    const managerGatewayIds = new Set(
      manager.all<{ id: string }>("SELECT id FROM gateways").map((row) => row.id),
    );
    const liveGatewayMappings = gatewayRows.filter((row) =>
      managerGatewayIds.has(row.gateway_id)
    ).length;

    const structuralChecks: Array<[string, string]> = [
      [
        "release definition/Tenant mismatch",
        `SELECT COUNT(*) AS n FROM platform_agent_releases release
          LEFT JOIN platform_agent_definitions definition ON definition.id = release.definition_id
         WHERE definition.id IS NULL OR definition.tenant_id <> release.tenant_id`,
      ],
      [
        "deployment definition/release/Tenant mismatch",
        `SELECT COUNT(*) AS n FROM platform_agent_deployments deployment
          LEFT JOIN platform_agent_definitions definition ON definition.id = deployment.definition_id
          LEFT JOIN platform_agent_releases requested ON requested.id = deployment.requested_release_id
          LEFT JOIN platform_agent_releases applied ON applied.id = deployment.applied_release_id
         WHERE definition.id IS NULL OR requested.id IS NULL
            OR definition.tenant_id <> deployment.tenant_id
            OR requested.tenant_id <> deployment.tenant_id
            OR requested.definition_id <> deployment.definition_id
            OR (deployment.applied_release_id IS NOT NULL AND
                (applied.id IS NULL OR applied.tenant_id <> deployment.tenant_id
                 OR applied.definition_id <> deployment.definition_id))`,
      ],
      [
        "deployment fence without deployment",
        `SELECT COUNT(*) AS n FROM platform_deployment_pair_fences fence
          LEFT JOIN platform_agent_deployments deployment ON deployment.id = fence.deployment_id
         WHERE deployment.id IS NULL`,
      ],
      [
        "deployment binding without deployment",
        `SELECT COUNT(*) AS n FROM platform_deployment_key_bindings binding
          LEFT JOIN platform_agent_deployments deployment ON deployment.id = binding.deployment_id
         WHERE deployment.id IS NULL`,
      ],
      [
        "deployment route reservation without deployment",
        `SELECT COUNT(*) AS n FROM platform_deployment_route_reservations reservation
          LEFT JOIN platform_agent_deployments deployment ON deployment.id = reservation.deployment_id
         WHERE deployment.id IS NULL`,
      ],
      [
        "knowledge document/Tenant mismatch",
        `SELECT COUNT(*) AS n FROM platform_knowledge_documents document
          LEFT JOIN platform_knowledge_bases knowledge ON knowledge.id = document.knowledge_base_id
         WHERE knowledge.id IS NULL OR knowledge.tenant_id <> document.tenant_id`,
      ],
      [
        "model definition missing current version",
        `SELECT COUNT(*) AS n FROM platform_tenant_model_definitions definition
          LEFT JOIN platform_tenant_model_definition_versions version
            ON version.definition_id = definition.id AND version.version = definition.current_version
         WHERE version.definition_id IS NULL`,
      ],
      [
        "tool definition missing current version",
        `SELECT COUNT(*) AS n FROM platform_tenant_tool_definitions definition
          LEFT JOIN platform_tenant_tool_definition_versions version
            ON version.definition_id = definition.id AND version.version = definition.current_version
         WHERE version.definition_id IS NULL`,
      ],
    ];
    for (const [label, sql] of structuralChecks) {
      const count = await scalar(platform, sql);
      if (count > 0) violations.push(`${label}: ${count}`);
    }

    const metadata = await objectMetadata(platform);
    const storedPaths = await walkFiles(input.objectDir);
    const storedKeys = new Set(storedPaths.map((path) => normalizedRelative(input.objectDir, path)));
    const metadataKeys = new Set(metadata.map((row) => row.object_key));
    const active = metadata.filter((row) => row.status === "active");
    let verifiedActiveReferences = 0;
    for (const row of active) {
      const path = join(input.objectDir, ...row.object_key.split("/"));
      if (!storedKeys.has(row.object_key)) {
        violations.push(`${row.family} ${row.object_key} is active but its object is missing`);
        continue;
      }
      const details = await stat(path);
      const digest = await hashFile(path);
      if (details.size !== Number(row.size_bytes) || digest !== row.content_hash) {
        violations.push(`${row.family} ${row.object_key} size/hash mismatch`);
        continue;
      }
      verifiedActiveReferences += 1;
    }
    const orphanedFiles = [...storedKeys].filter((key) => !metadataKeys.has(key)).sort();
    for (const key of orphanedFiles) violations.push(`unreferenced object file: ${key}`);

    return {
      managerSchemaVersion,
      platformSchemaVersion,
      managerRows,
      platformRows,
      mappings: {
        managerUsers: managerRows.users,
        humanPrincipals: humanRows.length,
        liveHumanPrincipalMappings,
        retainedHumanPrincipalMappings: humanRows.length - liveHumanPrincipalMappings,
        managerGateways: managerRows.gateways,
        referencedGateways: gatewayRows.length,
        liveGatewayMappings,
        retainedGatewayMappings: gatewayRows.length - liveGatewayMappings,
        legacyGatewayMemberships: managerRows.user_gateways,
        tenantGatewayGrants: platformRows.platform_tenant_gateway_grants,
      },
      objects: {
        metadataRows: metadata.length,
        storedFiles: storedPaths.length,
        activeReferences: active.length,
        verifiedActiveReferences,
        orphanedFiles,
      },
      violations,
    };
  } finally {
    await postgres?.close();
  }
}

async function copyObjectTree(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await mkdir(target, { recursive: false, mode: 0o700 });
  for (const sourcePath of await walkFiles(source)) {
    const key = normalizedRelative(source, sourcePath);
    const targetPath = join(target, ...key.split("/"));
    await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
    await copyFile(sourcePath, targetPath);
    await chmod(targetPath, 0o600);
  }
}

async function run(command: string, args: string[], environment?: Record<string, string>) {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...environment },
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

export function postgresCliConnection(platformDatabaseUrl: string): {
  databaseUrl: string;
  environment?: Record<string, string>;
} {
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(platformDatabaseUrl);
  } catch {
    throw new Error("PLATFORM_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (databaseUrl.protocol !== "postgres:" && databaseUrl.protocol !== "postgresql:") {
    throw new Error("PLATFORM_DATABASE_URL must use postgres:// or postgresql://");
  }
  const hasPasswordQueryParameter = [...databaseUrl.searchParams.keys()].some((key) => {
    const normalized = key.toLowerCase();
    return normalized === "password" || normalized === "sslpassword";
  });
  if (hasPasswordQueryParameter) {
    throw new Error(
      "PLATFORM_DATABASE_URL must put its password in the URL authority, not query parameters",
    );
  }

  let password: string | undefined;
  if (databaseUrl.password) {
    try {
      password = decodeURIComponent(databaseUrl.password);
    } catch {
      throw new Error("PLATFORM_DATABASE_URL contains an invalid encoded password");
    }
    databaseUrl.password = "";
  }

  return {
    databaseUrl: databaseUrl.toString(),
    environment: password === undefined ? undefined : { PGPASSWORD: password },
  };
}

export function postgresRestoreInvocation(
  platformDatabaseUrl: string,
  dumpPath: string,
): { args: string[]; environment?: Record<string, string> } {
  const connection = postgresCliConnection(platformDatabaseUrl);
  return {
    args: [
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "--no-privileges",
      `--dbname=${connection.databaseUrl}`,
      dumpPath,
    ],
    environment: connection.environment,
  };
}

async function artifactList(root: string): Promise<BackupArtifact[]> {
  const artifacts: BackupArtifact[] = [];
  for (const path of await walkFiles(root)) {
    const key = normalizedRelative(root, path);
    if (key === "backup.json") continue;
    artifacts.push({
      path: key,
      sizeBytes: (await stat(path)).size,
      sha256: await hashFile(path),
    });
  }
  return artifacts;
}

function requireCleanInventory(inventory: CutoverInventory): void {
  if (inventory.violations.length > 0) {
    throw new Error(`cutover inventory failed:\n- ${inventory.violations.join("\n- ")}`);
  }
}

export async function createCutoverBackup(input: {
  managerDbPath: string;
  objectDir: string;
  outputDir: string;
  platformDatabaseUrl?: string;
  now?: string;
}): Promise<CutoverBackupManifest> {
  const output = resolve(input.outputDir);
  await mkdir(output, { recursive: false, mode: 0o700 });
  try {
    const inventory = await collectCutoverInventory(input);
    requireCleanInventory(inventory);

    const managerTarget = join(output, "manager.sqlite");
    openDatabase(input.managerDbPath).run("VACUUM INTO ?", [managerTarget]);
    await chmod(managerTarget, 0o600);
    await copyObjectTree(input.objectDir, join(output, "objects"));
    if (input.platformDatabaseUrl) {
      const connection = postgresCliConnection(input.platformDatabaseUrl);
      await run(
        "pg_dump",
        [
          "--format=custom",
          `--file=${join(output, "platform.dump")}`,
          `--dbname=${connection.databaseUrl}`,
        ],
        connection.environment,
      );
      await chmod(join(output, "platform.dump"), 0o600);
    }

    const manifest: CutoverBackupManifest = {
      formatVersion: 1,
      createdAt: input.now ?? new Date().toISOString(),
      storageMode: input.platformDatabaseUrl ? "postgres" : "sqlite",
      managerDatabase: basename(input.managerDbPath),
      inventory,
      artifacts: await artifactList(output),
    };
    await writeFile(join(output, "backup.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    return manifest;
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}

export async function readAndVerifyBackup(backupDir: string): Promise<CutoverBackupManifest> {
  const root = resolve(backupDir);
  const manifest = JSON.parse(
    await readFile(join(root, "backup.json"), "utf8"),
  ) as CutoverBackupManifest;
  if (manifest.formatVersion !== 1) throw new Error("unsupported cutover backup format");

  const actual = await artifactList(root);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.artifacts)) {
    throw new Error("backup artifact hashes do not match backup.json");
  }
  return manifest;
}

export async function restoreCutoverBackup(input: {
  backupDir: string;
  managerDbPath: string;
  objectDir: string;
  platformDatabaseUrl?: string;
}): Promise<CutoverInventory> {
  const manifest = await readAndVerifyBackup(input.backupDir);
  if (manifest.storageMode === "postgres" && !input.platformDatabaseUrl) {
    throw new Error("PostgreSQL backup requires a target platform database URL");
  }
  if (manifest.storageMode === "sqlite" && input.platformDatabaseUrl) {
    throw new Error("SQLite backup cannot be restored into PostgreSQL implicitly");
  }

  const managerTarget = resolve(input.managerDbPath);
  const objectTarget = resolve(input.objectDir);
  if (pathIsAtOrBelow(objectTarget, managerTarget) || pathIsAtOrBelow(managerTarget, objectTarget)) {
    throw new Error("manager and object restore targets must not overlap");
  }

  try {
    await lstat(managerTarget);
    throw new Error("manager restore target already exists");
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
  try {
    await lstat(objectTarget);
    throw new Error("object restore target already exists");
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  if (input.platformDatabaseUrl) {
    const target = openPostgresPlatformDatabase(input.platformDatabaseUrl);
    try {
      const [row] = await target.query<{ n: number }>(`
        SELECT COUNT(*) AS n FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name LIKE 'platform_%'
      `);
      if (Number(row.n) !== 0) throw new Error("PostgreSQL restore target is not empty");
    } finally {
      await target.close();
    }
  }

  await mkdir(dirname(managerTarget), { recursive: true, mode: 0o700 });
  await mkdir(dirname(objectTarget), { recursive: true, mode: 0o700 });

  let managerStageRoot: string | undefined;
  let objectStageRoot: string | undefined;
  let managerPublished = false;
  let objectsPublished = false;
  try {
    managerStageRoot = await mkdtemp(join(dirname(managerTarget), ".agwmngr-restore-"));
    objectStageRoot = await mkdtemp(join(dirname(objectTarget), ".agwmngr-restore-"));
    const stagedManager = join(managerStageRoot, "manager.sqlite");
    const stagedObjects = join(objectStageRoot, "objects");

    await copyFile(join(input.backupDir, "manager.sqlite"), stagedManager);
    await chmod(stagedManager, 0o600);
    await copyObjectTree(join(input.backupDir, "objects"), stagedObjects);
    if (input.platformDatabaseUrl) {
      const invocation = postgresRestoreInvocation(
        input.platformDatabaseUrl,
        join(input.backupDir, "platform.dump"),
      );
      await run("pg_restore", invocation.args, invocation.environment);
    }

    const restored = await collectCutoverInventory({
      managerDbPath: stagedManager,
      objectDir: stagedObjects,
      platformDatabaseUrl: input.platformDatabaseUrl,
    });
    requireCleanInventory(restored);
    if (JSON.stringify(restored) !== JSON.stringify(manifest.inventory)) {
      throw new Error("restored row/reference/object inventory differs from the backup source");
    }

    await rename(stagedObjects, objectTarget);
    objectsPublished = true;
    await rename(stagedManager, managerTarget);
    managerPublished = true;
    return restored;
  } catch (error) {
    if (managerPublished) await rm(managerTarget, { recursive: true, force: true });
    if (objectsPublished) await rm(objectTarget, { recursive: true, force: true });
    throw error;
  } finally {
    if (managerStageRoot) await rm(managerStageRoot, { recursive: true, force: true });
    if (objectStageRoot) await rm(objectStageRoot, { recursive: true, force: true });
  }
}
