import type {
  DeploymentObservation,
  DeploymentObservationKind,
  DeploymentOperationalMetadata,
  OwnInvocationMetadata,
  TenantRuntimeAttention,
} from "../../contracts/platform/deployments";
import type { PlatformActorReference } from "../../contracts/platform/identity";
import type { GatewayDeploymentRuntimeAdapter } from "../ports/deployment-runtime";
import { DeploymentAccessRegistry } from "./deployment-access-registry";
import { AgentDeploymentService } from "./deployments";
import { IdentityError, isIdentityError, type PlatformIdentityService } from "./identity";

function items(value: unknown, field: string): unknown[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const candidate = (value as Record<string, unknown>)[field];
  return Array.isArray(candidate) ? candidate : [];
}

function viewSafeObservation(
  kind: DeploymentObservationKind,
  data: unknown,
  canManage: boolean,
): unknown {
  if (kind !== "activity" || canManage || !data || typeof data !== "object" || Array.isArray(data)) {
    return data;
  }
  const safe = { ...data as Record<string, unknown> };
  delete safe.pending_permissions;
  return safe;
}

export class DeploymentObservabilityService {
  constructor(
    private readonly deployments: AgentDeploymentService,
    private readonly access: DeploymentAccessRegistry,
    private readonly identity: PlatformIdentityService,
    private readonly gateway: GatewayDeploymentRuntimeAdapter,
  ) {}

  private async canManage(
    actor: PlatformActorReference,
    tenantId: string,
    deploymentId: string,
  ): Promise<boolean> {
    try {
      await this.deployments.authorizeRuntime(actor, tenantId, deploymentId, "manage");
      return true;
    } catch (error) {
      if (isIdentityError(error) && error.code === "forbidden") return false;
      throw error;
    }
  }

  async observations(
    actor: PlatformActorReference,
    tenantId: string,
    kind: DeploymentObservationKind,
    query = "",
  ): Promise<DeploymentObservation[]> {
    const visible = (await this.deployments.list(actor, tenantId)).filter(
      (deployment) => deployment.appliedReleaseId !== null &&
        deployment.lifecycleState !== "deleted",
    );
    return Promise.all(visible.map(async (deployment) => {
      const canManage = kind === "activity"
        ? await this.canManage(actor, tenantId, deployment.id)
        : false;
      const data = await this.gateway.readAgentResource(
        deployment.target.gatewayId,
        deployment.target.gatewayAgentId,
        kind,
        query,
      );
      return {
        deploymentId: deployment.id,
        tenantId,
        definitionId: deployment.definitionId,
        releaseId: deployment.appliedReleaseId,
        gatewayId: deployment.target.gatewayId,
        gatewayAgentId: deployment.target.gatewayAgentId,
        kind,
        data: viewSafeObservation(kind, data, canManage),
      };
    }));
  }

  async observation(
    actor: PlatformActorReference,
    tenantId: string,
    deploymentId: string,
    kind: DeploymentObservationKind,
    query = "",
  ): Promise<DeploymentObservation> {
    const deployment = await this.deployments.authorizeRuntime(
      actor, tenantId, deploymentId, "view",
    );
    const canManage = kind === "activity"
      ? await this.canManage(actor, tenantId, deploymentId)
      : false;
    const data = await this.gateway.readAgentResource(
      deployment.target.gatewayId,
      deployment.target.gatewayAgentId,
      kind,
      query,
    );
    return {
      deploymentId,
      tenantId,
      definitionId: deployment.definitionId,
      releaseId: deployment.appliedReleaseId,
      gatewayId: deployment.target.gatewayId,
      gatewayAgentId: deployment.target.gatewayAgentId,
      kind,
      data: viewSafeObservation(kind, data, canManage),
    };
  }

  async operationalMetadata(
    actor: PlatformActorReference,
    tenantId: string,
    deploymentId: string,
  ): Promise<DeploymentOperationalMetadata> {
    const deployment = await this.deployments.authorizeRuntime(
      actor, tenantId, deploymentId, "view",
    );
    const canManage = await this.canManage(actor, tenantId, deploymentId);
    const capabilities = await this.gateway.readAgentCapabilities(
      deployment.target.gatewayId,
      deployment.target.gatewayAgentId,
    );
    const [sessionPage, runPage, permissionPage] = await Promise.all([
      capabilities.sessions?.list
        ? this.gateway.readAgentResource(
          deployment.target.gatewayId,
          deployment.target.gatewayAgentId,
          "sessions",
        )
        : Promise.resolve({ sessions: [] }),
      this.gateway.readAgentResource(deployment.target.gatewayId, deployment.target.gatewayAgentId, "runs"),
      canManage
        ? this.gateway.readAgentResource(deployment.target.gatewayId, deployment.target.gatewayAgentId, "permissions")
        : Promise.resolve({ items: [] }),
    ]);
    return {
      deploymentId,
      tenantId,
      gatewayId: deployment.target.gatewayId,
      gatewayAgentId: deployment.target.gatewayAgentId,
      sessions: items(sessionPage, "sessions").map((value) => {
        const row = value as Record<string, unknown>;
        return { session_id: row.session_id, updated_at: row.updated_at };
      }),
      runs: items(runPage, "items").map((value) => {
        const row = value as Record<string, unknown>;
        return {
          run_id: row.run_id, session_id: row.session_id, state: row.state,
          started_at: row.started_at, finished_at: row.finished_at, stop_reason: row.stop_reason,
        };
      }),
      permissions: items(permissionPage, "items").map((value) => {
        const row = value as Record<string, unknown>;
        return {
          request_id: row.request_id, run_id: row.run_id, session_id: row.session_id,
          created_at: row.created_at, expires_at: row.expires_at, resume_mode: row.resume_mode,
          actions: row.actions, options: row.options,
        };
      }),
    };
  }

