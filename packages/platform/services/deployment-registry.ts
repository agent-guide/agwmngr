import type {
  AgentDeployment,
  DeploymentLifecycleState,
  DeploymentOperationState,
} from "../../contracts/platform/deployments";
import type { DatabaseSession, PlatformDatabase } from "../ports/database";

interface DeploymentRow {
  id: string;
  tenant_id: string;
  tenant_authority_epoch: number;
  definition_id: string;
  requested_release_id: string;
  applied_release_id: string | null;
  gateway_id: string;
  gateway_authority_epoch: number;
  gateway_agent_id: string;
  gateway_route_id: string;
  path_prefix: string;
  desired_digest: string;
  lifecycle_state: DeploymentLifecycleState;
  operation_state: DeploymentOperationState;
  invocation_epoch: number;
  request_key: string;
  last_verified_at: string | null;
  failure_code: string | null;
  created_by_principal_id: string;
  created_at: string;
  updated_at: string;
}

const deploymentColumns = `id, tenant_id, tenant_authority_epoch, definition_id,
  requested_release_id, applied_release_id, gateway_id, gateway_authority_epoch,
  gateway_agent_id, gateway_route_id, path_prefix, desired_digest, lifecycle_state,
  operation_state, invocation_epoch, request_key, last_verified_at, failure_code,
  created_by_principal_id, created_at, updated_at`;

export interface StoredAgentDeployment extends AgentDeployment {
  tenantAuthorityEpoch: number;
  gatewayAuthorityEpoch: number;
  requestKey: string;
}

function deployment(row: DeploymentRow): StoredAgentDeployment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantAuthorityEpoch: Number(row.tenant_authority_epoch),
    definitionId: row.definition_id,
    requestedReleaseId: row.requested_release_id,
    appliedReleaseId: row.applied_release_id,
    target: {
      gatewayId: row.gateway_id,
      gatewayAgentId: row.gateway_agent_id,
      gatewayRouteId: row.gateway_route_id,
      pathPrefix: row.path_prefix,
    },
    gatewayAuthorityEpoch: Number(row.gateway_authority_epoch),
    desiredDigest: row.desired_digest,
    lifecycleState: row.lifecycle_state,
    operationState: row.operation_state,
    invocationEpoch: Number(row.invocation_epoch),
    requestKey: row.request_key,
    lastVerifiedAt: row.last_verified_at,
    failureCode: row.failure_code,
    createdByPrincipalId: row.created_by_principal_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type CreateDeploymentResult =
  | { status: "created" | "existing"; item: StoredAgentDeployment }
  | { status: "conflict" | "invalid_release" | "invalid_tenant" };

export class AgentDeploymentRegistry {
  constructor(readonly database: PlatformDatabase) {}

  private async write<T>(work: (transaction: DatabaseSession) => Promise<T>): Promise<T> {
    return this.database.transaction(async (transaction) => {
      const suffix = this.database.dialect === "postgres" ? " FOR UPDATE" : "";
      await transaction.query(`SELECT id FROM platform_schema_lock WHERE id = 1${suffix}`);
      return work(transaction);
    });
  }

  async get(
    id: string,
    session: DatabaseSession = this.database,
  ): Promise<StoredAgentDeployment | null> {
    const [row] = await session.query<DeploymentRow>(
      `SELECT ${deploymentColumns} FROM platform_agent_deployments WHERE id = ?`,
      [id],
    );
    return row ? deployment(row) : null;
  }

  async list(tenantId: string): Promise<StoredAgentDeployment[]> {
    return (await this.database.query<DeploymentRow>(
      `SELECT ${deploymentColumns} FROM platform_agent_deployments deployment
        WHERE deployment.tenant_id = ? AND deployment.lifecycle_state <> 'deleted'
          AND EXISTS (
            SELECT 1 FROM platform_authority_fences fence
             WHERE fence.subject_kind = 'tenant' AND fence.subject_id = deployment.tenant_id
               AND fence.tenant_id = ''
               AND fence.authority_epoch = deployment.tenant_authority_epoch
          )
        ORDER BY deployment.updated_at DESC, deployment.id`,
      [tenantId],
    )).map(deployment);
  }

