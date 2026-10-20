import type {
  AgentDeployment,
  AgentDeploymentOperation,
  DeploymentLifecycleState,
  DeploymentOperationKind,
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

interface OperationRow {
  id: string;
  deployment_id: string;
  kind: DeploymentOperationKind;
  request_key: string;
  release_id: string;
  sequence: number;
  status: AgentDeploymentOperation["status"];
  phase: string;
  desired_agent_json: string;
  desired_agent_digest: string;
  desired_staging_route_json: string;
  desired_staging_route_digest: string;
  desired_final_route_json: string;
  desired_final_route_digest: string;
  observed_agent_json: string | null;
  observed_route_json: string | null;
  agent_write_attempted: number;
  route_write_attempted: number;
  failure_code: string | null;
  failure_message: string | null;
  lease_until: string | null;
  created_at: string;
  updated_at: string;
}

const operationColumns = `id, deployment_id, kind, request_key, release_id,
  sequence, status, phase, desired_agent_json, desired_agent_digest,
  desired_staging_route_json, desired_staging_route_digest,
  desired_final_route_json, desired_final_route_digest, observed_agent_json,
  observed_route_json, agent_write_attempted, route_write_attempted,
  failure_code, failure_message, lease_until, created_at, updated_at`;

export interface StoredDeploymentOperation extends AgentDeploymentOperation {
  desiredAgent: unknown;
  desiredAgentDigest: string;
  desiredStagingRoute: unknown;
  desiredStagingRouteDigest: string;
  desiredFinalRoute: unknown;
  desiredFinalRouteDigest: string;
  observedAgent: unknown | null;
  observedRoute: unknown | null;
  agentWriteAttempted: boolean;
  routeWriteAttempted: boolean;
  leaseUntil: string | null;
}

function operation(row: OperationRow): StoredDeploymentOperation {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    kind: row.kind,
    requestKey: row.request_key,
    releaseId: row.release_id,
    sequence: Number(row.sequence),
    status: row.status,
    phase: row.phase,
    desiredAgent: JSON.parse(row.desired_agent_json),
    desiredAgentDigest: row.desired_agent_digest,
    desiredStagingRoute: JSON.parse(row.desired_staging_route_json),
    desiredStagingRouteDigest: row.desired_staging_route_digest,
    desiredFinalRoute: JSON.parse(row.desired_final_route_json),
    desiredFinalRouteDigest: row.desired_final_route_digest,
    observedAgent: row.observed_agent_json ? JSON.parse(row.observed_agent_json) : null,
    observedRoute: row.observed_route_json ? JSON.parse(row.observed_route_json) : null,
    agentWriteAttempted: Number(row.agent_write_attempted) === 1,
    routeWriteAttempted: Number(row.route_write_attempted) === 1,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    leaseUntil: row.lease_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface DeploymentKeyBindingRecord {
  deploymentId: string;
  gatewayId: string;
  keyId: string;
  routeId: string;
  status: "binding" | "bound" | "cleanup_required" | "awaiting_key_restore";
  keyPolicyEpoch: number;
  keyPolicyFingerprint: string | null;
}

export interface DeploymentPairFence {
  gatewayId: string;
  gatewayAgentId: string;
  gatewayRouteId: string;
  deploymentId: string;
  operationId: string | null;
  state: "provisional" | "promoted" | "quarantined" | "deleting";
  claimEpoch: number;
  agentDigest: string | null;
  routeDigest: string | null;
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

  async binding(
    deploymentId: string,
    session: DatabaseSession = this.database,
  ): Promise<DeploymentKeyBindingRecord | null> {
    const [row] = await session.query<{
      deployment_id: string;
      gateway_id: string;
      key_id: string;
      route_id: string;
      status: DeploymentKeyBindingRecord["status"];
      key_policy_epoch: number;
      key_policy_fingerprint: string | null;
    }>(
      `SELECT deployment_id, gateway_id, key_id, route_id, status,
              key_policy_epoch, key_policy_fingerprint
         FROM platform_deployment_key_bindings WHERE deployment_id = ?`,
      [deploymentId],
    );
    return row ? {
      deploymentId: row.deployment_id,
      gatewayId: row.gateway_id,
      keyId: row.key_id,
      routeId: row.route_id,
      status: row.status,
      keyPolicyEpoch: Number(row.key_policy_epoch),
      keyPolicyFingerprint: row.key_policy_fingerprint,
    } : null;
  }

  async pairFence(
    gatewayId: string,
    agentId: string,
    session: DatabaseSession = this.database,
  ): Promise<DeploymentPairFence | null> {
    const [row] = await session.query<{
      gateway_id: string;
      gateway_agent_id: string;
      gateway_route_id: string;
      deployment_id: string;
      operation_id: string | null;
      state: DeploymentPairFence["state"];
      claim_epoch: number;
      agent_digest: string | null;
      route_digest: string | null;
    }>(
      `SELECT gateway_id, gateway_agent_id, gateway_route_id, deployment_id,
              operation_id, state, claim_epoch, agent_digest, route_digest
         FROM platform_deployment_pair_fences
        WHERE gateway_id = ? AND gateway_agent_id = ?`,
      [gatewayId, agentId],
    );
    return row ? {
      gatewayId: row.gateway_id,
      gatewayAgentId: row.gateway_agent_id,
      gatewayRouteId: row.gateway_route_id,
      deploymentId: row.deployment_id,
      operationId: row.operation_id,
      state: row.state,
      claimEpoch: Number(row.claim_epoch),
      agentDigest: row.agent_digest,
      routeDigest: row.route_digest,
    } : null;
  }

  async operation(
    id: string,
    session: DatabaseSession = this.database,
  ): Promise<StoredDeploymentOperation | null> {
    const [row] = await session.query<OperationRow>(
      `SELECT ${operationColumns} FROM platform_deployment_operations WHERE id = ?`,
      [id],
    );
    return row ? operation(row) : null;
  }

  async operations(deploymentId: string): Promise<StoredDeploymentOperation[]> {
    return (await this.database.query<OperationRow>(
      `SELECT ${operationColumns} FROM platform_deployment_operations
        WHERE deployment_id = ? ORDER BY sequence DESC`,
      [deploymentId],
    )).map(operation);
  }

  async acquireGatewayLeases(input: {
    gatewayId: string;
    ownerToken: string;
    now: string;
    leaseUntil: string;
  }): Promise<boolean> {
    return this.write(async (transaction) => {
      for (const kind of ["objects", "key_policy"] as const) {
        const [row] = await transaction.query<{
          owner_token: string;
          lease_epoch: number;
          lease_until: string;
        }>(
          `SELECT owner_token, lease_epoch, lease_until
             FROM platform_gateway_operation_leases
            WHERE gateway_id = ? AND lease_kind = ?`,
          [input.gatewayId, kind],
        );
        if (row && row.owner_token !== input.ownerToken && row.lease_until > input.now) {
          return false;
        }
        if (row) {
          await transaction.query(
            `UPDATE platform_gateway_operation_leases
                SET owner_token = ?, lease_epoch = ?, lease_until = ?, updated_at = ?
              WHERE gateway_id = ? AND lease_kind = ?`,
            [input.ownerToken, Number(row.lease_epoch) + 1, input.leaseUntil, input.now,
              input.gatewayId, kind],
          );
        } else {
          await transaction.query(
            `INSERT INTO platform_gateway_operation_leases
              (gateway_id, lease_kind, owner_token, lease_epoch, lease_until, updated_at)
             VALUES (?, ?, ?, 1, ?, ?)`,
            [input.gatewayId, kind, input.ownerToken, input.leaseUntil, input.now],
          );
        }
      }
      return true;
    });
  }

  async releaseGatewayLeases(gatewayId: string, ownerToken: string, now: string): Promise<void> {
    await this.write(async (transaction) => {
      await transaction.query(
        `UPDATE platform_gateway_operation_leases SET lease_until = ?, updated_at = ?
          WHERE gateway_id = ? AND owner_token = ?`,
        [now, now, gatewayId, ownerToken],
      );
    });
  }

  async beginOperation(input: {
    deploymentId: string;
    expectedInvocationEpoch: number;
    expectedLifecycle: DeploymentLifecycleState[];
    kind: DeploymentOperationKind;
    requestKey: string;
    releaseId: string;
    operationId: string;
    phase: string;
    desiredAgent: unknown;
    desiredAgentDigest: string;
    desiredStagingRoute: unknown;
    desiredStagingRouteDigest: string;
    desiredFinalRoute: unknown;
    desiredFinalRouteDigest: string;
    leaseUntil: string;
    now: string;
    initial: boolean;
  }): Promise<{ status: "started"; deployment: StoredAgentDeployment; operation: StoredDeploymentOperation } |
    { status: "existing"; operation: StoredDeploymentOperation } |
    { status: "conflict" }> {
    return this.write(async (transaction) => {
      const current = await this.get(input.deploymentId, transaction);
      if (!current) return { status: "conflict" };
      const [sameKey] = await transaction.query<OperationRow>(
        `SELECT ${operationColumns} FROM platform_deployment_operations
          WHERE deployment_id = ? AND request_key = ?`,
        [input.deploymentId, input.requestKey],
      );
      if (sameKey) {
        if (sameKey.kind !== input.kind || sameKey.release_id !== input.releaseId) {
          return { status: "conflict" };
        }
        return { status: "existing", operation: operation(sameKey) };
      }
      if (current.invocationEpoch !== input.expectedInvocationEpoch ||
        current.operationState !== "stable" ||
        !input.expectedLifecycle.includes(current.lifecycleState)) {
        return { status: "conflict" };
      }
      const [sequenceRow] = await transaction.query<{ sequence: number }>(
        `SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
           FROM platform_deployment_operations WHERE deployment_id = ?`,
        [input.deploymentId],
      );
      const sequence = Number(sequenceRow.sequence);
      if (input.initial) {
        const binding = await this.binding(input.deploymentId, transaction);
        const [reservation] = await transaction.query<{
          deployment_id: string;
          operation_id: string | null;
          state: string;
        }>(
          `SELECT deployment_id, operation_id, state
             FROM platform_deployment_route_reservations
            WHERE gateway_id = ? AND route_id = ?`,
          [current.target.gatewayId, current.target.gatewayRouteId],
        );
        const fence = await this.pairFence(
          current.target.gatewayId,
          current.target.gatewayAgentId,
          transaction,
        );
        if (!binding || binding.status !== "bound" ||
          !reservation || reservation.deployment_id !== current.id ||
          (input.kind === "apply" && reservation.state !== "prepublication") ||
          (input.kind === "retry" && reservation.state !== "provisional") ||
          (input.kind === "retry" && (!fence || fence.deploymentId !== current.id ||
            fence.state !== "provisional"))) {
          return { status: "conflict" };
        }
        if (input.kind === "apply") {
          if (fence) return { status: "conflict" };
          await transaction.query(
            `INSERT INTO platform_deployment_pair_fences
              (gateway_id, gateway_agent_id, gateway_route_id, deployment_id,
               operation_id, state, claim_epoch, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'provisional', 1, ?, ?)`,
            [current.target.gatewayId, current.target.gatewayAgentId,
              current.target.gatewayRouteId, current.id, input.operationId,
              input.now, input.now],
          );
          await transaction.query(
            `UPDATE platform_deployment_route_reservations
                SET operation_id = ?, state = 'provisional', updated_at = ?
              WHERE gateway_id = ? AND route_id = ?`,
            [input.operationId, input.now, current.target.gatewayId,
              current.target.gatewayRouteId],
          );
        }
      }
      await transaction.query(
        `INSERT INTO platform_deployment_operations
          (id, deployment_id, kind, request_key, release_id, sequence, status,
           phase, desired_agent_json, desired_agent_digest,
           desired_staging_route_json, desired_staging_route_digest,
           desired_final_route_json, desired_final_route_digest,
           agent_write_attempted, route_write_attempted, lease_until,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'applying', ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
        [input.operationId, input.deploymentId, input.kind, input.requestKey,
          input.releaseId, sequence, input.phase, JSON.stringify(input.desiredAgent),
          input.desiredAgentDigest, JSON.stringify(input.desiredStagingRoute),
          input.desiredStagingRouteDigest, JSON.stringify(input.desiredFinalRoute),
          input.desiredFinalRouteDigest, input.leaseUntil, input.now, input.now],
      );
      await transaction.query(
        `UPDATE platform_agent_deployments
            SET operation_state = 'applying', invocation_epoch = invocation_epoch + 1,
                current_operation_id = ?, failure_code = NULL, updated_at = ?
          WHERE id = ?`,
        [input.operationId, input.now, input.deploymentId],
      );
      return {
        status: "started",
        deployment: (await this.get(input.deploymentId, transaction))!,
        operation: (await this.operation(input.operationId, transaction))!,
      };
    });
  }

  async updateOperation(input: {
    operationId: string;
    phase: string;
    now: string;
    observedAgent?: unknown;
    observedRoute?: unknown;
    agentWriteAttempted?: boolean;
    routeWriteAttempted?: boolean;
  }): Promise<boolean> {
    return this.write(async (transaction) => {
      const current = await this.operation(input.operationId, transaction);
      if (!current || current.status !== "applying") return false;
      await transaction.query(
        `UPDATE platform_deployment_operations
            SET phase = ?, observed_agent_json = COALESCE(?, observed_agent_json),
                observed_route_json = COALESCE(?, observed_route_json),
                agent_write_attempted = CASE WHEN ? = 1 THEN 1 ELSE agent_write_attempted END,
                route_write_attempted = CASE WHEN ? = 1 THEN 1 ELSE route_write_attempted END,
                updated_at = ?
          WHERE id = ?`,
        [input.phase,
          input.observedAgent === undefined ? null : JSON.stringify(input.observedAgent),
          input.observedRoute === undefined ? null : JSON.stringify(input.observedRoute),
          input.agentWriteAttempted ? 1 : 0, input.routeWriteAttempted ? 1 : 0,
          input.now, input.operationId],
      );
      return true;
    });
  }

  async completeOperation(input: {
    operationId: string;
    lifecycle: DeploymentLifecycleState;
    appliedReleaseId: string;
    desiredDigest: string;
    agentDigest: string;
    routeDigest: string;
    now: string;
  }): Promise<boolean> {
    return this.write(async (transaction) => {
      const current = await this.operation(input.operationId, transaction);
      if (!current || current.status !== "applying") return false;
      const deployment = await this.get(current.deploymentId, transaction);
      if (!deployment || deployment.operationState !== "applying") return false;
      await transaction.query(
        `UPDATE platform_deployment_operations
            SET status = 'succeeded', phase = 'verified', failure_code = NULL,
                failure_message = NULL, lease_until = NULL, updated_at = ?
          WHERE id = ?`,
        [input.now, input.operationId],
      );
      await transaction.query(
        `UPDATE platform_agent_deployments
            SET requested_release_id = ?, applied_release_id = ?, desired_digest = ?,
                lifecycle_state = ?, operation_state = 'stable',
                invocation_epoch = invocation_epoch + 1, current_operation_id = NULL,
                last_verified_at = ?, failure_code = NULL, updated_at = ?
          WHERE id = ?`,
        [input.appliedReleaseId, input.appliedReleaseId, input.desiredDigest,
          input.lifecycle, input.now, input.now, current.deploymentId],
      );
      await transaction.query(
        `UPDATE platform_deployment_pair_fences
            SET operation_id = NULL, state = 'promoted', claim_epoch = claim_epoch + 1,
                agent_digest = ?, route_digest = ?, updated_at = ?
          WHERE gateway_id = ? AND gateway_agent_id = ? AND deployment_id = ?`,
        [input.agentDigest, input.routeDigest, input.now, deployment.target.gatewayId,
          deployment.target.gatewayAgentId, deployment.id],
      );
      return true;
    });
  }

  async failOperation(input: {
    operationId: string;
    phase: string;
    code: string;
    message: string;
    now: string;
  }): Promise<void> {
    await this.write(async (transaction) => {
      const current = await this.operation(input.operationId, transaction);
      if (!current || current.status !== "applying") return;
      await transaction.query(
        `UPDATE platform_deployment_operations
            SET status = 'failed', phase = ?, failure_code = ?, failure_message = ?,
                lease_until = NULL, updated_at = ? WHERE id = ?`,
        [input.phase, input.code, input.message, input.now, input.operationId],
      );
      await transaction.query(
        `UPDATE platform_agent_deployments
            SET lifecycle_state = 'partial_failure', operation_state = 'stable',
                invocation_epoch = invocation_epoch + 1, current_operation_id = NULL,
                failure_code = ?, updated_at = ? WHERE id = ?`,
        [input.code, input.now, current.deploymentId],
      );
    });
  }

  async quarantineOperation(input: {
    operationId: string;
    phase: "route_quarantined_contained" | "route_containment_failed";
    message: string;
    routeDigest: string | null;
    now: string;
  }): Promise<void> {
    await this.write(async (transaction) => {
      const current = await this.operation(input.operationId, transaction);
      if (!current || current.status !== "applying") return;
      const deployment = await this.get(current.deploymentId, transaction);
      if (!deployment) return;
      await transaction.query(
        `UPDATE platform_deployment_operations
            SET status = 'failed', phase = ?, failure_code = ?, failure_message = ?,
                lease_until = NULL, updated_at = ? WHERE id = ?`,
        [input.phase, input.phase, input.message, input.now, input.operationId],
      );
      await transaction.query(
        `UPDATE platform_agent_deployments
            SET lifecycle_state = 'partial_failure', operation_state = 'reconciliation_required',
                invocation_epoch = invocation_epoch + 1, current_operation_id = NULL,
                failure_code = ?, updated_at = ? WHERE id = ?`,
        [input.phase, input.now, current.deploymentId],
      );
      await transaction.query(
        `UPDATE platform_deployment_pair_fences
            SET state = 'quarantined', operation_id = ?, claim_epoch = claim_epoch + 1,
                route_digest = COALESCE(?, route_digest), updated_at = ?
          WHERE gateway_id = ? AND gateway_agent_id = ? AND deployment_id = ?`,
        [input.operationId, input.routeDigest, input.now, deployment.target.gatewayId,
          deployment.target.gatewayAgentId, deployment.id],
      );
    });
  }

  async recordVerification(input: {
    deploymentId: string;
    operationId: string;
    requestKey: string;
    releaseId: string;
    desiredAgent: unknown;
    desiredAgentDigest: string;
    desiredStagingRoute: unknown;
    desiredStagingRouteDigest: string;
    desiredFinalRoute: unknown;
    desiredFinalRouteDigest: string;
    observedAgent: unknown;
    observedRoute: unknown;
    now: string;
  }): Promise<StoredDeploymentOperation | null> {
    return this.write(async (transaction) => {
      const deployment = await this.get(input.deploymentId, transaction);
      if (!deployment || deployment.operationState !== "stable") return null;
      const [sameKey] = await transaction.query<OperationRow>(
        `SELECT ${operationColumns} FROM platform_deployment_operations
          WHERE deployment_id = ? AND request_key = ?`,
        [input.deploymentId, input.requestKey],
      );
      if (sameKey) return sameKey.kind === "verify" ? operation(sameKey) : null;
      const [sequenceRow] = await transaction.query<{ sequence: number }>(
        `SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
           FROM platform_deployment_operations WHERE deployment_id = ?`,
        [input.deploymentId],
      );
      await transaction.query(
        `INSERT INTO platform_deployment_operations
          (id, deployment_id, kind, request_key, release_id, sequence, status,
           phase, desired_agent_json, desired_agent_digest,
           desired_staging_route_json, desired_staging_route_digest,
           desired_final_route_json, desired_final_route_digest,
           observed_agent_json, observed_route_json, agent_write_attempted,
           route_write_attempted, created_at, updated_at)
         VALUES (?, ?, 'verify', ?, ?, ?, 'succeeded', 'verified', ?, ?, ?, ?, ?, ?,
           ?, ?, 0, 0, ?, ?)`,
        [input.operationId, input.deploymentId, input.requestKey, input.releaseId,
          Number(sequenceRow.sequence), JSON.stringify(input.desiredAgent),
          input.desiredAgentDigest, JSON.stringify(input.desiredStagingRoute),
          input.desiredStagingRouteDigest, JSON.stringify(input.desiredFinalRoute),
          input.desiredFinalRouteDigest, JSON.stringify(input.observedAgent),
          JSON.stringify(input.observedRoute), input.now, input.now],
      );
      await transaction.query(
        `UPDATE platform_agent_deployments SET last_verified_at = ?, updated_at = ? WHERE id = ?`,
        [input.now, input.now, input.deploymentId],
      );
      return this.operation(input.operationId, transaction);
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
