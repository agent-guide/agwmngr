import type {
  PrincipalStatus,
  Tenant,
  TenantGatewayAccess,
  TenantGatewayGrant,
  TenantMembership,
  TenantRole,
} from "../../contracts/platform/identity";
import type { DatabaseSession, PlatformDatabase } from "../ports/database";

export interface StoredPrincipal {
  id: string;
  kind: "human" | "service";
  userId: number | null;
  serviceName: string | null;
  status: PrincipalStatus;
  createdAt: string;
  updatedAt: string;
}

interface PrincipalRow {
  id: string;
  kind: "human" | "service";
  user_id: number | null;
  service_name: string | null;
  status: PrincipalStatus;
  created_at: string;
  updated_at: string;
}

interface TenantRow {
  id: string;
  name: string;
  status: Tenant["status"];
  created_at: string;
  updated_at: string;
}

interface MembershipRow {
  principal_id: string;
  tenant_id: string;
  role: TenantRole;
  created_at: string;
  updated_at: string;
}

interface AuthorityFenceRow {
  authority_epoch: number;
}

interface GrantRow {
  principal_id: string;
  tenant_id: string;
  gateway_id: string;
  access: TenantGatewayAccess;
  principal_authority_epoch: number;
  tenant_authority_epoch: number;
  membership_authority_epoch: number;
  gateway_authority_epoch: number;
  created_at: string;
  updated_at: string;
}

