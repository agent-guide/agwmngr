import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { AgentDefinitionDraft } from "@/packages/contracts/platform/agents";
import type { PlatformActorReference } from "@/packages/contracts/platform/identity";
import type { PlatformDatabase } from "@/packages/platform/ports/database";
import type { ObjectStore } from "@/packages/platform/ports/objects";
import { AgentDefinitionRegistry } from "@/packages/platform/services/agent-definition-registry";
import { AgentDefinitionService, canonicalAgentValue } from "@/packages/platform/services/agent-definitions";
import { AgentReleaseRegistry } from "@/packages/platform/services/agent-release-registry";
import { AgentReleaseService } from "@/packages/platform/services/agent-releases";
import { AuthoredResourceRegistry } from "@/packages/platform/services/authored-resource-registry";
import { AuthoredResourceService } from "@/packages/platform/services/authored-resources";
import { CatalogRegistry } from "@/packages/platform/services/catalog-registry";
import { PlatformCatalogService } from "@/packages/platform/services/catalog";
import { IdentityRegistry } from "@/packages/platform/services/identity-registry";
import { migratePlatformIdentityDatabase } from "@/packages/platform/services/identity-migrations";
import { PlatformIdentityService } from "@/packages/platform/services/identity";
import { KnowledgeRegistry } from "@/packages/platform/services/knowledge-registry";
import { KnowledgeService } from "@/packages/platform/services/knowledge";
import { ModelDefinitionRegistry } from "@/packages/platform/services/model-definition-registry";
import { TenantModelDefinitionService } from "@/packages/platform/services/model-definitions";
import { ToolDefinitionRegistry } from "@/packages/platform/services/tool-definition-registry";
import { TenantToolDefinitionService } from "@/packages/platform/services/tool-definitions";
import { openPostgresPlatformDatabase, sqlitePlatformDatabase } from "./platform-database";
import { openDatabase } from "./sqlite";

const emptyObjects: ObjectStore = {
  async put() { throw new Error("not used"); },
  async stat() { return null; },
  async read() { throw new Error("not used"); },
  async remove() {},
};

function builtinDraft(input: Partial<AgentDefinitionDraft> = {}): AgentDefinitionDraft {
  return {
    name: "Research assistant",
    description: "Tenant-owned draft",
    systemPrompt: "Answer with evidence.",
    runtime: {
      type: "builtin",
      advanced: {
        topology: { kind: "single", maxIterations: 4 },
        generation: { maxTokens: 2_048, temperature: 0.2 },
        permissions: { mode: "interactive", timeoutSeconds: 300, maxPending: 10 },
      },
    },
    resources: {
      modelDefinitionId: null,
      toolDefinitionIds: [],
      skillRevisionIds: [],
      instructionRevisionIds: [],
      knowledgeBaseIds: [],
    },
    policy: { maxAgentDepth: 3, budget: { maxTurnsPerDay: 100 } },
    ...input,
  };
}

