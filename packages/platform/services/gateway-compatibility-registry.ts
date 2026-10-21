import type { DatabaseSession, PlatformDatabase } from "../ports/database";

export type GatewayCompatibilityPairState =
  | "stable"
  | "mutating"
  | "reconciliation_required";

export interface StoredGatewayCompatibilityPair {
  gatewayId: string;
  gatewayAgentId: string;
  state: GatewayCompatibilityPairState;
  authorityEpoch: number;
  agentFingerprint: string | null;
  operationToken: string | null;
  incident: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PairRow {
  gateway_id: string;
  gateway_agent_id: string;
  state: GatewayCompatibilityPairState;
  authority_epoch: number;
  agent_fingerprint: string | null;
  operation_token: string | null;
  incident: string | null;
  created_at: string;
  updated_at: string;
}

const pairColumns = `gateway_id, gateway_agent_id, state, authority_epoch,
  agent_fingerprint, operation_token, incident, created_at, updated_at`;

function pair(row: PairRow): StoredGatewayCompatibilityPair {
  return {
    gatewayId: row.gateway_id,
    gatewayAgentId: row.gateway_agent_id,
    state: row.state,
    authorityEpoch: Number(row.authority_epoch),
    agentFingerprint: row.agent_fingerprint,
    operationToken: row.operation_token,
    incident: row.incident,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface StoredGatewayCompatibilityContext {
  id: string;
  principalId: string;
  principalAuthorityEpoch: number;
  gatewayId: string;
  gatewayAuthorityEpoch: number;
  gatewayAgentId: string;
  gatewayRouteId: string;
  compatibilityPairEpoch: number;
  agentFingerprint: string;
  routeFingerprint: string;
  pathPrefix: string;
  keyId: string;
  keyPolicyEpoch: number;
  keyPolicyFingerprint: string;
  expiresAt: string;
  completedAt: string | null;
  createdAt: string;
  lastUsedAt: string;
}

interface ContextRow {
  id: string;
  principal_id: string;
  principal_authority_epoch: number;
  gateway_id: string;
  gateway_authority_epoch: number;
  gateway_agent_id: string;
  gateway_route_id: string;
  compatibility_pair_epoch: number;
  agent_fingerprint: string;
  route_fingerprint: string;
  path_prefix: string;
  key_id: string;
  key_policy_epoch: number;
  key_policy_fingerprint: string;
  expires_at: string;
  completed_at: string | null;
  created_at: string;
  last_used_at: string;
}

const contextColumns = `id, principal_id, principal_authority_epoch, gateway_id,
  gateway_authority_epoch, gateway_agent_id, gateway_route_id,
  compatibility_pair_epoch, agent_fingerprint, route_fingerprint, path_prefix,
  key_id, key_policy_epoch, key_policy_fingerprint, expires_at, completed_at,
  created_at, last_used_at`;

function context(row: ContextRow): StoredGatewayCompatibilityContext {
  return {
    id: row.id,
    principalId: row.principal_id,
    principalAuthorityEpoch: Number(row.principal_authority_epoch),
    gatewayId: row.gateway_id,
    gatewayAuthorityEpoch: Number(row.gateway_authority_epoch),
    gatewayAgentId: row.gateway_agent_id,
    gatewayRouteId: row.gateway_route_id,
    compatibilityPairEpoch: Number(row.compatibility_pair_epoch),
    agentFingerprint: row.agent_fingerprint,
    routeFingerprint: row.route_fingerprint,
    pathPrefix: row.path_prefix,
    keyId: row.key_id,
    keyPolicyEpoch: Number(row.key_policy_epoch),
    keyPolicyFingerprint: row.key_policy_fingerprint,
    expiresAt: row.expires_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export class GatewayCompatibilityRegistry {
  constructor(readonly database: PlatformDatabase) {}

  private async write<T>(work: (transaction: DatabaseSession) => Promise<T>): Promise<T> {
    return this.database.transaction(async (transaction) => {
      const suffix = this.database.dialect === "postgres" ? " FOR UPDATE" : "";
      await transaction.query(`SELECT id FROM platform_schema_lock WHERE id = 1${suffix}`);
      return work(transaction);
    });
  }

  async pair(
    gatewayId: string,
    agentId: string,
    session: DatabaseSession = this.database,
  ): Promise<StoredGatewayCompatibilityPair | null> {
    const [row] = await session.query<PairRow>(
      `SELECT ${pairColumns} FROM platform_gateway_compatibility_pairs
        WHERE gateway_id = ? AND gateway_agent_id = ?`,
      [gatewayId, agentId],
    );
    return row ? pair(row) : null;
  }

  async ensureStable(input: {
    gatewayId: string;
    agentId: string;
    agentFingerprint: string;
    now: string;
  }): Promise<StoredGatewayCompatibilityPair | null> {
    return this.write(async (transaction) => {
      const current = await this.pair(input.gatewayId, input.agentId, transaction);
      if (current) {
        if (current.state !== "stable" || current.agentFingerprint !== input.agentFingerprint) {
          return null;
        }
        return current;
      }
      await transaction.query(
        `INSERT INTO platform_gateway_compatibility_pairs
          (gateway_id, gateway_agent_id, state, authority_epoch, agent_fingerprint,
           operation_token, incident, created_at, updated_at)
         VALUES (?, ?, 'stable', 1, ?, NULL, NULL, ?, ?)`,
        [input.gatewayId, input.agentId, input.agentFingerprint, input.now, input.now],
      );
      return this.pair(input.gatewayId, input.agentId, transaction);
    });
  }

  async markDrift(input: {
    gatewayId: string;
    agentId: string;
    expectedEpoch: number;
    incident: string;
    now: string;
  }): Promise<void> {
    await this.write(async (transaction) => {
      await transaction.query(
        `UPDATE platform_gateway_compatibility_pairs
            SET state = 'reconciliation_required', authority_epoch = authority_epoch + 1,
                operation_token = NULL, incident = ?, updated_at = ?
          WHERE gateway_id = ? AND gateway_agent_id = ? AND state = 'stable'
            AND authority_epoch = ?`,
        [input.incident, input.now, input.gatewayId, input.agentId, input.expectedEpoch],
      );
    });
  }

  async beginMutation(input: {
    gatewayId: string;
    agentIds: string[];
    operationToken: string;
    now: string;
  }): Promise<boolean> {
    const ids = [...new Set(input.agentIds)].sort();
    if (ids.length === 0) return false;
    return this.write(async (transaction) => {
      const states = await Promise.all(ids.map((id) => this.pair(input.gatewayId, id, transaction)));
      if (states.some((item) => item && item.state !== "stable")) return false;
      for (let index = 0; index < ids.length; index++) {
        const id = ids[index];
        const current = states[index];
        if (current) {
          await transaction.query(
            `UPDATE platform_gateway_compatibility_pairs
                SET state = 'mutating', authority_epoch = authority_epoch + 1,
                    operation_token = ?, incident = NULL, updated_at = ?
              WHERE gateway_id = ? AND gateway_agent_id = ?`,
            [input.operationToken, input.now, input.gatewayId, id],
          );
        } else {
          await transaction.query(
            `INSERT INTO platform_gateway_compatibility_pairs
              (gateway_id, gateway_agent_id, state, authority_epoch, agent_fingerprint,
               operation_token, incident, created_at, updated_at)
             VALUES (?, ?, 'mutating', 1, NULL, ?, NULL, ?, ?)`,
            [input.gatewayId, id, input.operationToken, input.now, input.now],
          );
        }
      }
      return true;
    });
  }

  async completeMutation(input: {
    gatewayId: string;
    agentFingerprints: Record<string, string | null>;
    operationToken: string;
    now: string;
  }): Promise<boolean> {
    const ids = Object.keys(input.agentFingerprints).sort();
    return this.write(async (transaction) => {
      const states = await Promise.all(ids.map((id) => this.pair(input.gatewayId, id, transaction)));
      if (states.some((item) => !item || item.state !== "mutating" ||
        item.operationToken !== input.operationToken)) return false;
      for (const id of ids) {
        await transaction.query(
          `UPDATE platform_gateway_compatibility_pairs
              SET state = 'stable', authority_epoch = authority_epoch + 1,
                  agent_fingerprint = ?, operation_token = NULL, incident = NULL,
                  updated_at = ?
            WHERE gateway_id = ? AND gateway_agent_id = ?`,
          [input.agentFingerprints[id], input.now, input.gatewayId, id],
        );
      }
      return true;
    });
  }

  async failMutation(input: {
    gatewayId: string;
    agentIds: string[];
    operationToken: string;
    incident: string;
    now: string;
  }): Promise<void> {
    await this.write(async (transaction) => {
      for (const id of [...new Set(input.agentIds)]) {
        await transaction.query(
          `UPDATE platform_gateway_compatibility_pairs
              SET state = 'reconciliation_required', authority_epoch = authority_epoch + 1,
                  incident = ?, updated_at = ?
            WHERE gateway_id = ? AND gateway_agent_id = ? AND state = 'mutating'
              AND operation_token = ?`,
          [input.incident, input.now, input.gatewayId, id, input.operationToken],
        );
      }
    });
  }

  async reconcilePair(input: {
    gatewayId: string;
    agentId: string;
    agentFingerprint: string | null;
    now: string;
  }): Promise<StoredGatewayCompatibilityPair | null> {
    return this.write(async (transaction) => {
      const current = await this.pair(input.gatewayId, input.agentId, transaction);
      if (!current || current.state !== "reconciliation_required") return null;
      await transaction.query(
        `UPDATE platform_gateway_compatibility_pairs
            SET state = 'stable', authority_epoch = authority_epoch + 1,
                agent_fingerprint = ?, operation_token = NULL, incident = NULL,
                updated_at = ?
          WHERE gateway_id = ? AND gateway_agent_id = ?`,
        [input.agentFingerprint, input.now, input.gatewayId, input.agentId],
      );
      return this.pair(input.gatewayId, input.agentId, transaction);
    });
  }

  async createContext(input: Omit<StoredGatewayCompatibilityContext,
    "completedAt" | "createdAt" | "lastUsedAt"> & { now: string }): Promise<boolean> {
    return this.write(async (transaction) => {
      const current = await this.pair(input.gatewayId, input.gatewayAgentId, transaction);
      if (!current || current.state !== "stable" ||
        current.authorityEpoch !== input.compatibilityPairEpoch ||
        current.agentFingerprint !== input.agentFingerprint) return false;
      const [fence] = await transaction.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM platform_deployment_pair_fences
          WHERE gateway_id = ? AND (gateway_agent_id = ? OR gateway_route_id = ?)`,
        [input.gatewayId, input.gatewayAgentId, input.gatewayRouteId],
      );
      if (Number(fence.n) !== 0) return false;
      const [policy] = await transaction.query<{
        state: string;
        policy_epoch: number;
        observed_fingerprint: string | null;
      }>(
        `SELECT state, policy_epoch, observed_fingerprint
           FROM platform_gateway_virtual_key_policies
          WHERE gateway_id = ? AND key_id = ?`,
        [input.gatewayId, input.keyId],
      );
      if (!policy || policy.state !== "stable" ||
        Number(policy.policy_epoch) !== input.keyPolicyEpoch ||
        policy.observed_fingerprint !== input.keyPolicyFingerprint) return false;
      await transaction.query(
        `INSERT INTO platform_gateway_compatibility_invocation_contexts
          (${contextColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [input.id, input.principalId, input.principalAuthorityEpoch, input.gatewayId,
          input.gatewayAuthorityEpoch, input.gatewayAgentId, input.gatewayRouteId,
          input.compatibilityPairEpoch, input.agentFingerprint, input.routeFingerprint,
          input.pathPrefix, input.keyId, input.keyPolicyEpoch, input.keyPolicyFingerprint,
          input.expiresAt, input.now, input.now],
      );
      return true;
    });
  }

  async context(id: string): Promise<StoredGatewayCompatibilityContext | null> {
    const [row] = await this.database.query<ContextRow>(
      `SELECT ${contextColumns}
         FROM platform_gateway_compatibility_invocation_contexts WHERE id = ?`,
      [id],
    );
    return row ? context(row) : null;
  }

  async touchContext(id: string, principalId: string, now: string): Promise<boolean> {
    return this.write(async (transaction) => {
      const rows = await transaction.query<{ id: string }>(
        `UPDATE platform_gateway_compatibility_invocation_contexts
            SET last_used_at = ?
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
        `UPDATE platform_gateway_compatibility_invocation_contexts
            SET completed_at = COALESCE(completed_at, ?), last_used_at = ?
          WHERE id = ? AND principal_id = ?`,
        [now, now, id, principalId],
      );
    });
  }
}
