import type {
  AgentDefinitionDependency,
  AgentDefinitionDraft,
} from "../../contracts/platform/agents";
import type { DatabaseSession, PlatformDatabase } from "../ports/database";

interface DefinitionRow {
  id: string;
  slug: string;
  tenant_id: string;
  tenant_authority_epoch: number;
  status: "active" | "archived";
  version: number;
  draft_json: string;
  draft_digest: string;
  dependencies_json: string;
  created_by_principal_id: string;
  updated_by_principal_id: string;
  created_at: string;
  updated_at: string;
}

export interface StoredAgentDefinition {
  id: string;
  slug: string;
  tenantId: string;
  tenantAuthorityEpoch: number;
  status: "active" | "archived";
  version: number;
  draft: AgentDefinitionDraft;
  draftDigest: string;
  dependencies: AgentDefinitionDependency[];
  createdByPrincipalId: string;
  updatedByPrincipalId: string;
  createdAt: string;
  updatedAt: string;
}

export type SaveDefinitionResult =
  | { status: "saved"; item: StoredAgentDefinition }
  | { status: "exists" | "missing" | "stale" | "archived" | "invalid_tenant" | "invalid_dependency" };

const columns = `id, slug, tenant_id, tenant_authority_epoch, status, version,
  draft_json, draft_digest, dependencies_json, created_by_principal_id,
  updated_by_principal_id, created_at, updated_at`;

