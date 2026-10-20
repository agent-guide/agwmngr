import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { PlatformActorReference } from "@/packages/contracts/platform/identity";
import type { AgentPayload } from "@/packages/contracts/gateway/agents";
import type { ContentRuntime } from "@/packages/platform/ports/content";
import type { PlatformDatabase } from "@/packages/platform/ports/database";
import type {
  GatewayAgentRouteDocument,
  GatewayDeploymentAdapter,
  GatewayVirtualKeyPolicy,
} from "@/packages/platform/ports/deployment";
import { AgentReleaseRegistry } from "@/packages/platform/services/agent-release-registry";
import { AgentDeploymentRegistry } from "@/packages/platform/services/deployment-registry";
import {
  AgentDeploymentService,
  virtualKeyPolicyValue,
} from "@/packages/platform/services/deployments";
import { canonicalAgentValue } from "@/packages/platform/services/agent-definitions";
import { IdentityRegistry } from "@/packages/platform/services/identity-registry";
import { migratePlatformIdentityDatabase } from "@/packages/platform/services/identity-migrations";
import { PlatformIdentityService } from "@/packages/platform/services/identity";
import { openPostgresPlatformDatabase, sqlitePlatformDatabase } from "./platform-database";
import { openDatabase } from "./sqlite";

const operator: PlatformActorReference = { kind: "human", userId: 1 };
const alice: PlatformActorReference = { kind: "human", userId: 2 };
const bob: PlatformActorReference = { kind: "human", userId: 3 };

class MemoryDeploymentGateway implements GatewayDeploymentAdapter {
  readonly agents = new Map<string, AgentPayload>();
  readonly routes = new Map<string, GatewayAgentRouteDocument>();
  readonly keys = new Map<string, GatewayVirtualKeyPolicy>();
  readonly writes: string[] = [];
  failNextRouteCreate = false;

