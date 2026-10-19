import type {
  AuthoredResourceKind,
  AuthoredResourceStatus,
  AuthoredRevisionStatus,
} from "../../contracts/platform/authored-resources";
import type { CatalogAvailabilityMode } from "../../contracts/platform/catalog";
import type { DatabaseSession, PlatformDatabase } from "../ports/database";

interface ResourceRow {
  id: string;
  kind: AuthoredResourceKind;
  name: string;
  description: string;
  owner_kind: "tenant" | "platform";
  tenant_id: string | null;
  tenant_authority_epoch: number | null;
  owner_principal_id: string;
  status: AuthoredResourceStatus;
  availability_mode: CatalogAvailabilityMode | null;
  created_at: string;
  updated_at: string;
  latest_revision_number: number;
}

interface RevisionRow {
  id: string;
  resource_id: string;
  number: number;
  status: AuthoredRevisionStatus;
  content_json: string;
  content_hash: string;
  created_by_principal_id: string;
  created_at: string;
}

export interface StoredAuthoredResource {
  id: string;
  kind: AuthoredResourceKind;
  name: string;
  description: string;
  ownerKind: "tenant" | "platform";
  tenantId: string | null;
  tenantAuthorityEpoch: number | null;
  ownerPrincipalId: string;
  status: AuthoredResourceStatus;
  availabilityMode: CatalogAvailabilityMode | null;
  latestRevisionNumber: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoredAuthoredRevision {
  id: string;
  resourceId: string;
  number: number;
  status: AuthoredRevisionStatus;
  contentJson: string;
  contentHash: string;
  createdByPrincipalId: string;
  createdAt: string;
}

const columns = `resource.id, resource.kind, resource.name, resource.description,
  resource.owner_kind, resource.tenant_id, resource.tenant_authority_epoch,
  resource.owner_principal_id, resource.status, resource.availability_mode,
  resource.created_at, resource.updated_at,
  COALESCE((SELECT MAX(number) FROM platform_authored_resource_revisions revision
             WHERE revision.resource_id = resource.id), 0) AS latest_revision_number`;

function toResource(row: ResourceRow): StoredAuthoredResource {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    description: row.description,
    ownerKind: row.owner_kind,
    tenantId: row.tenant_id,
    tenantAuthorityEpoch: row.tenant_authority_epoch === null ? null : Number(row.tenant_authority_epoch),
    ownerPrincipalId: row.owner_principal_id,
    status: row.status,
    availabilityMode: row.availability_mode,
    latestRevisionNumber: Number(row.latest_revision_number),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRevision(row: RevisionRow): StoredAuthoredRevision {
  return {
    id: row.id,
    resourceId: row.resource_id,
    number: Number(row.number),
    status: row.status,
    contentJson: row.content_json,
    contentHash: row.content_hash,
    createdByPrincipalId: row.created_by_principal_id,
    createdAt: row.created_at,
  };
}

export class AuthoredResourceRegistry {
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
      `SELECT fence.authority_epoch
         FROM platform_tenants tenant
         JOIN platform_authority_fences fence
           ON fence.subject_kind = 'tenant' AND fence.subject_id = tenant.id AND fence.tenant_id = ''
        WHERE tenant.id = ? AND tenant.status = 'active'`,
      [tenantId],
    );
    return row ? Number(row.authority_epoch) : null;
  }