  async ownInvocations(
    actor: PlatformActorReference,
    tenantId: string,
  ): Promise<OwnInvocationMetadata[]> {
    const authority = await this.identity.authorizeTenant(actor, tenantId, "user");
    return (await this.access.invocationContextsForPrincipal(authority.principal.id, tenantId))
      .map((context) => ({
        contextId: context.id,
        deploymentId: context.deploymentId,
        tenantId,
        gatewayId: context.gatewayId,
        gatewayAgentId: context.gatewayAgentId,
        keyId: context.keyId,
        expiresAt: context.expiresAt,
        completedAt: context.completedAt,
      }));
  }

  async runtimeAttention(
    actor: PlatformActorReference,
    tenantId: string,
  ): Promise<TenantRuntimeAttention> {
    const ownInvocations = await this.ownInvocations(actor, tenantId);
    let visible;
    try {
      visible = await this.deployments.list(actor, tenantId);
    } catch (error) {
      if (isIdentityError(error) && error.code === "forbidden") {
        return { ownInvocations, managed: [] };
      }
      throw error;
    }
    const managed = [];
    for (const deployment of visible.filter((item) => item.appliedReleaseId !== null)) {
      try {
        await this.deployments.authorizeRuntime(actor, tenantId, deployment.id, "manage");
      } catch (error) {
        if (isIdentityError(error) && error.code === "forbidden") continue;
        throw error;
      }
      const metadata = await this.operationalMetadata(actor, tenantId, deployment.id);
      managed.push({
        deploymentId: deployment.id,
        tenantId,
        gatewayId: deployment.target.gatewayId,
        gatewayAgentId: deployment.target.gatewayAgentId,
        pendingPermissions: metadata.permissions,
        runningRuns: metadata.runs.filter((value) =>
          value && typeof value === "object" &&
          (value as { state?: unknown }).state === "running"),
      });
    }
    return { ownInvocations, managed };
  }

  async resolvePermission(
    actor: PlatformActorReference,
    tenantId: string,
    deploymentId: string,
    requestId: string,
    decision: unknown,
    resumeNewStream?: () => Promise<unknown>,
  ): Promise<unknown> {
    const deployment = await this.deployments.authorizeRuntime(
      actor, tenantId, deploymentId, "manage",
    );
    const capabilities = await this.gateway.readAgentCapabilities(
      deployment.target.gatewayId, deployment.target.gatewayAgentId,
    );
    if (!capabilities.permissions?.interactive) {
      throw new IdentityError("conflict", "Agent does not support interactive permission resolution");
    }
    await this.deployments.authorizeRuntime(actor, tenantId, deploymentId, "manage");
    if (capabilities.permissions.resume_mode === "new_stream") {
      if (!resumeNewStream) {
        throw new IdentityError("conflict", "Agent permission resolution requires a new turn stream");
      }
      return resumeNewStream();
    }
    if (capabilities.permissions.resume_mode === "active_stream") {
      return this.gateway.resolveAgentPermission(
        deployment.target.gatewayId, deployment.target.gatewayAgentId, requestId, decision,
      );
    }
    throw new IdentityError("conflict", "Agent permission resume mode is not supported");
  }

  async cancelRun(
    actor: PlatformActorReference,
    tenantId: string,
    deploymentId: string,
    runId: string,
    mode: "force" | "graceful",
  ): Promise<unknown> {
    const deployment = await this.deployments.authorizeRuntime(
      actor, tenantId, deploymentId, "manage",
    );
    const capabilities = await this.gateway.readAgentCapabilities(
      deployment.target.gatewayId, deployment.target.gatewayAgentId,
    );
    if (capabilities.cancellation?.[mode] !== true) {
      throw new IdentityError("conflict", `Agent does not support ${mode} cancellation`);
    }
    await this.deployments.authorizeRuntime(actor, tenantId, deploymentId, "manage");
    return this.gateway.cancelAgentRun(
      deployment.target.gatewayId, deployment.target.gatewayAgentId, runId, mode,
    );
  }
}
