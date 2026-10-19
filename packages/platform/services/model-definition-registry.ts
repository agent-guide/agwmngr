import type { DatabaseSession, PlatformDatabase } from "../ports/database";

interface ModelRow {
  id: string;
  tenant_id: string;
  tenant_authority_epoch: number;
  status: "active" | "archived";
  current_version: number;
  created_by_principal_id: string;
  created_at: string;
  updated_at: string;
  name: string;
  description: string;
  offering_id: string;
  offering_version: number;
  offering_digest: string;
  digest: string;
}

export interface StoredModelDefinition {
  id: string;
  tenantId: string;
  tenantAuthorityEpoch: number;
  status: "active" | "archived";
  version: number;
  createdByPrincipalId: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  description: string;
  offeringId: string;
  offeringVersion: number;
  offeringDigest: string;
  digest: string;
}

const columns = `definition.id, definition.tenant_id, definition.tenant_authority_epoch,
  definition.status, definition.current_version, definition.created_by_principal_id,
  definition.created_at, definition.updated_at, version.name, version.description,
  version.offering_id, version.offering_version, version.offering_digest, version.digest`;

function toDefinition(row: ModelRow): StoredModelDefinition {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantAuthorityEpoch: Number(row.tenant_authority_epoch),
    status: row.status,
    version: Number(row.current_version),
    createdByPrincipalId: row.created_by_principal_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    name: row.name,
    description: row.description,
    offeringId: row.offering_id,
    offeringVersion: Number(row.offering_version),
    offeringDigest: row.offering_digest,
    digest: row.digest,
  };
}

export class ModelDefinitionRegistry {
  constructor(readonly database: PlatformDatabase) {}

  private async write<T>(work: (transaction: DatabaseSession) => Promise<T>): Promise<T> {
    return this.database.transaction(async (transaction) => {
      const suffix = this.database.dialect === "postgres" ? " FOR UPDATE" : "";
      await transaction.query(`SELECT id FROM platform_schema_lock WHERE id = 1${suffix}`);
      return work(transaction);
    });
  }

  private async activeTenantEpoch(tenantId: string, tx: DatabaseSession): Promise<number | null> {
    const [row] = await tx.query<{ authority_epoch: number }>(
      `SELECT fence.authority_epoch FROM platform_tenants tenant
        JOIN platform_authority_fences fence
          ON fence.subject_kind = 'tenant' AND fence.subject_id = tenant.id AND fence.tenant_id = ''
       WHERE tenant.id = ? AND tenant.status = 'active'`, [tenantId],
    );
    return row ? Number(row.authority_epoch) : null;
  }

  async get(id: string, session: DatabaseSession = this.database): Promise<StoredModelDefinition | null> {
    const [row] = await session.query<ModelRow>(
      `SELECT ${columns} FROM platform_tenant_model_definitions definition
        JOIN platform_tenant_model_definition_versions version
          ON version.definition_id = definition.id AND version.version = definition.current_version
       WHERE definition.id = ?`, [id],
    );
    return row ? toDefinition(row) : null;
  }

  async list(tenantId: string): Promise<StoredModelDefinition[]> {
    return (await this.database.query<ModelRow>(
      `SELECT ${columns} FROM platform_tenant_model_definitions definition
        JOIN platform_tenant_model_definition_versions version
          ON version.definition_id = definition.id AND version.version = definition.current_version
       WHERE definition.tenant_id = ? AND EXISTS (
          SELECT 1 FROM platform_authority_fences fence
           WHERE fence.subject_kind = 'tenant' AND fence.subject_id = ? AND fence.tenant_id = ''
             AND fence.authority_epoch = definition.tenant_authority_epoch
       ) ORDER BY version.name, definition.id`, [tenantId, tenantId],
    )).map(toDefinition);
  }

  async create(record: StoredModelDefinition): Promise<"created" | "exists" | "invalid_tenant"> {
    return this.write(async (tx) => {
      if (await this.get(record.id, tx)) return "exists";
      const epoch = await this.activeTenantEpoch(record.tenantId, tx);
      if (epoch === null) return "invalid_tenant";
      await tx.query(
        `INSERT INTO platform_tenant_model_definitions
          (id, tenant_id, tenant_authority_epoch, status, current_version,
           created_by_principal_id, created_at, updated_at)
         VALUES (?, ?, ?, 'active', 1, ?, ?, ?)`,
        [record.id, record.tenantId, epoch, record.createdByPrincipalId, record.createdAt, record.updatedAt],
      );
      await tx.query(
        `INSERT INTO platform_tenant_model_definition_versions
          (definition_id, version, name, description, offering_id, offering_version,
           offering_digest, digest, created_by_principal_id, created_at)
         VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [record.id, record.name, record.description, record.offeringId, record.offeringVersion,
          record.offeringDigest, record.digest, record.createdByPrincipalId, record.createdAt],
      );
      return "created";
    });
  }

  async update(
    id: string,
    input: Omit<StoredModelDefinition, "id" | "tenantId" | "tenantAuthorityEpoch" | "status" | "createdAt" | "updatedAt">,
    now: string,
  ): Promise<"updated" | "missing" | "archived"> {
    return this.write(async (tx) => {
      const current = await this.get(id, tx);
      if (!current) return "missing";
      if (current.status === "archived") return "archived";
      if (input.version !== current.version + 1) return "missing";
      await tx.query(
        `INSERT INTO platform_tenant_model_definition_versions
          (definition_id, version, name, description, offering_id, offering_version,
           offering_digest, digest, created_by_principal_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, input.version, input.name, input.description, input.offeringId, input.offeringVersion,
          input.offeringDigest, input.digest, input.createdByPrincipalId, now],
      );
      await tx.query(
        "UPDATE platform_tenant_model_definitions SET current_version = ?, updated_at = ? WHERE id = ?",
        [input.version, now, id],
      );
      return "updated";
    });
  }

  async archive(id: string, now: string): Promise<"archived" | "missing" | "referenced"> {
    return this.write(async (tx) => {
      const current = await this.get(id, tx);
      if (!current) return "missing";
      const [reference] = await tx.query<{ source_id: string }>(
        "SELECT source_id FROM platform_tenant_model_definition_refs WHERE definition_id = ? LIMIT 1", [id],
      );
      if (reference) return "referenced";
      await tx.query(
        "UPDATE platform_tenant_model_definitions SET status = 'archived', updated_at = ? WHERE id = ?",
        [now, id],
      );
      return "archived";
    });
  }
}
