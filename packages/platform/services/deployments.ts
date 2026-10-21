import type { AgentPayload, AgentRuntimeBuiltin, BuiltinToolSelection } from "../../contracts/gateway/agents";
import type {
  AgentDeployment,
  AgentDeploymentOperation,
  CreateAgentDeploymentInput,
  DeploymentLifecycleState,
  DeploymentOperationKind,
} from "../../contracts/platform/deployments";
import type { PlatformActorReference } from "../../contracts/platform/identity";
import type { ContentRuntime } from "../ports/content";
import type {
  GatewayAgentRouteDocument,
  GatewayDeploymentAdapter,
  GatewayVirtualKeyPolicy,
} from "../ports/deployment";
import { AgentReleaseRegistry, type StoredAgentRelease } from "./agent-release-registry";
import { DeploymentAccessRegistry } from "./deployment-access-registry";
import { canonicalAgentValue } from "./agent-definitions";
import {
  AgentDeploymentRegistry,
  type DeploymentKeyBindingRecord,
  type StoredDeploymentOperation,
  type StoredAgentDeployment,
} from "./deployment-registry";
import {
  IdentityError,
  isIdentityError,
  type PlatformIdentityService,
} from "./identity";

function conflict(message: string): never {
  throw new IdentityError("conflict", message);
}

function validRequestKey(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value);
}

function slugPart(value: string, maximum = 40): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    .slice(0, maximum) || "agent";
}

