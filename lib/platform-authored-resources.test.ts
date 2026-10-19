import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { PlatformActorReference } from "@/packages/contracts/platform/identity";
import type { PlatformDatabase } from "@/packages/platform/ports/database";
import { AuthoredResourceRegistry } from "@/packages/platform/services/authored-resource-registry";
import { AuthoredResourceService } from "@/packages/platform/services/authored-resources";
import { PlatformIdentityService } from "@/packages/platform/services/identity";
import { IdentityRegistry } from "@/packages/platform/services/identity-registry";
import { migratePlatformIdentityDatabase } from "@/packages/platform/services/identity-migrations";
import { openPostgresPlatformDatabase, sqlitePlatformDatabase } from "./platform-database";
import { openDatabase } from "./sqlite";

async function verifyAuthoredResources(database: PlatformDatabase) {
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
      async findUserByUsername(username) {
        return [...users.values()].find((user) => user.username === username) ?? null;
      },
      async listUsers() { return [...users.values()]; },
      async findGateway() { return null; },
    },
    {
      digest: (token) => `digest:${token}`,
      issue: () => ({ id: "credential:test", token: `agwmngr_svc_${"1".repeat(64)}`, digest: "digest:test" }),
    },
    {
      digest: (token) => `receipt:${token}`,
      issue: () => ({ token: `agwmngr_member_${"2".repeat(64)}`, digest: "receipt:test" }),
    },
    () => now,
  );
  const resources = new AuthoredResourceService(
    new AuthoredResourceRegistry(database),
    identity,
    {
      id: () => `id-${++sequence}`,
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

  const skillContent = {
    text: "",
    files: [{ path: "SKILL.md", data: Buffer.from("# Search\n").toString("base64") }],
    tags: ["search"],
  };
  const tenantSkill = await resources.createTenant(alice, "alpha", "skill", {
    name: "Search skill",
    description: "Tenant-owned",
    content: skillContent,
  });
  expect(tenantSkill.resource).toMatchObject({
    kind: "skill",
    owner: { kind: "tenant", tenantId: "alpha" },
    latestRevisionNumber: 1,
  });
  expect(tenantSkill.revisions[0].contentHash).toHaveLength(64);
  expect((await resources.listTenant(alice, "alpha", "skill")).map((item) => item.id))
    .toEqual([tenantSkill.resource.id]);
  expect(await resources.listTenant(bob, "beta", "skill")).toEqual([]);
  await expect(resources.getTenant(bob, "beta", "skill", tenantSkill.resource.id))
    .rejects.toMatchObject({ code: "not_found" });
  await expect(resources.updateMetadata(bob, "beta", "skill", tenantSkill.resource.id, {
    name: "stolen", description: "",
  })).rejects.toMatchObject({ code: "not_found" });

  const shared = await resources.createPlatform(admin, "instruction", {
    name: "Safety instruction",
    description: "Shared",
    content: { text: "Be safe.", files: [], tags: ["safety"] },
  }, { mode: "tenant-allowlist", tenantIds: ["alpha"] });
  expect(shared.resource).toMatchObject({ owner: { kind: "platform" } });
  expect((await resources.listTenant(alice, "alpha", "instruction"))[0]).toMatchObject({
    id: shared.resource.id,
    owner: { kind: "platform" },
  });
  expect(await resources.listTenant(bob, "beta", "instruction")).toEqual([]);
  await expect(resources.addRevision(alice, "alpha", "instruction", shared.resource.id, {
    text: "Mutation denied", files: [], tags: [],
  })).rejects.toMatchObject({ code: "not_found" });
  await resources.setPlatformAvailability(admin, "instruction", shared.resource.id, {
    mode: "all-active-tenants", tenantIds: [],
  });
  expect((await resources.listTenant(bob, "beta", "instruction"))[0]?.id)
    .toBe(shared.resource.id);
  await resources.remove(admin, null, "instruction", shared.resource.id);
  await expect(resources.updateMetadata(admin, null, "instruction", shared.resource.id, {
    name: "Changed after archive", description: "",
  })).rejects.toMatchObject({ code: "conflict" });
  expect((await resources.getPlatform(admin, "instruction", shared.resource.id)).resource)
    .toMatchObject({ name: "Safety instruction", status: "archived" });

  now = new Date("2026-10-19T01:00:00.000Z");
  const second = await resources.addRevision(alice, "alpha", "skill", tenantSkill.resource.id, {
    ...skillContent,
    files: [{ path: "SKILL.md", data: Buffer.from("# Search v2\n").toString("base64") }],
  });
  expect(second.number).toBe(2);
  await resources.setRevisionStatus(alice, "alpha", "skill", tenantSkill.resource.id, second.id, "published");
  await database.query(
    "INSERT INTO platform_authored_revision_refs (source_kind, source_id, revision_id, created_at) VALUES (?, ?, ?, ?)",
    ["test_release", "release-1", second.id, now.toISOString()],
  );
  await expect(resources.setRevisionStatus(
    alice, "alpha", "skill", tenantSkill.resource.id, second.id, "archived",
  )).rejects.toMatchObject({ code: "conflict" });
  await expect(resources.remove(alice, "alpha", "skill", tenantSkill.resource.id))
    .rejects.toMatchObject({ code: "conflict" });
  expect((await resources.getTenant(alice, "alpha", "skill", tenantSkill.resource.id)).revisions)
    .toHaveLength(2);

  await expect(resources.createTenant(alice, "alpha", "skill", {
    name: "Unsafe", description: "", content: {
      text: "", files: [{ path: "../SKILL.md", data: "" }], tags: [],
    },
  })).rejects.toMatchObject({ code: "invalid_input" });
  await expect(resources.createTenant(alice, "alpha", "instruction", {
    name: "Secret shape", description: "", content: { text: "x", files: [], tags: [] },
    apiKey: "must be rejected",
  } as never)).rejects.toMatchObject({ code: "invalid_input" });

  const epochSkill = await resources.createTenant(alice, "alpha", "skill", {
    name: "Epoch fenced", description: "", content: skillContent,
  });
  await identity.setTenantStatus(admin, "alpha", "disabled");
  await identity.setTenantStatus(admin, "alpha", "active");
  expect(await resources.listTenant(alice, "alpha", "skill")).toEqual([]);
  await expect(resources.addRevision(alice, "alpha", "skill", epochSkill.resource.id, skillContent))
    .rejects.toMatchObject({ code: "not_found" });
  await expect(resources.setRevisionStatus(
    alice, "alpha", "skill", epochSkill.resource.id, epochSkill.revisions[0].id, "published",
  )).rejects.toMatchObject({ code: "not_found" });
  await expect(resources.remove(alice, "alpha", "skill", epochSkill.resource.id))
    .rejects.toMatchObject({ code: "not_found" });
  expect(await database.query(
    "SELECT id FROM platform_authored_resources WHERE id = ?",
    [epochSkill.resource.id],
  )).toHaveLength(1);

  const deleteIsolation = await resources.createPlatform(admin, "skill", {
    name: "Delete isolation",
    description: "",
    content: skillContent,
  }, { mode: "tenant-allowlist", tenantIds: ["alpha"] });
  expect(await database.query(
    "SELECT tenant_id FROM platform_authored_resource_availability WHERE resource_id = ?",
    [deleteIsolation.resource.id],
  )).toEqual([{ tenant_id: "alpha" }]);

  await identity.deleteTenant(admin, "alpha");
  expect(await database.query(
    "SELECT tenant_id FROM platform_authored_resource_availability WHERE resource_id = ?",
    [deleteIsolation.resource.id],
  )).toEqual([]);
  expect(await database.query(
    "SELECT id FROM platform_authored_resources WHERE id = ?",
    [tenantSkill.resource.id],
  )).toHaveLength(1);
  await expect(resources.listTenant(alice, "alpha", "skill"))
    .rejects.toMatchObject({ code: "forbidden" });
  await expect(identity.createTenant(admin, "alpha", "Replacement Alpha"))
    .rejects.toMatchObject({ code: "conflict" });
}

test("SQLite authored resources enforce scope, immutable revisions, and reference safety", async () => {
  await verifyAuthoredResources(sqlitePlatformDatabase(openDatabase(":memory:")));
});

const postgresUrl = process.env.PLATFORM_TEST_POSTGRES_URL;
test.skipIf(!postgresUrl)(
  "PostgreSQL authored resources match the SQLite contract",
  async () => {
    const admin = openPostgresPlatformDatabase(postgresUrl!);
    const name = `agwmngr_resources_${crypto.randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(postgresUrl!);
    url.pathname = `/${name}`;
    const database = openPostgresPlatformDatabase(url.toString());
    try {
      await verifyAuthoredResources(database);
    } finally {
      await database.close();
      await admin.query(`DROP DATABASE ${name}`);
      await admin.close();
    }
  },
  30_000,
);
