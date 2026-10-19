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
  sqlitePlatformDatabase,
} from "./platform-database";
import { openDatabase } from "./sqlite";

async function verifyPersistence(
  database: PlatformDatabase,
  reopen: () => Promise<PlatformDatabase>,
) {
  expect(await migratePlatformIdentityDatabase(database, true)).toEqual({
    from: 0,
    to: 5,
    dryRun: true,
  });
  await expect(database.query("SELECT * FROM platform_principals")).rejects.toThrow();

  await Promise.all([
    migratePlatformIdentityDatabase(database),
    migratePlatformIdentityDatabase(database),
  ]);
  expect((await migratePlatformIdentityDatabase(database)).from).toBe(5);
  expect(await database.query("SELECT * FROM platform_catalog_offerings")).toEqual([]);

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
  const authority = await registry.localGrantAuthority("user:1", "alpha");
  expect(authority).not.toBeNull();
  expect(
    await registry.putTenantGatewayGrant({
      principalId: "user:1",
      tenantId: "alpha",
      gatewayId: "prod",
      access: "manage",
      principalAuthorityEpoch: 7,
      tenantAuthorityEpoch: authority!.tenantAuthorityEpoch,
      membershipAuthorityEpoch: authority!.membershipAuthorityEpoch,
      gatewayAuthorityEpoch: 3,
      createdAt: "2026-10-17T00:04:00.000Z",
      updatedAt: "2026-10-17T00:04:00.000Z",
    }),
  ).toBe(true);
  expect((await registry.tenantGatewayGrant("user:1", "alpha", "prod"))?.access).toBe(
    "manage",
  );
  await registry.updateMembership("user:1", "alpha", "user", "2026-10-17T00:05:00.000Z");
  expect(await registry.tenantGatewayGrant("user:1", "alpha", "prod")).toBeNull();
  await registry.updateMembership("user:1", "alpha", "admin", "2026-10-17T00:06:00.000Z");
  expect((await registry.localGrantAuthority("user:1", "alpha"))!.membershipAuthorityEpoch)
    .toBeGreaterThan(authority!.membershipAuthorityEpoch);
  await registry.setTenantStatus("alpha", "disabled", "2026-10-17T00:07:00.000Z");
  await registry.setTenantStatus("alpha", "active", "2026-10-17T00:08:00.000Z");
  expect((await registry.localGrantAuthority("user:1", "alpha"))!.tenantAuthorityEpoch)
    .toBeGreaterThan(authority!.tenantAuthorityEpoch);
  expect(
    await registry.createMembership(
      "user:1",
      "alpha",
      "user",
      "2026-10-17T00:02:00.000Z",
    ),
  ).toBe(false);
  await registry.removeMembership("user:1", "alpha", "2026-10-17T00:02:30.000Z");
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
  expect(await registry.issued("service_principal", "service:worker")).toBe(true);
  expect(await registry.issued("tenant", "alpha")).toBe(true);
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

  // Rehearse the exact additive v4 -> v5 authored-resource upgrade on both adapters.
  await database.query("DROP TABLE platform_authored_revision_refs");
  await database.query("DROP TABLE platform_authored_resource_revisions");
  await database.query("DROP TABLE platform_authored_resource_availability");
  await database.query("DROP TABLE platform_authored_resources");
  await database.query("UPDATE platform_schema_lock SET version = 4 WHERE id = 1");
  expect(await migratePlatformIdentityDatabase(database, true)).toEqual({
    from: 4,
    to: 5,
    dryRun: true,
  });
  await expect(database.query("SELECT * FROM platform_authored_resources")).rejects.toThrow();
  expect((await restarted.tenant("alpha"))?.name).toBe("Alpha");
  expect(await migratePlatformIdentityDatabase(database)).toEqual({
    from: 4,
    to: 5,
    dryRun: false,
  });
  expect(await database.query("SELECT * FROM platform_authored_resources")).toEqual([]);
  expect((await restarted.principal("user:1"))?.userId).toBe(1);
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
    expect(manager.get<{ user_version: number }>("PRAGMA user_version")?.user_version).toBe(4);
    expect(manager.all("PRAGMA foreign_key_check")).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("legacy Gateway memberships are not converted into Tenant authority", async () => {
  const manager = openDatabase(":memory:");
  manager.exec("PRAGMA foreign_keys = ON");
  migrateDatabase(manager);
  manager.run(
    `INSERT INTO users
       (id, username, password_hash, is_platform_admin, status, created_at, updated_at)
     VALUES (1, 'legacy-admin', 'hash', 0, 'active', 'now', 'now')`,
  );
  manager.run(
    `INSERT INTO gateways
       (id, name, admin_addr, admin_user, admin_password_enc, status, created_at, updated_at)
     VALUES ('prod', 'Production', 'http://localhost:1', 'admin', 'ciphertext',
             'active', 'now', 'now')`,
  );
  manager.run(
    "INSERT INTO user_gateways (user_id, gateway_id, role) VALUES (1, 'prod', 'admin')",
  );

  const platform = sqlitePlatformDatabase(manager);
  await migratePlatformIdentityDatabase(platform);
  expect(await platform.query("SELECT * FROM platform_tenants")).toEqual([]);
  expect(await platform.query("SELECT * FROM platform_tenant_memberships")).toEqual([]);
  expect(await platform.query("SELECT * FROM platform_tenant_gateway_grants")).toEqual([]);
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
