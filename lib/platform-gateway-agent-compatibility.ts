import { createHash, randomUUID } from "node:crypto";
import type { ResolvedGateway } from "@/packages/contracts/gateway/connection";
import type { PlatformActorReference } from "@/packages/contracts/platform/identity";
import { gatewayRequestJSON } from "@/packages/gateway-client/admin";
import type { GatewayDeploymentRuntimeAdapter } from "@/packages/platform/ports/deployment-runtime";
import type {
  GatewayAgentRouteDocument,
  GatewayDeploymentAdapter,
  GatewayVirtualKeyPolicy,
} from "@/packages/platform/ports/deployment";
import { canonicalAgentValue } from "@/packages/platform/services/agent-definitions";
import {
  DeploymentAccessRegistry,
  type StoredKeyPolicy,
} from "@/packages/platform/services/deployment-access-registry";
import type { AgentDeploymentRegistry } from "@/packages/platform/services/deployment-registry";
import {
  GatewayCompatibilityRegistry,
  type StoredGatewayCompatibilityContext,
} from "@/packages/platform/services/gateway-compatibility-registry";
import {
  virtualKeyPolicyFingerprint,
  virtualKeyPolicyValue,
} from "@/packages/platform/services/deployments";
import {
  IdentityError,
  type PlatformIdentityService,
} from "@/packages/platform/services/identity";
import { conflictsWithPlatformDeploymentPath } from "./platform-route-mutation";

type Json = Record<string, unknown>;

function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new IdentityError("conflict", "Gateway returned an invalid document");
  }
  return value as Json;
}

export function gatewayAgentInventory(
  scanned: unknown[],
  claimedAgentIds: ReadonlySet<string>,
  includeClaimed: boolean,
): unknown[] {
  if (includeClaimed) {
    return scanned.map((value) => {
      const row = object(value);
      if (typeof row.id !== "string" || !claimedAgentIds.has(row.id)) return value;
      const runtime = row.runtime && typeof row.runtime === "object" &&
        !Array.isArray(row.runtime) ? row.runtime as Json : {};
      const routes = row.routes && typeof row.routes === "object" &&
        !Array.isArray(row.routes) ? row.routes as Json : {};
      const resources = row.resources && typeof row.resources === "object" &&
        !Array.isArray(row.resources) ? row.resources as Json : {};
      return {
        id: row.id,
        ...(typeof row.name === "string" ? { name: row.name } : {}),
        disabled: row.disabled === true,
        runtime: { ...(typeof runtime.type === "string" ? { type: runtime.type } : {}) },
        routes: {
          llm_route_ids: Array.isArray(routes.llm_route_ids) ? routes.llm_route_ids : [],
          mcp_route_ids: Array.isArray(routes.mcp_route_ids) ? routes.mcp_route_ids : [],
        },
        resources: {
          provider_ids: Array.isArray(resources.provider_ids) ? resources.provider_ids : [],
          mcp_service_ids: Array.isArray(resources.mcp_service_ids)
            ? resources.mcp_service_ids : [],
          virtual_key_ids: Array.isArray(resources.virtual_key_ids)
            ? resources.virtual_key_ids : [],
        },
        policy: {},
      };
    });
  }
  return scanned.filter((value) => {
    const id = object(value).id;
    return typeof id === "string" && !claimedAgentIds.has(id);
  });
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalAgentValue(value)).digest("hex");
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function keyExpired(key: GatewayVirtualKeyPolicy, now: string): boolean {
  if (!key.expires_at || key.expires_at === "0001-01-01T00:00:00Z") return false;
  const expiry = Date.parse(key.expires_at);
  return Number.isFinite(expiry) && expiry <= Date.parse(now);
}

function keyEligible(key: GatewayVirtualKeyPolicy, routeId: string, now: string): boolean {
  return !key.disabled && !keyExpired(key, now) && key.allowed_route_ids.length > 0 &&
    key.allowed_route_ids.includes(routeId);
}