  async create(input: {
    deployment: StoredAgentDeployment;
    expectedReleaseDigest: string;
  }): Promise<CreateDeploymentResult> {
    return this.write(async (transaction) => {
      const [existing] = await transaction.query<DeploymentRow>(
        `SELECT ${deploymentColumns} FROM platform_agent_deployments
          WHERE tenant_id = ? AND request_key = ?`,
        [input.deployment.tenantId, input.deployment.requestKey],
      );
      if (existing) {
        const item = deployment(existing);
        return item.requestedReleaseId === input.deployment.requestedReleaseId &&
          item.target.gatewayId === input.deployment.target.gatewayId &&
          item.desiredDigest === input.deployment.desiredDigest
          ? { status: "existing", item }
          : { status: "conflict" };
      }

      const [release] = await transaction.query<{
        definition_id: string;
        tenant_id: string;
        tenant_authority_epoch: number;
        digest: string;
      }>(
        `SELECT definition_id, tenant_id, tenant_authority_epoch, digest
           FROM platform_agent_releases WHERE id = ?`,
        [input.deployment.requestedReleaseId],
      );
      if (!release || release.tenant_id !== input.deployment.tenantId ||
        release.definition_id !== input.deployment.definitionId ||
        release.digest !== input.expectedReleaseDigest) {
        return { status: "invalid_release" };
      }
      const [tenant] = await transaction.query<{ authority_epoch: number }>(
        `SELECT fence.authority_epoch FROM platform_tenants tenant
          JOIN platform_authority_fences fence
            ON fence.subject_kind = 'tenant' AND fence.subject_id = tenant.id
           AND fence.tenant_id = ''
         WHERE tenant.id = ? AND tenant.status = 'active'`,
        [input.deployment.tenantId],
      );
      if (!tenant || Number(tenant.authority_epoch) !== input.deployment.tenantAuthorityEpoch ||
        Number(release.tenant_authority_epoch) !== input.deployment.tenantAuthorityEpoch) {
        return { status: "invalid_tenant" };
      }

      const item = input.deployment;
      await transaction.query(
        `INSERT INTO platform_agent_deployments
          (id, tenant_id, tenant_authority_epoch, definition_id, requested_release_id,
           applied_release_id, gateway_id, gateway_authority_epoch, gateway_agent_id,
           gateway_route_id, path_prefix, desired_digest, lifecycle_state,
           operation_state, invocation_epoch, request_key, current_operation_id,
           last_verified_at, failure_code, created_by_principal_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'awaiting_key_binding',
           'stable', 1, ?, NULL, NULL, NULL, ?, ?, ?)`,
        [item.id, item.tenantId, item.tenantAuthorityEpoch, item.definitionId,
          item.requestedReleaseId, item.target.gatewayId, item.gatewayAuthorityEpoch,
          item.target.gatewayAgentId, item.target.gatewayRouteId, item.target.pathPrefix,
          item.desiredDigest, item.requestKey, item.createdByPrincipalId,
          item.createdAt, item.updatedAt],
      );
      return { status: "created", item: (await this.get(item.id, transaction))! };
    });
  }

  async cancelAwaiting(id: string): Promise<boolean> {
    return this.write(async (transaction) => {
      const current = await this.get(id, transaction);
      if (!current || current.lifecycleState !== "awaiting_key_binding" ||
        current.operationState !== "stable") return false;
      const [dependent] = await transaction.query<{ n: number }>(
        `SELECT
          (SELECT COUNT(*) FROM platform_deployment_key_bindings WHERE deployment_id = ?) +
          (SELECT COUNT(*) FROM platform_deployment_operations WHERE deployment_id = ?) +
          (SELECT COUNT(*) FROM platform_deployment_pair_fences WHERE deployment_id = ?) +
          (SELECT COUNT(*) FROM platform_deployment_route_reservations WHERE deployment_id = ?) AS n`,
        [id, id, id, id],
      );
      if (Number(dependent.n) !== 0) return false;
      await transaction.query("DELETE FROM platform_agent_deployments WHERE id = ?", [id]);
      return true;
    });
  }
}