  async readAgent(_gatewayId: string, agentId: string) {
    return structuredClone(this.agents.get(agentId) ?? null);
  }
  async createAgent(_gatewayId: string, value: AgentPayload) {
    this.writes.push(`create-agent:${value.id}`);
    this.agents.set(value.id, structuredClone(value));
    return structuredClone(value);
  }
  async updateAgent(_gatewayId: string, agentId: string, value: AgentPayload) {
    this.writes.push(`update-agent:${agentId}`);
    this.agents.set(agentId, structuredClone(value));
    return structuredClone(value);
  }
  async deleteAgent(_gatewayId: string, agentId: string) {
    this.writes.push(`delete-agent:${agentId}`);
    this.agents.delete(agentId);
  }
  async readAgentRoute(_gatewayId: string, routeId: string) {
    return structuredClone(this.routes.get(routeId) ?? null);
  }
  async createAgentRoute(_gatewayId: string, value: GatewayAgentRouteDocument) {
    if (this.failNextRouteCreate) {
      this.failNextRouteCreate = false;
      throw new Error("injected route failure");
    }
    this.writes.push(`create-route:${value.id}`);
    this.routes.set(value.id, structuredClone(value));
    return structuredClone(value);
  }
  async updateAgentRoute(
    _gatewayId: string,
    routeId: string,
    value: GatewayAgentRouteDocument,
  ) {
    this.writes.push(`update-route:${routeId}:${value.disabled ? "staging" : "final"}`);
    this.routes.set(routeId, structuredClone(value));
    return structuredClone(value);
  }
  async deleteAgentRoute(_gatewayId: string, routeId: string) {
    this.writes.push(`delete-route:${routeId}`);
    this.routes.delete(routeId);
  }
  async listAgentRoutes() { return [...this.routes.values()].map((value) => structuredClone(value)); }
  async listLLMRoutes() { return []; }
  async listMCPRoutes() { return []; }
  async listVirtualKeys() { return [...this.keys.values()].map((value) => structuredClone(value)); }
  async readVirtualKey(_gatewayId: string, keyId: string) {
    return structuredClone(this.keys.get(keyId) ?? null);
  }
  async updateVirtualKey(_gatewayId: string, keyId: string, value: GatewayVirtualKeyPolicy) {
    this.writes.push(`update-key:${keyId}`);
    this.keys.set(keyId, structuredClone(value));
    return structuredClone(value);
  }
  async setVirtualKeyEnabled(_gatewayId: string, keyId: string, enabled: boolean) {
    const value = this.keys.get(keyId);
    if (!value) throw new Error("missing key");
    const updated = { ...value, disabled: !enabled };
    this.writes.push(`${enabled ? "enable" : "disable"}-key:${keyId}`);
    this.keys.set(keyId, updated);
    return structuredClone(updated);
  }
}

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
  let sequence = 0;
  const runtime: ContentRuntime = {
    id: () => `test-${++sequence}`,
    now: () => "2026-10-21T00:00:00.000Z",
    hash: (value) => createHash("sha256").update(value).digest("hex"),
    hashBytes: (value) => createHash("sha256").update(value).digest("hex"),
    decodeBase64: (value) => Buffer.from(value, "base64"),
    encodeBase64: (value) => Buffer.from(value).toString("base64"),
  };
  const gateway = new MemoryDeploymentGateway();
  const service = new AgentDeploymentService(
    new AgentDeploymentRegistry(database),
    new AgentReleaseRegistry(database),
    identity,
    runtime,
    gateway,
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
  expect(gateway.writes).toEqual([]);

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

  async function bind(item: typeof created) {
    const key: GatewayVirtualKeyPolicy = {
      id: `key:${item.id}`,
      disabled: false,
      allowed_route_ids: [item.target.gatewayRouteId],
    };
    gateway.keys.set(key.id, key);
    const fingerprint = runtime.hash(canonicalAgentValue(virtualKeyPolicyValue(key)));
    await database.query(
      `INSERT INTO platform_deployment_key_bindings
        (deployment_id, gateway_id, key_id, route_id, status, key_policy_epoch,
         key_policy_fingerprint, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'bound', 1, ?, 'now', 'now')`,
      [item.id, item.target.gatewayId, key.id, item.target.gatewayRouteId, fingerprint],
    );
    await database.query(
      `INSERT INTO platform_deployment_route_reservations
        (gateway_id, route_id, deployment_id, operation_id, state, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 'prepublication', 'now', 'now')`,
      [item.target.gatewayId, item.target.gatewayRouteId, item.id],
    );
    await database.query(
      `UPDATE platform_agent_deployments SET lifecycle_state = 'ready_to_apply'
        WHERE id = ?`,
      [item.id],
    );
  }

  await bind(created);
  const applied = await service.apply(alice, "alpha", created.id, "apply-one");
  expect(applied).toMatchObject({ kind: "apply", status: "succeeded", phase: "verified" });
  expect((await service.get(alice, "alpha", created.id)).lifecycleState).toBe("active");
  expect(gateway.routes.get(created.target.gatewayRouteId)).toMatchObject({
    disabled: false,
    auth_policy: { require_virtual_key: true },
    agent_id: created.target.gatewayAgentId,
  });
  expect(gateway.writes.slice(-3)).toEqual([
    `create-agent:${created.target.gatewayAgentId}`,
    `create-route:${created.target.gatewayRouteId}`,
    `update-route:${created.target.gatewayRouteId}:final`,
  ]);
  await expect(service.apply(operator, "alpha", created.id, "operator-apply"))
    .rejects.toMatchObject({ code: "forbidden" });
  const writesAfterApply = gateway.writes.length;
  expect(await service.apply(alice, "alpha", created.id, "apply-one")).toEqual(applied);
  expect(gateway.writes).toHaveLength(writesAfterApply);

  expect(await service.takeOffline(alice, "alpha", created.id, "offline-one"))
    .toMatchObject({ kind: "take_offline", status: "succeeded" });
  expect((await service.get(alice, "alpha", created.id)).lifecycleState).toBe("offline");
  expect(gateway.routes.get(created.target.gatewayRouteId)).toMatchObject({ disabled: true });
  const writesAfterOffline = gateway.writes.length;
  expect(await service.takeOffline(alice, "alpha", created.id, "offline-one"))
    .toMatchObject({ kind: "take_offline", status: "succeeded" });
  expect(gateway.writes).toHaveLength(writesAfterOffline);
  expect(await service.online(alice, "alpha", created.id, "online-one"))
    .toMatchObject({ kind: "online", status: "succeeded" });
  expect(await service.verify(alice, "alpha", created.id, "verify-one"))
    .toMatchObject({ kind: "verify", status: "succeeded" });
  expect(await service.rollback(alice, "alpha", created.id, "release:one", "rollback-one"))
    .toMatchObject({ kind: "rollback", status: "succeeded" });
  expect((await service.history(alice, "alpha", created.id)).map((item) => item.kind))
    .toEqual(["rollback", "verify", "online", "take_offline", "apply"]);

  const retryable = await service.create(alice, "alpha", {
    releaseId: "release:one", gatewayId: "prod", requestKey: "retryable-deploy",
  });
  await bind(retryable);
  gateway.failNextRouteCreate = true;
  expect(await service.apply(alice, "alpha", retryable.id, "apply-fails"))
    .toMatchObject({ status: "failed" });
  const agentCreates = gateway.writes.filter((item) =>
    item === `create-agent:${retryable.target.gatewayAgentId}`).length;
  expect(await service.retry(alice, "alpha", retryable.id, "retry-succeeds"))
    .toMatchObject({ kind: "retry", status: "succeeded" });
  expect(gateway.writes.filter((item) =>
    item === `create-agent:${retryable.target.gatewayAgentId}`)).toHaveLength(agentCreates);

  const blocked = await service.create(alice, "alpha", {
    releaseId: "release:one", gatewayId: "prod", requestKey: "allow-all-blocked",
  });
  await bind(blocked);
  gateway.keys.set("legacy-allow-all", {
    id: "legacy-allow-all", disabled: false, allowed_route_ids: [],
  });
  const writesBefore = gateway.writes.length;
  await expect(service.apply(alice, "alpha", blocked.id, "blocked-apply"))
    .rejects.toMatchObject({ code: "conflict" });
  expect(gateway.writes).toHaveLength(writesBefore);
  expect((await service.get(alice, "alpha", blocked.id)).invocationEpoch).toBe(1);
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
