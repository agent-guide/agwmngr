import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { PlatformActorReference } from "@/packages/contracts/platform/identity";
import type { PlatformDatabase } from "@/packages/platform/ports/database";
import { PlatformCatalogService } from "@/packages/platform/services/catalog";
import { CatalogRegistry } from "@/packages/platform/services/catalog-registry";
import { PlatformIdentityService } from "@/packages/platform/services/identity";
import { IdentityRegistry } from "@/packages/platform/services/identity-registry";
import { migratePlatformIdentityDatabase } from "@/packages/platform/services/identity-migrations";
import {
  openPostgresPlatformDatabase,
  sqlitePlatformDatabase,
} from "./platform-database";
import { openDatabase } from "./sqlite";

async function verifyCatalog(database: PlatformDatabase) {
  await migratePlatformIdentityDatabase(database);
  const users = new Map([
    [1, { id: 1, username: "operator", active: true, platformAdmin: true, authorityEpoch: 1 }],
    [2, { id: 2, username: "alice", active: true, platformAdmin: false, authorityEpoch: 1 }],
    [3, { id: 3, username: "bob", active: true, platformAdmin: false, authorityEpoch: 1 }],
    [4, { id: 4, username: "outsider", active: true, platformAdmin: false, authorityEpoch: 1 }],
  ]);
  const gateways = new Map([
    ["prod", { id: "prod", active: true, authorityEpoch: 1 }],
  ]);
  let now = new Date("2026-10-19T00:00:00.000Z");
  const identity = new PlatformIdentityService(
    new IdentityRegistry(database),
    {
      async findUser(id) { return users.get(id) ?? null; },
      async findUserByUsername(username) {
        return [...users.values()].find((user) => user.username === username) ?? null;
      },
      async listUsers() { return [...users.values()]; },
      async findGateway(id) { return gateways.get(id) ?? null; },
    },
    {
      digest: (token) => `digest:${token}`,
      issue: () => ({
        id: "credential:test",
        token: `agwmngr_svc_${"1".repeat(64)}`,
        digest: "digest:test",
      }),
    },
    {
      digest: (token) => `receipt:${token}`,
      issue: () => ({
        token: `agwmngr_member_${"2".repeat(64)}`,
        digest: "receipt:test",
      }),
    },
    () => now,
  );
  const catalog = new PlatformCatalogService(
    new CatalogRegistry(database),
    identity,
    { async findGateway(id) { return gateways.get(id) ?? null; } },
    {
      digest: (value) => createHash("sha256").update(value).digest("hex"),
      now: () => now.toISOString(),
    },
  );
  const admin: PlatformActorReference = { kind: "human", userId: 1 };
  const alice: PlatformActorReference = { kind: "human", userId: 2 };
  const bob: PlatformActorReference = { kind: "human", userId: 3 };
  const outsider: PlatformActorReference = { kind: "human", userId: 4 };

  await identity.createTenant(admin, "alpha", "Alpha");
  await identity.createTenant(admin, "beta", "Beta");
  await identity.bootstrapMembership(admin, "alpha", "user:2", "user");
  await identity.bootstrapMembership(admin, "beta", "user:3", "admin");

  await expect(catalog.listPlatformOfferings(alice)).rejects.toMatchObject({ code: "forbidden" });
  await expect(catalog.createOffering(alice, {
    offeringId: "forbidden",
    category: "model",
    name: "Forbidden",
    description: "",
    kind: "platform-native",
    availability: { mode: "all-active-tenants" },
  })).rejects.toMatchObject({ code: "forbidden" });

  await expect(catalog.createOffering(admin, {
    offeringId: "partial-source",
    category: "model",
    name: "Partial",
    description: "",
    kind: "gateway-backed",
    sourceGatewayId: "prod",
    availability: { mode: "all-active-tenants" },
  })).rejects.toMatchObject({ code: "invalid_input" });
  await expect(catalog.createOffering(admin, {
    offeringId: "mixed-source",
    category: "model",
    name: "Mixed",
    description: "",
    kind: "platform-native",
    sourceGatewayId: "prod",
    upstreamStableId: "route-a",
    availability: { mode: "all-active-tenants" },
  })).rejects.toMatchObject({ code: "invalid_input" });
  await expect(catalog.createOffering(admin, {
    offeringId: "missing-gateway",
    category: "model",
    name: "Missing",
    description: "",
    kind: "gateway-backed",
    sourceGatewayId: "missing",
    upstreamStableId: "route-a",
    availability: { mode: "all-active-tenants" },
  })).rejects.toMatchObject({ code: "invalid_input" });
  await expect(catalog.createOffering(admin, {
    offeringId: "malformed-tool-source",
    category: "tool",
    name: "Malformed tool source",
    description: "",
    kind: "gateway-backed",
    sourceGatewayId: "prod",
    upstreamStableId: "search:query",
    availability: { mode: "all-active-tenants" },
  })).rejects.toMatchObject({
    code: "invalid_input",
    message: "tool upstream stable ID must use mcp:<service-id>:<tool-name>",
  });
  await expect(catalog.createOffering(admin, {
    offeringId: "invalid-tenant",
    category: "tool",
    name: "Invalid Tenant",
    description: "",
    kind: "platform-native",
    availability: { mode: "tenant-allowlist", tenantIds: ["missing"] },
  })).rejects.toMatchObject({ code: "invalid_input" });
  await expect(catalog.createOffering(admin, {
    offeringId: "secret-field",
    category: "model",
    name: "Secret field",
    description: "",
    kind: "gateway-backed",
    sourceGatewayId: "prod",
    upstreamStableId: "route-a",
    availability: { mode: "all-active-tenants" },
    apiKey: "must-not-be-accepted",
  } as Parameters<typeof catalog.createOffering>[1])).rejects.toMatchObject({
    code: "invalid_input",
  });

  const native = await catalog.createOffering(admin, {
    offeringId: "native-model",
    category: "model",
    name: "Native model",
    description: "Platform hosted",
    kind: "platform-native",
    availability: { mode: "tenant-allowlist", tenantIds: ["alpha"] },
  });
  expect(native).toMatchObject({
    ownerPrincipalId: "user:1",
    sourceGatewayId: null,
    upstreamStableId: null,
    status: "draft",
    version: 1,
    sourceAvailable: true,
  });
  expect(native.digest).toHaveLength(64);

  const backed = await catalog.createOffering(admin, {
    offeringId: "gateway-tool",
    category: "tool",
    name: "Gateway tool",
    description: "Approved upstream tool",
    kind: "gateway-backed",
    sourceGatewayId: "prod",
    upstreamStableId: "mcp:search:query",
    availability: { mode: "all-active-tenants" },
  });
  expect(backed).toMatchObject({
    sourceGatewayId: "prod",
    upstreamStableId: "mcp:search:query",
    sourceGatewayAuthorityEpoch: 1,
    sourceAvailable: true,
  });
  expect(Object.keys(backed)).not.toContain("credential");
  expect(Object.keys(backed)).not.toContain("apiKey");
  await expect(catalog.createOffering(admin, {
    offeringId: "native-model",
    category: "model",
    name: "Replacement",
    description: "",
    kind: "platform-native",
    availability: { mode: "all-active-tenants" },
  })).rejects.toMatchObject({ code: "conflict" });

  expect(await catalog.listTenantOfferings(alice, "alpha")).toEqual([]);
  await expect(catalog.listTenantOfferings(outsider, "alpha")).rejects.toMatchObject({
    code: "forbidden",
  });
  await catalog.approveOffering(admin, native.offeringId);
  await catalog.approveOffering(admin, backed.offeringId);

  const alpha = await catalog.listTenantOfferings(alice, "alpha");
  expect(alpha.map((item) => item.offeringId)).toEqual(["native-model", "gateway-tool"]);
  expect(alpha.find((item) => item.offeringId === "gateway-tool")).toEqual({
    offeringId: "gateway-tool",
    category: "tool",
    name: "Gateway tool",
    description: "Approved upstream tool",
    kind: "gateway-backed",
    owner: "platform",
    version: 1,
    digest: backed.digest,
  });
  expect(JSON.stringify(alpha)).not.toContain("sourceGateway");
  expect(JSON.stringify(alpha)).not.toContain("upstreamStable");
  expect(JSON.stringify(alpha)).not.toContain("credential");
  expect((await catalog.listTenantOfferings(bob, "beta")).map((item) => item.offeringId))
    .toEqual(["gateway-tool"]);

  expect(await catalog.resolveReference(alice, "alpha", "gateway-tool", "tool"))
    .toMatchObject({
      offeringId: "gateway-tool",
      sourceGatewayId: "prod",
      upstreamStableId: "mcp:search:query",
      sourceGatewayAuthorityEpoch: 1,
    });
  await expect(catalog.resolveReference(alice, "alpha", "gateway-tool", "model"))
    .rejects.toMatchObject({ code: "forbidden" });

  await catalog.setAvailability(admin, "native-model", {
    mode: "tenant-allowlist",
    tenantIds: ["beta"],
  });
  expect((await catalog.listTenantOfferings(alice, "alpha")).map((item) => item.offeringId))
    .toEqual(["gateway-tool"]);
  expect((await catalog.listTenantOfferings(bob, "beta")).map((item) => item.offeringId))
    .toEqual(["native-model", "gateway-tool"]);

  // A Tenant authority epoch change invalidates the old allowlist row until a
  // Platform Admin explicitly saves it again.
  await identity.setTenantStatus(admin, "beta", "disabled");
  await identity.setTenantStatus(admin, "beta", "active");
  expect((await catalog.listTenantOfferings(bob, "beta")).map((item) => item.offeringId))
    .toEqual(["gateway-tool"]);
  await catalog.setAvailability(admin, "native-model", {
    mode: "tenant-allowlist",
    tenantIds: ["beta"],
  });
  expect((await catalog.listTenantOfferings(bob, "beta")).map((item) => item.offeringId))
    .toEqual(["native-model", "gateway-tool"]);

  // A replacement Gateway identity cannot inherit an old source binding.
  gateways.set("prod", { id: "prod", active: false, authorityEpoch: 2 });
  expect((await catalog.listTenantOfferings(bob, "beta")).map((item) => item.offeringId))
    .toEqual(["native-model"]);
  gateways.set("prod", { id: "prod", active: true, authorityEpoch: 3 });
  expect((await catalog.listTenantOfferings(bob, "beta")).map((item) => item.offeringId))
    .toEqual(["native-model"]);
  expect((await catalog.listPlatformOfferings(admin)).find(
    (item) => item.offeringId === "gateway-tool",
  )?.sourceAvailable).toBe(false);

  await catalog.retireOffering(admin, "native-model");
  expect((await catalog.listTenantOfferings(bob, "beta")).map((item) => item.offeringId))
    .toEqual([]);
  await expect(catalog.approveOffering(admin, "native-model")).rejects.toMatchObject({
    code: "conflict",
  });
  await expect(catalog.setAvailability(admin, "native-model", {
    mode: "all-active-tenants",
  })).rejects.toMatchObject({ code: "conflict" });

  now = new Date("2026-10-19T01:00:00.000Z");
  await catalog.createOffering(admin, {
    offeringId: "delete-isolation",
    category: "model",
    name: "Delete isolation",
    description: "",
    kind: "platform-native",
    availability: { mode: "tenant-allowlist", tenantIds: ["alpha"] },
  });
  await identity.deleteTenant(admin, "alpha");
  expect(await database.query(
    "SELECT tenant_id FROM platform_catalog_tenant_availability WHERE offering_id = ?",
    ["delete-isolation"],
  )).toEqual([]);
  await expect(identity.createTenant(admin, "alpha", "Replacement Alpha"))
    .rejects.toMatchObject({ code: "conflict" });
}

test("SQLite catalog enforces platform ownership, Tenant availability, and source fencing", async () => {
  await verifyCatalog(sqlitePlatformDatabase(openDatabase(":memory:")));
});

const postgresUrl = process.env.PLATFORM_TEST_POSTGRES_URL;
test.skipIf(!postgresUrl)(
  "PostgreSQL catalog matches the SQLite authority and lifecycle contract",
  async () => {
    const admin = openPostgresPlatformDatabase(postgresUrl!);
    const name = `agwmngr_catalog_${crypto.randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(postgresUrl!);
    url.pathname = `/${name}`;
    const database = openPostgresPlatformDatabase(url.toString());
    try {
      await verifyCatalog(database);
    } finally {
      await database.close();
      await admin.query(`DROP DATABASE ${name}`);
      await admin.close();
    }
  },
  30_000,
);
