import type {
  AgentDefinitionDependency,
  AgentDefinitionDraft,
  AgentRelease,
} from "../../contracts/platform/agents";
import type { CatalogOfferingKind } from "../../contracts/platform/catalog";
import type { AuthoredResourceContent } from "../../contracts/platform/authored-resources";
import type { DatabaseSession, PlatformDatabase } from "../ports/database";
import { AgentDefinitionRegistry } from "./agent-definition-registry";

export type InternalAgentReleaseDependency =
  | {
      kind: "model_definition";
      definitionId: string;
      definitionVersion: number;
      definitionDigest: string;
      offeringId: string;
      offeringVersion: number;
      offeringDigest: string;
      offeringKind: CatalogOfferingKind;
      sourceGatewayId: string | null;
      upstreamStableId: string | null;
      sourceGatewayAuthorityEpoch: number | null;
    }
  | {
      kind: "tool_definition";
      definitionId: string;
      definitionVersion: number;
      definitionDigest: string;
      offeringId: string;
      offeringVersion: number;
      offeringDigest: string;
      offeringKind: CatalogOfferingKind;
      sourceGatewayId: string | null;
      upstreamStableId: string | null;
      sourceGatewayAuthorityEpoch: number | null;
    }
  | {
      kind: "skill_revision";
      resourceId: string;
      revisionId: string;
      revisionNumber: number;
      contentHash: string;
      name: string;
      description: string;
      content: AuthoredResourceContent;
    }
  | {
      kind: "instruction_revision";
      resourceId: string;
      revisionId: string;
      revisionNumber: number;
      contentHash: string;
      name: string;
      description: string;
      content: AuthoredResourceContent;
    };

export interface BuiltinReleaseExecution {
  type: "builtin";
  model: Extract<InternalAgentReleaseDependency, { kind: "model_definition" }>;
  tools: Array<Extract<InternalAgentReleaseDependency, { kind: "tool_definition" }>>;
  skills: Array<Extract<InternalAgentReleaseDependency, { kind: "skill_revision" }>>;
  systemPrompt: string;
  advanced: Extract<AgentDefinitionDraft["runtime"], { type: "builtin" }>["advanced"];
  policy: AgentDefinitionDraft["policy"];
}

export interface StoredAgentRelease extends AgentRelease {
  internalDependencies: InternalAgentReleaseDependency[];
  execution: BuiltinReleaseExecution;
}

interface ReleaseRow {
  id: string;
  definition_id: string;
  tenant_id: string;
  tenant_authority_epoch: number;
  number: number;
  draft_version: number;
  snapshot_json: string;
  dependencies_json: string;
  internal_dependencies_json: string;
  execution_json: string;
  runtime_type: "builtin";
  digest: string;
  created_by_principal_id: string;
  created_at: string;
}

const releaseColumns = `id, definition_id, tenant_id, tenant_authority_epoch,
  number, draft_version, snapshot_json, dependencies_json,
  internal_dependencies_json, execution_json, runtime_type, digest,
  created_by_principal_id, created_at`;

function toRelease(row: ReleaseRow): StoredAgentRelease {
  return {
    id: row.id,
    definitionId: row.definition_id,
    tenantId: row.tenant_id,
    number: Number(row.number),
    draftVersion: Number(row.draft_version),
    snapshot: JSON.parse(row.snapshot_json) as AgentDefinitionDraft,
    dependencies: JSON.parse(row.dependencies_json) as AgentDefinitionDependency[],
    internalDependencies: JSON.parse(row.internal_dependencies_json) as InternalAgentReleaseDependency[],
    execution: JSON.parse(row.execution_json) as BuiltinReleaseExecution,
    runtimeType: row.runtime_type,
    digest: row.digest,
    createdByPrincipalId: row.created_by_principal_id,
    createdAt: row.created_at,
  };
}

export type CreateReleaseResult =
  | { status: "created"; item: StoredAgentRelease }
  | { status: "missing" | "stale" | "archived" | "exists" | "invalid_tenant" | "invalid_dependency" };

export class AgentReleaseRegistry {
  private readonly definitions: AgentDefinitionRegistry;

  constructor(readonly database: PlatformDatabase) {
    this.definitions = new AgentDefinitionRegistry(database);
  }

  private async write<T>(work: (transaction: DatabaseSession) => Promise<T>): Promise<T> {
    return this.database.transaction(async (transaction) => {
      const suffix = this.database.dialect === "postgres" ? " FOR UPDATE" : "";
      await transaction.query(`SELECT id FROM platform_schema_lock WHERE id = 1${suffix}`);
      return work(transaction);
    });
  }

