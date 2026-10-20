import type { DatabaseSession, PlatformDatabase } from "../ports/database";

const versionOneStatements = [
  `CREATE TABLE platform_principals (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('human','service')),
    user_id BIGINT UNIQUE,
    service_name TEXT UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('active','disabled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
      (kind = 'human' AND user_id IS NOT NULL AND user_id > 0 AND service_name IS NULL)
      OR
      (kind = 'service' AND user_id IS NULL AND service_name IS NOT NULL)
    )
  )`,
  `CREATE TABLE platform_tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active','disabled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE platform_tenant_memberships (
    principal_id TEXT NOT NULL REFERENCES platform_principals(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('admin','user')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (principal_id, tenant_id)
  )`,
  `CREATE INDEX platform_memberships_tenant
    ON platform_tenant_memberships (tenant_id, role, principal_id)`,
  `CREATE TABLE platform_service_credentials (
    id TEXT PRIMARY KEY,
    principal_id TEXT NOT NULL REFERENCES platform_principals(id) ON DELETE CASCADE,
    token_digest TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX platform_service_credentials_principal
    ON platform_service_credentials (principal_id)`,
];

const versionTwoStatements = [
  `CREATE TABLE platform_issued_ids (
    subject_kind TEXT NOT NULL CHECK (subject_kind IN ('service_principal','tenant')),
    subject_id TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    tombstoned_at TEXT,
    PRIMARY KEY (subject_kind, subject_id)
  )`,
  `INSERT INTO platform_issued_ids (subject_kind, subject_id, issued_at, tombstoned_at)
   SELECT 'service_principal', id, created_at, NULL
     FROM platform_principals
    WHERE kind = 'service'
   ON CONFLICT DO NOTHING`,
  `INSERT INTO platform_issued_ids (subject_kind, subject_id, issued_at, tombstoned_at)
   SELECT 'tenant', id, created_at, NULL
     FROM platform_tenants
    WHERE 1 = 1
   ON CONFLICT DO NOTHING`,
  `CREATE TABLE platform_authority_fences (
    subject_kind TEXT NOT NULL CHECK (subject_kind IN ('service_principal','tenant','membership')),
    subject_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT '',
    authority_epoch BIGINT NOT NULL CHECK (authority_epoch > 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (subject_kind, subject_id, tenant_id),
    CHECK (
      (subject_kind = 'membership' AND tenant_id <> '')
      OR (subject_kind <> 'membership' AND tenant_id = '')
    )
  )`,
  `INSERT INTO platform_authority_fences
     (subject_kind, subject_id, tenant_id, authority_epoch, updated_at)
   SELECT 'service_principal', id, '', 1, updated_at
     FROM platform_principals
    WHERE kind = 'service'
   ON CONFLICT DO NOTHING`,
  `INSERT INTO platform_authority_fences
     (subject_kind, subject_id, tenant_id, authority_epoch, updated_at)
   SELECT 'tenant', id, '', 1, updated_at
     FROM platform_tenants
    WHERE 1 = 1
   ON CONFLICT DO NOTHING`,
  `INSERT INTO platform_authority_fences
     (subject_kind, subject_id, tenant_id, authority_epoch, updated_at)
   SELECT 'membership', principal_id, tenant_id, 1, updated_at
     FROM platform_tenant_memberships
    WHERE 1 = 1
   ON CONFLICT DO NOTHING`,
  `CREATE TABLE platform_tenant_gateway_grants (
    principal_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    gateway_id TEXT NOT NULL,
    access TEXT NOT NULL CHECK (access IN ('view','manage')),
    principal_authority_epoch BIGINT NOT NULL CHECK (principal_authority_epoch > 0),
    tenant_authority_epoch BIGINT NOT NULL CHECK (tenant_authority_epoch > 0),
    membership_authority_epoch BIGINT NOT NULL CHECK (membership_authority_epoch > 0),
    gateway_authority_epoch BIGINT NOT NULL CHECK (gateway_authority_epoch > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (principal_id, tenant_id, gateway_id),
    FOREIGN KEY (principal_id, tenant_id)
      REFERENCES platform_tenant_memberships(principal_id, tenant_id)
      ON DELETE CASCADE
  )`,
  `CREATE INDEX platform_tenant_gateway_grants_gateway
    ON platform_tenant_gateway_grants (gateway_id, tenant_id, principal_id)`,
];

