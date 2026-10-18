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

export interface IdentityMigrationReport {
  from: number;
  to: number;
  dryRun: boolean;
}

export async function migratePlatformIdentityDatabase(
  database: PlatformDatabase,
  dryRun = false,
): Promise<IdentityMigrationReport> {
  let report: IdentityMigrationReport = { from: 0, to: 4, dryRun };
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
      if (current > 4) throw new Error("platform schema is newer than this application");
      report = { from: current, to: 4, dryRun };

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
}
