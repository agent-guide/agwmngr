import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlatformDatabase } from "@/packages/platform/ports/database";
import { IdentityRegistry } from "@/packages/platform/services/identity-registry";
import { migratePlatformIdentityDatabase } from "@/packages/platform/services/identity-migrations";
import { migrateDatabase } from "./db";
import {
  openPostgresPlatformDatabase,
  openSqlitePlatformDatabase,
} from "./platform-database";
import { openDatabase } from "./sqlite";

async function verifyPersistence(
  database: PlatformDatabase,
  reopen: () => Promise<PlatformDatabase>,
) {
  expect(await migratePlatformIdentityDatabase(database, true)).toEqual({
    from: 0,
    to: 1,
    dryRun: true,
  });
  await expect(database.query("SELECT * FROM platform_principals")).rejects.toThrow();

  await Promise.all([
    migratePlatformIdentityDatabase(database),
    migratePlatformIdentityDatabase(database),
  ]);
  expect((await migratePlatformIdentityDatabase(database)).from).toBe(1);

  const registry = new IdentityRegistry(database);
  await registry.ensureHuman(1, "2026-10-17T00:00:00.000Z");
  await registry.createTenant({
    id: "alpha",
    name: "Alpha",
    status: "active",
    createdAt: "2026-10-17T00:00:00.000Z",
    updatedAt: "2026-10-17T00:00:00.000Z",
  });
  expect(
    await registry.createMembership(
      "user:1",
      "alpha",
      "user",
      "2026-10-17T00:00:00.000Z",
    ),
  ).toBe(true);
  expect(
    await registry.updateMembership(
      "user:1",
      "alpha",
      "admin",
      "2026-10-17T00:01:00.000Z",
    ),
  ).toBe(true);
  expect((await registry.membership("user:1", "alpha"))?.role).toBe("admin");
  expect(
    await registry.createMembership(
      "user:1",
      "alpha",
      "user",
      "2026-10-17T00:02:00.000Z",
    ),
  ).toBe(false);
  await registry.removeMembership("user:1", "alpha");
  expect(
    await registry.updateMembership(
      "user:1",
      "alpha",
      "user",
      "2026-10-17T00:03:00.000Z",
    ),
  ).toBe(false);
  expect(
    await registry.createMembership(
      "user:1",
      "alpha",
      "admin",
      "2026-10-17T00:04:00.000Z",
    ),
  ).toBe(true);

  await registry.createService({
    id: "service:worker",
    name: "worker",
    credentialId: "credential:test",
    digest: "test-digest",
    expiresAt: "2099-01-01T00:00:00.000Z",
    now: "2026-10-17T00:00:00.000Z",
  });
  expect(
    (await registry.serviceForCredential("test-digest", "2026-10-17T00:00:00.000Z"))?.id,
  ).toBe("service:worker");
  expect(
    await registry.serviceForCredential("test-digest", "2100-01-01T00:00:00.000Z"),
  ).toBeNull();

  const restarted = new IdentityRegistry(await reopen());
  expect((await restarted.membership("user:1", "alpha"))?.role).toBe("admin");
  await restarted.disableService("service:worker", "2026-10-17T00:02:00.000Z");
  expect(
    await restarted.serviceForCredential("test-digest", "2026-10-17T00:03:00.000Z"),
  ).toBeNull();

  await expect(
    database.transaction(async (transaction) => {
      await transaction.query("DELETE FROM platform_tenants WHERE id = ?", ["alpha"]);
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  expect(await restarted.tenant("alpha")).not.toBeNull();
}

test("SQLite identity migration is additive and state survives restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "agwmngr-identity-"));
  try {
    const path = join(root, "manager.db");
    const manager = openDatabase(path);
    manager.exec("PRAGMA foreign_keys = ON");
    migrateDatabase(manager);
    manager.run(
      `INSERT INTO users
         (id, username, password_hash, is_platform_admin, status, created_at, updated_at)
       VALUES (1, 'admin', 'unchanged-hash', 1, 'active', 'now', 'now')`,
    );
    const usersBefore = manager.all("SELECT * FROM users");
    await verifyPersistence(
      openSqlitePlatformDatabase(path),
      async () => openSqlitePlatformDatabase(path),
    );
    expect(manager.all("SELECT * FROM users")).toEqual(usersBefore);
    expect(manager.get<{ user_version: number }>("PRAGMA user_version")?.user_version).toBe(3);
    expect(manager.all("PRAGMA foreign_key_check")).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const postgresUrl = process.env.PLATFORM_TEST_POSTGRES_URL;
test.skipIf(!postgresUrl)(
  "PostgreSQL uses the same identity migration and persistence contract",
  async () => {
    const admin = openPostgresPlatformDatabase(postgresUrl!);
    const name = `agwmngr_identity_${crypto.randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(postgresUrl!);
    url.pathname = `/${name}`;
    const database = openPostgresPlatformDatabase(url.toString());
    let restarted: ReturnType<typeof openPostgresPlatformDatabase> | undefined;
    try {
      await verifyPersistence(database, async () => {
        restarted = openPostgresPlatformDatabase(url.toString());
        return restarted;
      });
    } finally {
      await restarted?.close();
      await database.close();
      await admin.query(`DROP DATABASE ${name}`);
      await admin.close();
    }
  },
  30_000,
);