function projection(value: StoredAgentDeployment): AgentDeployment {
  return {
    id: value.id,
    tenantId: value.tenantId,
    definitionId: value.definitionId,
    requestedReleaseId: value.requestedReleaseId,
    appliedReleaseId: value.appliedReleaseId,
    target: value.target,
    desiredDigest: value.desiredDigest,
    lifecycleState: value.lifecycleState,
    operationState: value.operationState,
    invocationEpoch: value.invocationEpoch,
    lastVerifiedAt: value.lastVerifiedAt,
    failureCode: value.failureCode,
    createdByPrincipalId: value.createdByPrincipalId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function operationProjection(value: StoredDeploymentOperation): AgentDeploymentOperation {
  return {
    id: value.id,
    deploymentId: value.deploymentId,
    kind: value.kind,
    requestKey: value.requestKey,
    releaseId: value.releaseId,
    sequence: value.sequence,
    status: value.status,
    phase: value.phase,
    failureCode: value.failureCode,
    failureMessage: value.failureMessage,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(normalized).filter((item) => item !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).flatMap(([key, child]) => {
      if (["created_at", "updated_at", "source", "read_only", "runtime_status", "capabilities"]
        .includes(key)) return [];
      const result = normalized(child);
      return result === undefined ? [] : [[key, result] as const];
    });
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }
  return value === null || value === "" || value === 0 || value === false || value === undefined
    ? undefined : value;
}

function agentView(value: unknown): unknown {
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  return normalized(Object.fromEntries(
    ["id", "name", "description", "runtime", "routes", "resources", "policy", "disabled"]
      .map((key) => [key, row[key]]),
  ));
}

function routeView(value: unknown): unknown {
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const match = row.match_policy && typeof row.match_policy === "object" &&
    !Array.isArray(row.match_policy) ? row.match_policy as Record<string, unknown> : {};
  const auth = row.auth_policy && typeof row.auth_policy === "object" &&
    !Array.isArray(row.auth_policy) ? row.auth_policy as Record<string, unknown> : {};
  return {
    id: row.id,
    protocol: row.protocol ?? "agent",
    ...(row.description ? { description: row.description } : {}),
    disabled: row.disabled === true,
    match_policy: {
      ...(typeof match.host === "string" && match.host ? { host: match.host } : {}),
      ...(typeof match.path_prefix === "string" && match.path_prefix
        ? { path_prefix: match.path_prefix } : {}),
      ...(Array.isArray(match.methods) && match.methods.length > 0
        ? { methods: [...match.methods].map(String).sort() } : {}),
    },
    auth_policy: { require_virtual_key: auth.require_virtual_key === true },
    agent_id: row.agent_id,
  };
}

export function deploymentAgentFingerprint(
  value: unknown,
  content: Pick<ContentRuntime, "hash">,
): string {
  return content.hash(canonicalAgentValue(agentView(value)));
}

export function deploymentRouteFingerprint(
  value: unknown,
  content: Pick<ContentRuntime, "hash">,
): string {
  return content.hash(canonicalAgentValue(routeView(value)));
}

function same(left: unknown, right: unknown): boolean {
  return canonicalAgentValue(left) === canonicalAgentValue(right);
}

function routeProtected(value: unknown): boolean {
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? value as { auth_policy?: { require_virtual_key?: unknown } } : {};
  return row.auth_policy?.require_virtual_key === true;
}

export function virtualKeyPolicyValue(value: GatewayVirtualKeyPolicy): GatewayVirtualKeyPolicy {
  return {
    id: value.id,
    ...(value.tag ? { tag: value.tag } : {}),
    ...(value.description ? { description: value.description } : {}),
    disabled: value.disabled,
    allowed_route_ids: [...new Set(value.allowed_route_ids)].sort(),
    ...(value.rate_limits ? { rate_limits: value.rate_limits } : {}),
    ...(value.status_message ? { status_message: value.status_message } : {}),
    ...(value.expires_at && value.expires_at !== "0001-01-01T00:00:00Z"
      ? { expires_at: value.expires_at } : {}),
  };
}

function virtualKeyExpired(expiresAt: string | undefined, now: number): boolean {
  return Boolean(
    expiresAt && expiresAt !== "0001-01-01T00:00:00Z" && Date.parse(expiresAt) <= now,
  );
}

export function virtualKeyPolicyFingerprint(
  value: GatewayVirtualKeyPolicy,
  content: Pick<ContentRuntime, "hash">,
): string {
  return content.hash(canonicalAgentValue(virtualKeyPolicyValue(value)));
}

function methodOverlap(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return true;
  return value.some((method) => typeof method === "string" && method.toUpperCase() === "POST");
}

export function conflictsWithFinalRoute(route: unknown, desired: GatewayAgentRouteDocument): boolean {
  if (!route || typeof route !== "object" || Array.isArray(route)) return true;
  const row = route as Record<string, unknown>;
  if (row.id === desired.id || row.disabled === true) return false;
  const match = row.match_policy && typeof row.match_policy === "object" &&
    !Array.isArray(row.match_policy) ? row.match_policy as Record<string, unknown> : {};
  if (!methodOverlap(match.methods)) return false;
  const desiredHost = desired.match_policy.host ?? "";
  const otherHost = typeof match.host === "string" ? match.host : "";
  if (desiredHost && otherHost && desiredHost !== otherHost) return false;
  const desiredPath = desired.match_policy.path_prefix ?? "/";
  const otherPath = typeof match.path_prefix === "string" && match.path_prefix
    ? match.path_prefix : "/";
  if (otherPath === desiredPath) return true;
  // A broader ancestor loses to the more-specific desired route. A foreign
  // descendant would win for part of the Agent endpoint namespace and is unsafe.
  return otherPath.startsWith(`${desiredPath}/`);
}

function gatewaySource(
  dependency: StoredAgentRelease["execution"]["model"] |
    StoredAgentRelease["execution"]["tools"][number],
  gatewayId: string,
  gatewayAuthorityEpoch: number,
): string {
  if (dependency.offeringKind !== "gateway-backed") {
    conflict(`platform-native ${dependency.kind.replace("_definition", "")} execution is not available`);
  }
  if (!dependency.sourceGatewayId || !dependency.upstreamStableId ||
    !dependency.sourceGatewayAuthorityEpoch) {
    conflict(`release contains a malformed ${dependency.kind.replace("_definition", "")} source`);
  }
  if (dependency.sourceGatewayId !== gatewayId) {
    conflict("release dependencies do not belong to the selected Gateway");
  }
  if (dependency.sourceGatewayAuthorityEpoch !== gatewayAuthorityEpoch) {
    conflict("release dependency Gateway authority changed; create a new release");
  }
  return dependency.upstreamStableId;
}

function materializedSystemPrompt(
  release: StoredAgentRelease,
  content: ContentRuntime,
): string {
  const skills = release.execution.skills.map((skill) => {
    const source = skill.content.files.find((file) => file.path === "SKILL.md");
    if (!source) conflict(`Skill ${skill.resourceId} has no root SKILL.md`);
    let body: string;
    try {
      body = new TextDecoder("utf-8", { fatal: true }).decode(content.decodeBase64(source.data));
    } catch {
      conflict(`Skill ${skill.resourceId} is not valid UTF-8`);
    }
    return [`## Skill: ${skill.name}`, skill.description, body!].filter(Boolean).join("\n\n");
  });
  return [release.execution.systemPrompt, ...skills].filter(Boolean).join("\n\n");
}

export interface DeploymentMaterialization {
  agent: AgentPayload;
  stagingRoute: GatewayAgentRouteDocument;
  finalRoute: GatewayAgentRouteDocument;
  digest: string;
}

export function materializeDeployment(input: {
  release: StoredAgentRelease;
  gatewayId: string;
  gatewayAuthorityEpoch: number;
  gatewayAgentId: string;
  gatewayRouteId: string;
  pathPrefix: string;
  stagingToken: string;
  content: ContentRuntime;
}): DeploymentMaterialization {
  const { release } = input;
  const llmRouteId = gatewaySource(
    release.execution.model,
    input.gatewayId,
    input.gatewayAuthorityEpoch,
  );
  const tools = new Map<string, string[]>();
  for (const tool of release.execution.tools) {
    const stableId = gatewaySource(tool, input.gatewayId, input.gatewayAuthorityEpoch);
    if (!stableId.startsWith("mcp:")) conflict(`tool ${tool.offeringId} has an invalid Gateway source`);
    const separator = stableId.indexOf(":", 4);
    if (separator < 5 || separator === stableId.length - 1) {
      conflict(`tool ${tool.offeringId} has an invalid Gateway source`);
    }
    const serviceId = stableId.slice(4, separator);
    const toolName = stableId.slice(separator + 1);
    const names = tools.get(serviceId) ?? [];
    if (!names.includes(toolName)) names.push(toolName);
    tools.set(serviceId, names);
  }
  const toolSelections: BuiltinToolSelection[] = [...tools]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([mcp_service_id, names]) => ({ mcp_service_id, tools: names.sort() }));
  const advanced = release.execution.advanced;
  const builtin: AgentRuntimeBuiltin = {
    model: { llm_route_id: llmRouteId },
    system_prompt: materializedSystemPrompt(release, input.content),
    topology: {
      kind: advanced.topology.kind,
      ...(advanced.topology.maxIterations === undefined
        ? {} : { max_iterations: advanced.topology.maxIterations }),
    },
    ...(advanced.generation ? { generation: {
      ...(advanced.generation.maxTokens === undefined
        ? {} : { max_tokens: advanced.generation.maxTokens }),
      ...(advanced.generation.temperature === undefined
        ? {} : { temperature: advanced.generation.temperature }),
      ...(advanced.generation.topP === undefined ? {} : { top_p: advanced.generation.topP }),
    } } : {}),
    ...(toolSelections.length > 0 ? { tools: toolSelections } : {}),
    ...(advanced.permissions ? { permissions: {
      ...(advanced.permissions.mode === undefined ? {} : { mode: advanced.permissions.mode }),
      ...(advanced.permissions.timeoutSeconds === undefined
        ? {} : { timeout_seconds: advanced.permissions.timeoutSeconds }),
      ...(advanced.permissions.maxPending === undefined
        ? {} : { max_pending: advanced.permissions.maxPending }),
    } } : {}),
  };
  const agent: AgentPayload = {
    id: input.gatewayAgentId,
    name: release.snapshot.name,
    description: release.snapshot.description,
    runtime: { type: "builtin", builtin },
    routes: { llm_route_ids: [llmRouteId] },
    resources: { mcp_service_ids: [...tools.keys()].sort() },
    policy: {
      ...(release.execution.policy.maxAgentDepth === undefined
        ? {} : { max_agent_depth: release.execution.policy.maxAgentDepth }),
      ...(release.execution.policy.budget ? { budget: {
        ...(release.execution.policy.budget.maxTurnsPerDay === undefined
          ? {} : { max_turns_per_day: release.execution.policy.budget.maxTurnsPerDay }),
        ...(release.execution.policy.budget.maxTokensPerDay === undefined
          ? {} : { max_tokens_per_day: release.execution.policy.budget.maxTokensPerDay }),
      } } : {}),
    },
    disabled: false,
  };
  const routeBase = {
    id: input.gatewayRouteId,
    kind: "agent" as const,
    protocol: "agent" as const,
    description: `Platform deployment ${release.definitionId}`,
    auth_policy: { require_virtual_key: true },
    agent_id: input.gatewayAgentId,
  };
  const stagingRoute: GatewayAgentRouteDocument = {
    ...routeBase,
    disabled: true,
    match_policy: {
      host: `${input.stagingToken}.staging.invalid`,
      path_prefix: `/_agwmngr/staging/${input.stagingToken}`,
      methods: ["POST"],
    },
  };
  const finalRoute: GatewayAgentRouteDocument = {
    ...routeBase,
    disabled: false,
    match_policy: { path_prefix: input.pathPrefix, methods: ["POST"] },
  };
  return {
    agent,
    stagingRoute,
    finalRoute,
    digest: input.content.hash(canonicalAgentValue({ agent, route: finalRoute })),
  };
}

export class AgentDeploymentService {
  constructor(
    private readonly registry: AgentDeploymentRegistry,
    private readonly releases: AgentReleaseRegistry,
    private readonly identity: PlatformIdentityService,
    private readonly content: ContentRuntime,
    private readonly gateway: GatewayDeploymentAdapter,
  ) {}

  async create(
    actor: PlatformActorReference,
    tenantId: string,
    input: CreateAgentDeploymentInput,
  ): Promise<AgentDeployment> {
    if (!validRequestKey(input.requestKey)) {
      throw new IdentityError("invalid_input", "requestKey must be 1-100 safe characters");
    }
    const authority = await this.identity.authorizeTenantGateway(
      actor,
      tenantId,
      input.gatewayId,
      "manage",
    );
    const release = await this.releases.get(input.releaseId);
    if (!release || release.tenantId !== tenantId) {
      throw new IdentityError("not_found", "Agent release not found");
    }
    const seed = this.content.hash(canonicalAgentValue({
      tenantId,
      releaseId: release.id,
      gatewayId: input.gatewayId,
      requestKey: input.requestKey,
    }));
    const definitionSlug = release.definitionId.split(":").at(-1) ?? "agent";
    const deploymentId = `deployment:${slugPart(tenantId)}:${seed.slice(0, 24)}`;
    const gatewayAgentId = `pl-${slugPart(tenantId)}-${slugPart(definitionSlug)}-${seed.slice(0, 12)}`;
    const gatewayRouteId = `pl-agent-${seed.slice(0, 24)}`;
    const pathPrefix = `/agents/${slugPart(tenantId)}/${slugPart(definitionSlug)}-${seed.slice(0, 10)}`;
    const materialized = materializeDeployment({
      release,
      gatewayId: input.gatewayId,
      gatewayAuthorityEpoch: authority.gateway.authorityEpoch,
      gatewayAgentId,
      gatewayRouteId,
      pathPrefix,
      stagingToken: seed.slice(0, 32),
      content: this.content,
    });
    const now = this.content.now();
    const result = await this.registry.create({
      expectedReleaseDigest: release.digest,
      deployment: {
        id: deploymentId,
        tenantId,
        tenantAuthorityEpoch: await this.tenantAuthorityEpoch(tenantId),
        definitionId: release.definitionId,
        requestedReleaseId: release.id,
        appliedReleaseId: null,
        target: { gatewayId: input.gatewayId, gatewayAgentId, gatewayRouteId, pathPrefix },
        gatewayAuthorityEpoch: authority.gateway.authorityEpoch,
        desiredDigest: materialized.digest,
        lifecycleState: "awaiting_key_binding",
        operationState: "stable",
        invocationEpoch: 1,
        requestKey: input.requestKey,
        lastVerifiedAt: null,
        failureCode: null,
        createdByPrincipalId: authority.principal.id,
        createdAt: now,
        updatedAt: now,
      },
    });
    if (result.status === "conflict") conflict("requestKey is already bound to another deployment intent");
    if (result.status === "invalid_release") conflict("Agent release changed while allocating deployment");
    if (result.status === "invalid_tenant") conflict("Tenant authority changed while allocating deployment");
    if (!("item" in result)) conflict("deployment allocation failed");

    try {
      const current = await this.identity.authorizeTenantGateway(
        actor,
        tenantId,
        input.gatewayId,
        "manage",
      );
      if (current.gateway.authorityEpoch !== authority.gateway.authorityEpoch) {
        conflict("Gateway authority changed while allocating deployment");
      }
    } catch (error) {
      if (result.status === "created" && isIdentityError(error)) {
        await this.registry.cancelAwaiting(result.item.id);
        conflict("deployment authority changed while allocating deployment");
      }
      throw error;
    }
    return projection(result.item);
  }

  private async tenantAuthorityEpoch(tenantId: string): Promise<number> {
    const [row] = await this.registry.database.query<{ authority_epoch: number }>(
      `SELECT fence.authority_epoch FROM platform_tenants tenant
        JOIN platform_authority_fences fence
          ON fence.subject_kind = 'tenant' AND fence.subject_id = tenant.id
         AND fence.tenant_id = ''
       WHERE tenant.id = ? AND tenant.status = 'active'`,
      [tenantId],
    );
    if (!row) throw new IdentityError("conflict", "Tenant authority changed");
    return Number(row.authority_epoch);
  }

  private async managed(
    actor: PlatformActorReference,
    tenantId: string,
    deploymentId: string,
    access: "view" | "manage",
  ): Promise<StoredAgentDeployment> {
    const item = await this.registry.get(deploymentId);
    if (!item || item.tenantId !== tenantId || item.lifecycleState === "deleted") {
      throw new IdentityError("not_found", "Agent deployment not found");
    }
    const authority = await this.identity.authorizeTenantGateway(
      actor,
      tenantId,
      item.target.gatewayId,
      access,
    );
    if (authority.gateway.authorityEpoch !== item.gatewayAuthorityEpoch) {
      conflict("deployment Gateway authority changed");
    }
    return item;
  }

  private async releaseFor(
    deployment: StoredAgentDeployment,
    releaseId: string,
  ): Promise<StoredAgentRelease> {
    const release = await this.releases.get(releaseId);
    if (!release || release.tenantId !== deployment.tenantId ||
      release.definitionId !== deployment.definitionId) {
      throw new IdentityError("not_found", "Agent release not found");
    }
    return release;
  }

  private materializeFor(
    deployment: StoredAgentDeployment,
    release: StoredAgentRelease,
  ): DeploymentMaterialization {
    return materializeDeployment({
      release,
      gatewayId: deployment.target.gatewayId,
      gatewayAuthorityEpoch: deployment.gatewayAuthorityEpoch,
      gatewayAgentId: deployment.target.gatewayAgentId,
      gatewayRouteId: deployment.target.gatewayRouteId,
      pathPrefix: deployment.target.pathPrefix,
      stagingToken: this.content.hash(deployment.id).slice(0, 32),
      content: this.content,
    });
  }

  private digest(value: unknown): string {
    return this.content.hash(canonicalAgentValue(value));
  }

  private async withGatewayLeases<T>(
    gatewayId: string,
    work: (ownerToken: string) => Promise<T>,
  ): Promise<T> {
    const ownerToken = `deployment-operation:${this.content.id()}`;
    const now = this.content.now();
    const leaseUntil = new Date(new Date(now).getTime() + 5 * 60_000).toISOString();
    if (!await this.registry.acquireGatewayLeases({ gatewayId, ownerToken, now, leaseUntil })) {
      conflict("another Gateway object operation is in progress");
    }
    try {
      return await work(ownerToken);
    } finally {
      await this.registry.releaseGatewayLeases(gatewayId, ownerToken, this.content.now());
    }
  }

  private async eligibleBinding(
    deployment: StoredAgentDeployment,
  ): Promise<{ binding: DeploymentKeyBindingRecord; key: GatewayVirtualKeyPolicy }> {
    const binding = await this.registry.binding(deployment.id);
    if (!binding || binding.status !== "bound" ||
      binding.gatewayId !== deployment.target.gatewayId ||
      binding.routeId !== deployment.target.gatewayRouteId ||
      !binding.keyPolicyFingerprint) {
      conflict("deployment requires a verified Virtual Key binding");
    }
    const keys = await this.gateway.listVirtualKeys(deployment.target.gatewayId);
    const now = new Date(this.content.now()).getTime();
    for (const key of keys) {
      const expired = virtualKeyExpired(key.expires_at, now);
      if (!key.disabled && !expired && key.allowed_route_ids.length === 0) {
        conflict("an enabled allow-all Virtual Key blocks platform route activation");
      }
    }
    const key = keys.find((candidate) => candidate.id === binding.keyId);
    if (!key || key.disabled ||
      virtualKeyExpired(key.expires_at, now) ||
      key.allowed_route_ids.length === 0 ||
      !key.allowed_route_ids.includes(deployment.target.gatewayRouteId)) {
      conflict("bound Virtual Key is not eligible for deployment");
    }
    if (virtualKeyPolicyFingerprint(key, this.content) !== binding.keyPolicyFingerprint) {
      conflict("bound Virtual Key policy changed; reconcile it before deployment");
    }
    return { binding, key };
  }

  private async cleanupInitialBindingConflict(
    deployment: StoredAgentDeployment,
  ): Promise<void> {
    const access = new DeploymentAccessRegistry(this.registry.database);
    if (!await access.startBindingConflictCleanup(deployment.id, this.content.now())) {
      conflict("deployment binding conflict cleanup could not start");
    }
    const binding = await this.registry.binding(deployment.id);
    if (!binding) conflict("deployment binding disappeared during conflict cleanup");
    const key = await this.gateway.readVirtualKey(binding.gatewayId, binding.keyId);
    if (!key) {
      if (!await access.completeBindingConflictCleanup(deployment.id, this.content.now())) {
        conflict("deployment binding conflict cleanup could not be committed");
      }
      return;
    }
    const allowed = key.allowed_route_ids.filter((id) => id !== binding.routeId);
    const desired = virtualKeyPolicyValue({
      ...key,
      disabled: allowed.length === 0 ? true : key.disabled,
      allowed_route_ids: allowed,
    });
    const token = `binding-conflict-cleanup:${deployment.id}:${this.content.id()}`;
    if (!await access.beginKeyMutation({
      gatewayId: binding.gatewayId,
      keyId: binding.keyId,
      desired,
      operationKind: "binding_conflict_cleanup",
      operationToken: token,
      now: this.content.now(),
    })) {
      conflict("deployment binding key requires reconciliation before cleanup");
    }
    try {
      await this.gateway.updateVirtualKey(binding.gatewayId, binding.keyId, desired);
      const observed = await this.gateway.readVirtualKey(binding.gatewayId, binding.keyId);
      const fingerprint = observed && virtualKeyPolicyFingerprint(observed, this.content);
      if (!observed || fingerprint !== virtualKeyPolicyFingerprint(desired, this.content)) {
        throw new Error("binding-conflict key cleanup could not be verified");
      }
      if (!await access.completeKeyMutation({
        gatewayId: binding.gatewayId,
        keyId: binding.keyId,
        operationToken: token,
        fingerprint,
        now: this.content.now(),
      })) {
        throw new Error("binding-conflict key cleanup lost its state token");
      }
      if (!await access.completeBindingConflictCleanup(deployment.id, this.content.now())) {
        throw new Error("binding-conflict cleanup could not release its reservation");
      }
    } catch (error) {
      await access.failKeyMutation({
        gatewayId: binding.gatewayId,
        keyId: binding.keyId,
        operationToken: token,
        incident: error instanceof Error ? error.message : "binding conflict cleanup failed",
        now: this.content.now(),
      });
      throw error;
    }
  }

  private async proveFinalRoute(
    deployment: StoredAgentDeployment,
    desired: GatewayAgentRouteDocument,
  ): Promise<void> {
    const [agentRoutes, llmRoutes, mcpRoutes] = await Promise.all([
      this.gateway.listAgentRoutes(deployment.target.gatewayId),
      this.gateway.listLLMRoutes(deployment.target.gatewayId),
      this.gateway.listMCPRoutes(deployment.target.gatewayId),
    ]);
    if ([...agentRoutes, ...llmRoutes, ...mcpRoutes]
      .some((route) => conflictsWithFinalRoute(route, desired))) {
      conflict("Gateway route namespace conflicts with the deployment ingress");
    }
  }

  private async reauthorize(
    actor: PlatformActorReference,
    deployment: StoredAgentDeployment,
  ): Promise<void> {
    const authority = await this.identity.authorizeTenantGateway(
      actor,
      deployment.tenantId,
      deployment.target.gatewayId,
      "manage",
    );
    if (authority.gateway.authorityEpoch !== deployment.gatewayAuthorityEpoch) {
      conflict("deployment Gateway authority changed");
    }
  }

  private operationError(error: unknown): { code: string; message: string } {
    if (isIdentityError(error)) return { code: error.code, message: error.message };
    return { code: "gateway_operation_failed", message: "Gateway operation failed" };
  }

  private async containUnprotectedRoute(
    deployment: StoredAgentDeployment,
    operation: StoredDeploymentOperation,
    materialized: DeploymentMaterialization,
  ): Promise<void> {
    try {
      await this.registry.updateOperation({
        operationId: operation.id,
        phase: "route_containment_in_progress",
        routeWriteAttempted: true,
        now: this.content.now(),
      });
      await this.gateway.updateAgentRoute(
        deployment.target.gatewayId,
        deployment.target.gatewayRouteId,
        materialized.stagingRoute,
      );
      const observed = await this.gateway.readAgentRoute(
        deployment.target.gatewayId,
        deployment.target.gatewayRouteId,
      );
      if (!observed || !same(routeView(observed), routeView(materialized.stagingRoute))) {
        throw new Error("route containment could not be verified");
      }
      await this.registry.quarantineOperation({
        operationId: operation.id,
        phase: "route_quarantined_contained",
        message: "an unprotected public route was withdrawn and quarantined",
        routeDigest: this.digest(routeView(observed)),
        now: this.content.now(),
      });
    } catch {
      await this.registry.quarantineOperation({
        operationId: operation.id,
        phase: "route_containment_failed",
        message: "an unprotected public route could not be withdrawn",
        routeDigest: null,
        now: this.content.now(),
      });
    }
  }

  private async containFailedResumeProof(
    deployment: StoredAgentDeployment,
    operation: StoredDeploymentOperation,
    materialized: DeploymentMaterialization,
    error: unknown,
  ): Promise<AgentDeploymentOperation> {
    const route = await this.gateway.readAgentRoute(
      deployment.target.gatewayId,
      deployment.target.gatewayRouteId,
    ).catch(() => null);
    if (route && same(routeView(route), routeView(materialized.finalRoute))) {
      await this.containUnprotectedRoute(deployment, operation, materialized);
      return operationProjection((await this.registry.operation(operation.id))!);
    }
    throw error;
  }

  private async finishOrFail(
    deployment: StoredAgentDeployment,
    operation: StoredDeploymentOperation,
    materialized: DeploymentMaterialization,
    lifecycle: "active" | "offline",
    releaseId: string,
    expectedRoute: GatewayAgentRouteDocument,
  ): Promise<AgentDeploymentOperation> {
    const observedAgent = await this.gateway.readAgent(
      deployment.target.gatewayId,
      deployment.target.gatewayAgentId,
    );
    const observedRoute = await this.gateway.readAgentRoute(
      deployment.target.gatewayId,
      deployment.target.gatewayRouteId,
    );
    await this.registry.updateOperation({
      operationId: operation.id,
      phase: "verifying",
      observedAgent,
      observedRoute,
      now: this.content.now(),
    });
    if (lifecycle === "active" && observedRoute && !routeProtected(observedRoute)) {
      await this.containUnprotectedRoute(deployment, operation, materialized);
      return operationProjection((await this.registry.operation(operation.id))!);
    }
    if (!observedAgent || !observedRoute ||
      !same(agentView(observedAgent), agentView(materialized.agent)) ||
      !same(routeView(observedRoute), routeView(expectedRoute))) {
      await this.registry.failOperation({
        operationId: operation.id,
        phase: "verification_failed",
        code: "observed_state_mismatch",
        message: "Gateway Agent or route did not match the desired state",
        now: this.content.now(),
      });
      return operationProjection((await this.registry.operation(operation.id))!);
    }
    const completed = await this.registry.completeOperation({
      operationId: operation.id,
      lifecycle,
      appliedReleaseId: releaseId,
      desiredDigest: materialized.digest,
      agentDigest: this.digest(agentView(observedAgent)),
      routeDigest: this.digest(routeView(observedRoute)),
      now: this.content.now(),
    });
    if (!completed) conflict("deployment operation lost its state lease");
    return operationProjection((await this.registry.operation(operation.id))!);
  }

  async list(actor: PlatformActorReference, tenantId: string): Promise<AgentDeployment[]> {
    await this.identity.authorizeTenant(actor, tenantId, "admin");
    const visible: AgentDeployment[] = [];
    for (const item of await this.registry.list(tenantId)) {
      try {
        await this.identity.authorizeTenantGateway(actor, tenantId, item.target.gatewayId, "view");
        visible.push(projection(item));
      } catch (error) {
        if (!isIdentityError(error) || error.code !== "forbidden") throw error;
      }
    }
    return visible;
  }

  async get(
    actor: PlatformActorReference,
    tenantId: string,
    deploymentId: string,
  ): Promise<AgentDeployment> {
    await this.identity.authorizeTenant(actor, tenantId, "admin");
    const item = await this.registry.get(deploymentId);
    if (!item || item.tenantId !== tenantId || item.lifecycleState === "deleted") {
      throw new IdentityError("not_found", "Agent deployment not found");
    }
    await this.identity.authorizeTenantGateway(actor, tenantId, item.target.gatewayId, "view");
    return projection(item);
  }

  async authorizeRuntime(
    actor: PlatformActorReference,
    tenantId: string,
    deploymentId: string,
    access: "view" | "manage",
  ): Promise<AgentDeployment> {
    await this.identity.authorizeTenant(actor, tenantId, "admin");
    return projection(await this.managed(actor, tenantId, deploymentId, access));
  }

  async history(
    actor: PlatformActorReference,
    tenantId: string,
    deploymentId: string,
  ): Promise<AgentDeploymentOperation[]> {
    await this.managed(actor, tenantId, deploymentId, "view");
    return (await this.registry.operations(deploymentId)).map(operationProjection);
  }

  private async begin(input: {
    deployment: StoredAgentDeployment;
    materialized: DeploymentMaterialization;
    kind: DeploymentOperationKind;
    requestKey: string;
    releaseId: string;
    expectedLifecycle: DeploymentLifecycleState[];
    phase: string;
    initial: boolean;
  }): Promise<StoredDeploymentOperation> {
    if (!validRequestKey(input.requestKey)) {
      throw new IdentityError("invalid_input", "requestKey must be 1-100 safe characters");
    }
    const now = this.content.now();
    const result = await this.registry.beginOperation({
      deploymentId: input.deployment.id,
      expectedInvocationEpoch: input.deployment.invocationEpoch,
      expectedLifecycle: input.expectedLifecycle,
      kind: input.kind,
      requestKey: input.requestKey,
      releaseId: input.releaseId,
      operationId: `operation:${this.content.id()}`,
      phase: input.phase,
      desiredAgent: input.materialized.agent,
      desiredAgentDigest: this.digest(agentView(input.materialized.agent)),
      desiredStagingRoute: input.materialized.stagingRoute,
      desiredStagingRouteDigest: this.digest(routeView(input.materialized.stagingRoute)),
      desiredFinalRoute: input.materialized.finalRoute,
      desiredFinalRouteDigest: this.digest(routeView(input.materialized.finalRoute)),
      leaseUntil: new Date(new Date(now).getTime() + 5 * 60_000).toISOString(),
      now,
      initial: input.initial,
    });
    if (result.status === "conflict") conflict("deployment state changed before the operation began");
    return result.operation;
  }

  private async priorOperation(
    deploymentId: string,
    requestKey: string,
    kind: DeploymentOperationKind,
    releaseId: string,
  ): Promise<StoredDeploymentOperation | null> {
    if (!validRequestKey(requestKey)) {
      throw new IdentityError("invalid_input", "requestKey must be 1-100 safe characters");
    }
    const existing = (await this.registry.operations(deploymentId))
      .find((item) => item.requestKey === requestKey);
    if (!existing) return null;
    if (existing.kind !== kind || existing.releaseId !== releaseId) {
      conflict("requestKey is already bound to another deployment operation");
    }
    return existing;
  }

  private operationMaterialization(operation: StoredDeploymentOperation): DeploymentMaterialization {
    return {
      agent: operation.desiredAgent as AgentPayload,
      stagingRoute: operation.desiredStagingRoute as GatewayAgentRouteDocument,
      finalRoute: operation.desiredFinalRoute as GatewayAgentRouteDocument,
      digest: this.content.hash(canonicalAgentValue({
        agent: operation.desiredAgent,
        route: operation.desiredFinalRoute,
      })),
    };
  }

  private async executeInitial(
    actor: PlatformActorReference,
    deployment: StoredAgentDeployment,
    operation: StoredDeploymentOperation,
    materialized: DeploymentMaterialization,
  ): Promise<AgentDeploymentOperation> {
    if (operation.status !== "applying") return operationProjection(operation);
    try {
      const history = await this.registry.operations(deployment.id);
      let observedAgent = await this.gateway.readAgent(
        deployment.target.gatewayId,
        deployment.target.gatewayAgentId,
      );
      const agentProven = operation.agentWriteAttempted || history.some((item) =>
        item.id !== operation.id && item.agentWriteAttempted &&
        item.desiredAgentDigest === operation.desiredAgentDigest
      );
      if (observedAgent && (!agentProven ||
        !same(agentView(observedAgent), agentView(materialized.agent)))) {
        conflict("Gateway Agent ID is occupied by an unverified object");
      }
      if (!observedAgent) {
        await this.reauthorize(actor, deployment);
        await this.registry.updateOperation({
          operationId: operation.id,
          phase: "agent_create_pending",
          agentWriteAttempted: true,
          now: this.content.now(),
        });
        await this.gateway.createAgent(deployment.target.gatewayId, materialized.agent);
        observedAgent = await this.gateway.readAgent(
          deployment.target.gatewayId,
          deployment.target.gatewayAgentId,
        );
      }
      if (!observedAgent || !same(agentView(observedAgent), agentView(materialized.agent))) {
        conflict("Gateway Agent create could not be verified");
      }
      await this.registry.updateOperation({
        operationId: operation.id,
        phase: "agent_verified",
        observedAgent,
        now: this.content.now(),
      });

      let observedRoute = await this.gateway.readAgentRoute(
        deployment.target.gatewayId,
        deployment.target.gatewayRouteId,
      );
      const routeProven = operation.routeWriteAttempted || history.some((item) =>
        item.id !== operation.id && item.routeWriteAttempted &&
        item.desiredStagingRouteDigest === operation.desiredStagingRouteDigest &&
        item.desiredFinalRouteDigest === operation.desiredFinalRouteDigest
      );
      const routeIsStaging = observedRoute &&
        same(routeView(observedRoute), routeView(materialized.stagingRoute));
      const routeIsFinal = observedRoute &&
        same(routeView(observedRoute), routeView(materialized.finalRoute));
      if (observedRoute && (!routeProven || (!routeIsStaging && !routeIsFinal))) {
        conflict("Gateway route ID is occupied by an unverified object");
      }
      if (!observedRoute) {
        await this.reauthorize(actor, deployment);
        await this.registry.updateOperation({
          operationId: operation.id,
          phase: "staging_route_create_pending",
          routeWriteAttempted: true,
          now: this.content.now(),
        });
        await this.gateway.createAgentRoute(
          deployment.target.gatewayId,
          materialized.stagingRoute,
        );
        observedRoute = await this.gateway.readAgentRoute(
          deployment.target.gatewayId,
          deployment.target.gatewayRouteId,
        );
      }
      if (!observedRoute) conflict("Gateway staging route create could not be verified");
      if (!same(routeView(observedRoute), routeView(materialized.stagingRoute)) &&
        !same(routeView(observedRoute), routeView(materialized.finalRoute))) {
        conflict("Gateway staging route does not match its operation journal");
      }
      await this.registry.updateOperation({
        operationId: operation.id,
        phase: same(routeView(observedRoute), routeView(materialized.finalRoute))
          ? "activation_write_observed" : "objects_created_awaiting_activation",
        observedRoute,
        now: this.content.now(),
      });

      if (same(routeView(observedRoute), routeView(materialized.stagingRoute))) {
        await this.reauthorize(actor, deployment);
        await this.eligibleBinding(deployment);
        await this.proveFinalRoute(deployment, materialized.finalRoute);
        await this.registry.updateOperation({
          operationId: operation.id,
          phase: "activation_pending",
          routeWriteAttempted: true,
          now: this.content.now(),
        });
        await this.gateway.updateAgentRoute(
          deployment.target.gatewayId,
          deployment.target.gatewayRouteId,
          materialized.finalRoute,
        );
      }
      return this.finishOrFail(
        deployment,
        operation,
        materialized,
        "active",
        operation.releaseId,
        materialized.finalRoute,
      );
    } catch (error) {
      const observedRoute = await this.gateway.readAgentRoute(
        deployment.target.gatewayId,
        deployment.target.gatewayRouteId,
      ).catch(() => null);
      if (observedRoute && observedRoute.id === deployment.target.gatewayRouteId &&
        observedRoute.disabled !== true && !routeProtected(observedRoute)) {
        await this.containUnprotectedRoute(deployment, operation, materialized);
      } else {
        const failure = this.operationError(error);
        await this.registry.failOperation({
          operationId: operation.id,
          phase: (await this.registry.operation(operation.id))?.phase ?? "apply_failed",
          code: failure.code,
          message: failure.message,
          now: this.content.now(),
        });
      }
      return operationProjection((await this.registry.operation(operation.id))!);
    }
  }

  private async initialOperation(
    actor: PlatformActorReference,
    tenantId: string,
    deploymentId: string,
    requestKey: string,
    retry: boolean,
  ): Promise<AgentDeploymentOperation> {
    const deployment = await this.managed(actor, tenantId, deploymentId, "manage");
    const release = await this.releaseFor(deployment, deployment.requestedReleaseId);
    const materialized = this.materializeFor(deployment, release);
    if (materialized.digest !== deployment.desiredDigest) {
      conflict("deployment desired materialization changed");
    }
    const kind = retry ? "retry" : "apply";
    const prior = await this.priorOperation(deploymentId, requestKey, kind, release.id);
    if (prior) {
      if (prior.status !== "applying") return operationProjection(prior);
      return this.withGatewayLeases(deployment.target.gatewayId, async () => {
        await this.reauthorize(actor, deployment);
        try {
          await this.eligibleBinding(deployment);
          await this.proveFinalRoute(deployment, materialized.finalRoute);
        } catch (error) {
          return this.containFailedResumeProof(deployment, prior, materialized, error);
        }
        return this.executeInitial(actor, deployment, prior, this.operationMaterialization(prior));
      });
    }
    return this.withGatewayLeases(deployment.target.gatewayId, async () => {
      await this.reauthorize(actor, deployment);
      await this.eligibleBinding(deployment);
      await this.proveFinalRoute(deployment, materialized.finalRoute);
      const [remoteAgent, remoteRoute] = await Promise.all([
        this.gateway.readAgent(deployment.target.gatewayId, deployment.target.gatewayAgentId),
        this.gateway.readAgentRoute(deployment.target.gatewayId, deployment.target.gatewayRouteId),
      ]);
      if (!retry && (remoteAgent || remoteRoute)) {
        await this.cleanupInitialBindingConflict(deployment);
        conflict("deployment target IDs were occupied; the key binding was safely removed");
      }
      if (retry) {
        const fence = await this.registry.pairFence(
          deployment.target.gatewayId,
          deployment.target.gatewayAgentId,
        );
        if (!fence || fence.deploymentId !== deployment.id || fence.state !== "provisional") {
          conflict("retry requires this deployment's provisional pair reservation");
        }
      }
      await this.reauthorize(actor, deployment);
      const operation = await this.begin({
        deployment,
        materialized,
        kind,
        requestKey,
        releaseId: release.id,
        expectedLifecycle: retry ? ["partial_failure"] : ["ready_to_apply"],
        phase: "prewrite_verified",
        initial: true,
      });
      return this.executeInitial(actor, deployment, operation, materialized);
    });
  }

  async apply(
    actor: PlatformActorReference,
    tenantId: string,
    deploymentId: string,
    requestKey: string,
  ): Promise<AgentDeploymentOperation> {
    return this.initialOperation(actor, tenantId, deploymentId, requestKey, false);
  }

  async retry(
    actor: PlatformActorReference,
    tenantId: string,
    deploymentId: string,
    requestKey: string,
  ): Promise<AgentDeploymentOperation> {
    const deployment = await this.managed(actor, tenantId, deploymentId, "manage");
    const prior = await this.priorOperation(
      deploymentId,
      requestKey,
      "retry",
      deployment.requestedReleaseId,
    );
    if (prior && prior.status !== "applying") return operationProjection(prior);
    const operations = await this.registry.operations(deploymentId);
    const last = operations[0];
    if (!last || !["apply", "retry"].includes(last.kind)) {
      conflict("this deployment failure is not an initial publication retry");
    }
    return this.initialOperation(actor, tenantId, deploymentId, requestKey, true);
  }

  private async currentMaterialization(
    deployment: StoredAgentDeployment,
  ): Promise<DeploymentMaterialization> {
    if (!deployment.appliedReleaseId) conflict("deployment has no applied release");
    const operations = await this.registry.operations(deployment.id);
    const latest = operations.find((item) =>
      item.status === "succeeded" && item.releaseId === deployment.appliedReleaseId &&
      item.kind !== "verify"
    );
    if (!latest) conflict("deployment has no verified materialization journal");
    return {
      agent: latest.desiredAgent as AgentPayload,
      stagingRoute: latest.desiredStagingRoute as GatewayAgentRouteDocument,
      finalRoute: latest.desiredFinalRoute as GatewayAgentRouteDocument,
      digest: deployment.desiredDigest,
    };
  }

  private async requirePromotedPair(deployment: StoredAgentDeployment): Promise<void> {
    const fence = await this.registry.pairFence(
      deployment.target.gatewayId,
      deployment.target.gatewayAgentId,
    );
    if (!fence || fence.deploymentId !== deployment.id || fence.state !== "promoted" ||
      fence.gatewayRouteId !== deployment.target.gatewayRouteId) {
      conflict("deployment does not own a promoted Gateway Agent/route pair");
    }
  }

  async takeOffline(
    actor: PlatformActorReference,
    tenantId: string,
    deploymentId: string,
    requestKey: string,
  ): Promise<AgentDeploymentOperation> {
    const deployment = await this.managed(actor, tenantId, deploymentId, "manage");
    if (!deployment.appliedReleaseId) conflict("deployment has no applied release");
    const prior = await this.priorOperation(
      deploymentId,
      requestKey,
      "take_offline",
      deployment.appliedReleaseId,
    );
    if (prior && prior.status !== "applying") return operationProjection(prior);
    const materialized = await this.currentMaterialization(deployment);
    return this.withGatewayLeases(deployment.target.gatewayId, async () => {
      await this.requirePromotedPair(deployment);
      const [agent, route] = await Promise.all([
        this.gateway.readAgent(deployment.target.gatewayId, deployment.target.gatewayAgentId),
        this.gateway.readAgentRoute(deployment.target.gatewayId, deployment.target.gatewayRouteId),
      ]);
      const routeIsFinal = route && same(routeView(route), routeView(materialized.finalRoute));
      const routeIsStaging = route && same(routeView(route), routeView(materialized.stagingRoute));
      if (!agent || !route || !same(agentView(agent), agentView(materialized.agent)) ||
        (!routeIsFinal && !(prior?.status === "applying" && routeIsStaging))) {
        conflict("active deployment drift must be reconciled before take-offline");
      }
      let operation = prior;
      if (!operation) {
        await this.reauthorize(actor, deployment);
        operation = await this.begin({
        deployment,
        materialized,
        kind: "take_offline",
        requestKey,
        releaseId: deployment.appliedReleaseId!,
        expectedLifecycle: ["active"],
        phase: "take_offline_pending_stage",
        initial: false,
        });
      }
      if (operation.status !== "applying") return operationProjection(operation);
      try {
        if (!routeIsStaging) {
          await this.reauthorize(actor, deployment);
          await this.registry.updateOperation({
            operationId: operation.id,
            phase: "take_offline_pending_stage",
            routeWriteAttempted: true,
            now: this.content.now(),
          });
          await this.gateway.updateAgentRoute(
            deployment.target.gatewayId,
            deployment.target.gatewayRouteId,
            materialized.stagingRoute,
          );
        }
        return this.finishOrFail(
          deployment,
          operation,
          materialized,
          "offline",
          deployment.appliedReleaseId!,
          materialized.stagingRoute,
        );
      } catch (error) {
        const failure = this.operationError(error);
        await this.registry.failOperation({
          operationId: operation.id,
          phase: "take_offline_failed",
          code: failure.code,
          message: failure.message,
          now: this.content.now(),
        });
        return operationProjection((await this.registry.operation(operation.id))!);
      }
    });
  }

  async online(
    actor: PlatformActorReference,
    tenantId: string,
    deploymentId: string,
    requestKey: string,
  ): Promise<AgentDeploymentOperation> {
    const deployment = await this.managed(actor, tenantId, deploymentId, "manage");
    if (!deployment.appliedReleaseId) conflict("deployment has no applied release");
    const prior = await this.priorOperation(
      deploymentId,
      requestKey,
      "online",
      deployment.appliedReleaseId,
    );
    if (prior && prior.status !== "applying") return operationProjection(prior);
    const release = await this.releaseFor(deployment, deployment.appliedReleaseId);
    const materialized = this.materializeFor(deployment, release);
    return this.withGatewayLeases(deployment.target.gatewayId, async () => {
      await this.requirePromotedPair(deployment);
      try {
        await this.eligibleBinding(deployment);
        await this.proveFinalRoute(deployment, materialized.finalRoute);
      } catch (error) {
        if (prior?.status === "applying") {
          return this.containFailedResumeProof(deployment, prior, materialized, error);
        }
        throw error;
      }
      const [agent, route] = await Promise.all([
        this.gateway.readAgent(deployment.target.gatewayId, deployment.target.gatewayAgentId),
        this.gateway.readAgentRoute(deployment.target.gatewayId, deployment.target.gatewayRouteId),
      ]);
      const routeIsStaging = route && same(routeView(route), routeView(materialized.stagingRoute));
      const routeIsFinal = route && same(routeView(route), routeView(materialized.finalRoute));
      if (!agent || !route || !same(agentView(agent), agentView(materialized.agent)) ||
        (!routeIsStaging && !(prior?.status === "applying" && routeIsFinal))) {
        conflict("offline deployment drift must be reconciled before online");
      }
      let operation = prior;
      if (!operation) {
        await this.reauthorize(actor, deployment);
        operation = await this.begin({
        deployment,
        materialized,
        kind: "online",
        requestKey,
        releaseId: release.id,
        expectedLifecycle: ["offline"],
        phase: "online_pending_activation",
        initial: false,
        });
      }
      if (operation.status !== "applying") return operationProjection(operation);
      try {
        if (!routeIsFinal) {
          await this.reauthorize(actor, deployment);
          await this.eligibleBinding(deployment);
          await this.proveFinalRoute(deployment, materialized.finalRoute);
          await this.registry.updateOperation({
            operationId: operation.id,
            phase: "online_pending_activation",
            routeWriteAttempted: true,
            now: this.content.now(),
          });
          await this.gateway.updateAgentRoute(
            deployment.target.gatewayId,
            deployment.target.gatewayRouteId,
            materialized.finalRoute,
          );
        }
        return this.finishOrFail(
          deployment,
          operation,
          materialized,
          "active",
          release.id,
          materialized.finalRoute,
        );
      } catch (error) {
        const observed = await this.gateway.readAgentRoute(
          deployment.target.gatewayId,
          deployment.target.gatewayRouteId,
        ).catch(() => null);
        if (observed && observed.disabled !== true && !routeProtected(observed)) {
          await this.containUnprotectedRoute(deployment, operation, materialized);
        } else {
          const failure = this.operationError(error);
          await this.registry.failOperation({
            operationId: operation.id,
            phase: "online_failed",
            code: failure.code,
            message: failure.message,
            now: this.content.now(),
          });
        }
        return operationProjection((await this.registry.operation(operation.id))!);
      }
    });
  }

  async rollback(
    actor: PlatformActorReference,
    tenantId: string,
    deploymentId: string,
    releaseId: string,
    requestKey: string,
  ): Promise<AgentDeploymentOperation> {
    const deployment = await this.managed(actor, tenantId, deploymentId, "manage");
    const prior = await this.priorOperation(deploymentId, requestKey, "rollback", releaseId);
    if (prior && prior.status !== "applying") return operationProjection(prior);
    const history = await this.registry.operations(deployment.id);
    if (!history.some((item) => item.status === "succeeded" && item.releaseId === releaseId &&
      item.kind !== "verify")) {
      conflict("rollback requires a previously verified release on this deployment");
    }
    const release = await this.releaseFor(deployment, releaseId);
    const target = this.materializeFor(deployment, release);
    const current = await this.currentMaterialization(deployment);
    return this.withGatewayLeases(deployment.target.gatewayId, async () => {
      await this.requirePromotedPair(deployment);
      try {
        await this.eligibleBinding(deployment);
        await this.proveFinalRoute(deployment, target.finalRoute);
      } catch (error) {
        if (prior?.status === "applying") {
          return this.containFailedResumeProof(deployment, prior, target, error);
        }
        throw error;
      }
      const [agent, route] = await Promise.all([
        this.gateway.readAgent(deployment.target.gatewayId, deployment.target.gatewayAgentId),
        this.gateway.readAgentRoute(deployment.target.gatewayId, deployment.target.gatewayRouteId),
      ]);
      const expectedRoute = deployment.lifecycleState === "active"
        ? current.finalRoute : current.stagingRoute;
      if (!agent || !route || !same(agentView(agent), agentView(current.agent)) ||
        !same(routeView(route), routeView(expectedRoute))) {
        conflict("deployment drift must be reconciled before rollback");
      }
      let operation = prior;
      if (!operation) {
        await this.reauthorize(actor, deployment);
        operation = await this.begin({
        deployment,
        materialized: target,
        kind: "rollback",
        requestKey,
        releaseId,
        expectedLifecycle: ["active", "offline"],
        phase: deployment.lifecycleState === "active"
          ? "rollback_pending_stage" : "rollback_staged_awaiting_agent_update",
        initial: false,
        });
      }
      if (operation.status !== "applying") return operationProjection(operation);
      try {
        if (deployment.lifecycleState === "active") {
          await this.reauthorize(actor, deployment);
          await this.registry.updateOperation({
            operationId: operation.id,
            phase: "rollback_pending_stage",
            routeWriteAttempted: true,
            now: this.content.now(),
          });
          await this.gateway.updateAgentRoute(
            deployment.target.gatewayId,
            deployment.target.gatewayRouteId,
            target.stagingRoute,
          );
        }
        const staged = await this.gateway.readAgentRoute(
          deployment.target.gatewayId,
          deployment.target.gatewayRouteId,
        );
        if (!staged || !same(routeView(staged), routeView(target.stagingRoute))) {
          conflict("rollback staging route could not be verified");
        }
        await this.registry.updateOperation({
          operationId: operation.id,
          phase: "rollback_staged_awaiting_agent_update",
          agentWriteAttempted: true,
          observedRoute: staged,
          now: this.content.now(),
        });
        await this.reauthorize(actor, deployment);
        await this.gateway.updateAgent(
          deployment.target.gatewayId,
          deployment.target.gatewayAgentId,
          target.agent,
        );
        const updatedAgent = await this.gateway.readAgent(
          deployment.target.gatewayId,
          deployment.target.gatewayAgentId,
        );
        if (!updatedAgent || !same(agentView(updatedAgent), agentView(target.agent))) {
          conflict("rollback Agent update could not be verified");
        }
        await this.registry.updateOperation({
          operationId: operation.id,
          phase: "rollback_agent_updated_awaiting_activation",
          observedAgent: updatedAgent,
          now: this.content.now(),
        });
        await this.eligibleBinding(deployment);
        await this.proveFinalRoute(deployment, target.finalRoute);
        await this.reauthorize(actor, deployment);
        await this.gateway.updateAgentRoute(
          deployment.target.gatewayId,
          deployment.target.gatewayRouteId,
          target.finalRoute,
        );
        return this.finishOrFail(
          deployment,
          operation,
          target,
          "active",
          releaseId,
          target.finalRoute,
        );
      } catch (error) {
        const observed = await this.gateway.readAgentRoute(
          deployment.target.gatewayId,
          deployment.target.gatewayRouteId,
        ).catch(() => null);
        if (observed && observed.disabled !== true && !routeProtected(observed)) {
          await this.containUnprotectedRoute(deployment, operation, target);
        } else {
          const failure = this.operationError(error);
          await this.registry.failOperation({
            operationId: operation.id,
            phase: "rollback_failed",
            code: failure.code,
            message: failure.message,
            now: this.content.now(),
          });
        }
        return operationProjection((await this.registry.operation(operation.id))!);
      }
    });
  }

  async verify(
    actor: PlatformActorReference,
    tenantId: string,
    deploymentId: string,
    requestKey: string,
  ): Promise<AgentDeploymentOperation> {
    if (!validRequestKey(requestKey)) {
      throw new IdentityError("invalid_input", "requestKey must be 1-100 safe characters");
    }
    const deployment = await this.managed(actor, tenantId, deploymentId, "manage");
    if (!deployment.appliedReleaseId) conflict("deployment has no applied release");
    const prior = await this.priorOperation(
      deploymentId,
      requestKey,
      "verify",
      deployment.appliedReleaseId,
    );
    if (prior) return operationProjection(prior);
    const materialized = await this.currentMaterialization(deployment);
    return this.withGatewayLeases(deployment.target.gatewayId, async () => {
      await this.requirePromotedPair(deployment);
      const [agent, route] = await Promise.all([
        this.gateway.readAgent(deployment.target.gatewayId, deployment.target.gatewayAgentId),
        this.gateway.readAgentRoute(deployment.target.gatewayId, deployment.target.gatewayRouteId),
      ]);
      const expectedRoute = deployment.lifecycleState === "active"
        ? materialized.finalRoute : materialized.stagingRoute;
      if (!agent || !route || !same(agentView(agent), agentView(materialized.agent)) ||
        !same(routeView(route), routeView(expectedRoute))) {
        conflict("Gateway deployment drift detected");
      }
      const recorded = await this.registry.recordVerification({
        deploymentId,
        operationId: `operation:${this.content.id()}`,
        requestKey,
        releaseId: deployment.appliedReleaseId!,
        desiredAgent: materialized.agent,
        desiredAgentDigest: this.digest(agentView(materialized.agent)),
        desiredStagingRoute: materialized.stagingRoute,
        desiredStagingRouteDigest: this.digest(routeView(materialized.stagingRoute)),
        desiredFinalRoute: materialized.finalRoute,
        desiredFinalRouteDigest: this.digest(routeView(materialized.finalRoute)),
        observedAgent: agent,
        observedRoute: route,
        now: this.content.now(),
      });
      if (!recorded) conflict("deployment state changed during verification");
      return operationProjection(recorded);
    });
  }

  async cancel(
    actor: PlatformActorReference,
    tenantId: string,
    deploymentId: string,
  ): Promise<void> {
    const item = await this.registry.get(deploymentId);
    if (!item || item.tenantId !== tenantId) {
      throw new IdentityError("not_found", "Agent deployment not found");
    }
    await this.identity.authorizeTenantGateway(actor, tenantId, item.target.gatewayId, "manage");
    if (!await this.registry.cancelAwaiting(deploymentId)) {
      conflict("only an unbound deployment intent can be cancelled");
    }
  }
}