  async get(id: string, session: DatabaseSession = this.database): Promise<StoredAgentRelease | null> {
    const [row] = await session.query<ReleaseRow>(
      `SELECT ${releaseColumns} FROM platform_agent_releases WHERE id = ?`,
      [id],
    );
    return row ? toRelease(row) : null;
  }

  async list(definitionId: string, tenantId: string): Promise<StoredAgentRelease[]> {
    return (await this.database.query<ReleaseRow>(
      `SELECT ${releaseColumns} FROM platform_agent_releases release_row
        WHERE release_row.definition_id = ? AND release_row.tenant_id = ? AND EXISTS (
          SELECT 1 FROM platform_authority_fences fence
           WHERE fence.subject_kind = 'tenant' AND fence.subject_id = release_row.tenant_id
             AND fence.tenant_id = '' AND fence.authority_epoch = release_row.tenant_authority_epoch
        ) ORDER BY release_row.number DESC`,
      [definitionId, tenantId],
    )).map(toRelease);
  }

  private async validInternalDependency(
    tenantId: string,
    dependency: InternalAgentReleaseDependency,
    tx: DatabaseSession,
  ): Promise<boolean> {
    if (dependency.kind === "model_definition" || dependency.kind === "tool_definition") {
      const prefix = dependency.kind === "model_definition" ? "model" : "tool";
      const [row] = await tx.query<{
        definition_digest: string;
        offering_id: string;
        offering_version: number;
        offering_digest: string;
        offering_kind: CatalogOfferingKind;
        source_gateway_id: string | null;
        upstream_stable_id: string | null;
        source_gateway_authority_epoch: number | null;
      }>(
        `SELECT version.digest AS definition_digest, version.offering_id,
                version.offering_version, version.offering_digest,
                offering.offering_kind, offering.source_gateway_id,
                offering.upstream_stable_id, offering.source_gateway_authority_epoch
           FROM platform_tenant_${prefix}_definitions definition
           JOIN platform_tenant_${prefix}_definition_versions version
             ON version.definition_id = definition.id AND version.version = ?
           JOIN platform_catalog_offerings offering
             ON offering.offering_id = version.offering_id
           JOIN platform_authority_fences fence
             ON fence.subject_kind = 'tenant' AND fence.subject_id = definition.tenant_id
            AND fence.tenant_id = '' AND fence.authority_epoch = definition.tenant_authority_epoch
          WHERE definition.id = ? AND definition.tenant_id = ? AND definition.status = 'active'
            AND definition.current_version = ? AND offering.status = 'active'
            AND offering.version = ? AND offering.digest = ?
            AND (offering.availability_mode = 'all-active-tenants' OR EXISTS (
              SELECT 1 FROM platform_catalog_tenant_availability availability
              JOIN platform_authority_fences availability_fence
                ON availability_fence.subject_kind = 'tenant'
               AND availability_fence.subject_id = availability.tenant_id
               AND availability_fence.tenant_id = ''
               AND availability_fence.authority_epoch = availability.tenant_authority_epoch
             WHERE availability.offering_id = offering.offering_id
               AND availability.tenant_id = ?
            ))`,
        [dependency.definitionVersion, dependency.definitionId, tenantId,
          dependency.definitionVersion, dependency.offeringVersion,
          dependency.offeringDigest, tenantId],
      );
      return Boolean(row && row.definition_digest === dependency.definitionDigest &&
        row.offering_id === dependency.offeringId &&
        Number(row.offering_version) === dependency.offeringVersion &&
        row.offering_digest === dependency.offeringDigest &&
        row.offering_kind === dependency.offeringKind &&
        row.source_gateway_id === dependency.sourceGatewayId &&
        row.upstream_stable_id === dependency.upstreamStableId &&
        (row.source_gateway_authority_epoch === null ? null : Number(row.source_gateway_authority_epoch)) ===
          dependency.sourceGatewayAuthorityEpoch);
    }
    const [row] = await tx.query<{
      resource_id: string;
      kind: string;
      number: number;
      content_json: string;
      content_hash: string;
      name: string;
      description: string;
    }>(
      `SELECT resource.id AS resource_id, resource.kind, revision.number,
              revision.content_json, revision.content_hash, resource.name, resource.description
         FROM platform_authored_resource_revisions revision
         JOIN platform_authored_resources resource ON resource.id = revision.resource_id
        WHERE revision.id = ? AND resource.id = ? AND resource.status = 'active'
          AND revision.status = 'published' AND (
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
      Number(row.number) === dependency.revisionNumber &&
      row.content_hash === dependency.contentHash && row.name === dependency.name &&
      row.description === dependency.description &&
      row.content_json === JSON.stringify(dependency.content));
  }

  private async addReferences(
    release: StoredAgentRelease,
    tx: DatabaseSession,
  ): Promise<void> {
    for (const dependency of release.dependencies) {
      if (dependency.kind === "model_definition") {
        await tx.query(
          `INSERT INTO platform_tenant_model_definition_refs
            (source_kind, source_id, definition_id, definition_version, created_at)
           VALUES ('agent_release', ?, ?, ?, ?)`,
          [release.id, dependency.definitionId, dependency.definitionVersion, release.createdAt],
        );
      } else if (dependency.kind === "tool_definition") {
        await tx.query(
          `INSERT INTO platform_tenant_tool_definition_refs
            (source_kind, source_id, definition_id, definition_version, created_at)
           VALUES ('agent_release', ?, ?, ?, ?)`,
          [release.id, dependency.definitionId, dependency.definitionVersion, release.createdAt],
        );
      } else if (dependency.kind === "skill_revision" || dependency.kind === "instruction_revision") {
        await tx.query(
          `INSERT INTO platform_authored_revision_refs
            (source_kind, source_id, revision_id, created_at)
           VALUES ('agent_release', ?, ?, ?)`,
          [release.id, dependency.revisionId, release.createdAt],
        );
      }
    }
  }

  async create(input: {
    definitionId: string;
    tenantId: string;
    expectedDraftVersion: number;
    expectedDraftDigest: string;
    expectedDefinitionDependencies: AgentDefinitionDependency[];
    release: Omit<StoredAgentRelease, "number">;
  }): Promise<CreateReleaseResult> {
    return this.write(async (tx) => {
      const definition = await this.definitions.get(input.definitionId, tx);
      if (!definition || definition.tenantId !== input.tenantId) return { status: "missing" };
      if (definition.status !== "active") return { status: "archived" };
      if (definition.version !== input.expectedDraftVersion ||
        definition.draftDigest !== input.expectedDraftDigest ||
        JSON.stringify(definition.dependencies) !== JSON.stringify(input.expectedDefinitionDependencies)) {
        return { status: "stale" };
      }
      const [tenant] = await tx.query<{ authority_epoch: number }>(
        `SELECT fence.authority_epoch FROM platform_tenants tenant
          JOIN platform_authority_fences fence
            ON fence.subject_kind = 'tenant' AND fence.subject_id = tenant.id AND fence.tenant_id = ''
         WHERE tenant.id = ? AND tenant.status = 'active'`,
        [input.tenantId],
      );
      if (!tenant || Number(tenant.authority_epoch) !== definition.tenantAuthorityEpoch) {
        return { status: "invalid_tenant" };
      }
      for (const dependency of input.release.internalDependencies) {
        if (!await this.validInternalDependency(input.tenantId, dependency, tx)) {
          return { status: "invalid_dependency" };
        }
      }
      const [existing] = await tx.query<{ id: string }>(
        "SELECT id FROM platform_agent_releases WHERE definition_id = ? AND digest = ?",
        [input.definitionId, input.release.digest],
      );
      if (existing) return { status: "exists" };
      const [numberRow] = await tx.query<{ number: number }>(
        "SELECT COALESCE(MAX(number), 0) + 1 AS number FROM platform_agent_releases WHERE definition_id = ?",
        [input.definitionId],
      );
      const release: StoredAgentRelease = { ...input.release, number: Number(numberRow.number) };
      await tx.query(
        `INSERT INTO platform_agent_releases
          (id, definition_id, tenant_id, tenant_authority_epoch, number, draft_version,
           snapshot_json, dependencies_json, internal_dependencies_json, execution_json,
           runtime_type, digest, created_by_principal_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'builtin', ?, ?, ?)`,
        [release.id, release.definitionId, release.tenantId, Number(tenant.authority_epoch),
          release.number, release.draftVersion, JSON.stringify(release.snapshot),
          JSON.stringify(release.dependencies), JSON.stringify(release.internalDependencies),
          JSON.stringify(release.execution), release.digest, release.createdByPrincipalId,
          release.createdAt],
      );
      await this.addReferences(release, tx);
      return { status: "created", item: release };
    });
  }
}
