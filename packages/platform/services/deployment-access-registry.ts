import type {
  DeploymentInvocationContext,
  DeploymentKeyBinding,
  DeploymentKeyBindingCandidate,
  DeploymentVirtualKeyReference,
} from "../../contracts/platform/deployments";
import type { DatabaseSession, PlatformDatabase } from "../ports/database";
import type { GatewayVirtualKeyPolicy } from "../ports/deployment";
import { AgentDeploymentRegistry, type StoredAgentDeployment } from "./deployment-registry";

export type KeyPolicyState = DeploymentVirtualKeyReference["status"];

export interface StoredKeyPolicy {
  gatewayId: string;
  keyId: string;
  state: KeyPolicyState;
  policyEpoch: number;
  desiredPolicy: GatewayVirtualKeyPolicy | null;
  observedFingerprint: string | null;
  operationKind: string | null;
  operationToken: string | null;
  incident: string | null;
  createdAt: string;
  updatedAt: string;
}

interface KeyPolicyRow {
  gateway_id: string;
  key_id: string;
  state: KeyPolicyState;
  policy_epoch: number;
  desired_policy_json: string | null;
  observed_fingerprint: string | null;
  operation_kind: string | null;
  operation_token: string | null;
  incident: string | null;
  created_at: string;
  updated_at: string;
}

const keyColumns = `gateway_id, key_id, state, policy_epoch, desired_policy_json,
  observed_fingerprint, operation_kind, operation_token, incident, created_at, updated_at`;