const versionThreeStatements = [
  `CREATE TABLE platform_membership_add_receipts (
    receipt_digest TEXT PRIMARY KEY,
    actor_principal_id TEXT NOT NULL REFERENCES platform_principals(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
    target_principal_id TEXT NOT NULL REFERENCES platform_principals(id) ON DELETE CASCADE,
    target_kind TEXT NOT NULL CHECK (target_kind IN ('human','service')),
    actor_principal_authority_epoch BIGINT NOT NULL CHECK (actor_principal_authority_epoch > 0),
    tenant_authority_epoch BIGINT NOT NULL CHECK (tenant_authority_epoch > 0),
    actor_membership_authority_epoch BIGINT NOT NULL CHECK (actor_membership_authority_epoch > 0),
    target_principal_authority_epoch BIGINT NOT NULL CHECK (target_principal_authority_epoch > 0),
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX platform_membership_add_receipts_expiry
    ON platform_membership_add_receipts (expires_at, consumed_at)`,
];

const versionFourStatements = [
  `CREATE TABLE platform_catalog_offerings (
    offering_id TEXT PRIMARY KEY,
    category TEXT NOT NULL CHECK (category IN ('model','tool')),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    owner_principal_id TEXT NOT NULL REFERENCES platform_principals(id) ON DELETE RESTRICT,
    offering_kind TEXT NOT NULL CHECK (offering_kind IN ('platform-native','gateway-backed')),
    source_gateway_id TEXT,
    upstream_stable_id TEXT,
    source_gateway_authority_epoch BIGINT,
    status TEXT NOT NULL CHECK (status IN ('draft','active','retired')),
    version BIGINT NOT NULL CHECK (version = 1),
    digest TEXT NOT NULL UNIQUE,
    availability_mode TEXT NOT NULL CHECK (availability_mode IN ('all-active-tenants','tenant-allowlist')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
      (offering_kind = 'platform-native'
        AND source_gateway_id IS NULL
        AND upstream_stable_id IS NULL
        AND source_gateway_authority_epoch IS NULL)
      OR
      (offering_kind = 'gateway-backed'
        AND source_gateway_id IS NOT NULL
        AND upstream_stable_id IS NOT NULL
        AND source_gateway_authority_epoch > 0)
    )
  )`,
  `CREATE INDEX platform_catalog_offerings_category_status
    ON platform_catalog_offerings (category, status, offering_id)`,
  `CREATE TABLE platform_catalog_tenant_availability (
    offering_id TEXT NOT NULL REFERENCES platform_catalog_offerings(offering_id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
    tenant_authority_epoch BIGINT NOT NULL CHECK (tenant_authority_epoch > 0),
    created_at TEXT NOT NULL,
    PRIMARY KEY (offering_id, tenant_id)
  )`,
  `CREATE INDEX platform_catalog_tenant_availability_tenant
    ON platform_catalog_tenant_availability (tenant_id, offering_id)`,
];