function toDefinition(row: DefinitionRow): StoredAgentDefinition {
  return {
    id: row.id,
    slug: row.slug,
    tenantId: row.tenant_id,
    tenantAuthorityEpoch: Number(row.tenant_authority_epoch),
    status: row.status,
    version: Number(row.version),
    draft: JSON.parse(row.draft_json) as AgentDefinitionDraft,
    draftDigest: row.draft_digest,
    dependencies: JSON.parse(row.dependencies_json) as AgentDefinitionDependency[],
    createdByPrincipalId: row.created_by_principal_id,
    updatedByPrincipalId: row.updated_by_principal_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AgentDefinitionRegistry {
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
       WHERE tenant.id = ? AND tenant.status = 'active'`,
      [tenantId],
    );
    return row ? Number(row.authority_epoch) : null;
  }

  async get(id: string, session: DatabaseSession = this.database): Promise<StoredAgentDefinition | null> {
    const [row] = await session.query<DefinitionRow>(
      `SELECT ${columns} FROM platform_agent_definitions WHERE id = ?`,
      [id],
    );
    return row ? toDefinition(row) : null;
  }

  async list(tenantId: string): Promise<StoredAgentDefinition[]> {
    return (await this.database.query<DefinitionRow>(
      `SELECT ${columns} FROM platform_agent_definitions definition
        WHERE definition.tenant_id = ? AND EXISTS (
          SELECT 1 FROM platform_authority_fences fence
           WHERE fence.subject_kind = 'tenant' AND fence.subject_id = ? AND fence.tenant_id = ''
             AND fence.authority_epoch = definition.tenant_authority_epoch
        ) ORDER BY definition.updated_at DESC, definition.id`,
      [tenantId, tenantId],
    )).map(toDefinition);
  }

  private async validDependency(
    tenantId: string,
    dependency: AgentDefinitionDependency,
    tx: DatabaseSession,
  ): Promise<boolean> {
    if (dependency.kind === "model_definition") {
      const [row] = await tx.query<{ digest: string; offering_id: string; offering_version: number; offering_digest: string }>(
        `SELECT version.digest, version.offering_id, version.offering_version, version.offering_digest
           FROM platform_tenant_model_definitions definition
           JOIN platform_tenant_model_definition_versions version
             ON version.definition_id = definition.id AND version.version = ?
           JOIN platform_authority_fences fence
             ON fence.subject_kind = 'tenant' AND fence.subject_id = definition.tenant_id
            AND fence.tenant_id = '' AND fence.authority_epoch = definition.tenant_authority_epoch
          WHERE definition.id = ? AND definition.tenant_id = ? AND definition.status = 'active'
            AND definition.current_version = ?`,
        [dependency.definitionVersion, dependency.definitionId, tenantId, dependency.definitionVersion],
      );
      return Boolean(row && row.digest === dependency.definitionDigest &&
        row.offering_id === dependency.offeringId &&
        Number(row.offering_version) === dependency.offeringVersion &&
        row.offering_digest === dependency.offeringDigest);
    }
    if (dependency.kind === "tool_definition") {
      const [row] = await tx.query<{ digest: string; offering_id: string; offering_version: number; offering_digest: string }>(
        `SELECT version.digest, version.offering_id, version.offering_version, version.offering_digest
           FROM platform_tenant_tool_definitions definition
           JOIN platform_tenant_tool_definition_versions version
             ON version.definition_id = definition.id AND version.version = ?
           JOIN platform_authority_fences fence
             ON fence.subject_kind = 'tenant' AND fence.subject_id = definition.tenant_id
            AND fence.tenant_id = '' AND fence.authority_epoch = definition.tenant_authority_epoch
          WHERE definition.id = ? AND definition.tenant_id = ? AND definition.status = 'active'
            AND definition.current_version = ?`,
        [dependency.definitionVersion, dependency.definitionId, tenantId, dependency.definitionVersion],
      );
      return Boolean(row && row.digest === dependency.definitionDigest &&
        row.offering_id === dependency.offeringId &&
        Number(row.offering_version) === dependency.offeringVersion &&
        row.offering_digest === dependency.offeringDigest);
    }
    if (dependency.kind === "skill_revision" || dependency.kind === "instruction_revision") {
      const [row] = await tx.query<{
        resource_id: string;
        kind: string;
        number: number;
        status: string;
        content_hash: string;
      }>(
        `SELECT resource.id AS resource_id, resource.kind, revision.number,
                revision.status, revision.content_hash
           FROM platform_authored_resource_revisions revision
           JOIN platform_authored_resources resource ON resource.id = revision.resource_id
          WHERE revision.id = ? AND resource.id = ? AND resource.status = 'active'
            AND revision.status <> 'archived' AND (
              (resource.owner_kind = 'tenant' AND resource.tenant_id = ? AND EXISTS (
                SELECT 1 FROM platform_authority_fences fence
                 WHERE fence.subject_kind = 'tenant' AND fence.subject_id = ? AND fence.tenant_id = ''
                   AND fence.authority_epoch = resource.tenant_authority_epoch
              )) OR (resource.owner_kind = 'platform' AND (
                resource.availability_mode = 'all-active-tenants' OR EXISTS (
                  SELECT 1 FROM platform_authored_resource_availability availability
                  JOIN platform_authority_fences fence
                    ON fence.subject_kind = 'tenant' AND fence.subject_id = availability.tenant_id
                   AND fence.tenant_id = '' AND fence.authority_epoch = availability.tenant_authority_epoch
                 WHERE availability.resource_id = resource.id AND availability.tenant_id = ?
                )
              ))
            )`,
        [dependency.revisionId, dependency.resourceId, tenantId, tenantId, tenantId],
      );
      return Boolean(row && row.kind === dependency.kind.replace("_revision", "") &&
        Number(row.number) === dependency.revisionNumber && row.content_hash === dependency.contentHash);
    }
    const [row] = await tx.query<{ updated_at: string }>(
      `SELECT knowledge.updated_at FROM platform_knowledge_bases knowledge
        JOIN platform_authority_fences fence
          ON fence.subject_kind = 'tenant' AND fence.subject_id = knowledge.tenant_id
         AND fence.tenant_id = '' AND fence.authority_epoch = knowledge.tenant_authority_epoch
       WHERE knowledge.id = ? AND knowledge.tenant_id = ? AND knowledge.status = 'active'`,
      [dependency.knowledgeBaseId, tenantId],
    );
    return Boolean(row && row.updated_at === dependency.updatedAt);
  }

  private async replaceReferences(
    definitionId: string,
    dependencies: AgentDefinitionDependency[],
    now: string,
    tx: DatabaseSession,
  ): Promise<void> {
    await tx.query("DELETE FROM platform_authored_revision_refs WHERE source_kind = 'agent_definition' AND source_id = ?", [definitionId]);
    await tx.query("DELETE FROM platform_knowledge_base_refs WHERE source_kind = 'agent_definition' AND source_id = ?", [definitionId]);
    await tx.query("DELETE FROM platform_tenant_model_definition_refs WHERE source_kind = 'agent_definition' AND source_id = ?", [definitionId]);
    await tx.query("DELETE FROM platform_tenant_tool_definition_refs WHERE source_kind = 'agent_definition' AND source_id = ?", [definitionId]);
    for (const dependency of dependencies) {
      if (dependency.kind === "model_definition") {
        await tx.query(
          `INSERT INTO platform_tenant_model_definition_refs
            (source_kind, source_id, definition_id, definition_version, created_at)
           VALUES ('agent_definition', ?, ?, ?, ?)`,
          [definitionId, dependency.definitionId, dependency.definitionVersion, now],
        );
      } else if (dependency.kind === "tool_definition") {
        await tx.query(
          `INSERT INTO platform_tenant_tool_definition_refs
            (source_kind, source_id, definition_id, definition_version, created_at)
           VALUES ('agent_definition', ?, ?, ?, ?)`,
          [definitionId, dependency.definitionId, dependency.definitionVersion, now],
        );
      } else if (dependency.kind === "skill_revision" || dependency.kind === "instruction_revision") {
        await tx.query(
          `INSERT INTO platform_authored_revision_refs
            (source_kind, source_id, revision_id, created_at)
           VALUES ('agent_definition', ?, ?, ?)`,
          [definitionId, dependency.revisionId, now],
        );
      } else {
        await tx.query(
          `INSERT INTO platform_knowledge_base_refs
            (source_kind, source_id, knowledge_base_id, created_at)
           VALUES ('agent_definition', ?, ?, ?)`,
          [definitionId, dependency.knowledgeBaseId, now],
        );
      }
    }
  }

  async save(input: {
    id: string;
    slug: string;
    tenantId: string;
    expectedVersion: number;
    draft: AgentDefinitionDraft;
    draftDigest: string;
    dependencies: AgentDefinitionDependency[];
    principalId: string;
    now: string;
  }): Promise<SaveDefinitionResult> {
    return this.write(async (tx) => {
      const tenantEpoch = await this.activeTenantEpoch(input.tenantId, tx);
      if (tenantEpoch === null) return { status: "invalid_tenant" };
      const current = await this.get(input.id, tx);
      if (input.expectedVersion === 0) {
        if (current) return { status: "exists" };
      } else {
        if (!current || current.tenantId !== input.tenantId) return { status: "missing" };
        if (current.status !== "active") return { status: "archived" };
        if (current.version !== input.expectedVersion) return { status: "stale" };
      }
      for (const dependency of input.dependencies) {
        if (!await this.validDependency(input.tenantId, dependency, tx)) {
          return { status: "invalid_dependency" };
        }
      }
      const version = input.expectedVersion + 1;
      if (current) {
        await tx.query(
          `UPDATE platform_agent_definitions
              SET version = ?, draft_json = ?, draft_digest = ?, dependencies_json = ?,
                  updated_by_principal_id = ?, updated_at = ? WHERE id = ?`,
          [version, JSON.stringify(input.draft), input.draftDigest, JSON.stringify(input.dependencies),
            input.principalId, input.now, input.id],
        );
      } else {
        await tx.query(
          `INSERT INTO platform_agent_definitions
            (id, slug, tenant_id, tenant_authority_epoch, status, version, draft_json,
             draft_digest, dependencies_json, created_by_principal_id,
             updated_by_principal_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', 1, ?, ?, ?, ?, ?, ?, ?)`,
          [input.id, input.slug, input.tenantId, tenantEpoch, JSON.stringify(input.draft),
            input.draftDigest, JSON.stringify(input.dependencies), input.principalId,
            input.principalId, input.now, input.now],
        );
      }
      await this.replaceReferences(input.id, input.dependencies, input.now, tx);
      return { status: "saved", item: (await this.get(input.id, tx))! };
    });
  }

  async archive(id: string, tenantId: string, now: string): Promise<"archived" | "missing"> {
    return this.write(async (tx) => {
      const current = await this.get(id, tx);
      if (!current || current.tenantId !== tenantId) return "missing";
      await this.replaceReferences(id, [], now, tx);
      await tx.query(
        "UPDATE platform_agent_definitions SET status = 'archived', updated_at = ? WHERE id = ?",
        [now, id],
      );
      return "archived";
    });
  }
}