function routePathPrefix(route: GatewayAgentRouteDocument): string {
  const value = route.match_policy.path_prefix;
  if (typeof value !== "string" || !value.startsWith("/")) {
    throw new IdentityError("conflict", "Gateway Agent route has no valid path prefix");
  }
  return value;
}

function redactRuntime(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactRuntime);
  if (!value || typeof value !== "object") return value;
  const blocked = new Set([
    "input", "output", "prompt", "transcript", "content", "tool_payload",
    "arguments", "result", "key", "token", "secret", "authorization",
  ]);
  return Object.fromEntries(Object.entries(value as Json).flatMap(([key, child]) =>
    blocked.has(key.toLowerCase()) ? [] : [[key, redactRuntime(child)] as const]));
}

async function request(
  gateway: ResolvedGateway,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await gatewayRequestJSON(method, path, gateway, body, {
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, body: response.body };
}

async function listAll(gateway: ResolvedGateway, path: string): Promise<unknown[]> {
  const result: unknown[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const response = await request(
      gateway,
      "GET",
      `${path}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    if (response.status < 200 || response.status >= 300) {
      throw new IdentityError("conflict", `Gateway rejected GET ${path} (${response.status})`);
    }
    const page = object(response.body);
    if (!Array.isArray(page.items)) throw new IdentityError("conflict", "Gateway returned an invalid list");
    result.push(...page.items);
    cursor = typeof page.next_cursor === "string" && page.next_cursor
      ? page.next_cursor : undefined;
    if (cursor && seen.has(cursor)) throw new IdentityError("conflict", "Gateway repeated a cursor");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return result;
}

export interface GatewayCompatibilityInvocationContext {
  id: string;
  gatewayId: string;
  gatewayAgentId: string;
  gatewayRouteId: string;
  keyId: string;
  expiresAt: string;
  completedAt: string | null;
}

export interface AuthorizedGatewayCompatibilityInvocation {
  context: GatewayCompatibilityInvocationContext;
  gatewayId: string;
  gatewayAgentId: string;
  gatewayRouteId: string;
  pathPrefix: string;
  host?: string;
  bearer: string;
}

function contextProjection(
  value: StoredGatewayCompatibilityContext,
): GatewayCompatibilityInvocationContext {
  return {
    id: value.id,
    gatewayId: value.gatewayId,
    gatewayAgentId: value.gatewayAgentId,
    gatewayRouteId: value.gatewayRouteId,
    keyId: value.keyId,
    expiresAt: value.expiresAt,
    completedAt: value.completedAt,
  };
}

export class GatewayAgentCompatibilityService {
  constructor(
    private readonly deployments: AgentDeploymentRegistry,
    private readonly compatibility: GatewayCompatibilityRegistry,
    private readonly access: DeploymentAccessRegistry,
    private readonly identity: PlatformIdentityService,
    private readonly gatewayAdapter: GatewayDeploymentAdapter & GatewayDeploymentRuntimeAdapter,
    private readonly now = () => new Date().toISOString(),
    private readonly id = () => randomUUID(),
  ) {}

  private async withGatewayLeases<T>(gatewayId: string, work: () => Promise<T>): Promise<T> {
    const ownerToken = `gateway-compatibility:${this.id()}`;
    const now = this.now();
    const leaseUntil = new Date(Date.parse(now) + 5 * 60_000).toISOString();
    if (!await this.deployments.acquireGatewayLeases({ gatewayId, ownerToken, now, leaseUntil })) {
      throw new IdentityError("conflict", "another Gateway object or key-policy operation is in progress");
    }
    try {
      return await work();
    } finally {
      await this.deployments.releaseGatewayLeases(gatewayId, ownerToken, this.now());
    }
  }

  private async blocked(gatewayId: string) {
    const fences = await this.deployments.pairFencesForGateway(gatewayId);
    return {
      agents: new Set(fences.map((item) => item.gatewayAgentId)),
      routes: new Set(fences.map((item) => item.gatewayRouteId)),
    };
  }

  private async requireUnfenced(gatewayId: string, agentId: string, routeId?: string) {
    const blocked = await this.blocked(gatewayId);
    if (blocked.agents.has(agentId) || (routeId && blocked.routes.has(routeId))) {
      throw new IdentityError("conflict", "Gateway object is claimed by a platform deployment");
    }
    const pair = await this.compatibility.pair(gatewayId, agentId);
    if (pair && pair.state !== "stable") {
      throw new IdentityError("conflict", "Gateway compatibility pair requires reconciliation");
    }
  }

  private async agentFingerprint(gatewayId: string, agentId: string): Promise<string | null> {
    const agent = await this.gatewayAdapter.readAgent(gatewayId, agentId);
    return agent ? fingerprint(agent) : null;
  }

  private async containKeyDrift(
    gatewayId: string,
    policy: StoredKeyPolicy,
    live: GatewayVirtualKeyPolicy,
  ): Promise<never> {
    const token = `compatibility-key-containment:${this.id()}`;
    const desired = virtualKeyPolicyValue({ ...live, disabled: true });
    if (!await this.access.beginContainment({
      gatewayId,
      keyId: policy.keyId,
      expectedEpoch: policy.policyEpoch,
      desired,
      operationToken: token,
      now: this.now(),
    })) {
      throw new IdentityError("conflict", "Virtual Key changed during compatibility authorization");
    }
    try {
      await this.gatewayAdapter.setVirtualKeyEnabled(gatewayId, policy.keyId, false);
      const observed = await this.gatewayAdapter.readVirtualKey(gatewayId, policy.keyId);
      const contained = Boolean(observed?.disabled);
      await this.access.finishContainment({
        gatewayId,
        keyId: policy.keyId,
        operationToken: token,
        fingerprint: observed ? virtualKeyPolicyFingerprint(observed, { hash }) : null,
        succeeded: contained,
        now: this.now(),
      });
      if (!contained) {
        throw new IdentityError("conflict", "Virtual Key drift containment could not be verified");
      }
      throw new IdentityError(
        "conflict",
        "Virtual Key policy drift was contained; reconciliation is required",
      );
    } catch (error) {
      const current = await this.access.keyPolicy(gatewayId, policy.keyId);
      if (current?.state === "containment_in_progress") {
        await this.access.finishContainment({
          gatewayId,
          keyId: policy.keyId,
          operationToken: token,
          fingerprint: null,
          succeeded: false,
          now: this.now(),
        });
      }
      throw error;
    }
  }

  private async mutate(input: {
    actor: PlatformActorReference;
    gatewayId: string;
    agentIds: string[];
    desiredRoute?: unknown;
    work: () => Promise<{ status: number; body: unknown }>;
  }): Promise<Response> {
    return this.withGatewayLeases(input.gatewayId, async () => {
      await this.identity.authorizePlatformGateway(input.actor, input.gatewayId);
      for (const agentId of input.agentIds) await this.requireUnfenced(input.gatewayId, agentId);
      if (input.desiredRoute !== undefined &&
        await conflictsWithPlatformDeploymentPath(
          this.deployments,
          input.gatewayId,
          input.desiredRoute,
        )) {
        throw new IdentityError(
          "conflict",
          "Gateway route could intersect a platform deployment namespace",
        );
      }
      const operationToken = `compatibility-mutation:${this.id()}`;
      if (!await this.compatibility.beginMutation({
        gatewayId: input.gatewayId,
        agentIds: input.agentIds,
        operationToken,
        now: this.now(),
      })) {
        throw new IdentityError("conflict", "Gateway compatibility pair is busy");
      }
      try {
        await this.identity.authorizePlatformGateway(input.actor, input.gatewayId);
        const blocked = await this.blocked(input.gatewayId);
        if (input.agentIds.some((id) => blocked.agents.has(id))) {
          throw new IdentityError("conflict", "Gateway object is claimed by a platform deployment");
        }
        const result = await input.work();
        if (result.status < 200 || result.status >= 300) {
          throw new Error(`Gateway rejected compatibility mutation (${result.status})`);
        }
        const agentFingerprints = Object.fromEntries(await Promise.all(
          [...new Set(input.agentIds)].map(async (agentId) => [
            agentId,
            await this.agentFingerprint(input.gatewayId, agentId),
          ] as const),
        ));
        if (!await this.compatibility.completeMutation({
          gatewayId: input.gatewayId,
          agentFingerprints,
          operationToken,
          now: this.now(),
        })) {
          throw new Error("Gateway compatibility mutation lost its state token");
        }
        return result.status === 204
          ? new Response(null, { status: 204 })
          : Response.json(result.body, { status: result.status });
      } catch (error) {
        await this.compatibility.failMutation({
          gatewayId: input.gatewayId,
          agentIds: input.agentIds,
          operationToken,
          incident: error instanceof Error ? error.message : "Gateway compatibility mutation failed",
          now: this.now(),
        });
        throw error;
      }
    });
  }

  async createInvocationContext(input: {
    actor: PlatformActorReference;
    gatewayId: string;
    agentId: string;
    routeId: string;
    keyId: string;
  }): Promise<GatewayCompatibilityInvocationContext> {
    return this.withGatewayLeases(input.gatewayId, async () => {
      const authority = await this.identity.authorizePlatformGateway(input.actor, input.gatewayId);
      await this.requireUnfenced(input.gatewayId, input.agentId, input.routeId);
      const [agent, route, capabilities, key, policy] = await Promise.all([
        this.gatewayAdapter.readAgent(input.gatewayId, input.agentId),
        this.gatewayAdapter.readAgentRoute(input.gatewayId, input.routeId),
        this.gatewayAdapter.readAgentCapabilities(input.gatewayId, input.agentId),
        this.gatewayAdapter.readVirtualKey(input.gatewayId, input.keyId),
        this.access.keyPolicy(input.gatewayId, input.keyId),
      ]);
      if (!agent || !route || route.agent_id !== input.agentId || route.protocol !== "agent" ||
        route.disabled ||
        route.auth_policy.require_virtual_key !== true) {
        throw new IdentityError("conflict", "a protected live common Agent route is required");
      }
      if (capabilities.executable !== true || capabilities.turn?.streaming !== true) {
        throw new IdentityError("conflict", "Gateway Agent does not support streaming Test");
      }
      const agentFingerprint = fingerprint(agent);
      const routeFingerprint = fingerprint(route);
      const pair = await this.compatibility.ensureStable({
        gatewayId: input.gatewayId,
        agentId: input.agentId,
        agentFingerprint,
        now: this.now(),
      });
      if (!pair) {
        throw new IdentityError("conflict", "Gateway compatibility pair changed; reconcile it first");
      }
      const liveFingerprint = key && virtualKeyPolicyFingerprint(key, { hash });
      if (!key || !policy || policy.state !== "stable" || !policy.observedFingerprint ||
        liveFingerprint !== policy.observedFingerprint ||
        !keyEligible(key, input.routeId, this.now())) {
        throw new IdentityError("conflict", "a stable eligible manager-controlled Virtual Key is required");
      }
      const now = this.now();
      const stored: Omit<StoredGatewayCompatibilityContext,
        "completedAt" | "createdAt" | "lastUsedAt"> & { now: string } = {
        id: `gateway-invocation-${this.id()}`,
        principalId: authority.principal.id,
        principalAuthorityEpoch: authority.principalAuthorityEpoch,
        gatewayId: input.gatewayId,
        gatewayAuthorityEpoch: authority.gateway.authorityEpoch,
        gatewayAgentId: input.agentId,
        gatewayRouteId: input.routeId,
        compatibilityPairEpoch: pair.authorityEpoch,
        agentFingerprint,
        routeFingerprint,
        pathPrefix: routePathPrefix(route),
        keyId: input.keyId,
        keyPolicyEpoch: policy.policyEpoch,
        keyPolicyFingerprint: policy.observedFingerprint,
        expiresAt: new Date(Date.parse(now) + 15 * 60_000).toISOString(),
        now,
      };
      if (!await this.compatibility.createContext(stored)) {
        throw new IdentityError("conflict", "Gateway compatibility authority changed");
      }
      return contextProjection({
        ...stored,
        completedAt: null,
        createdAt: now,
        lastUsedAt: now,
      });
    });
  }

  async withInvocation<T>(
    actor: PlatformActorReference,
    gatewayId: string,
    contextId: string,
    forward: (authorized: AuthorizedGatewayCompatibilityInvocation) => Promise<T>,
    permissionResume = false,
  ): Promise<T> {
    const initial = await this.compatibility.context(contextId);
    if (!initial || initial.gatewayId !== gatewayId) {
      throw new IdentityError("not_found", "Gateway compatibility invocation not found");
    }
    return this.withGatewayLeases(gatewayId, async () => {
      const context = await this.compatibility.context(contextId);
      const now = this.now();
      if (!context || context.completedAt || context.expiresAt <= now) {
        throw new IdentityError("forbidden", "Gateway compatibility invocation expired");
      }
      const authority = await this.identity.authorizePlatformGateway(actor, gatewayId);
      if (authority.principal.id !== context.principalId ||
        authority.principalAuthorityEpoch !== context.principalAuthorityEpoch ||
        authority.gateway.authorityEpoch !== context.gatewayAuthorityEpoch) {
        throw new IdentityError("forbidden", "Gateway compatibility authority changed");
      }
      await this.requireUnfenced(gatewayId, context.gatewayAgentId, context.gatewayRouteId);
      const [pair, agent, route, policy, secret, capabilities] = await Promise.all([
        this.compatibility.pair(gatewayId, context.gatewayAgentId),
        this.gatewayAdapter.readAgent(gatewayId, context.gatewayAgentId),
        this.gatewayAdapter.readAgentRoute(gatewayId, context.gatewayRouteId),
        this.access.keyPolicy(gatewayId, context.keyId),
        this.gatewayAdapter.readVirtualKeySecret(gatewayId, context.keyId),
        this.gatewayAdapter.readAgentCapabilities(gatewayId, context.gatewayAgentId),
      ]);
      if (!pair || pair.state !== "stable" ||
        pair.authorityEpoch !== context.compatibilityPairEpoch ||
        !agent || fingerprint(agent) !== context.agentFingerprint ||
        !route || route.agent_id !== context.gatewayAgentId || route.disabled ||
        fingerprint(route) !== context.routeFingerprint ||
        routePathPrefix(route) !== context.pathPrefix ||
        capabilities.executable !== true || capabilities.turn?.streaming !== true) {
        throw new IdentityError("forbidden", "Gateway compatibility pair changed");
      }
      if (permissionResume && (capabilities.permissions?.interactive !== true ||
        capabilities.permissions.resume_mode !== "active_stream")) {
        throw new IdentityError(
          "conflict",
          "Gateway Agent does not support active-stream permission resume",
        );
      }
      if (!policy || policy.state !== "stable" ||
        policy.policyEpoch !== context.keyPolicyEpoch ||
        policy.observedFingerprint !== context.keyPolicyFingerprint || !secret) {
        throw new IdentityError("forbidden", "Gateway compatibility key authority changed");
      }
      const liveFingerprint = virtualKeyPolicyFingerprint(
        virtualKeyPolicyValue(secret.policy),
        { hash },
      );
      if (liveFingerprint !== context.keyPolicyFingerprint) {
        return this.containKeyDrift(gatewayId, policy, secret.policy);
      }
      if (!keyEligible(secret.policy, context.gatewayRouteId, now)) {
        throw new IdentityError("forbidden", "Gateway compatibility key policy drifted");
      }
      if (!await this.compatibility.touchContext(context.id, context.principalId, now)) {
        throw new IdentityError("forbidden", "Gateway compatibility invocation expired");
      }
      return forward({
        context: contextProjection(context),
        gatewayId,
        gatewayAgentId: context.gatewayAgentId,
        gatewayRouteId: context.gatewayRouteId,
        pathPrefix: context.pathPrefix,
        ...(route.match_policy.host ? { host: route.match_policy.host } : {}),
        bearer: secret.bearer,
      });
    });
  }

  async completeInvocation(
    actor: PlatformActorReference,
    gatewayId: string,
    contextId: string,
  ): Promise<void> {
    const context = await this.compatibility.context(contextId);
    if (!context || context.gatewayId !== gatewayId) return;
    const authority = await this.identity.authorizePlatformGateway(actor, gatewayId);
    if (authority.principal.id !== context.principalId) {
      throw new IdentityError("forbidden", "Gateway compatibility invocation belongs to another Principal");
    }
    await this.compatibility.completeContext(contextId, context.principalId, this.now());
  }

  async handle(input: {
    actor: PlatformActorReference;
    gatewayId: string;
    gateway: ResolvedGateway;
    method: string;
    path: string[];
    query: string;
    body?: unknown;
  }): Promise<Response> {
    const { actor, gatewayId, gateway, method, path, query, body } = input;
    await this.identity.authorizePlatformGateway(actor, gatewayId);
    if (path.length === 0) {
      if (method === "GET") {
        const scanned = await listAll(gateway, "/admin/agents");
        const includeClaimed = new URL(`http://local${query || ""}`)
          .searchParams.get("include_claimed") === "true";
        const current = await this.blocked(gatewayId);
        const items = gatewayAgentInventory(scanned, current.agents, includeClaimed);
        return Response.json({ items, total: items.length });
      }
      if (method === "POST") {
        const agentId = object(body).id;
        if (typeof agentId !== "string" || !agentId) {
          throw new IdentityError("invalid_input", "Agent id is required");
        }
        return this.mutate({
          actor,
          gatewayId,
          agentIds: [agentId],
          work: () => request(gateway, method, "/admin/agents", body),
        });
      }
    }

    if (path[0] === "routes") {
      if (path.length === 1 && method === "GET") {
        const scanned = await listAll(gateway, "/admin/agents/routes");
        const current = await this.blocked(gatewayId);
        const items = scanned.filter((value) => {
          const row = object(value);
          return typeof row.id === "string" && typeof row.agent_id === "string" &&
            !current.routes.has(row.id) && !current.agents.has(row.agent_id);
        });
        return Response.json({ items, total: items.length });
      }
      if (path.length === 1 && method === "POST") {
        const row = object(body);
        if (typeof row.id !== "string" || typeof row.agent_id !== "string") {
          throw new IdentityError("invalid_input", "route id and agent_id are required");
        }
        return this.mutate({
          actor,
          gatewayId,
          agentIds: [row.agent_id],
          desiredRoute: row,
          work: () => request(gateway, method, "/admin/agents/routes", body),
        });
      }
      if (path.length === 2) {
        const routeId = path[1];
        const current = await request(
          gateway, "GET", `/admin/agents/routes/${encodeURIComponent(routeId)}`,
        );
        if (current.status < 200 || current.status >= 300) {
          return Response.json(current.body, { status: current.status });
        }
        const currentAgent = object(current.body).agent_id;
        if (typeof currentAgent !== "string") throw new IdentityError("conflict", "invalid Agent route");
        await this.requireUnfenced(gatewayId, currentAgent, routeId);
        if (method === "GET") return Response.json(current.body);
        const nextAgent = method === "PUT" ? object(body).agent_id : currentAgent;
        if (typeof nextAgent !== "string") throw new IdentityError("invalid_input", "agent_id is required");
        return this.mutate({
          actor,
          gatewayId,
          agentIds: [currentAgent, nextAgent],
          ...(method === "PUT" ? { desiredRoute: body } : {}),
          work: () => request(
            gateway, method, `/admin/agents/routes/${encodeURIComponent(routeId)}`, body,
          ),
        });
      }
    }

    const agentId = path[0];
    const suffix = path.slice(1);
    const key = suffix.join("/");
    if (method === "POST" && suffix.length === 1 && suffix[0] === "invocations") {
      const row = object(body);
      if (typeof row.route_id !== "string" || typeof row.key_id !== "string") {
        throw new IdentityError("invalid_input", "route_id and key_id are required");
      }
      const item = await this.createInvocationContext({
        actor,
        gatewayId,
        agentId,
        routeId: row.route_id,
        keyId: row.key_id,
      });
      return Response.json(item, { status: 201 });
    }
    if (method === "POST" && suffix.length === 1 && suffix[0] === "reconcile") {
      return this.withGatewayLeases(gatewayId, async () => {
        await this.identity.authorizePlatformGateway(actor, gatewayId);
        const blocked = await this.blocked(gatewayId);
        if (blocked.agents.has(agentId)) {
          throw new IdentityError("conflict", "Gateway object is claimed by a platform deployment");
        }
        const agent = await this.gatewayAdapter.readAgent(gatewayId, agentId);
        const reconciled = await this.compatibility.reconcilePair({
          gatewayId,
          agentId,
          agentFingerprint: agent ? fingerprint(agent) : null,
          now: this.now(),
        });
        if (!reconciled) {
          throw new IdentityError("conflict", "Gateway compatibility pair does not require reconciliation");
        }
        return Response.json({
          gateway_id: gatewayId,
          agent_id: agentId,
          state: reconciled.state,
          authority_epoch: reconciled.authorityEpoch,
        });
      });
    }
    await this.requireUnfenced(gatewayId, agentId);

    const readSuffixes = new Set([
      "", "workspace", "capabilities", "health", "activity", "usage", "interactions",
      "resources", "sessions", "runs", "permissions",
    ]);
    const permissionMutation = method === "POST" && suffix.length === 2 && suffix[0] === "permissions";
    const runCancellation = method === "DELETE" && suffix.length === 2 && suffix[0] === "runs";
    const agentMutation = suffix.length === 0 && (method === "PUT" || method === "DELETE");
    if (method === "GET" && readSuffixes.has(key)) {
      await this.requireUnfenced(gatewayId, agentId);
      const target = `/admin/agents/${path.map(encodeURIComponent).join("/")}${query}`;
      const result = await request(gateway, method, target, body);
      const runtimeMetadata = ["sessions", "runs", "permissions"].includes(suffix[0] ?? "");
      return Response.json(runtimeMetadata ? redactRuntime(result.body) : result.body, {
        status: result.status,
      });
    }
    if (permissionMutation || runCancellation) {
      return this.withGatewayLeases(gatewayId, async () => {
        await this.identity.authorizePlatformGateway(actor, gatewayId);
        await this.requireUnfenced(gatewayId, agentId);
        const capabilities = await this.gatewayAdapter.readAgentCapabilities(gatewayId, agentId);
        if (permissionMutation && capabilities.permissions?.interactive !== true) {
          throw new IdentityError("conflict", "Gateway Agent does not support interactive permissions");
        }
        if (runCancellation) {
          const mode = new URL(`http://local${query || ""}`).searchParams.get("mode") ?? "force";
          if (mode !== "force" && mode !== "graceful") {
            throw new IdentityError("invalid_input", "mode must be force or graceful");
          }
          if ((mode === "force" && capabilities.cancellation?.force !== true) ||
            (mode === "graceful" && capabilities.cancellation?.graceful !== true)) {
            throw new IdentityError("conflict", `Gateway Agent does not support ${mode} cancellation`);
          }
        }
        const target = `/admin/agents/${path.map(encodeURIComponent).join("/")}${query}`;
        const result = await request(gateway, method, target, body);
        return result.status === 204
          ? new Response(null, { status: 204 })
          : Response.json(redactRuntime(result.body), { status: result.status });
      });
    }
    if (agentMutation) {
      return this.mutate({
        actor,
        gatewayId,
        agentIds: [agentId],
        work: () => request(
          gateway, method, `/admin/agents/${encodeURIComponent(agentId)}${query}`, body,
        ),
      });
    }
    throw new IdentityError("not_found", "Gateway Agent compatibility route not found");
  }
}