const versionFiveStatements = [
  `CREATE TABLE platform_authored_resources (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('skill','instruction')),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    owner_kind TEXT NOT NULL CHECK (owner_kind IN ('tenant','platform')),
    tenant_id TEXT,
    tenant_authority_epoch BIGINT,
    owner_principal_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active','archived')),
    availability_mode TEXT CHECK (availability_mode IN ('all-active-tenants','tenant-allowlist')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
      (owner_kind = 'tenant' AND tenant_id IS NOT NULL
        AND tenant_authority_epoch > 0 AND availability_mode IS NULL)
      OR
      (owner_kind = 'platform' AND tenant_id IS NULL
        AND tenant_authority_epoch IS NULL AND availability_mode IS NOT NULL)
    )
  )`,
  `CREATE INDEX platform_authored_resources_tenant_kind
    ON platform_authored_resources (tenant_id, kind, status, id)`,
  `CREATE INDEX platform_authored_resources_platform_kind
    ON platform_authored_resources (owner_kind, kind, status, id)`,
  `CREATE TABLE platform_authored_resource_availability (
    resource_id TEXT NOT NULL REFERENCES platform_authored_resources(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL,
    tenant_authority_epoch BIGINT NOT NULL CHECK (tenant_authority_epoch > 0),
    created_at TEXT NOT NULL,
    PRIMARY KEY (resource_id, tenant_id)
  )`,
  `CREATE INDEX platform_authored_resource_availability_tenant
    ON platform_authored_resource_availability (tenant_id, resource_id)`,
  `CREATE TABLE platform_authored_resource_revisions (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL REFERENCES platform_authored_resources(id) ON DELETE CASCADE,
    number BIGINT NOT NULL CHECK (number > 0),
    status TEXT NOT NULL CHECK (status IN ('draft','published','archived')),
    content_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    created_by_principal_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (resource_id, number)
  )`,
  `CREATE INDEX platform_authored_resource_revisions_resource
    ON platform_authored_resource_revisions (resource_id, number)`,
  `CREATE TABLE platform_authored_revision_refs (
    source_kind TEXT NOT NULL,
    source_id TEXT NOT NULL,
    revision_id TEXT NOT NULL REFERENCES platform_authored_resource_revisions(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (source_kind, source_id, revision_id)
  )`,
  `CREATE INDEX platform_authored_revision_refs_revision
    ON platform_authored_revision_refs (revision_id)`,
];

const versionSixStatements = [
  `CREATE TABLE platform_knowledge_bases (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    tenant_authority_epoch BIGINT NOT NULL CHECK (tenant_authority_epoch > 0),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active','archived')),
    created_by_principal_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX platform_knowledge_bases_tenant_status
    ON platform_knowledge_bases (tenant_id, status, id)`,
  `CREATE TABLE platform_knowledge_documents (
    id TEXT PRIMARY KEY,
    knowledge_base_id TEXT NOT NULL REFERENCES platform_knowledge_bases(id) ON DELETE RESTRICT,
    tenant_id TEXT NOT NULL,
    tenant_authority_epoch BIGINT NOT NULL CHECK (tenant_authority_epoch > 0),
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    expected_hash TEXT,
    content_hash TEXT,
    object_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('pending','active','failed','deleted')),
    failure_reason TEXT,
    created_by_principal_id TEXT NOT NULL,
    request_key TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (knowledge_base_id, created_by_principal_id, request_key)
  )`,
  `CREATE INDEX platform_knowledge_documents_parent_status
    ON platform_knowledge_documents (knowledge_base_id, status, id)`,
  `CREATE TABLE platform_document_object_tickets (
    digest TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES platform_knowledge_documents(id) ON DELETE CASCADE,
    operation TEXT NOT NULL CHECK (operation IN ('upload','download')),
    principal_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX platform_document_object_tickets_document
    ON platform_document_object_tickets (document_id, operation, expires_at)`,
  `CREATE TABLE platform_knowledge_base_refs (
    source_kind TEXT NOT NULL,
    source_id TEXT NOT NULL,
    knowledge_base_id TEXT NOT NULL REFERENCES platform_knowledge_bases(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (source_kind, source_id, knowledge_base_id)
  )`,
  `CREATE TABLE platform_knowledge_document_refs (
    source_kind TEXT NOT NULL,
    source_id TEXT NOT NULL,
    document_id TEXT NOT NULL REFERENCES platform_knowledge_documents(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (source_kind, source_id, document_id)
  )`,
];