async function verifyAgentDefinitions(database: PlatformDatabase) {
  await migratePlatformIdentityDatabase(database);
  const users = new Map([
    [1, { id: 1, username: "operator", active: true, platformAdmin: true, authorityEpoch: 1 }],
    [2, { id: 2, username: "alice", active: true, platformAdmin: false, authorityEpoch: 1 }],
    [3, { id: 3, username: "bob", active: true, platformAdmin: false, authorityEpoch: 1 }],
  ]);
  let sequence = 0;
  let now = new Date("2026-10-20T00:00:00.000Z");
  const runtime = {
    id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    now: () => now.toISOString(),
    hash: (value: string) => createHash("sha256").update(value).digest("hex"),
    hashBytes: (value: Uint8Array) => createHash("sha256").update(value).digest("hex"),
    decodeBase64: (value: string) => Buffer.from(value, "base64"),
    encodeBase64: (value: Uint8Array) => Buffer.from(value).toString("base64"),
  };
  const identity = new PlatformIdentityService(
    new IdentityRegistry(database),
    {
      async findUser(id) { return users.get(id) ?? null; },
      async findUserByUsername(username) { return [...users.values()].find((user) => user.username === username) ?? null; },
      async listUsers() { return [...users.values()]; },
      async findGateway(id) { return id === "prod" ? { id, active: true, authorityEpoch: 1 } : null; },
    },
    { digest: (token) => `digest:${token}`, issue: () => ({ id: "credential:test", token: `agwmngr_svc_${"1".repeat(64)}`, digest: "digest:test" }) },
    { digest: (token) => `receipt:${token}`, issue: () => ({ token: `agwmngr_member_${"2".repeat(64)}`, digest: "receipt:test" }) },
    () => now,
  );
  const catalog = new PlatformCatalogService(
    new CatalogRegistry(database), identity,
    { async findGateway(id) { return id === "prod" ? { id, active: true, authorityEpoch: 1 } : null; } },
    { digest: runtime.hash, now: runtime.now },
  );
  const capabilities = { async check() { return { available: true as const }; } };
  const authored = new AuthoredResourceService(new AuthoredResourceRegistry(database), identity, runtime);
  const knowledge = new KnowledgeService(new KnowledgeRegistry(database), identity, emptyObjects, runtime);
  const models = new TenantModelDefinitionService(
    new ModelDefinitionRegistry(database), identity, catalog, capabilities, runtime,
  );
  const tools = new TenantToolDefinitionService(
    new ToolDefinitionRegistry(database), identity, catalog, capabilities, runtime,
  );
  const agents = new AgentDefinitionService(
    new AgentDefinitionRegistry(database), identity, authored, knowledge, models, tools, runtime,
  );
  const releases = new AgentReleaseService(
    new AgentReleaseRegistry(database), identity, agents, authored, models, tools, catalog, runtime,
  );
  const operator: PlatformActorReference = { kind: "human", userId: 1 };
  const alice: PlatformActorReference = { kind: "human", userId: 2 };
  const bob: PlatformActorReference = { kind: "human", userId: 3 };
  await identity.createTenant(operator, "alpha", "Alpha");
  await identity.createTenant(operator, "beta", "Beta");
  await identity.bootstrapMembership(operator, "alpha", "user:2", "user");
  await identity.bootstrapMembership(operator, "beta", "user:3", "admin");

  for (const [offeringId, category] of [["chat-model", "model"], ["search-tool", "tool"]] as const) {
    await catalog.createOffering(operator, {
      offeringId, category, name: offeringId, description: "", kind: "gateway-backed",
      sourceGatewayId: "prod",
      upstreamStableId: category === "model" ? "chat-route" : "mcp:search:query",
      availability: { mode: "tenant-allowlist", tenantIds: ["alpha"] },
    });
    await catalog.approveOffering(operator, offeringId);
  }
  const model = await models.create(alice, "alpha", {
    name: "Chat model", description: "", offeringId: "chat-model",
  });
  const tool = await tools.create(alice, "alpha", {
    name: "Search", description: "", offeringId: "search-tool",
  });
  const skill = await authored.createTenant(alice, "alpha", "skill", {
    name: "Evidence", description: "", content: {
      text: "", files: [{ path: "SKILL.md", data: Buffer.from("# Evidence").toString("base64") }], tags: [],
    },
  });
  const instruction = await authored.createTenant(alice, "alpha", "instruction", {
    name: "Safety", description: "", content: { text: "Be safe.", files: [], tags: [] },
  });
  const knowledgeBase = await knowledge.create(alice, "alpha", { name: "Docs", description: "" });
  const draft = builtinDraft({
    resources: {
      modelDefinitionId: model.id,
      toolDefinitionIds: [tool.id],
      skillRevisionIds: [skill.revisions[0].id],
      instructionRevisionIds: [instruction.revisions[0].id],
      knowledgeBaseIds: [knowledgeBase.id],
    },
  });

  await expect(agents.create(operator, "alpha", {
    slug: "operator-denied", expectedVersion: 0, draft,
  })).rejects.toMatchObject({ code: "forbidden" });
  await expect(agents.create(alice, "alpha", {
    slug: "leaky", expectedVersion: 0,
    draft: { ...draft, runtime: { type: "http", advanced: {
      cardUrl: "https://example.test/card.json", apiToken: "secret",
    } } } as never,
  })).rejects.toMatchObject({ code: "invalid_input" });
  await expect(agents.create(alice, "alpha", {
    slug: "bad-http", expectedVersion: 0,
    draft: { ...draft, runtime: { type: "http", advanced: { cardUrl: "http://example.test/card.json" } } },
  })).rejects.toMatchObject({ code: "invalid_input" });

  const created = await agents.create(alice, "alpha", {
    slug: "research", expectedVersion: 0, draft,
  });
  expect(created).toMatchObject({
    id: "agent:alpha:research", tenantId: "alpha", slug: "research",
    version: 1, editable: true, status: "active",
  });
  expect(created.draftDigest).toHaveLength(64);
  expect(created.dependencies.map((item) => item.kind)).toEqual([
    "model_definition", "tool_definition", "skill_revision", "instruction_revision", "knowledge_base",
  ]);
  expect(JSON.stringify(created)).not.toMatch(/sourceGateway|upstreamStable|credential|apiKey/);
  await expect(agents.create(alice, "alpha", {
    slug: "research", expectedVersion: 0, draft,
  })).rejects.toMatchObject({ code: "conflict" });
  expect(await agents.list(bob, "beta")).toEqual([]);
  await expect(agents.get(bob, "beta", created.id)).rejects.toMatchObject({ code: "not_found" });

  await expect(authored.setRevisionStatus(
    alice, "alpha", "skill", skill.resource.id, skill.revisions[0].id, "archived",
  )).rejects.toMatchObject({ code: "conflict" });
  await expect(models.remove(alice, "alpha", model.id)).rejects.toMatchObject({ code: "conflict" });
  await expect(knowledge.remove(alice, "alpha", knowledgeBase.id)).rejects.toMatchObject({ code: "conflict" });

  await expect(releases.create(alice, "alpha", created.id, 1))
    .rejects.toMatchObject({ code: "conflict", message: "knowledge retrieval is unavailable for Agent releases" });
  const unpublished = await agents.create(alice, "alpha", {
    slug: "unpublished", expectedVersion: 0, draft: builtinDraft({ resources: {
      modelDefinitionId: model.id,
      toolDefinitionIds: [], skillRevisionIds: [skill.revisions[0].id],
      instructionRevisionIds: [], knowledgeBaseIds: [],
    } }),
  });
  await expect(releases.create(alice, "alpha", unpublished.id, 1))
    .rejects.toMatchObject({ code: "conflict", message: "skill revision is missing, archived or unpublished" });
  const httpDefinition = await agents.create(alice, "alpha", {
    slug: "remote", expectedVersion: 0, draft: builtinDraft({
      runtime: { type: "http", advanced: { cardUrl: "https://example.test/card.json" } },
    }),
  });
  await expect(releases.create(alice, "alpha", httpDefinition.id, 1))
    .rejects.toMatchObject({ code: "conflict", message: "only builtin Agent definitions can create releases in Step 5" });
  await authored.setRevisionStatus(
    alice, "alpha", "skill", skill.resource.id, skill.revisions[0].id, "published",
  );
  await authored.setRevisionStatus(
    alice, "alpha", "instruction", instruction.resource.id, instruction.revisions[0].id, "published",
  );

  now = new Date("2026-10-20T01:00:00.000Z");
  const updated = await agents.update(alice, "alpha", created.id, {
    expectedVersion: 1,
    draft: { ...draft, name: "Research assistant v2", resources: {
      ...draft.resources,
      knowledgeBaseIds: [],
    } },
  });
  expect(updated).toMatchObject({ version: 2, draft: { name: "Research assistant v2" } });
  expect(updated.draftDigest).not.toBe(created.draftDigest);
  await expect(agents.update(alice, "alpha", created.id, {
    expectedVersion: 1, draft: updated.draft,
  })).rejects.toMatchObject({ code: "conflict" });

  const release = await releases.create(alice, "alpha", created.id, 2);
  expect(release).toMatchObject({
    definitionId: created.id,
    tenantId: "alpha",
    number: 1,
    draftVersion: 2,
    runtimeType: "builtin",
    snapshot: { name: "Research assistant v2" },
  });
  expect(release.digest).toHaveLength(64);
  expect(JSON.stringify(release)).not.toMatch(/sourceGateway|upstreamStable|chat-route|mcp:search:query/);
  const [storedRelease] = await database.query<{
    internal_dependencies_json: string;
    execution_json: string;
  }>(
    "SELECT internal_dependencies_json, execution_json FROM platform_agent_releases WHERE id = ?", [release.id],
  );
  expect(storedRelease.internal_dependencies_json).toContain("sourceGatewayId");
  expect(storedRelease.internal_dependencies_json).toContain("prod");
  expect(release.digest).toBe(runtime.hash(canonicalAgentValue({
    definitionId: created.id,
    draftVersion: release.draftVersion,
    snapshot: release.snapshot,
    dependencies: JSON.parse(storedRelease.internal_dependencies_json),
    execution: JSON.parse(storedRelease.execution_json),
  })));
  await expect(releases.get(bob, "beta", created.id, release.id))
    .rejects.toMatchObject({ code: "not_found" });
  await expect(releases.create(alice, "alpha", created.id, 2))
    .rejects.toMatchObject({ code: "conflict", message: "an identical immutable release already exists" });

  const detached = await agents.update(alice, "alpha", created.id, {
    expectedVersion: 2,
    draft: { ...updated.draft, name: "Draft after release", resources: {
      modelDefinitionId: null,
      toolDefinitionIds: [],
      skillRevisionIds: [],
      instructionRevisionIds: [],
      knowledgeBaseIds: [],
    } },
  });
  expect(detached.version).toBe(3);
  expect((await releases.get(alice, "alpha", created.id, release.id)).snapshot.name)
    .toBe("Research assistant v2");
  expect((await releases.list(alice, "alpha", created.id)).map((item) => item.id)).toEqual([release.id]);
  await expect(models.remove(alice, "alpha", model.id)).rejects.toMatchObject({ code: "conflict" });
  await expect(authored.setRevisionStatus(
    alice, "alpha", "skill", skill.resource.id, skill.revisions[0].id, "archived",
  )).rejects.toMatchObject({ code: "conflict" });
  await knowledge.remove(alice, "alpha", knowledgeBase.id);

  const currentModel = await models.update(alice, "alpha", model.id, {
    name: "Chat model v2", description: "", offeringId: "chat-model",
  });
  const staleDefinition = await agents.create(alice, "alpha", {
    slug: "stale", expectedVersion: 0, draft: builtinDraft({ resources: {
      modelDefinitionId: currentModel.id,
      toolDefinitionIds: [], skillRevisionIds: [], instructionRevisionIds: [], knowledgeBaseIds: [],
    } }),
  });
  await models.update(alice, "alpha", model.id, {
    name: "Chat model v3", description: "", offeringId: "chat-model",
  });
  await expect(releases.create(alice, "alpha", staleDefinition.id, 1))
    .rejects.toMatchObject({ code: "conflict", message: "model definition changed after the draft was saved" });

  await agents.remove(alice, "alpha", created.id);
  expect(await agents.get(alice, "alpha", created.id)).toMatchObject({ status: "archived", editable: false });
  await expect(agents.update(alice, "alpha", created.id, {
    expectedVersion: 3, draft: updated.draft,
  })).rejects.toMatchObject({ code: "conflict" });

  const retained = await agents.create(alice, "alpha", {
    slug: "retained", expectedVersion: 0, draft: builtinDraft(),
  });
  await identity.deleteTenant(operator, "alpha");
  expect(await database.query("SELECT id FROM platform_agent_definitions WHERE id = ?", [retained.id])).toHaveLength(1);
  expect(await database.query("SELECT id FROM platform_agent_releases WHERE id = ?", [release.id])).toHaveLength(1);
  await expect(agents.list(alice, "alpha")).rejects.toMatchObject({ code: "forbidden" });
  await expect(releases.list(alice, "alpha", created.id)).rejects.toMatchObject({ code: "forbidden" });
}

test("SQLite Agent definitions enforce Tenant ownership, exact references, and optimistic drafts", async () => {
  await verifyAgentDefinitions(sqlitePlatformDatabase(openDatabase(":memory:")));
});

const postgresUrl = process.env.PLATFORM_TEST_POSTGRES_URL;
test.skipIf(!postgresUrl)("PostgreSQL Agent definitions match the SQLite contract", async () => {
  const admin = openPostgresPlatformDatabase(postgresUrl!);
  const name = `agwmngr_agents_${crypto.randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(postgresUrl!); url.pathname = `/${name}`;
  const database = openPostgresPlatformDatabase(url.toString());
  try { await verifyAgentDefinitions(database); }
  finally { await database.close(); await admin.query(`DROP DATABASE ${name}`); await admin.close(); }
}, 30_000);
