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

export interface IdentityMigrationReport {
  from: number;
  to: number;
  dryRun: boolean;
}

export async function migratePlatformIdentityDatabase(
  database: PlatformDatabase,
  dryRun = false,
): Promise<IdentityMigrationReport> {
  let report: IdentityMigrationReport = { from: 0, to: 1, dryRun };
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
      if (current > 1) throw new Error("platform identity schema is newer than this application");
      report = { from: current, to: 1, dryRun };

      if (current === 0) {
        for (const statement of versionOneStatements) await transaction.query(statement);
        await transaction.query("UPDATE platform_schema_lock SET version = 1 WHERE id = 1");
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
}