const versionSevenStatements = [
  `ALTER TABLE platform_knowledge_documents ADD COLUMN object_deleted_at TEXT`,
  `CREATE TABLE platform_personal_files (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    tenant_authority_epoch BIGINT NOT NULL CHECK (tenant_authority_epoch > 0),
    owner_principal_id TEXT NOT NULL,
    owner_user_id BIGINT NOT NULL CHECK (owner_user_id > 0),
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    expected_hash TEXT,
    content_hash TEXT,
    object_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('pending','active','failed','deleted')),
    failure_reason TEXT,
    request_key TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    object_deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (tenant_id, owner_principal_id, request_key)
  )`,
  `CREATE INDEX platform_personal_files_owner_status
    ON platform_personal_files (tenant_id, owner_principal_id, status, id)`,
  `CREATE TABLE platform_personal_file_tickets (
    digest TEXT PRIMARY KEY,
    file_id TEXT NOT NULL REFERENCES platform_personal_files(id) ON DELETE CASCADE,
    operation TEXT NOT NULL CHECK (operation IN ('upload','download','preview')),
    owner_principal_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX platform_personal_file_tickets_file
    ON platform_personal_file_tickets (file_id, operation, expires_at)`,
  `CREATE TABLE platform_personal_file_refs (
    source_kind TEXT NOT NULL,
    source_id TEXT NOT NULL,
    file_id TEXT NOT NULL REFERENCES platform_personal_files(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (source_kind, source_id, file_id)
  )`,
];

const versionEightStatements = [
  `CREATE TABLE platform_tenant_model_definitions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    tenant_authority_epoch BIGINT NOT NULL CHECK (tenant_authority_epoch > 0),
    status TEXT NOT NULL CHECK (status IN ('active','archived')),
    current_version BIGINT NOT NULL CHECK (current_version > 0),
    created_by_principal_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (id, current_version)
  )`,
  `CREATE INDEX platform_tenant_model_definitions_tenant_status
    ON platform_tenant_model_definitions (tenant_id, status, id)`,
  `CREATE TABLE platform_tenant_model_definition_versions (
    definition_id TEXT NOT NULL REFERENCES platform_tenant_model_definitions(id) ON DELETE RESTRICT,
    version BIGINT NOT NULL CHECK (version > 0),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    offering_id TEXT NOT NULL,
    offering_version BIGINT NOT NULL CHECK (offering_version > 0),
    offering_digest TEXT NOT NULL,
    digest TEXT NOT NULL,
    created_by_principal_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (definition_id, version),
    UNIQUE (definition_id, digest)
  )`,
  `CREATE INDEX platform_tenant_model_definition_versions_offering
    ON platform_tenant_model_definition_versions (offering_id, definition_id, version)`,
  `CREATE TABLE platform_tenant_model_definition_refs (
    source_kind TEXT NOT NULL,
    source_id TEXT NOT NULL,
    definition_id TEXT NOT NULL,
    definition_version BIGINT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (source_kind, source_id, definition_id, definition_version),
    FOREIGN KEY (definition_id, definition_version)
      REFERENCES platform_tenant_model_definition_versions(definition_id, version)
      ON DELETE RESTRICT
  )`,
];

const versionNineStatements = [
  `CREATE TABLE platform_tenant_tool_definitions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    tenant_authority_epoch BIGINT NOT NULL CHECK (tenant_authority_epoch > 0),
    status TEXT NOT NULL CHECK (status IN ('active','archived')),
    current_version BIGINT NOT NULL CHECK (current_version > 0),
    created_by_principal_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (id, current_version)
  )`,
  `CREATE INDEX platform_tenant_tool_definitions_tenant_status
    ON platform_tenant_tool_definitions (tenant_id, status, id)`,
  `CREATE TABLE platform_tenant_tool_definition_versions (
    definition_id TEXT NOT NULL REFERENCES platform_tenant_tool_definitions(id) ON DELETE RESTRICT,
    version BIGINT NOT NULL CHECK (version > 0),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    offering_id TEXT NOT NULL,
    offering_version BIGINT NOT NULL CHECK (offering_version > 0),
    offering_digest TEXT NOT NULL,
    digest TEXT NOT NULL,
    created_by_principal_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (definition_id, version),
    UNIQUE (definition_id, digest)
  )`,
  `CREATE INDEX platform_tenant_tool_definition_versions_offering
    ON platform_tenant_tool_definition_versions (offering_id, definition_id, version)`,
  `CREATE TABLE platform_tenant_tool_definition_refs (
    source_kind TEXT NOT NULL,
    source_id TEXT NOT NULL,
    definition_id TEXT NOT NULL,
    definition_version BIGINT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (source_kind, source_id, definition_id, definition_version),
    FOREIGN KEY (definition_id, definition_version)
      REFERENCES platform_tenant_tool_definition_versions(definition_id, version)
      ON DELETE RESTRICT
  )`,
];