  async create(
    resource: StoredAuthoredResource,
    revision: StoredAuthoredRevision,
    availabilityTenantIds: string[] = [],
  ): Promise<"created" | "exists" | "invalid_tenant"> {
    return this.write(async (tx) => {
      const [existing] = await tx.query<{ id: string }>(
        "SELECT id FROM platform_authored_resources WHERE id = ?",
        [resource.id],
      );
      if (existing) return "exists";
      const tenantEpoch = resource.ownerKind === "tenant"
        ? await this.activeTenantEpoch(resource.tenantId!, tx)
        : null;
      if (resource.ownerKind === "tenant" && tenantEpoch === null) return "invalid_tenant";
      const availabilityEpochs = new Map<string, number>();
      for (const tenantId of availabilityTenantIds) {
        const epoch = await this.activeTenantEpoch(tenantId, tx);
        if (epoch === null) return "invalid_tenant";
        availabilityEpochs.set(tenantId, epoch);
      }
      await tx.query(
        `INSERT INTO platform_authored_resources
           (id, kind, name, description, owner_kind, tenant_id, tenant_authority_epoch,
            owner_principal_id, status, availability_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [resource.id, resource.kind, resource.name, resource.description, resource.ownerKind,
          resource.tenantId, tenantEpoch, resource.ownerPrincipalId, resource.status,
          resource.availabilityMode, resource.createdAt, resource.updatedAt],
      );
      await tx.query(
        `INSERT INTO platform_authored_resource_revisions
           (id, resource_id, number, status, content_json, content_hash,
            created_by_principal_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [revision.id, revision.resourceId, revision.number, revision.status, revision.contentJson,
          revision.contentHash, revision.createdByPrincipalId, revision.createdAt],
      );
      for (const tenantId of availabilityTenantIds) {
        await tx.query(
          `INSERT INTO platform_authored_resource_availability
             (resource_id, tenant_id, tenant_authority_epoch, created_at)
           VALUES (?, ?, ?, ?)`,
          [resource.id, tenantId, availabilityEpochs.get(tenantId)!, resource.createdAt],
        );
      }
      return "created";
    });
  }

  async listForTenant(tenantId: string, kind: AuthoredResourceKind): Promise<StoredAuthoredResource[]> {
    const rows = await this.database.query<ResourceRow>(
      `SELECT ${columns}
         FROM platform_authored_resources resource
        WHERE resource.kind = ? AND resource.status = 'active'
          AND (
            (resource.owner_kind = 'tenant' AND resource.tenant_id = ? AND EXISTS (
              SELECT 1 FROM platform_authority_fences fence
               WHERE fence.subject_kind = 'tenant' AND fence.subject_id = ? AND fence.tenant_id = ''
                 AND fence.authority_epoch = resource.tenant_authority_epoch
            ))
            OR
            (resource.owner_kind = 'platform' AND (
              resource.availability_mode = 'all-active-tenants' OR EXISTS (
                SELECT 1 FROM platform_authored_resource_availability availability
                JOIN platform_authority_fences fence
                  ON fence.subject_kind = 'tenant' AND fence.subject_id = availability.tenant_id
                 AND fence.tenant_id = '' AND fence.authority_epoch = availability.tenant_authority_epoch
                WHERE availability.resource_id = resource.id AND availability.tenant_id = ?
              )
            ))
          )
        ORDER BY resource.owner_kind DESC, resource.name, resource.id`,
      [kind, tenantId, tenantId, tenantId],
    );
    return rows.map(toResource);
  }

  async listPlatform(kind: AuthoredResourceKind): Promise<StoredAuthoredResource[]> {
    return (await this.database.query<ResourceRow>(
      `SELECT ${columns} FROM platform_authored_resources resource
        WHERE resource.kind = ? AND resource.owner_kind = 'platform'
        ORDER BY resource.name, resource.id`,
      [kind],
    )).map(toResource);
  }

  async get(id: string, session: DatabaseSession = this.database): Promise<StoredAuthoredResource | null> {
    const [row] = await session.query<ResourceRow>(
      `SELECT ${columns} FROM platform_authored_resources resource WHERE resource.id = ?`,
      [id],
    );
    return row ? toResource(row) : null;
  }

  async revisions(resourceId: string): Promise<StoredAuthoredRevision[]> {
    return (await this.database.query<RevisionRow>(
      `SELECT id, resource_id, number, status, content_json, content_hash,
              created_by_principal_id, created_at
         FROM platform_authored_resource_revisions WHERE resource_id = ? ORDER BY number DESC`,
      [resourceId],
    )).map(toRevision);
  }

  async availabilityTenantIds(resourceId: string): Promise<string[]> {
    return (await this.database.query<{ tenant_id: string }>(
      "SELECT tenant_id FROM platform_authored_resource_availability WHERE resource_id = ? ORDER BY tenant_id",
      [resourceId],
    )).map((row) => row.tenant_id);
  }

  async updateMetadata(
    id: string,
    name: string,
    description: string,
    now: string,
  ): Promise<"updated" | "missing" | "archived"> {
    return this.write(async (tx) => {
      const current = await this.get(id, tx);
      if (!current) return "missing";
      if (current.status === "archived") return "archived";
      await tx.query(
        "UPDATE platform_authored_resources SET name = ?, description = ?, updated_at = ? WHERE id = ?",
        [name, description, now, id],
      );
      return "updated";
    });
  }

  async addRevision(resourceId: string, revision: StoredAuthoredRevision): Promise<"created" | "missing" | "archived"> {
    return this.write(async (tx) => {
      const current = await this.get(resourceId, tx);
      if (!current) return "missing";
      if (current.status === "archived") return "archived";
      const [number] = await tx.query<{ n: number }>(
        "SELECT COALESCE(MAX(number), 0) + 1 AS n FROM platform_authored_resource_revisions WHERE resource_id = ?",
        [resourceId],
      );
      await tx.query(
        `INSERT INTO platform_authored_resource_revisions
           (id, resource_id, number, status, content_json, content_hash,
            created_by_principal_id, created_at) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)`,
        [revision.id, resourceId, Number(number.n), revision.contentJson, revision.contentHash,
          revision.createdByPrincipalId, revision.createdAt],
      );
      await tx.query("UPDATE platform_authored_resources SET updated_at = ? WHERE id = ?", [revision.createdAt, resourceId]);
      return "created";
    });
  }

  async setRevisionStatus(
    resourceId: string,
    revisionId: string,
    status: "published" | "archived",
  ): Promise<"updated" | "missing" | "resource_archived" | "revision_archived" | "referenced"> {
    return this.write(async (tx) => {
      const resource = await this.get(resourceId, tx);
      if (!resource) return "missing";
      if (resource.status === "archived") return "resource_archived";
      const [revision] = await tx.query<{ status: AuthoredRevisionStatus }>(
        "SELECT status FROM platform_authored_resource_revisions WHERE id = ? AND resource_id = ?",
        [revisionId, resourceId],
      );
      if (!revision) return "missing";
      if (revision.status === status) return "updated";
      if (revision.status === "archived") return "revision_archived";
      if (status === "archived") {
        const [reference] = await tx.query<{ source_id: string }>(
          "SELECT source_id FROM platform_authored_revision_refs WHERE revision_id = ? LIMIT 1",
          [revisionId],
        );
        if (reference) return "referenced";
      }
      await tx.query(
        "UPDATE platform_authored_resource_revisions SET status = ? WHERE id = ?",
        [status, revisionId],
      );
      return "updated";
    });
  }

  async remove(id: string, archiveShared: boolean, now: string): Promise<"deleted" | "archived" | "missing" | "referenced"> {
    return this.write(async (tx) => {
      const current = await this.get(id, tx);
      if (!current) return "missing";
      const [reference] = await tx.query<{ source_id: string }>(
        `SELECT reference.source_id FROM platform_authored_revision_refs reference
          JOIN platform_authored_resource_revisions revision ON revision.id = reference.revision_id
         WHERE revision.resource_id = ? LIMIT 1`,
        [id],
      );
      if (reference) return "referenced";
      if (archiveShared || current.ownerKind === "platform") {
        await tx.query(
          "UPDATE platform_authored_resources SET status = 'archived', updated_at = ? WHERE id = ?",
          [now, id],
        );
        return "archived";
      }
      await tx.query("DELETE FROM platform_authored_resources WHERE id = ?", [id]);
      return "deleted";
    });
  }

  async setAvailability(
    resourceId: string,
    mode: CatalogAvailabilityMode,
    tenantIds: string[],
    now: string,
  ): Promise<"updated" | "missing" | "archived" | "invalid_tenant"> {
    return this.write(async (tx) => {
      const current = await this.get(resourceId, tx);
      if (!current || current.ownerKind !== "platform") return "missing";
      if (current.status === "archived") return "archived";
      const epochs = new Map<string, number>();
      for (const tenantId of tenantIds) {
        const epoch = await this.activeTenantEpoch(tenantId, tx);
        if (epoch === null) return "invalid_tenant";
        epochs.set(tenantId, epoch);
      }
      await tx.query("DELETE FROM platform_authored_resource_availability WHERE resource_id = ?", [resourceId]);
      await tx.query(
        "UPDATE platform_authored_resources SET availability_mode = ?, updated_at = ? WHERE id = ?",
        [mode, now, resourceId],
      );
      for (const tenantId of tenantIds) {
        await tx.query(
          `INSERT INTO platform_authored_resource_availability
             (resource_id, tenant_id, tenant_authority_epoch, created_at) VALUES (?, ?, ?, ?)`,
          [resourceId, tenantId, epochs.get(tenantId)!, now],
        );
      }
      return "updated";
    });
  }
}
