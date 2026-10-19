import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { PlatformActorReference } from "@/packages/contracts/platform/identity";
import type { PlatformDatabase } from "@/packages/platform/ports/database";
import { PlatformCatalogService } from "@/packages/platform/services/catalog";
import { CatalogRegistry } from "@/packages/platform/services/catalog-registry";
import { PlatformIdentityService } from "@/packages/platform/services/identity";
import { IdentityRegistry } from "@/packages/platform/services/identity-registry";
import { migratePlatformIdentityDatabase } from "@/packages/platform/services/identity-migrations";
import { ModelDefinitionRegistry } from "@/packages/platform/services/model-definition-registry";
import { TenantModelDefinitionService } from "@/packages/platform/services/model-definitions";
import { openPostgresPlatformDatabase, sqlitePlatformDatabase } from "./platform-database";
import { openDatabase } from "./sqlite";

async function verifyModelDefinitions(database: PlatformDatabase) {
  await migratePlatformIdentityDatabase(database);
  const users = new Map([
    [1, { id: 1, username: "operator", active: true, platformAdmin: true, authorityEpoch: 1 }],
    [2, { id: 2, username: "alice", active: true, platformAdmin: false, authorityEpoch: 1 }],
    [3, { id: 3, username: "bob", active: true, platformAdmin: false, authorityEpoch: 1 }],
  ]);
  let sequence = 0;
  let now = new Date("2026-10-19T00:00:00.000Z");
  const identity = new PlatformIdentityService(
    new IdentityRegistry(database),
    {
      async findUser(id) { return users.get(id) ?? null; },
      async findUserByUsername(username) { return [...users.values()].find((user) => user.username === username) ?? null; },
      async listUsers() { return [...users.values()]; },
      async findGateway() { return null; },
    },
    { digest: (token) => `digest:${token}`, issue: () => ({ id: "credential:test", token: `agwmngr_svc_${"1".repeat(64)}`, digest: "digest:test" }) },
    { digest: (token) => `receipt:${token}`, issue: () => ({ token: `agwmngr_member_${"2".repeat(64)}`, digest: "receipt:test" }) },
    () => now,
  );
  const catalog = new PlatformCatalogService(
    new CatalogRegistry(database), identity,
    { async findGateway() { return null; } },
    { digest: (value) => createHash("sha256").update(value).digest("hex"), now: () => now.toISOString() },
  );
  const capability = new Map<string, boolean>();
  const models = new TenantModelDefinitionService(
    new ModelDefinitionRegistry(database), identity, catalog,
    { async check(reference) { return capability.get(reference.offeringId) === false
      ? { available: false, reason: "upstream_missing" as const }
      : { available: true }; } },
    {
      id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
      now: () => now.toISOString(),
      hash: (value) => createHash("sha256").update(value).digest("hex"),
      hashBytes: (value) => createHash("sha256").update(value).digest("hex"),
      decodeBase64: (value) => Buffer.from(value, "base64"),
      encodeBase64: (value) => Buffer.from(value).toString("base64"),
    },
  );
  const admin: PlatformActorReference = { kind: "human", userId: 1 };
  const alice: PlatformActorReference = { kind: "human", userId: 2 };
  const bob: PlatformActorReference = { kind: "human", userId: 3 };
  await identity.createTenant(admin, "alpha", "Alpha");
  await identity.createTenant(admin, "beta", "Beta");
  await identity.bootstrapMembership(admin, "alpha", "user:2", "user");
  await identity.bootstrapMembership(admin, "beta", "user:3", "admin");

  for (const [offeringId, category] of [["primary-model", "model"], ["backup-model", "model"], ["broken-model", "model"], ["search-tool", "tool"]] as const) {
    await catalog.createOffering(admin, {
      offeringId, category, name: offeringId, description: "", kind: "platform-native",
      availability: { mode: "tenant-allowlist", tenantIds: ["alpha"] },
    });
    await catalog.approveOffering(admin, offeringId);
  }
  capability.set("broken-model", false);

  await expect(models.create(alice, "alpha", {
    name: "Leaky model", description: "", offeringId: "primary-model", providerId: "secret-provider",
  } as never)).rejects.toMatchObject({ code: "invalid_input" });
  await expect(models.create(alice, "alpha", {
    name: "Wrong category", description: "", offeringId: "search-tool",
  })).rejects.toMatchObject({ code: "forbidden" });
  await expect(models.create(alice, "alpha", {
    name: "Broken source", description: "", offeringId: "broken-model",
  })).rejects.toMatchObject({ code: "conflict" });

  const created = await models.create(alice, "alpha", {
    name: "Primary chat", description: "Tenant alias", offeringId: "primary-model",
  });
  expect(created).toMatchObject({
    tenantId: "alpha", version: 1, offeringId: "primary-model", offeringVersion: 1,
    status: "active", availability: "available",
  });
  expect(created.digest).toHaveLength(64);
  expect(created.offeringDigest).toHaveLength(64);
  expect(JSON.stringify(created)).not.toContain("provider");
  expect(JSON.stringify(created)).not.toContain("gateway");
  expect(await models.list(bob, "beta")).toEqual([]);
  await expect(models.get(bob, "beta", created.id)).rejects.toMatchObject({ code: "not_found" });

  now = new Date("2026-10-19T01:00:00.000Z");
  const updated = await models.update(alice, "alpha", created.id, {
    name: "Primary chat v2", description: "Fallback switched", offeringId: "backup-model",
  });
  expect(updated.version).toBe(2);
  expect(updated.digest).not.toBe(created.digest);
  expect(updated.offeringId).toBe("backup-model");
  const versions = await database.query<{ version: number; digest: string }>(
    "SELECT version, digest FROM platform_tenant_model_definition_versions WHERE definition_id = ? ORDER BY version",
    [created.id],
  );
  expect(versions.map((row) => Number(row.version))).toEqual([1, 2]);
  expect(await models.resolveReference(alice, "alpha", created.id)).toEqual({
    definitionId: created.id,
    definitionVersion: 2,
    definitionDigest: updated.digest,
    offeringId: "backup-model",
    offeringVersion: 1,
    offeringDigest: updated.offeringDigest,
  });

  await database.query(
    `INSERT INTO platform_tenant_model_definition_refs
      (source_kind, source_id, definition_id, definition_version, created_at) VALUES (?, ?, ?, ?, ?)`,
    ["test_release", "release-1", created.id, 2, now.toISOString()],
  );
  await expect(models.remove(alice, "alpha", created.id)).rejects.toMatchObject({ code: "conflict" });
  await catalog.retireOffering(admin, "backup-model");
  expect(await models.get(alice, "alpha", created.id)).toMatchObject({
    availability: "unavailable", unavailableReason: "offering_unavailable",
  });
  await expect(models.resolveReference(alice, "alpha", created.id)).rejects.toMatchObject({ code: "conflict" });

  await identity.deleteTenant(admin, "alpha");
  expect(await database.query("SELECT id FROM platform_tenant_model_definitions WHERE id = ?", [created.id])).toHaveLength(1);
  await expect(models.list(alice, "alpha")).rejects.toMatchObject({ code: "forbidden" });
}

test("SQLite Tenant models use approved offering-only immutable references", async () => {
  await verifyModelDefinitions(sqlitePlatformDatabase(openDatabase(":memory:")));
});

const postgresUrl = process.env.PLATFORM_TEST_POSTGRES_URL;
test.skipIf(!postgresUrl)("PostgreSQL Tenant models match the SQLite contract", async () => {
  const admin = openPostgresPlatformDatabase(postgresUrl!);
  const name = `agwmngr_models_${crypto.randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(postgresUrl!); url.pathname = `/${name}`;
  const database = openPostgresPlatformDatabase(url.toString());
  try { await verifyModelDefinitions(database); }
  finally { await database.close(); await admin.query(`DROP DATABASE ${name}`); await admin.close(); }
}, 30_000);