const versionTenStatements = [
  `CREATE TABLE platform_agent_definitions (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    tenant_authority_epoch BIGINT NOT NULL CHECK (tenant_authority_epoch > 0),
    status TEXT NOT NULL CHECK (status IN ('active','archived')),
    version BIGINT NOT NULL CHECK (version > 0),
    draft_json TEXT NOT NULL,
    draft_digest TEXT NOT NULL,
    dependencies_json TEXT NOT NULL,
    created_by_principal_id TEXT NOT NULL,
    updated_by_principal_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (tenant_id, slug)
  )`,
  `CREATE INDEX platform_agent_definitions_tenant_status
    ON platform_agent_definitions (tenant_id, status, updated_at, id)`,
];

export interface IdentityMigrationReport {
  from: number;
  to: number;
  dryRun: boolean;
}

export async function migratePlatformIdentityDatabase(
  database: PlatformDatabase,
  dryRun = false,
): Promise<IdentityMigrationReport> {
  let report: IdentityMigrationReport = { from: 0, to: 10, dryRun };
  const rollback = new Error("platform identity migration dry-run rollback");

  try {
    await database.transaction(async (transaction) => {
      if (database.dialect === "postgres") {
        await transaction.query("SELECT pg_advisory_xact_lock(748193622)");
      }
      await transaction.query(
        "CREATE TABLE IF NOT EXISTS platform_schema_lock (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)",
      );
      await transaction.query(
        "INSERT INTO platform_schema_lock (id, version) VALUES (1, 0) ON CONFLICT DO NOTHING",
      );
      const suffix = database.dialect === "postgres" ? " FOR UPDATE" : "";
      const [row] = await transaction.query<{ version: number }>(
        `SELECT version FROM platform_schema_lock WHERE id = 1${suffix}`,
      );
      const current = Number(row.version);
      if (current > 10) throw new Error("platform schema is newer than this application");
      report = { from: current, to: 10, dryRun };

      if (current === 0) {
        for (const statement of versionOneStatements) await transaction.query(statement);
        await transaction.query("UPDATE platform_schema_lock SET version = 1 WHERE id = 1");
      }

      if (current < 2) {
        for (const statement of versionTwoStatements) await transaction.query(statement);
        await transaction.query("UPDATE platform_schema_lock SET version = 2 WHERE id = 1");
      }

      if (current < 3) {
        for (const statement of versionThreeStatements) await transaction.query(statement);
        await transaction.query("UPDATE platform_schema_lock SET version = 3 WHERE id = 1");
      }

      if (current < 4) {
        for (const statement of versionFourStatements) await transaction.query(statement);
        await transaction.query("UPDATE platform_schema_lock SET version = 4 WHERE id = 1");
      }

      if (current < 5) {
        for (const statement of versionFiveStatements) await transaction.query(statement);
        await transaction.query("UPDATE platform_schema_lock SET version = 5 WHERE id = 1");
      }

      if (current < 6) {
        for (const statement of versionSixStatements) await transaction.query(statement);
        await transaction.query("UPDATE platform_schema_lock SET version = 6 WHERE id = 1");
      }

      if (current < 7) {
        for (const statement of versionSevenStatements) await transaction.query(statement);
        await transaction.query("UPDATE platform_schema_lock SET version = 7 WHERE id = 1");
      }

      if (current < 8) {
        for (const statement of versionEightStatements) await transaction.query(statement);
        await transaction.query("UPDATE platform_schema_lock SET version = 8 WHERE id = 1");
      }

      if (current < 9) {
        for (const statement of versionNineStatements) await transaction.query(statement);
        await transaction.query("UPDATE platform_schema_lock SET version = 9 WHERE id = 1");
      }

      if (current < 10) {
        for (const statement of versionTenStatements) await transaction.query(statement);
        await transaction.query("UPDATE platform_schema_lock SET version = 10 WHERE id = 1");
      }

      await validatePlatformIdentityReferences(transaction);
      if (dryRun) throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }

  return report;
}

export async function validatePlatformIdentityReferences(
  transaction: DatabaseSession,
): Promise<void> {
  const [row] = await transaction.query<{ n: number }>(`
    SELECT COUNT(*) AS n
      FROM platform_tenant_memberships membership
      LEFT JOIN platform_principals principal ON principal.id = membership.principal_id
      LEFT JOIN platform_tenants tenant ON tenant.id = membership.tenant_id
     WHERE principal.id IS NULL OR tenant.id IS NULL
  `);
  if (Number(row.n) !== 0) throw new Error("invalid platform identity references");

  const [grantRow] = await transaction.query<{ n: number }>(`
    SELECT COUNT(*) AS n
      FROM platform_tenant_gateway_grants grant_row
      LEFT JOIN platform_tenant_memberships membership
        ON membership.principal_id = grant_row.principal_id
       AND membership.tenant_id = grant_row.tenant_id
     WHERE membership.principal_id IS NULL
  `);
  if (Number(grantRow.n) !== 0) throw new Error("invalid Tenant Gateway grant references");

  const [catalogRow] = await transaction.query<{ n: number }>(`
    SELECT COUNT(*) AS n
      FROM platform_catalog_offerings offering
      LEFT JOIN platform_principals owner ON owner.id = offering.owner_principal_id
     WHERE owner.id IS NULL
  `);
  if (Number(catalogRow.n) !== 0) throw new Error("invalid catalog owner references");

  const [availabilityRow] = await transaction.query<{ n: number }>(`
    SELECT COUNT(*) AS n
      FROM platform_catalog_tenant_availability availability
      LEFT JOIN platform_catalog_offerings offering
        ON offering.offering_id = availability.offering_id
      LEFT JOIN platform_tenants tenant ON tenant.id = availability.tenant_id
     WHERE offering.offering_id IS NULL OR tenant.id IS NULL
  `);
  if (Number(availabilityRow.n) !== 0) {
    throw new Error("invalid catalog availability references");
  }

  const [resourceRevisionRow] = await transaction.query<{ n: number }>(`
    SELECT COUNT(*) AS n
      FROM platform_authored_resource_revisions revision
      LEFT JOIN platform_authored_resources resource ON resource.id = revision.resource_id
     WHERE resource.id IS NULL
  `);
  if (Number(resourceRevisionRow.n) !== 0) {
    throw new Error("invalid authored resource revision references");
  }

  const [resourceAvailabilityRow] = await transaction.query<{ n: number }>(`
    SELECT COUNT(*) AS n
      FROM platform_authored_resource_availability availability
      LEFT JOIN platform_authored_resources resource ON resource.id = availability.resource_id
     WHERE resource.id IS NULL
  `);
  if (Number(resourceAvailabilityRow.n) !== 0) {
    throw new Error("invalid authored resource availability references");
  }

  const [documentRow] = await transaction.query<{ n: number }>(`
    SELECT COUNT(*) AS n
      FROM platform_knowledge_documents document
      LEFT JOIN platform_knowledge_bases knowledge ON knowledge.id = document.knowledge_base_id
     WHERE knowledge.id IS NULL
  `);
  if (Number(documentRow.n) !== 0) {
    throw new Error("invalid knowledge document references");
  }
}
