import type {
  PrincipalStatus,
  Tenant,
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
    await this.write((transaction) =>
      transaction.query(
        `INSERT INTO platform_tenants (id, name, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [tenant.id, tenant.name, tenant.status, tenant.createdAt, tenant.updatedAt],
      ),
    );
  }

  async setTenantStatus(id: string, status: Tenant["status"], now: string): Promise<void> {
    await this.write((transaction) =>
      transaction.query(
        "UPDATE platform_tenants SET status = ?, updated_at = ? WHERE id = ?",
        [status, now, id],
      ),
    );
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
      const rows = await transaction.query<{ principal_id: string }>(
        `UPDATE platform_tenant_memberships
            SET role = ?, updated_at = ?
          WHERE principal_id = ? AND tenant_id = ?
        RETURNING principal_id`,
        [role, now, principalId, tenantId],
      );
      return rows.length === 1;
    });
  }

  async removeMembership(principalId: string, tenantId: string): Promise<void> {
    await this.write((transaction) =>
      transaction.query(
        "DELETE FROM platform_tenant_memberships WHERE principal_id = ? AND tenant_id = ?",
        [principalId, tenantId],
      ),
    );
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
    });
  }

  async disableService(id: string, now: string): Promise<void> {
    await this.write(async (transaction) => {
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
