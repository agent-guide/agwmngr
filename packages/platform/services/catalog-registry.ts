import type {
  CatalogAvailabilityMode,
  CatalogOfferingCategory,
  CatalogOfferingKind,
  CatalogOfferingStatus,
} from "../../contracts/platform/catalog";
import type { DatabaseSession, PlatformDatabase } from "../ports/database";

interface OfferingRow {
  offering_id: string;
  category: CatalogOfferingCategory;
  name: string;
  description: string;
  owner_principal_id: string;
  offering_kind: CatalogOfferingKind;
  source_gateway_id: string | null;
  upstream_stable_id: string | null;
  source_gateway_authority_epoch: number | null;
  status: CatalogOfferingStatus;
  version: number;
  digest: string;
  availability_mode: CatalogAvailabilityMode;
  created_at: string;
  updated_at: string;
}

interface TenantEpochRow {
  tenant_id: string;
  authority_epoch: number;
}

export interface StoredCatalogOffering {
  offeringId: string;
  category: CatalogOfferingCategory;
  name: string;
  description: string;
  ownerPrincipalId: string;
  kind: CatalogOfferingKind;
  sourceGatewayId: string | null;
  upstreamStableId: string | null;
  sourceGatewayAuthorityEpoch: number | null;
  status: CatalogOfferingStatus;
  version: number;
  digest: string;
  availabilityMode: CatalogAvailabilityMode;
  createdAt: string;
  updatedAt: string;
}

