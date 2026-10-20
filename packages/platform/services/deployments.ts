import type { AgentPayload, AgentRuntimeBuiltin, BuiltinToolSelection } from "../../contracts/gateway/agents";
import type {
  AgentDeployment,
  CreateAgentDeploymentInput,
} from "../../contracts/platform/deployments";
import type { PlatformActorReference } from "../../contracts/platform/identity";
import type { ContentRuntime } from "../ports/content";
import type { GatewayAgentRouteDocument } from "../ports/deployment";
import { AgentReleaseRegistry, type StoredAgentRelease } from "./agent-release-registry";
import { canonicalAgentValue } from "./agent-definitions";
import {
  AgentDeploymentRegistry,
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
