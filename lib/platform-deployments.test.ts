import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { PlatformActorReference } from "@/packages/contracts/platform/identity";
import type { ContentRuntime } from "@/packages/platform/ports/content";
import type { PlatformDatabase } from "@/packages/platform/ports/database";
import { AgentReleaseRegistry } from "@/packages/platform/services/agent-release-registry";
import { AgentDeploymentRegistry } from "@/packages/platform/services/deployment-registry";
import { AgentDeploymentService } from "@/packages/platform/services/deployments";
import { IdentityRegistry } from "@/packages/platform/services/identity-registry";
import { migratePlatformIdentityDatabase } from "@/packages/platform/services/identity-migrations";
import { PlatformIdentityService } from "@/packages/platform/services/identity";
import { openPostgresPlatformDatabase, sqlitePlatformDatabase } from "./platform-database";
import { openDatabase } from "./sqlite";

const operator: PlatformActorReference = { kind: "human", userId: 1 };
const alice: PlatformActorReference = { kind: "human", userId: 2 };
const bob: PlatformActorReference = { kind: "human", userId: 3 };

async function verifyDeploymentIntents(database: PlatformDatabase) {
  await migratePlatformIdentityDatabase(database);
  const users = new Map([
    [1, { id: 1, username: "operator", active: true, platformAdmin: true, authorityEpoch: 1 }],
    [2, { id: 2, username: "alice", active: true, platformAdmin: false, authorityEpoch: 1 }],
    [3, { id: 3, username: "bob", active: true, platformAdmin: false, authorityEpoch: 1 }],
  ]);
  const gateways = new Map([
    ["prod", { id: "prod", active: true, authorityEpoch: 1 }],
    ["other", { id: "other", active: true, authorityEpoch: 1 }],
  ]);
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
      issue: () => ({ token: `agwmngr_member_${"2".repeat(64)}`, digest: "receipt:test" }),
    },
    () => new Date("2026-10-21T00:00:00.000Z"),
  );
  await identity.createTenant(operator, "alpha", "Alpha");
  await identity.createTenant(operator, "beta", "Beta");
  await identity.bootstrapMembership(operator, "alpha", "user:2", "admin");
  await identity.bootstrapMembership(operator, "alpha", "user:3", "user");
  await identity.setTenantGatewayGrant(operator, "user:2", "alpha", "prod", "manage");
  await identity.setTenantGatewayGrant(operator, "user:2", "alpha", "other", "manage");
  const [tenant] = await database.query<{ authority_epoch: number }>(
    `SELECT authority_epoch FROM platform_authority_fences
      WHERE subject_kind = 'tenant' AND subject_id = 'alpha' AND tenant_id = ''`,
  );
  const draft = {
    name: "Research assistant",
    description: "Evidence first",
    systemPrompt: "Answer with evidence.",
    runtime: { type: "builtin", advanced: { topology: { kind: "single" } } },
    resources: {
      modelDefinitionId: "model:alpha:chat",
      toolDefinitionIds: ["tool:alpha:search"],
      skillRevisionIds: ["revision:skill"],
      instructionRevisionIds: [],
      knowledgeBaseIds: [],
    },
    policy: {},
  };
  const internalDependencies = [
    {
      kind: "model_definition",
      definitionId: "model:alpha:chat",
      definitionVersion: 1,
      definitionDigest: "model-digest",
      offeringId: "chat",
      offeringVersion: 1,
      offeringDigest: "offering-chat",
      offeringKind: "gateway-backed",
      sourceGatewayId: "prod",
      upstreamStableId: "chat-route",
      sourceGatewayAuthorityEpoch: 1,
    },
    {
      kind: "tool_definition",
      definitionId: "tool:alpha:search",
      definitionVersion: 1,
      definitionDigest: "tool-digest",
      offeringId: "search",
      offeringVersion: 1,
      offeringDigest: "offering-search",
      offeringKind: "gateway-backed",
      sourceGatewayId: "prod",
      upstreamStableId: "mcp:search:query",
      sourceGatewayAuthorityEpoch: 1,
    },
    {
      kind: "skill_revision",
      resourceId: "skill:alpha:evidence",
      revisionId: "revision:skill",
      revisionNumber: 1,
      contentHash: "skill-digest",
      name: "Evidence",
      description: "Cite sources",
      content: {
        text: "",
        files: [{ path: "SKILL.md", data: Buffer.from("# Evidence\nCite sources.").toString("base64") }],
        tags: [],
      },
    },
  ];
  const execution = {
    type: "builtin",
    model: internalDependencies[0],
    tools: [internalDependencies[1]],
    skills: [internalDependencies[2]],
    systemPrompt: "Answer with evidence.",
    advanced: { topology: { kind: "single" } },
    policy: {},
  };
  await database.query(
    `INSERT INTO platform_agent_definitions
      (id, slug, tenant_id, tenant_authority_epoch, status, version, draft_json,
       draft_digest, dependencies_json, created_by_principal_id, updated_by_principal_id,
       created_at, updated_at)
     VALUES ('agent:alpha:research', 'research', 'alpha', ?, 'active', 1, ?,
       'draft-digest', '[]', 'user:2', 'user:2', 'now', 'now')`,
    [Number(tenant.authority_epoch), JSON.stringify(draft)],
  );
  await database.query(
    `INSERT INTO platform_agent_releases
      (id, definition_id, tenant_id, tenant_authority_epoch, number, draft_version,
       snapshot_json, dependencies_json, internal_dependencies_json, execution_json,
       runtime_type, digest, created_by_principal_id, created_at)
     VALUES ('release:one', 'agent:alpha:research', 'alpha', ?, 1, 1, ?, '[]', ?, ?,
       'builtin', 'release-digest', 'user:2', 'now')`,
    [Number(tenant.authority_epoch), JSON.stringify(draft), JSON.stringify(internalDependencies),
      JSON.stringify(execution)],
  );
  const runtime: ContentRuntime = {
    id: () => "unused",
    now: () => "2026-10-21T00:00:00.000Z",
    hash: (value) => createHash("sha256").update(value).digest("hex"),
    hashBytes: (value) => createHash("sha256").update(value).digest("hex"),
    decodeBase64: (value) => Buffer.from(value, "base64"),
    encodeBase64: (value) => Buffer.from(value).toString("base64"),
  };
  const service = new AgentDeploymentService(
    new AgentDeploymentRegistry(database),
    new AgentReleaseRegistry(database),
    identity,
    runtime,
  );

  await expect(service.create(operator, "alpha", {
    releaseId: "release:one", gatewayId: "prod", requestKey: "operator-denied",
  })).rejects.toMatchObject({ code: "forbidden" });
  await expect(service.create(bob, "alpha", {
    releaseId: "release:one", gatewayId: "prod", requestKey: "user-denied",
  })).rejects.toMatchObject({ code: "forbidden" });

  const created = await service.create(alice, "alpha", {
    releaseId: "release:one", gatewayId: "prod", requestKey: "first-deploy",
  });
  expect(created).toMatchObject({
    tenantId: "alpha",
    definitionId: "agent:alpha:research",
    requestedReleaseId: "release:one",
    appliedReleaseId: null,
    lifecycleState: "awaiting_key_binding",
    operationState: "stable",
    invocationEpoch: 1,
    target: { gatewayId: "prod" },
  });
  expect(created.target.gatewayAgentId).toMatch(/^pl-alpha-research-/);
  expect(created.target.gatewayRouteId).toMatch(/^pl-agent-/);
  expect(created.target.pathPrefix).toMatch(/^\/agents\/alpha\/research-/);
  expect(JSON.stringify(created)).not.toMatch(/sourceGateway|upstreamStable|chat-route|mcp:search/);
  expect(await service.create(alice, "alpha", {
    releaseId: "release:one", gatewayId: "prod", requestKey: "first-deploy",
  })).toEqual(created);
  expect(await database.query("SELECT id FROM platform_deployment_operations")).toHaveLength(0);
  expect(await database.query("SELECT deployment_id FROM platform_deployment_pair_fences")).toHaveLength(0);
  expect(await database.query("SELECT deployment_id FROM platform_deployment_key_bindings")).toHaveLength(0);

  await expect(service.create(alice, "alpha", {
    releaseId: "release:one", gatewayId: "other", requestKey: "wrong-source",
  })).rejects.toMatchObject({
    code: "conflict",
    message: "release dependencies do not belong to the selected Gateway",
  });
  expect((await service.list(alice, "alpha")).map((item) => item.id)).toEqual([created.id]);
  await expect(service.list(bob, "alpha")).rejects.toMatchObject({ code: "forbidden" });

  const disposable = await service.create(alice, "alpha", {
    releaseId: "release:one", gatewayId: "prod", requestKey: "cancel-me",
  });
  await service.cancel(alice, "alpha", disposable.id);
  await expect(service.get(alice, "alpha", disposable.id)).rejects.toMatchObject({ code: "not_found" });
}

test("SQLite deployment intents are scoped, deterministic, idempotent, and local-only", async () => {
  await verifyDeploymentIntents(sqlitePlatformDatabase(openDatabase(":memory:")));
});

const postgresUrl = process.env.PLATFORM_TEST_POSTGRES_URL;
test.skipIf(!postgresUrl)("PostgreSQL deployment intents match the SQLite contract", async () => {
  const admin = openPostgresPlatformDatabase(postgresUrl!);
  const name = `agwmngr_deployments_${crypto.randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(postgresUrl!);
  url.pathname = `/${name}`;
  const database = openPostgresPlatformDatabase(url.toString());
  try {
    await verifyDeploymentIntents(database);
  } finally {
    await database.close();
    await admin.query(`DROP DATABASE ${name}`);
    await admin.close();
  }
}, 30_000);