interface MembershipAddReceiptRow {
  receipt_digest: string;
  actor_principal_id: string;
  tenant_id: string;
  target_principal_id: string;
  target_kind: "human" | "service";
  actor_principal_authority_epoch: number;
  tenant_authority_epoch: number;
  actor_membership_authority_epoch: number;
  target_principal_authority_epoch: number;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export interface TenantGatewayGrantSnapshot extends TenantGatewayGrant {
  principalAuthorityEpoch: number;
  tenantAuthorityEpoch: number;
  membershipAuthorityEpoch: number;
  gatewayAuthorityEpoch: number;
}

export interface LocalGrantAuthority {
  principal: StoredPrincipal;
  principalAuthorityEpoch: number | null;
  tenant: Tenant;
  tenantAuthorityEpoch: number;
  membership: TenantMembership;
  membershipAuthorityEpoch: number;
}

export interface MembershipAddReceiptSnapshot {
  digest: string;
  actorPrincipalId: string;
  tenantId: string;
  targetPrincipalId: string;
  targetKind: "human" | "service";
  actorPrincipalAuthorityEpoch: number;
  tenantAuthorityEpoch: number;
  actorMembershipAuthorityEpoch: number;
  targetPrincipalAuthorityEpoch: number;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
}

export type MembershipReceiptConsumeResult =
  | { status: "created"; membership: TenantMembership }
  | { status: "invalid" | "expired" | "replayed" | "stale" | "exists" };

function toPrincipal(row: PrincipalRow): StoredPrincipal {
  return {
    id: row.id,
    kind: row.kind,
    userId: row.user_id === null ? null : Number(row.user_id),
    serviceName: row.service_name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMembership(row: MembershipRow): TenantMembership {
  return {
    principalId: row.principal_id,
    tenantId: row.tenant_id,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toGrant(row: GrantRow): TenantGatewayGrantSnapshot {
  return {
    principalId: row.principal_id,
    tenantId: row.tenant_id,
    gatewayId: row.gateway_id,
    access: row.access,
    principalAuthorityEpoch: Number(row.principal_authority_epoch),
    tenantAuthorityEpoch: Number(row.tenant_authority_epoch),
    membershipAuthorityEpoch: Number(row.membership_authority_epoch),
    gatewayAuthorityEpoch: Number(row.gateway_authority_epoch),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMembershipAddReceipt(row: MembershipAddReceiptRow): MembershipAddReceiptSnapshot {
  return {
    digest: row.receipt_digest,
    actorPrincipalId: row.actor_principal_id,
    tenantId: row.tenant_id,
    targetPrincipalId: row.target_principal_id,
    targetKind: row.target_kind,
    actorPrincipalAuthorityEpoch: Number(row.actor_principal_authority_epoch),
    tenantAuthorityEpoch: Number(row.tenant_authority_epoch),
    actorMembershipAuthorityEpoch: Number(row.actor_membership_authority_epoch),
    targetPrincipalAuthorityEpoch: Number(row.target_principal_authority_epoch),
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}

// Private persistence boundary. Callers use PlatformIdentityService so live
// manager/service state and Tenant status cannot be bypassed accidentally.
export class IdentityRegistry {
  constructor(readonly database: PlatformDatabase) {}

  async write<T>(work: (transaction: DatabaseSession) => Promise<T>): Promise<T> {
    return this.database.transaction(async (transaction) => {
      const suffix = this.database.dialect === "postgres" ? " FOR UPDATE" : "";
      await transaction.query(`SELECT id FROM platform_schema_lock WHERE id = 1${suffix}`);
      return work(transaction);
    });
  }

  async principal(
    id: string,
    session: DatabaseSession = this.database,
  ): Promise<StoredPrincipal | null> {
    const [row] = await session.query<PrincipalRow>(
      `SELECT id, kind, user_id, service_name, status, created_at, updated_at
         FROM platform_principals WHERE id = ?`,
      [id],
    );
    return row ? toPrincipal(row) : null;
  }

  async principals(): Promise<StoredPrincipal[]> {
    const rows = await this.database.query<PrincipalRow>(
      `SELECT id, kind, user_id, service_name, status, created_at, updated_at
         FROM platform_principals ORDER BY id`,
    );
    return rows.map(toPrincipal);
  }

  async issued(
    kind: "service_principal" | "tenant",
    id: string,
    session: DatabaseSession = this.database,
  ): Promise<boolean> {
    const [row] = await session.query<{ subject_id: string }>(
      `SELECT subject_id FROM platform_issued_ids
        WHERE subject_kind = ? AND subject_id = ?`,
      [kind, id],
    );
    return Boolean(row);
  }

  private async authorityEpoch(
    kind: "service_principal" | "tenant" | "membership",
    id: string,
    tenantId: string,
    session: DatabaseSession = this.database,
  ): Promise<number | null> {
    const [row] = await session.query<AuthorityFenceRow>(
      `SELECT authority_epoch FROM platform_authority_fences
        WHERE subject_kind = ? AND subject_id = ? AND tenant_id = ?`,
      [kind, id, tenantId],
    );
    return row ? Number(row.authority_epoch) : null;
  }

  async servicePrincipalAuthorityEpoch(
    principalId: string,
    session: DatabaseSession = this.database,
  ): Promise<number | null> {
    return this.authorityEpoch("service_principal", principalId, "", session);
  }

  async localGrantAuthority(
    principalId: string,
    tenantId: string,
    session: DatabaseSession = this.database,
  ): Promise<LocalGrantAuthority | null> {
    const principal = await this.principal(principalId, session);
    const tenant = await this.tenant(tenantId, session);
    const membership = await this.membership(principalId, tenantId, session);
    if (!principal || !tenant || !membership) return null;
    const principalAuthorityEpoch = principal.kind === "service"
      ? await this.authorityEpoch("service_principal", principalId, "", session)
      : null;
    const tenantAuthorityEpoch = await this.authorityEpoch("tenant", tenantId, "", session);
    const membershipAuthorityEpoch = await this.authorityEpoch(
      "membership",
      principalId,
      tenantId,
      session,
    );
    if (
      (principal.kind === "service" && principalAuthorityEpoch === null) ||
      tenantAuthorityEpoch === null ||
      membershipAuthorityEpoch === null
    ) {
      throw new Error("missing platform authority fence");
    }
    return {
      principal,
      principalAuthorityEpoch,
      tenant,
      tenantAuthorityEpoch,
      membership,
      membershipAuthorityEpoch,
    };
  }

  async ensureHuman(userId: number, now: string): Promise<StoredPrincipal> {
    const id = `user:${userId}`;
    const current = await this.principal(id);
    if (current) {
      if (current.kind !== "human" || current.userId !== userId) {
        throw new Error("human principal mapping conflict");
      }
      return current;
    }
    await this.write((transaction) =>
      transaction.query(
        `INSERT INTO platform_principals
           (id, kind, user_id, service_name, status, created_at, updated_at)
         VALUES (?, 'human', ?, NULL, 'active', ?, ?)
         ON CONFLICT (id) DO NOTHING`,
        [id, userId, now, now],
      ),
    );
    const inserted = await this.principal(id);
    if (!inserted || inserted.kind !== "human" || inserted.userId !== userId) {
      throw new Error("human principal mapping conflict");
    }
    return inserted;
  }

  async tenant(
    id: string,
    session: DatabaseSession = this.database,
  ): Promise<Tenant | null> {
    const [row] = await session.query<TenantRow>(
      "SELECT id, name, status, created_at, updated_at FROM platform_tenants WHERE id = ?",
      [id],
    );
    return row ? toTenant(row) : null;
  }

  async tenants(): Promise<Tenant[]> {
    const rows = await this.database.query<TenantRow>(
      "SELECT id, name, status, created_at, updated_at FROM platform_tenants ORDER BY id",
    );
    return rows.map(toTenant);
  }

  async createTenant(tenant: Tenant): Promise<void> {
    await this.write(async (transaction) => {
      await transaction.query(
        `INSERT INTO platform_issued_ids
           (subject_kind, subject_id, issued_at, tombstoned_at)
         VALUES ('tenant', ?, ?, NULL)`,
        [tenant.id, tenant.createdAt],
      );
      await transaction.query(
        `INSERT INTO platform_tenants (id, name, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [tenant.id, tenant.name, tenant.status, tenant.createdAt, tenant.updatedAt],
      );
      await transaction.query(
        `INSERT INTO platform_authority_fences
           (subject_kind, subject_id, tenant_id, authority_epoch, updated_at)
         VALUES ('tenant', ?, '', 1, ?)`,
        [tenant.id, tenant.createdAt],
      );
    });
  }

  async setTenantStatus(id: string, status: Tenant["status"], now: string): Promise<void> {
    await this.write(async (transaction) => {
      const tenant = await this.tenant(id, transaction);
      if (!tenant) return;
      await transaction.query(
        "UPDATE platform_tenants SET status = ?, updated_at = ? WHERE id = ?",
        [status, now, id],
      );
      if (tenant.status !== status) {
        await transaction.query(
          `UPDATE platform_authority_fences
              SET authority_epoch = authority_epoch + 1, updated_at = ?
            WHERE subject_kind = 'tenant' AND subject_id = ? AND tenant_id = ''`,
          [now, id],
        );
        await transaction.query(
          "DELETE FROM platform_tenant_gateway_grants WHERE tenant_id = ?",
          [id],
        );
      }
    });
  }

  async deleteTenant(id: string, now: string): Promise<boolean> {
    return this.write(async (transaction) => {
      const tenant = await this.tenant(id, transaction);
      if (!tenant) return false;
      await transaction.query(
        `UPDATE platform_authority_fences
            SET authority_epoch = authority_epoch + 1, updated_at = ?
          WHERE subject_kind = 'tenant' AND subject_id = ? AND tenant_id = ''`,
        [now, id],
      );
      await transaction.query(
        `UPDATE platform_authority_fences
            SET authority_epoch = authority_epoch + 1, updated_at = ?
          WHERE subject_kind = 'membership' AND tenant_id = ?`,
        [now, id],
      );
      await transaction.query("DELETE FROM platform_tenant_gateway_grants WHERE tenant_id = ?", [id]);
      await transaction.query("DELETE FROM platform_tenants WHERE id = ?", [id]);
      await transaction.query(
        `UPDATE platform_issued_ids SET tombstoned_at = ?
          WHERE subject_kind = 'tenant' AND subject_id = ?`,
        [now, id],
      );
      return true;
    });
  }

  async membership(
    principalId: string,
    tenantId: string,
    session: DatabaseSession = this.database,
  ): Promise<TenantMembership | null> {
    const [row] = await session.query<MembershipRow>(
      `SELECT principal_id, tenant_id, role, created_at, updated_at
         FROM platform_tenant_memberships
        WHERE principal_id = ? AND tenant_id = ?`,
      [principalId, tenantId],
    );
    return row ? toMembership(row) : null;
  }

  async membershipsForPrincipal(principalId: string): Promise<TenantMembership[]> {
    const rows = await this.database.query<MembershipRow>(
      `SELECT principal_id, tenant_id, role, created_at, updated_at
         FROM platform_tenant_memberships
        WHERE principal_id = ? ORDER BY tenant_id`,
      [principalId],
    );
    return rows.map(toMembership);
  }

  async membershipsForTenant(tenantId: string): Promise<TenantMembership[]> {
    const rows = await this.database.query<MembershipRow>(
      `SELECT principal_id, tenant_id, role, created_at, updated_at
         FROM platform_tenant_memberships
        WHERE tenant_id = ? ORDER BY principal_id`,
      [tenantId],
    );
    return rows.map(toMembership);
  }

  async createMembership(
    principalId: string,
    tenantId: string,
    role: TenantRole,
    now: string,
  ): Promise<boolean> {
    return this.write(async (transaction) => {
      await transaction.query(
        `INSERT INTO platform_authority_fences
           (subject_kind, subject_id, tenant_id, authority_epoch, updated_at)
         VALUES ('membership', ?, ?, 1, ?)
         ON CONFLICT (subject_kind, subject_id, tenant_id) DO NOTHING`,
        [principalId, tenantId, now],
      );
      const rows = await transaction.query<{ principal_id: string }>(
        `INSERT INTO platform_tenant_memberships
           (principal_id, tenant_id, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (principal_id, tenant_id) DO NOTHING
         RETURNING principal_id`,
        [principalId, tenantId, role, now, now],
      );
      return rows.length === 1;
    });
  }

  async updateMembership(
    principalId: string,
    tenantId: string,
    role: TenantRole,
    now: string,
  ): Promise<boolean> {
    return this.write(async (transaction) => {
      const current = await this.membership(principalId, tenantId, transaction);
      if (!current) return false;
      const rows = await transaction.query<{ principal_id: string }>(
        `UPDATE platform_tenant_memberships
            SET role = ?, updated_at = ?
          WHERE principal_id = ? AND tenant_id = ?
        RETURNING principal_id`,
        [role, now, principalId, tenantId],
      );
      if (rows.length === 1 && current.role !== role) {
        await transaction.query(
          `UPDATE platform_authority_fences
              SET authority_epoch = authority_epoch + 1, updated_at = ?
            WHERE subject_kind = 'membership' AND subject_id = ? AND tenant_id = ?`,
          [now, principalId, tenantId],
        );
        await transaction.query(
          `DELETE FROM platform_tenant_gateway_grants
            WHERE principal_id = ? AND tenant_id = ?`,
          [principalId, tenantId],
        );
      }
      return rows.length === 1;
    });
  }

  async removeMembership(principalId: string, tenantId: string, now: string): Promise<void> {
    await this.write(async (transaction) => {
      const current = await this.membership(principalId, tenantId, transaction);
      if (!current) return;
      await transaction.query(
        `UPDATE platform_authority_fences
            SET authority_epoch = authority_epoch + 1, updated_at = ?
          WHERE subject_kind = 'membership' AND subject_id = ? AND tenant_id = ?`,
        [now, principalId, tenantId],
      );
      await transaction.query(
        "DELETE FROM platform_tenant_memberships WHERE principal_id = ? AND tenant_id = ?",
        [principalId, tenantId],
      );
    });
  }

  async membershipAddReceipt(
    digest: string,
    session: DatabaseSession = this.database,
  ): Promise<MembershipAddReceiptSnapshot | null> {
    const [row] = await session.query<MembershipAddReceiptRow>(
      `SELECT receipt_digest, actor_principal_id, tenant_id, target_principal_id,
              target_kind, actor_principal_authority_epoch, tenant_authority_epoch,
              actor_membership_authority_epoch, target_principal_authority_epoch,
              expires_at, consumed_at, created_at
         FROM platform_membership_add_receipts
        WHERE receipt_digest = ?`,
      [digest],
    );
    return row ? toMembershipAddReceipt(row) : null;
  }

  async createMembershipAddReceipt(input: MembershipAddReceiptSnapshot): Promise<boolean> {
    return this.write(async (transaction) => {
      const actor = await this.localGrantAuthority(
        input.actorPrincipalId,
        input.tenantId,
        transaction,
      );
      const target = await this.principal(input.targetPrincipalId, transaction);
      const targetEpoch = target?.kind === "service"
        ? await this.servicePrincipalAuthorityEpoch(input.targetPrincipalId, transaction)
        : null;
      if (
        !actor ||
        actor.principal.status !== "active" ||
        actor.tenant.status !== "active" ||
        actor.membership.role !== "admin" ||
        actor.tenantAuthorityEpoch !== input.tenantAuthorityEpoch ||
        actor.membershipAuthorityEpoch !== input.actorMembershipAuthorityEpoch ||
        (actor.principal.kind === "service" &&
          actor.principalAuthorityEpoch !== input.actorPrincipalAuthorityEpoch) ||
        !target ||
        target.kind !== input.targetKind ||
        target.status !== "active" ||
        (target.kind === "service" && targetEpoch !== input.targetPrincipalAuthorityEpoch)
      ) {
        return false;
      }
      await transaction.query(
        `INSERT INTO platform_membership_add_receipts
           (receipt_digest, actor_principal_id, tenant_id, target_principal_id,
            target_kind, actor_principal_authority_epoch, tenant_authority_epoch,
            actor_membership_authority_epoch, target_principal_authority_epoch,
            expires_at, consumed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        [
          input.digest,
          input.actorPrincipalId,
          input.tenantId,
          input.targetPrincipalId,
          input.targetKind,
          input.actorPrincipalAuthorityEpoch,
          input.tenantAuthorityEpoch,
          input.actorMembershipAuthorityEpoch,
          input.targetPrincipalAuthorityEpoch,
          input.expiresAt,
          input.createdAt,
        ],
      );
      return true;
    });
  }

  async removeMembershipAddReceipt(digest: string): Promise<void> {
    await this.write((transaction) =>
      transaction.query(
        "DELETE FROM platform_membership_add_receipts WHERE receipt_digest = ?",
        [digest],
      ),
    );
  }

  async consumeMembershipAddReceipt(input: {
    digest: string;
    actorPrincipalId: string;
    tenantId: string;
    role: TenantRole;
    now: string;
  }): Promise<MembershipReceiptConsumeResult> {
    return this.write(async (transaction) => {
      const receipt = await this.membershipAddReceipt(input.digest, transaction);
      if (
        !receipt ||
        receipt.actorPrincipalId !== input.actorPrincipalId ||
        receipt.tenantId !== input.tenantId
      ) return { status: "invalid" };
      if (receipt.consumedAt) return { status: "replayed" };
      if (receipt.expiresAt <= input.now) return { status: "expired" };

      const actor = await this.localGrantAuthority(
        receipt.actorPrincipalId,
        receipt.tenantId,
        transaction,
      );
      const target = await this.principal(receipt.targetPrincipalId, transaction);
      const targetEpoch = target?.kind === "service"
        ? await this.servicePrincipalAuthorityEpoch(receipt.targetPrincipalId, transaction)
        : null;
      if (
        !actor ||
        actor.principal.status !== "active" ||
        actor.tenant.status !== "active" ||
        actor.membership.role !== "admin" ||
        actor.tenantAuthorityEpoch !== receipt.tenantAuthorityEpoch ||
        actor.membershipAuthorityEpoch !== receipt.actorMembershipAuthorityEpoch ||
        (actor.principal.kind === "service" &&
          actor.principalAuthorityEpoch !== receipt.actorPrincipalAuthorityEpoch) ||
        !target ||
        target.kind !== receipt.targetKind ||
        target.status !== "active" ||
        (target.kind === "service" &&
          targetEpoch !== receipt.targetPrincipalAuthorityEpoch)
      ) return { status: "stale" };

      if (await this.membership(receipt.targetPrincipalId, receipt.tenantId, transaction)) {
        return { status: "exists" };
      }
      const consumed = await transaction.query<{ receipt_digest: string }>(
        `UPDATE platform_membership_add_receipts SET consumed_at = ?
          WHERE receipt_digest = ? AND consumed_at IS NULL
        RETURNING receipt_digest`,
        [input.now, input.digest],
      );
      if (consumed.length !== 1) return { status: "replayed" };

      await transaction.query(
        `INSERT INTO platform_authority_fences
           (subject_kind, subject_id, tenant_id, authority_epoch, updated_at)
         VALUES ('membership', ?, ?, 1, ?)
         ON CONFLICT (subject_kind, subject_id, tenant_id) DO NOTHING`,
        [receipt.targetPrincipalId, receipt.tenantId, input.now],
      );
      await transaction.query(
        `INSERT INTO platform_tenant_memberships
           (principal_id, tenant_id, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [receipt.targetPrincipalId, receipt.tenantId, input.role, input.now, input.now],
      );
      return {
        status: "created",
        membership: {
          principalId: receipt.targetPrincipalId,
          tenantId: receipt.tenantId,
          role: input.role,
          createdAt: input.now,
          updatedAt: input.now,
        },
      };
    });
  }

  async removeMembershipIfSnapshot(membership: TenantMembership, now: string): Promise<void> {
    await this.write(async (transaction) => {
      const rows = await transaction.query<{ principal_id: string }>(
        `DELETE FROM platform_tenant_memberships
          WHERE principal_id = ? AND tenant_id = ? AND role = ?
            AND created_at = ? AND updated_at = ?
        RETURNING principal_id`,
        [
          membership.principalId,
          membership.tenantId,
          membership.role,
          membership.createdAt,
          membership.updatedAt,
        ],
      );
      if (rows.length === 1) {
        await transaction.query(
          `UPDATE platform_authority_fences
              SET authority_epoch = authority_epoch + 1, updated_at = ?
            WHERE subject_kind = 'membership' AND subject_id = ? AND tenant_id = ?`,
          [now, membership.principalId, membership.tenantId],
        );
      }
    });
  }

  async createService(
    input: {
      id: string;
      name: string;
      credentialId: string;
      digest: string;
      expiresAt: string;
      now: string;
    },
  ): Promise<void> {
    await this.write(async (transaction) => {
      await transaction.query(
        `INSERT INTO platform_issued_ids
           (subject_kind, subject_id, issued_at, tombstoned_at)
         VALUES ('service_principal', ?, ?, NULL)`,
        [input.id, input.now],
      );
      await transaction.query(
        `INSERT INTO platform_principals
           (id, kind, user_id, service_name, status, created_at, updated_at)
         VALUES (?, 'service', NULL, ?, 'active', ?, ?)`,
        [input.id, input.name, input.now, input.now],
      );
      await transaction.query(
        `INSERT INTO platform_service_credentials
           (id, principal_id, token_digest, expires_at, revoked_at, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)`,
        [input.credentialId, input.id, input.digest, input.expiresAt, input.now],
      );
      await transaction.query(
        `INSERT INTO platform_authority_fences
           (subject_kind, subject_id, tenant_id, authority_epoch, updated_at)
         VALUES ('service_principal', ?, '', 1, ?)`,
        [input.id, input.now],
      );
    });
  }

  async disableService(id: string, now: string): Promise<void> {
    await this.write(async (transaction) => {
      const principal = await this.principal(id, transaction);
      await transaction.query(
        `UPDATE platform_principals
            SET status = 'disabled', updated_at = ?
          WHERE id = ? AND kind = 'service'`,
        [now, id],
      );
      await transaction.query(
        `UPDATE platform_service_credentials
            SET revoked_at = ?
          WHERE principal_id = ? AND revoked_at IS NULL`,
        [now, id],
      );
      if (principal?.kind === "service" && principal.status !== "disabled") {
        await transaction.query(
          `UPDATE platform_authority_fences
              SET authority_epoch = authority_epoch + 1, updated_at = ?
            WHERE subject_kind = 'service_principal' AND subject_id = ? AND tenant_id = ''`,
          [now, id],
        );
        await transaction.query(
          "DELETE FROM platform_tenant_gateway_grants WHERE principal_id = ?",
          [id],
        );
      }
    });
  }

  async tenantGatewayGrant(
    principalId: string,
    tenantId: string,
    gatewayId: string,
    session: DatabaseSession = this.database,
  ): Promise<TenantGatewayGrantSnapshot | null> {
    const [row] = await session.query<GrantRow>(
      `SELECT principal_id, tenant_id, gateway_id, access,
              principal_authority_epoch, tenant_authority_epoch,
              membership_authority_epoch, gateway_authority_epoch,
              created_at, updated_at
         FROM platform_tenant_gateway_grants
        WHERE principal_id = ? AND tenant_id = ? AND gateway_id = ?`,
      [principalId, tenantId, gatewayId],
    );
    return row ? toGrant(row) : null;
  }

  async tenantGatewayGrants(filters: {
    principalId?: string;
    tenantId?: string;
    gatewayId?: string;
  } = {}): Promise<TenantGatewayGrantSnapshot[]> {
    const where: string[] = [];
    const values: string[] = [];
    if (filters.principalId) {
      where.push("principal_id = ?");
      values.push(filters.principalId);
    }
    if (filters.tenantId) {
      where.push("tenant_id = ?");
      values.push(filters.tenantId);
    }
    if (filters.gatewayId) {
      where.push("gateway_id = ?");
      values.push(filters.gatewayId);
    }
    const rows = await this.database.query<GrantRow>(
      `SELECT principal_id, tenant_id, gateway_id, access,
              principal_authority_epoch, tenant_authority_epoch,
              membership_authority_epoch, gateway_authority_epoch,
              created_at, updated_at
         FROM platform_tenant_gateway_grants
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY tenant_id, gateway_id, principal_id`,
      values,
    );
    return rows.map(toGrant);
  }

  async putTenantGatewayGrant(input: TenantGatewayGrantSnapshot): Promise<boolean> {
    return this.write(async (transaction) => {
      const local = await this.localGrantAuthority(
        input.principalId,
        input.tenantId,
        transaction,
      );
      if (
        !local ||
        local.principal.status !== "active" ||
        local.tenant.status !== "active" ||
        local.membership.role !== "admin" ||
        local.tenantAuthorityEpoch !== input.tenantAuthorityEpoch ||
        local.membershipAuthorityEpoch !== input.membershipAuthorityEpoch ||
        (local.principal.kind === "service" &&
          local.principalAuthorityEpoch !== input.principalAuthorityEpoch)
      ) {
        return false;
      }
      await transaction.query(
        `INSERT INTO platform_tenant_gateway_grants
           (principal_id, tenant_id, gateway_id, access,
            principal_authority_epoch, tenant_authority_epoch,
            membership_authority_epoch, gateway_authority_epoch,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (principal_id, tenant_id, gateway_id) DO UPDATE SET
           access = excluded.access,
           principal_authority_epoch = excluded.principal_authority_epoch,
           tenant_authority_epoch = excluded.tenant_authority_epoch,
           membership_authority_epoch = excluded.membership_authority_epoch,
           gateway_authority_epoch = excluded.gateway_authority_epoch,
           updated_at = excluded.updated_at`,
        [
          input.principalId,
          input.tenantId,
          input.gatewayId,
          input.access,
          input.principalAuthorityEpoch,
          input.tenantAuthorityEpoch,
          input.membershipAuthorityEpoch,
          input.gatewayAuthorityEpoch,
          input.createdAt,
          input.updatedAt,
        ],
      );
      return true;
    });
  }

  async removeTenantGatewayGrant(
    principalId: string,
    tenantId: string,
    gatewayId: string,
  ): Promise<boolean> {
    return this.write(async (transaction) => {
      const rows = await transaction.query<{ principal_id: string }>(
        `DELETE FROM platform_tenant_gateway_grants
          WHERE principal_id = ? AND tenant_id = ? AND gateway_id = ?
        RETURNING principal_id`,
        [principalId, tenantId, gatewayId],
      );
      return rows.length === 1;
    });
  }

  async removeTenantGatewayGrantIfSnapshot(
    snapshot: TenantGatewayGrantSnapshot,
  ): Promise<boolean> {
    return this.write(async (transaction) => {
      const rows = await transaction.query<{ principal_id: string }>(
        `DELETE FROM platform_tenant_gateway_grants
          WHERE principal_id = ? AND tenant_id = ? AND gateway_id = ?
            AND principal_authority_epoch = ?
            AND tenant_authority_epoch = ?
            AND membership_authority_epoch = ?
            AND gateway_authority_epoch = ?
        RETURNING principal_id`,
        [
          snapshot.principalId,
          snapshot.tenantId,
          snapshot.gatewayId,
          snapshot.principalAuthorityEpoch,
          snapshot.tenantAuthorityEpoch,
          snapshot.membershipAuthorityEpoch,
          snapshot.gatewayAuthorityEpoch,
        ],
      );
      return rows.length === 1;
    });
  }

  async serviceForCredential(digest: string, now: string): Promise<StoredPrincipal | null> {
    const [row] = await this.database.query<PrincipalRow>(
      `SELECT principal.id, principal.kind, principal.user_id, principal.service_name,
              principal.status, principal.created_at, principal.updated_at
         FROM platform_service_credentials credential
         JOIN platform_principals principal ON principal.id = credential.principal_id
        WHERE credential.token_digest = ?
          AND credential.expires_at > ?
          AND credential.revoked_at IS NULL
          AND principal.kind = 'service'
          AND principal.status = 'active'`,
      [digest, now],
    );
    return row ? toPrincipal(row) : null;
  }
}