function keyPolicy(row: KeyPolicyRow): StoredKeyPolicy {
  return {
    gatewayId: row.gateway_id,
    keyId: row.key_id,
    state: row.state,
    policyEpoch: Number(row.policy_epoch),
    desiredPolicy: row.desired_policy_json
      ? JSON.parse(row.desired_policy_json) as GatewayVirtualKeyPolicy : null,
    observedFingerprint: row.observed_fingerprint,
    operationKind: row.operation_kind,
    operationToken: row.operation_token,
    incident: row.incident,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface ContextRow {
  id: string;
  principal_id: string;
  principal_authority_epoch: number;
  tenant_id: string;
  tenant_authority_epoch: number;
  membership_authority_epoch: number;
  deployment_id: string;
  deployment_invocation_epoch: number;
  gateway_id: string;
  gateway_authority_epoch: number;
  gateway_agent_id: string;
  gateway_route_id: string;
  pair_claim_epoch: number;
  key_id: string;
  key_policy_epoch: number;
  key_policy_fingerprint: string;
  expires_at: string;
  completed_at: string | null;
  created_at: string;
  last_used_at: string;
}

const contextColumns = `id, principal_id, principal_authority_epoch, tenant_id,
  tenant_authority_epoch, membership_authority_epoch, deployment_id,
  deployment_invocation_epoch, gateway_id, gateway_authority_epoch,
  gateway_agent_id, gateway_route_id, pair_claim_epoch, key_id, key_policy_epoch,
  key_policy_fingerprint, expires_at, completed_at, created_at, last_used_at`;

export interface StoredInvocationContext extends DeploymentInvocationContext {
  principalId: string;
  principalAuthorityEpoch: number;
  tenantAuthorityEpoch: number;
  membershipAuthorityEpoch: number;
  deploymentInvocationEpoch: number;
  gatewayAuthorityEpoch: number;
  pairClaimEpoch: number;
  keyPolicyEpoch: number;
  keyPolicyFingerprint: string;
  createdAt: string;
  lastUsedAt: string;
}

function invocationContext(row: ContextRow): StoredInvocationContext {
  return {
    id: row.id,
    principalId: row.principal_id,
    principalAuthorityEpoch: Number(row.principal_authority_epoch),
    tenantId: row.tenant_id,
    tenantAuthorityEpoch: Number(row.tenant_authority_epoch),
    membershipAuthorityEpoch: Number(row.membership_authority_epoch),
    deploymentId: row.deployment_id,
    deploymentInvocationEpoch: Number(row.deployment_invocation_epoch),
    gatewayId: row.gateway_id,
    gatewayAuthorityEpoch: Number(row.gateway_authority_epoch),
    gatewayAgentId: row.gateway_agent_id,
    gatewayRouteId: row.gateway_route_id,
    pairClaimEpoch: Number(row.pair_claim_epoch),
    keyId: row.key_id,
    keyPolicyEpoch: Number(row.key_policy_epoch),
    keyPolicyFingerprint: row.key_policy_fingerprint,
    expiresAt: row.expires_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export class DeploymentAccessRegistry {
  private readonly deployments: AgentDeploymentRegistry;

  constructor(readonly database: PlatformDatabase) {
    this.deployments = new AgentDeploymentRegistry(database);
  }

  private async write<T>(work: (transaction: DatabaseSession) => Promise<T>): Promise<T> {
    return this.database.transaction(async (transaction) => {
      const suffix = this.database.dialect === "postgres" ? " FOR UPDATE" : "";
      await transaction.query(`SELECT id FROM platform_schema_lock WHERE id = 1${suffix}`);
      return work(transaction);
    });
  }

  async keyPolicy(
    gatewayId: string,
    keyId: string,
    session: DatabaseSession = this.database,
  ): Promise<StoredKeyPolicy | null> {
    const [row] = await session.query<KeyPolicyRow>(
      `SELECT ${keyColumns} FROM platform_gateway_virtual_key_policies
        WHERE gateway_id = ? AND key_id = ?`,
      [gatewayId, keyId],
    );
    return row ? keyPolicy(row) : null;
  }

  async invocationContextsForPrincipal(
    principalId: string,
    tenantId: string,
  ): Promise<StoredInvocationContext[]> {
    return (await this.database.query<ContextRow>(
      `SELECT ${contextColumns} FROM platform_deployment_invocation_contexts
        WHERE principal_id = ? AND tenant_id = ?
          AND completed_at IS NULL
        ORDER BY created_at DESC`,
      [principalId, tenantId],
    )).map(invocationContext);
  }

  async beginKeyMutation(input: {
    gatewayId: string;
    keyId: string;
    desired: GatewayVirtualKeyPolicy;
    operationKind: string;
    operationToken: string;
    now: string;
  }): Promise<StoredKeyPolicy | null> {
    return this.write(async (transaction) => {
      const current = await this.keyPolicy(input.gatewayId, input.keyId, transaction);
      if (current && current.state !== "stable") return null;
      if (current) {
        await transaction.query(
          `UPDATE platform_gateway_virtual_key_policies
              SET state = 'mutating', policy_epoch = policy_epoch + 1,
                  desired_policy_json = ?, operation_kind = ?, operation_token = ?,
                  incident = NULL, updated_at = ?
            WHERE gateway_id = ? AND key_id = ?`,
          [JSON.stringify(input.desired), input.operationKind, input.operationToken,
            input.now, input.gatewayId, input.keyId],
        );
      } else {
        await transaction.query(
          `INSERT INTO platform_gateway_virtual_key_policies
            (gateway_id, key_id, state, policy_epoch, desired_policy_json,
             observed_fingerprint, operation_kind, operation_token, incident,
             created_at, updated_at)
           VALUES (?, ?, 'mutating', 1, ?, NULL, ?, ?, NULL, ?, ?)`,
          [input.gatewayId, input.keyId, JSON.stringify(input.desired),
            input.operationKind, input.operationToken, input.now, input.now],
        );
      }
      return this.keyPolicy(input.gatewayId, input.keyId, transaction);
    });
  }

  async completeKeyMutation(input: {
    gatewayId: string;
    keyId: string;
    operationToken: string;
    fingerprint: string;
    now: string;
  }): Promise<StoredKeyPolicy | null> {
    return this.write(async (transaction) => {
      const current = await this.keyPolicy(input.gatewayId, input.keyId, transaction);
      if (!current || current.state !== "mutating" ||
        current.operationToken !== input.operationToken) return null;
      await transaction.query(
        `UPDATE platform_gateway_virtual_key_policies
            SET state = 'stable', policy_epoch = policy_epoch + 1,
                observed_fingerprint = ?, operation_kind = NULL,
                operation_token = NULL, incident = NULL, updated_at = ?
          WHERE gateway_id = ? AND key_id = ?`,
        [input.fingerprint, input.now, input.gatewayId, input.keyId],
      );
      return this.keyPolicy(input.gatewayId, input.keyId, transaction);
    });
  }

  async refreshBindingsForKey(input: {
    gatewayId: string;
    keyId: string;
    policyEpoch: number;
    fingerprint: string;
    now: string;
  }): Promise<void> {
    await this.write(async (transaction) => {
      await transaction.query(
        `UPDATE platform_deployment_key_bindings
            SET key_policy_epoch = ?, key_policy_fingerprint = ?, updated_at = ?
          WHERE gateway_id = ? AND key_id = ? AND status = 'bound'`,
        [input.policyEpoch, input.fingerprint, input.now, input.gatewayId, input.keyId],
      );
      await transaction.query(
        `UPDATE platform_agent_deployments
            SET invocation_epoch = invocation_epoch + 1, updated_at = ?
          WHERE id IN (
            SELECT deployment_id FROM platform_deployment_key_bindings
             WHERE gateway_id = ? AND key_id = ? AND status = 'bound'
          )`,
        [input.now, input.gatewayId, input.keyId],
      );
    });
  }

  async deleteKeyControl(
    gatewayId: string,
    keyId: string,
    operationToken: string,
  ): Promise<boolean> {
    return this.write(async (transaction) => {
      const [bound] = await transaction.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM platform_deployment_key_bindings
          WHERE gateway_id = ? AND key_id = ?`,
        [gatewayId, keyId],
      );
      if (Number(bound.n) !== 0) return false;
      const rows = await transaction.query<{ key_id: string }>(
        `DELETE FROM platform_gateway_virtual_key_policies
          WHERE gateway_id = ? AND key_id = ? AND state = 'mutating'
            AND operation_token = ? RETURNING key_id`,
        [gatewayId, keyId, operationToken],
      );
      return rows.length === 1;
    });
  }

  async failKeyMutation(input: {
    gatewayId: string;
    keyId: string;
    operationToken: string;
    incident: string;
    now: string;
  }): Promise<void> {
    await this.write(async (transaction) => {
      await transaction.query(
        `UPDATE platform_gateway_virtual_key_policies
            SET state = 'reconciliation_required', policy_epoch = policy_epoch + 1,
                incident = ?, updated_at = ?
          WHERE gateway_id = ? AND key_id = ? AND state = 'mutating'
            AND operation_token = ?`,
        [input.incident, input.now, input.gatewayId, input.keyId, input.operationToken],
      );
    });
  }

  async beginContainment(input: {
    gatewayId: string;
    keyId: string;
    expectedEpoch: number;
    desired: GatewayVirtualKeyPolicy;
    operationToken: string;
    now: string;
  }): Promise<StoredKeyPolicy | null> {
    return this.write(async (transaction) => {
      const current = await this.keyPolicy(input.gatewayId, input.keyId, transaction);
      if (!current || current.state !== "stable" ||
        current.policyEpoch !== input.expectedEpoch) return null;
      await transaction.query(
        `UPDATE platform_gateway_virtual_key_policies
            SET state = 'containment_in_progress', policy_epoch = policy_epoch + 1,
                operation_kind = 'drift_containment',
                operation_token = ?, incident = 'live Virtual Key policy drift', updated_at = ?
          WHERE gateway_id = ? AND key_id = ?`,
        [input.operationToken, input.now,
          input.gatewayId, input.keyId],
      );
      await transaction.query(
        `UPDATE platform_agent_deployments
            SET operation_state = 'reconciliation_required',
                invocation_epoch = invocation_epoch + 1,
                failure_code = 'virtual_key_policy_drift', updated_at = ?
          WHERE id IN (
            SELECT deployment_id FROM platform_deployment_key_bindings
             WHERE gateway_id = ? AND key_id = ?
          )`,
        [input.now, input.gatewayId, input.keyId],
      );
      return this.keyPolicy(input.gatewayId, input.keyId, transaction);
    });
  }

  async finishContainment(input: {
    gatewayId: string;
    keyId: string;
    operationToken: string;
    fingerprint: string | null;
    succeeded: boolean;
    now: string;
  }): Promise<void> {
    await this.write(async (transaction) => {
      await transaction.query(
        `UPDATE platform_gateway_virtual_key_policies
            SET state = ?, policy_epoch = policy_epoch + 1,
                observed_fingerprint = COALESCE(?, observed_fingerprint), updated_at = ?
          WHERE gateway_id = ? AND key_id = ?
            AND state IN ('containment_in_progress','containment_reconciling')
            AND operation_token = ?`,
        [input.succeeded ? "quarantined_contained" : "containment_failed",
          input.fingerprint, input.now, input.gatewayId, input.keyId, input.operationToken],
      );
    });
  }

  async restoreContainedKey(input: {
    gatewayId: string;
    keyId: string;
    operationToken: string;
    fingerprint: string;
    now: string;
  }): Promise<StoredKeyPolicy | null> {
    return this.write(async (transaction) => {
      const current = await this.keyPolicy(input.gatewayId, input.keyId, transaction);
      if (!current || current.state !== "containment_reconciling" ||
        current.operationToken !== input.operationToken) return null;
      await transaction.query(
        `UPDATE platform_gateway_virtual_key_policies
            SET state = 'stable', policy_epoch = policy_epoch + 1,
                observed_fingerprint = ?, operation_kind = NULL,
                operation_token = NULL, incident = NULL, updated_at = ?
          WHERE gateway_id = ? AND key_id = ?`,
        [input.fingerprint, input.now, input.gatewayId, input.keyId],
      );
      const restored = (await this.keyPolicy(input.gatewayId, input.keyId, transaction))!;
      await transaction.query(
        `UPDATE platform_deployment_key_bindings
            SET key_policy_epoch = ?, key_policy_fingerprint = ?, updated_at = ?
          WHERE gateway_id = ? AND key_id = ? AND status = 'bound'`,
        [restored.policyEpoch, input.fingerprint, input.now, input.gatewayId, input.keyId],
      );
      await transaction.query(
        `UPDATE platform_agent_deployments
            SET operation_state = 'stable', invocation_epoch = invocation_epoch + 1,
                failure_code = NULL, updated_at = ?
          WHERE id IN (
            SELECT fence.deployment_id FROM platform_deployment_pair_fences fence
            JOIN platform_deployment_key_bindings binding
              ON binding.deployment_id = fence.deployment_id
           WHERE binding.gateway_id = ? AND binding.key_id = ?
             AND binding.status = 'bound' AND fence.state = 'promoted'
          ) AND operation_state = 'reconciliation_required'
            AND failure_code = 'virtual_key_policy_drift'`,
        [input.now, input.gatewayId, input.keyId],
      );
      return restored;
    });
  }

  async beginReconciliation(input: {
    gatewayId: string;
    keyId: string;
    desired: GatewayVirtualKeyPolicy;
    operationToken: string;
    containment: boolean;
    now: string;
  }): Promise<StoredKeyPolicy | null> {
    return this.write(async (transaction) => {
      const current = await this.keyPolicy(input.gatewayId, input.keyId, transaction);
      const accepted = input.containment
        ? ["quarantined_contained", "containment_failed"]
        : ["reconciliation_required"];
      if (!current || !accepted.includes(current.state)) return null;
      await transaction.query(
        `UPDATE platform_gateway_virtual_key_policies
            SET state = ?, policy_epoch = policy_epoch + 1,
                desired_policy_json = ?, operation_kind = ?, operation_token = ?, updated_at = ?
          WHERE gateway_id = ? AND key_id = ?`,
        [input.containment ? "containment_reconciling" : "mutating",
          JSON.stringify(input.desired), input.containment
            ? "containment_reconciliation" : "ordinary_reconciliation",
          input.operationToken, input.now, input.gatewayId, input.keyId],
      );
      return this.keyPolicy(input.gatewayId, input.keyId, transaction);
    });
  }

  async prepareBinding(input: {
    deploymentId: string;
    gatewayId: string;
    keyId: string;
    routeId: string;
    keyPolicyEpoch: number;
    now: string;
  }): Promise<boolean> {
    return this.write(async (transaction) => {
      const deployment = await this.deployments.get(input.deploymentId, transaction);
      if (!deployment || deployment.target.gatewayId !== input.gatewayId ||
        deployment.target.gatewayRouteId !== input.routeId ||
        deployment.lifecycleState !== "awaiting_key_binding" ||
        deployment.operationState !== "stable") return false;
      const [blocked] = await transaction.query<{ n: number }>(
        `SELECT
          (SELECT COUNT(*) FROM platform_deployment_key_bindings WHERE deployment_id = ?) +
          (SELECT COUNT(*) FROM platform_deployment_route_reservations WHERE
             gateway_id = ? AND route_id = ?) +
          (SELECT COUNT(*) FROM platform_deployment_pair_fences WHERE deployment_id = ?) +
          (SELECT COUNT(*) FROM platform_deployment_operations WHERE deployment_id = ?) AS n`,
        [input.deploymentId, input.gatewayId, input.routeId,
          input.deploymentId, input.deploymentId],
      );
      if (Number(blocked.n) !== 0) return false;
      await transaction.query(
        `INSERT INTO platform_deployment_key_bindings
          (deployment_id, gateway_id, key_id, route_id, status, key_policy_epoch,
           key_policy_fingerprint, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'binding', ?, NULL, ?, ?)`,
        [input.deploymentId, input.gatewayId, input.keyId, input.routeId,
          input.keyPolicyEpoch, input.now, input.now],
      );
      await transaction.query(
        `INSERT INTO platform_deployment_route_reservations
          (gateway_id, route_id, deployment_id, operation_id, state, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 'prepublication', ?, ?)`,
        [input.gatewayId, input.routeId, input.deploymentId, input.now, input.now],
      );
      return true;
    });
  }

  async completeBinding(input: {
    deploymentId: string;
    keyPolicyEpoch: number;
    fingerprint: string;
    now: string;
  }): Promise<boolean> {
    return this.write(async (transaction) => {
      const binding = await this.deployments.binding(input.deploymentId, transaction);
      const deployment = await this.deployments.get(input.deploymentId, transaction);
      if (!binding || binding.status !== "binding" || !deployment ||
        deployment.lifecycleState !== "awaiting_key_binding") return false;
      await transaction.query(
        `UPDATE platform_deployment_key_bindings
            SET status = 'bound', key_policy_epoch = ?, key_policy_fingerprint = ?, updated_at = ?
          WHERE deployment_id = ?`,
        [input.keyPolicyEpoch, input.fingerprint, input.now, input.deploymentId],
      );
      await transaction.query(
        `UPDATE platform_agent_deployments
            SET lifecycle_state = 'ready_to_apply', updated_at = ? WHERE id = ?`,
        [input.now, input.deploymentId],
      );
      return true;
    });
  }

  async failBinding(deploymentId: string, now: string): Promise<void> {
    await this.write(async (transaction) => {
      await transaction.query(
        `UPDATE platform_deployment_key_bindings
            SET status = 'cleanup_required', updated_at = ?
          WHERE deployment_id = ? AND status = 'binding'`,
        [now, deploymentId],
      );
    });
  }

  async startBindingConflictCleanup(deploymentId: string, now: string): Promise<boolean> {
    return this.write(async (transaction) => {
      const deployment = await this.deployments.get(deploymentId, transaction);
      const binding = await this.deployments.binding(deploymentId, transaction);
      if (!deployment || deployment.lifecycleState !== "ready_to_apply" ||
        deployment.operationState !== "stable" || !binding || binding.status !== "bound") {
        return false;
      }
      const [blocked] = await transaction.query<{ n: number }>(
        `SELECT
          (SELECT COUNT(*) FROM platform_deployment_operations WHERE deployment_id = ?) +
          (SELECT COUNT(*) FROM platform_deployment_pair_fences WHERE deployment_id = ?) AS n`,
        [deploymentId, deploymentId],
      );
      if (Number(blocked.n) !== 0) return false;
      await transaction.query(
        `UPDATE platform_deployment_key_bindings
            SET status = 'cleanup_required', updated_at = ? WHERE deployment_id = ?`,
        [now, deploymentId],
      );
      await transaction.query(
        `UPDATE platform_agent_deployments
            SET lifecycle_state = 'awaiting_key_binding',
                invocation_epoch = invocation_epoch + 1,
                failure_code = 'binding_conflict_cleanup', updated_at = ?
          WHERE id = ?`,
        [now, deploymentId],
      );
      return true;
    });
  }

  async completeBindingConflictCleanup(deploymentId: string, now: string): Promise<boolean> {
    return this.write(async (transaction) => {
      const deployment = await this.deployments.get(deploymentId, transaction);
      const binding = await this.deployments.binding(deploymentId, transaction);
      if (!deployment || deployment.lifecycleState !== "awaiting_key_binding" ||
        deployment.operationState !== "stable" || !binding ||
        binding.status !== "cleanup_required") return false;
      const [blocked] = await transaction.query<{ n: number }>(
        `SELECT
          (SELECT COUNT(*) FROM platform_deployment_operations WHERE deployment_id = ?) +
          (SELECT COUNT(*) FROM platform_deployment_pair_fences WHERE deployment_id = ?) AS n`,
        [deploymentId, deploymentId],
      );
      if (Number(blocked.n) !== 0) return false;
      await transaction.query(
        "DELETE FROM platform_deployment_key_bindings WHERE deployment_id = ?",
        [deploymentId],
      );
      await transaction.query(
        "DELETE FROM platform_deployment_route_reservations WHERE deployment_id = ?",
        [deploymentId],
      );
      await transaction.query(
        `UPDATE platform_agent_deployments
            SET failure_code = NULL, updated_at = ? WHERE id = ?`,
        [now, deploymentId],
      );
      return true;
    });
  }

  async completeUnbind(deploymentId: string, now: string): Promise<boolean> {
    return this.write(async (transaction) => {
      const deployment = await this.deployments.get(deploymentId, transaction);
      if (!deployment || deployment.lifecycleState !== "ready_to_apply" ||
        deployment.operationState !== "stable") return false;
      const [blocked] = await transaction.query<{ n: number }>(
        `SELECT
          (SELECT COUNT(*) FROM platform_deployment_operations WHERE deployment_id = ?) +
          (SELECT COUNT(*) FROM platform_deployment_pair_fences WHERE deployment_id = ?) AS n`,
        [deploymentId, deploymentId],
      );
      if (Number(blocked.n) !== 0) return false;
      await transaction.query(
        "DELETE FROM platform_deployment_key_bindings WHERE deployment_id = ?",
        [deploymentId],
      );
      await transaction.query(
        "DELETE FROM platform_deployment_route_reservations WHERE deployment_id = ?",
        [deploymentId],
      );
      await transaction.query(
        `UPDATE platform_agent_deployments
            SET lifecycle_state = 'awaiting_key_binding', updated_at = ? WHERE id = ?`,
        [now, deploymentId],
      );
      return true;
    });
  }

  async completeBindingAbandon(deploymentId: string, now: string): Promise<boolean> {
    return this.write(async (transaction) => {
      const deployment = await this.deployments.get(deploymentId, transaction);
      const binding = await this.deployments.binding(deploymentId, transaction);
      if (!deployment || deployment.lifecycleState !== "awaiting_key_binding" ||
        deployment.operationState !== "stable" || !binding ||
        !["binding", "cleanup_required"].includes(binding.status)) return false;
      const [blocked] = await transaction.query<{ n: number }>(
        `SELECT
          (SELECT COUNT(*) FROM platform_deployment_operations WHERE deployment_id = ?) +
          (SELECT COUNT(*) FROM platform_deployment_pair_fences WHERE deployment_id = ?) AS n`,
        [deploymentId, deploymentId],
      );
      if (Number(blocked.n) !== 0) return false;
      await transaction.query(
        "DELETE FROM platform_deployment_key_bindings WHERE deployment_id = ?",
        [deploymentId],
      );
      await transaction.query(
        "DELETE FROM platform_deployment_route_reservations WHERE deployment_id = ?",
        [deploymentId],
      );
      await transaction.query(
        "UPDATE platform_agent_deployments SET updated_at = ? WHERE id = ?",
        [now, deploymentId],
      );
      return true;
    });
  }

  async bindingProjection(deploymentId: string): Promise<DeploymentKeyBinding | null> {
    const [row] = await this.database.query<{
      deployment_id: string;
      tenant_id: string;
      gateway_id: string;
      key_id: string;
      route_id: string;
      status: DeploymentKeyBinding["status"];
      key_policy_epoch: number;
      key_state: KeyPolicyState | null;
      updated_at: string;
    }>(
      `SELECT binding.deployment_id, deployment.tenant_id, binding.gateway_id,
              binding.key_id, binding.route_id, binding.status,
              binding.key_policy_epoch, policy.state AS key_state, binding.updated_at
         FROM platform_deployment_key_bindings binding
         JOIN platform_agent_deployments deployment ON deployment.id = binding.deployment_id
         LEFT JOIN platform_gateway_virtual_key_policies policy
           ON policy.gateway_id = binding.gateway_id AND policy.key_id = binding.key_id
        WHERE binding.deployment_id = ?`,
      [deploymentId],
    );
    return row ? {
      deploymentId: row.deployment_id,
      tenantId: row.tenant_id,
      gatewayId: row.gateway_id,
      keyId: row.key_id,
      routeId: row.route_id,
      status: row.status,
      keyPolicyEpoch: Number(row.key_policy_epoch),
      keyPolicyStatus: row.key_state ?? "reconciliation_required",
      updatedAt: row.updated_at,
    } : null;
  }

  async bindingsForGateway(gatewayId: string): Promise<DeploymentKeyBinding[]> {
    const rows = await this.database.query<{ deployment_id: string }>(
      `SELECT deployment_id FROM platform_deployment_key_bindings
        WHERE gateway_id = ? ORDER BY updated_at DESC, deployment_id`,
      [gatewayId],
    );
    const result: DeploymentKeyBinding[] = [];
    for (const row of rows) {
      const item = await this.bindingProjection(row.deployment_id);
      if (item) result.push(item);
    }
    return result;
  }

  async bindingCandidatesForGateway(gatewayId: string): Promise<DeploymentKeyBindingCandidate[]> {
    const rows = await this.database.query<{
      deployment_id: string;
      tenant_id: string;
      definition_id: string;
      gateway_id: string;
      gateway_route_id: string;
      lifecycle_state: DeploymentKeyBindingCandidate["lifecycleState"];
      key_id: string | null;
    }>(
      `SELECT deployment.id AS deployment_id, deployment.tenant_id,
              deployment.definition_id, deployment.gateway_id,
              deployment.gateway_route_id, deployment.lifecycle_state, binding.key_id
         FROM platform_agent_deployments deployment
         LEFT JOIN platform_deployment_key_bindings binding
           ON binding.deployment_id = deployment.id
        WHERE deployment.gateway_id = ? AND deployment.lifecycle_state <> 'deleted'
        ORDER BY deployment.updated_at DESC, deployment.id`,
      [gatewayId],
    );
    return rows.map((row) => ({
      deploymentId: row.deployment_id,
      tenantId: row.tenant_id,
      definitionId: row.definition_id,
      gatewayId: row.gateway_id,
      gatewayRouteId: row.gateway_route_id,
      lifecycleState: row.lifecycle_state,
      bindingKeyId: row.key_id,
    }));
  }

  async createContext(input: {
    id: string;
    principalId: string;
    principalAuthorityEpoch: number;
    tenantId: string;
    tenantAuthorityEpoch: number;
    membershipAuthorityEpoch: number;
    deployment: StoredAgentDeployment;
    gatewayAuthorityEpoch: number;
    pairClaimEpoch: number;
    keyId: string;
    keyPolicyEpoch: number;
    keyPolicyFingerprint: string;
    expiresAt: string;
    now: string;
  }): Promise<StoredInvocationContext | null> {
    return this.write(async (transaction) => {
      const deployment = await this.deployments.get(input.deployment.id, transaction);
      const fence = await this.deployments.pairFence(
        input.deployment.target.gatewayId,
        input.deployment.target.gatewayAgentId,
        transaction,
      );
      const binding = await this.deployments.binding(input.deployment.id, transaction);
      const policy = await this.keyPolicy(input.deployment.target.gatewayId, input.keyId, transaction);
      const [authority] = await transaction.query<{
        tenant_epoch: number;
        membership_epoch: number;
      }>(
        `SELECT tenant_fence.authority_epoch AS tenant_epoch,
                membership_fence.authority_epoch AS membership_epoch
           FROM platform_tenants tenant
           JOIN platform_tenant_memberships membership
             ON membership.tenant_id = tenant.id AND membership.principal_id = ?
           JOIN platform_authority_fences tenant_fence
             ON tenant_fence.subject_kind = 'tenant'
            AND tenant_fence.subject_id = tenant.id AND tenant_fence.tenant_id = ''
           JOIN platform_authority_fences membership_fence
             ON membership_fence.subject_kind = 'membership'
            AND membership_fence.subject_id = membership.principal_id
            AND membership_fence.tenant_id = tenant.id
          WHERE tenant.id = ? AND tenant.status = 'active'`,
        [input.principalId, input.tenantId],
      );
      if (!deployment || deployment.lifecycleState !== "active" ||
        deployment.operationState !== "stable" ||
        deployment.invocationEpoch !== input.deployment.invocationEpoch ||
        deployment.gatewayAuthorityEpoch !== input.gatewayAuthorityEpoch ||
        !fence || fence.state !== "promoted" || fence.deploymentId !== deployment.id ||
        fence.gatewayRouteId !== deployment.target.gatewayRouteId ||
        fence.claimEpoch !== input.pairClaimEpoch ||
        !binding || binding.status !== "bound" || binding.keyId !== input.keyId ||
        binding.routeId !== deployment.target.gatewayRouteId ||
        !policy || policy.state !== "stable" || policy.policyEpoch !== input.keyPolicyEpoch ||
        policy.observedFingerprint !== input.keyPolicyFingerprint ||
        !authority || Number(authority.tenant_epoch) !== input.tenantAuthorityEpoch ||
        Number(authority.membership_epoch) !== input.membershipAuthorityEpoch) return null;
      await transaction.query(
        `INSERT INTO platform_deployment_invocation_contexts
          (${contextColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [input.id, input.principalId, input.principalAuthorityEpoch, input.tenantId,
          input.tenantAuthorityEpoch, input.membershipAuthorityEpoch, deployment.id,
          deployment.invocationEpoch, deployment.target.gatewayId, input.gatewayAuthorityEpoch,
          deployment.target.gatewayAgentId, deployment.target.gatewayRouteId,
          input.pairClaimEpoch, input.keyId, input.keyPolicyEpoch,
          input.keyPolicyFingerprint, input.expiresAt, input.now, input.now],
      );
      return this.context(input.id, transaction);
    });
  }

  async context(
    id: string,
    session: DatabaseSession = this.database,
  ): Promise<StoredInvocationContext | null> {
    const [row] = await session.query<ContextRow>(
      `SELECT ${contextColumns} FROM platform_deployment_invocation_contexts WHERE id = ?`,
      [id],
    );
    return row ? invocationContext(row) : null;
  }

  async touchContext(id: string, principalId: string, now: string): Promise<boolean> {
    return this.write(async (transaction) => {
      const rows = await transaction.query<{ id: string }>(
        `UPDATE platform_deployment_invocation_contexts SET last_used_at = ?
          WHERE id = ? AND principal_id = ? AND completed_at IS NULL AND expires_at > ?
          RETURNING id`,
        [now, id, principalId, now],
      );
      return rows.length === 1;
    });
  }

  async completeContext(id: string, principalId: string, now: string): Promise<void> {
    await this.write(async (transaction) => {
      await transaction.query(
        `UPDATE platform_deployment_invocation_contexts
            SET completed_at = COALESCE(completed_at, ?), last_used_at = ?
          WHERE id = ? AND principal_id = ?`,
        [now, now, id, principalId],
      );
    });
  }
}