function offering(row: OfferingRow): StoredCatalogOffering {
  return {
    offeringId: row.offering_id,
    category: row.category,
    name: row.name,
    description: row.description,
    ownerPrincipalId: row.owner_principal_id,
    kind: row.offering_kind,
    sourceGatewayId: row.source_gateway_id,
    upstreamStableId: row.upstream_stable_id,
    sourceGatewayAuthorityEpoch: row.source_gateway_authority_epoch === null
      ? null
      : Number(row.source_gateway_authority_epoch),
    status: row.status,
    version: Number(row.version),
    digest: row.digest,
    availabilityMode: row.availability_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const offeringColumns = `offering_id, category, name, description, owner_principal_id,
  offering_kind, source_gateway_id, upstream_stable_id, source_gateway_authority_epoch,
  status, version, digest, availability_mode, created_at, updated_at`;
const qualifiedOfferingColumns = `offering.offering_id, offering.category, offering.name,
  offering.description, offering.owner_principal_id, offering.offering_kind,
  offering.source_gateway_id, offering.upstream_stable_id,
  offering.source_gateway_authority_epoch, offering.status, offering.version,
  offering.digest, offering.availability_mode, offering.created_at, offering.updated_at`;

export class CatalogRegistry {
  constructor(readonly database: PlatformDatabase) {}

  private async write<T>(work: (transaction: DatabaseSession) => Promise<T>): Promise<T> {
    return this.database.transaction(async (transaction) => {
      const suffix = this.database.dialect === "postgres" ? " FOR UPDATE" : "";
      await transaction.query(`SELECT id FROM platform_schema_lock WHERE id = 1${suffix}`);
      return work(transaction);
    });
  }

  async get(
    offeringId: string,
    session: DatabaseSession = this.database,
  ): Promise<StoredCatalogOffering | null> {
    const [row] = await session.query<OfferingRow>(
      `SELECT ${offeringColumns} FROM platform_catalog_offerings WHERE offering_id = ?`,
      [offeringId],
    );
    return row ? offering(row) : null;
  }

  async list(category?: CatalogOfferingCategory): Promise<StoredCatalogOffering[]> {
    const rows = await this.database.query<OfferingRow>(
      `SELECT ${offeringColumns} FROM platform_catalog_offerings
       ${category ? "WHERE category = ?" : ""}
       ORDER BY category, offering_id`,
      category ? [category] : [],
    );
    return rows.map(offering);
  }

  async tenantOfferings(
    tenantId: string,
    principalId: string,
    category?: CatalogOfferingCategory,
  ): Promise<StoredCatalogOffering[]> {
    const values: string[] = [tenantId, tenantId, principalId, tenantId];
    const categoryClause = category ? "AND offering.category = ?" : "";
    if (category) values.push(category);
    const rows = await this.database.query<OfferingRow>(
      `SELECT ${qualifiedOfferingColumns}
         FROM platform_catalog_offerings offering
        WHERE offering.status = 'active'
          AND (
            offering.availability_mode = 'all-active-tenants'
            OR EXISTS (
              SELECT 1
                FROM platform_catalog_tenant_availability availability
                JOIN platform_authority_fences fence
                  ON fence.subject_kind = 'tenant'
                 AND fence.subject_id = availability.tenant_id
                 AND fence.tenant_id = ''
                 AND fence.authority_epoch = availability.tenant_authority_epoch
               WHERE availability.offering_id = offering.offering_id
                 AND availability.tenant_id = ?
            )
          )
          AND EXISTS (
            SELECT 1 FROM platform_tenants tenant
             WHERE tenant.id = ? AND tenant.status = 'active'
          )
          AND EXISTS (
            SELECT 1 FROM platform_tenant_memberships membership
             WHERE membership.principal_id = ? AND membership.tenant_id = ?
          )
          ${categoryClause}
        ORDER BY offering.category, offering.offering_id`,
      values,
    );
    return rows.map(offering);
  }

  async availabilityTenantIds(offeringId: string): Promise<string[]> {
    const rows = await this.database.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM platform_catalog_tenant_availability
        WHERE offering_id = ? ORDER BY tenant_id`,
      [offeringId],
    );
    return rows.map((row) => row.tenant_id);
  }

  private async activeTenantEpochs(
    tenantIds: string[],
    session: DatabaseSession,
  ): Promise<Map<string, number>> {
    const epochs = new Map<string, number>();
    for (const tenantId of tenantIds) {
      const [row] = await session.query<TenantEpochRow>(
        `SELECT tenant.id AS tenant_id, fence.authority_epoch
           FROM platform_tenants tenant
           JOIN platform_authority_fences fence
             ON fence.subject_kind = 'tenant'
            AND fence.subject_id = tenant.id
            AND fence.tenant_id = ''
          WHERE tenant.id = ? AND tenant.status = 'active'`,
        [tenantId],
      );
      if (row) epochs.set(row.tenant_id, Number(row.authority_epoch));
    }
    return epochs;
  }

  async create(
    record: StoredCatalogOffering,
    tenantIds: string[],
  ): Promise<"created" | "exists" | "invalid_tenant"> {
    return this.write(async (transaction) => {
      if (await this.get(record.offeringId, transaction)) return "exists";
      const epochs = record.availabilityMode === "tenant-allowlist"
        ? await this.activeTenantEpochs(tenantIds, transaction)
        : new Map<string, number>();
      if (epochs.size !== tenantIds.length) return "invalid_tenant";
      await transaction.query(
        `INSERT INTO platform_catalog_offerings
           (offering_id, category, name, description, owner_principal_id,
            offering_kind, source_gateway_id, upstream_stable_id,
            source_gateway_authority_epoch, status, version, digest,
            availability_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.offeringId,
          record.category,
          record.name,
          record.description,
          record.ownerPrincipalId,
          record.kind,
          record.sourceGatewayId,
          record.upstreamStableId,
          record.sourceGatewayAuthorityEpoch,
          record.status,
          record.version,
          record.digest,
          record.availabilityMode,
          record.createdAt,
          record.updatedAt,
        ],
      );
      for (const tenantId of tenantIds) {
        await transaction.query(
          `INSERT INTO platform_catalog_tenant_availability
             (offering_id, tenant_id, tenant_authority_epoch, created_at)
           VALUES (?, ?, ?, ?)`,
          [record.offeringId, tenantId, epochs.get(tenantId)!, record.createdAt],
        );
      }
      return "created";
    });
  }

  async setStatus(
    offeringId: string,
    from: CatalogOfferingStatus[],
    status: CatalogOfferingStatus,
    now: string,
  ): Promise<boolean> {
    return this.write(async (transaction) => {
      const current = await this.get(offeringId, transaction);
      if (!current || !from.includes(current.status)) return false;
      await transaction.query(
        "UPDATE platform_catalog_offerings SET status = ?, updated_at = ? WHERE offering_id = ?",
        [status, now, offeringId],
      );
      return true;
    });
  }

  async setAvailability(
    offeringId: string,
    mode: CatalogAvailabilityMode,
    tenantIds: string[],
    now: string,
  ): Promise<"updated" | "not_found" | "retired" | "invalid_tenant"> {
    return this.write(async (transaction) => {
      const current = await this.get(offeringId, transaction);
      if (!current) return "not_found";
      if (current.status === "retired") return "retired";
      const epochs = mode === "tenant-allowlist"
        ? await this.activeTenantEpochs(tenantIds, transaction)
        : new Map<string, number>();
      if (epochs.size !== tenantIds.length) return "invalid_tenant";
      await transaction.query(
        "DELETE FROM platform_catalog_tenant_availability WHERE offering_id = ?",
        [offeringId],
      );
      await transaction.query(
        `UPDATE platform_catalog_offerings
            SET availability_mode = ?, updated_at = ? WHERE offering_id = ?`,
        [mode, now, offeringId],
      );
      for (const tenantId of tenantIds) {
        await transaction.query(
          `INSERT INTO platform_catalog_tenant_availability
             (offering_id, tenant_id, tenant_authority_epoch, created_at)
           VALUES (?, ?, ?, ?)`,
          [offeringId, tenantId, epochs.get(tenantId)!, now],
        );
      }
      return "updated";
    });
  }
}
