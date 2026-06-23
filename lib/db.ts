import { mkdirSync, chmodSync } from "fs";
import { dirname, join } from "path";
import bcrypt from "bcryptjs";
import { getServerEnv } from "./server-env";
import { openDatabase, type SqlConnection } from "./sqlite";
import { encryptSecret, decryptSecret, isEncryptionConfigured } from "./crypto";

// Single long-lived connection. Survives hot-reload in dev via globalThis so we
// don't reopen (and re-run migrations) on every module re-evaluation.
const g = globalThis as typeof globalThis & { __managerDb?: SqlConnection };

function dbPath(): string {
  const override = getServerEnv("MANAGER_DB_PATH");
  if (override) return override;
  return join(process.cwd(), "data", "manager.db");
}

// Migrations are an ordered list of SQL scripts. The applied count is tracked
// via PRAGMA user_version, so each script runs exactly once across restarts.
const MIGRATIONS: string[] = [
  // 1: initial multi-tenant schema (§3 of docs/multi-tenant-design.md)
  `
  CREATE TABLE users (
    id                INTEGER PRIMARY KEY,
    username          TEXT NOT NULL,
    password_hash     TEXT NOT NULL,
    is_platform_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_platform_admin IN (0,1)),
    status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );
  CREATE UNIQUE INDEX ux_users_username ON users (username COLLATE NOCASE);

  CREATE TABLE gateways (
    id                  TEXT PRIMARY KEY,
    name                TEXT UNIQUE NOT NULL,
    description         TEXT,
    admin_addr          TEXT NOT NULL,
    admin_user          TEXT NOT NULL,
    admin_password_enc  TEXT NOT NULL,
    caddy_admin_addr    TEXT,
    dataplane_addr      TEXT,
    readonly_server_ids TEXT,
    status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  );

  CREATE TABLE user_gateways (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gateway_id TEXT    NOT NULL REFERENCES gateways(id) ON DELETE CASCADE,
    role       TEXT    NOT NULL CHECK (role IN ('operator','viewer')),
    PRIMARY KEY (user_id, gateway_id)
  );

  CREATE TABLE sessions (
    token             TEXT PRIMARY KEY,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    active_gateway_id TEXT REFERENCES gateways(id) ON DELETE SET NULL,
    created_at        TEXT NOT NULL,
    expires_at        TEXT NOT NULL,
    last_seen         TEXT NOT NULL
  );
  CREATE INDEX ix_sessions_user    ON sessions (user_id);
  CREATE INDEX ix_sessions_expires ON sessions (expires_at);

  CREATE TABLE audit_log (
    id             INTEGER PRIMARY KEY,
    ts             TEXT    NOT NULL,
    request_id     TEXT,
    actor_user_id  INTEGER,
    gateway_id     TEXT,
    action         TEXT,
    method         TEXT,
    path           TEXT,
    target_kind    TEXT,
    target_id      TEXT,
    decision       TEXT NOT NULL CHECK (decision IN ('allow','deny')),
    failure_reason TEXT,
    http_status    INTEGER,
    ip             TEXT,
    user_agent     TEXT,
    duration_ms    INTEGER
  );
  CREATE INDEX ix_audit_user    ON audit_log (actor_user_id, ts);
  CREATE INDEX ix_audit_gateway ON audit_log (gateway_id, ts);
  `,
];

function runMigrations(db: SqlConnection): void {
  const row = db.get<{ user_version: number }>("PRAGMA user_version");
  const current = row?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      // PRAGMA user_version does not accept bound parameters; v+1 is an integer
      // we control, so interpolation is safe here.
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

// Forward-compatible seed (P1/P2 per §7): if the user table is empty and the
// legacy single-admin env is present, seed one platform-admin user from it so
// the durable session store has a real user row to bind to. Auth still behaves
// as today; this only ensures a backing row exists.
function seedFromEnv(db: SqlConnection): void {
  const count = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM users");
  if ((count?.n ?? 0) > 0) return;

  const adminUser = getServerEnv("CADDYMGR_ADMIN_USER");
  const adminHash = getServerEnv("CADDYMGR_ADMIN_PASSWORD_HASH");
  if (!adminUser || !adminHash) return;

  const now = new Date().toISOString();
  db.run(
    `INSERT INTO users (username, password_hash, is_platform_admin, status, created_at, updated_at)
     VALUES (?, ?, 1, 'active', ?, ?)`,
    [adminUser, adminHash, now, now],
  );
}

function open(): SqlConnection {
  const path = dbPath();
  mkdirSync(dirname(path), { recursive: true });

  const db = openDatabase(path);
  // Per-connection PRAGMAs (§3): FK enforcement is off by default in SQLite and
  // is required for the ON DELETE CASCADE / SET NULL relations to take effect.
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");

  // At-rest hygiene: keep the DB file owner-only. Best-effort; ignore failures
  // (e.g. Windows).
  try {
    chmodSync(path, 0o600);
  } catch {
    // ignore
  }

  runMigrations(db);
  seedFromEnv(db);
  seedGatewayFromEnv(db);
  return db;
}

// Seed the single env-configured gateway into the registry on first boot at P3
// (§7). Only runs when encryption is configured (the admin password must be
// encrypted), the registry is empty, and the legacy GATEWAY_ADDR env is set.
// Also grants the seeded platform admin an operator membership of it.
function seedGatewayFromEnv(db: SqlConnection): void {
  if (!isEncryptionConfigured()) return;

  const count = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM gateways");
  if ((count?.n ?? 0) > 0) return;

  const adminAddr = getServerEnv("GATEWAY_ADDR");
  const adminUser = getServerEnv("GATEWAY_ADMIN_USER");
  const adminPassword = getServerEnv("GATEWAY_ADMIN_PASSWORD");
  if (!adminAddr || !adminUser) return;

  const now = new Date().toISOString();
  const enc = encryptSecret(adminPassword || "");
  db.run(
    `INSERT INTO gateways
       (id, name, description, admin_addr, admin_user, admin_password_enc,
        caddy_admin_addr, dataplane_addr, readonly_server_ids, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    [
      "default",
      "Default Gateway",
      "Migrated from environment configuration.",
      adminAddr.replace(/\/$/, ""),
      adminUser,
      enc,
      getServerEnv("CADDY_ADMIN_ADDR") || null,
      getServerEnv("GATEWAY_DATAPLANE_ADDR") || null,
      getServerEnv("CADDYMGR_READONLY_SERVER_IDS") || null,
      now,
      now,
    ],
  );

  // Grant the seeded platform admin operator membership so the switcher lists it.
  const seededAdmin = getServerEnv("CADDYMGR_ADMIN_USER");
  if (seededAdmin) {
    const user = findUserByUsername(seededAdmin);
    if (user) {
      db.run(
        `INSERT OR IGNORE INTO user_gateways (user_id, gateway_id, role)
         VALUES (?, 'default', 'operator')`,
        [user.id],
      );
    }
  }
}

export function getDb(): SqlConnection {
  if (!g.__managerDb) g.__managerDb = open();
  return g.__managerDb;
}

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  is_platform_admin: number;
  status: "active" | "disabled";
  created_at: string;
  updated_at: string;
}

export function findUserByUsername(username: string): UserRow | null {
  return (
    getDb().get<UserRow>(
      "SELECT * FROM users WHERE username = ? COLLATE NOCASE LIMIT 1",
      [username],
    ) ?? null
  );
}

export function findUserById(id: number): UserRow | null {
  return getDb().get<UserRow>("SELECT * FROM users WHERE id = ?", [id]) ?? null;
}

// Public-facing user shape (never exposes password_hash).
export interface UserSummary {
  id: number;
  username: string;
  is_platform_admin: boolean;
  status: "active" | "disabled";
  created_at: string;
  updated_at: string;
}

function toSummary(row: UserRow): UserSummary {
  return {
    id: row.id,
    username: row.username,
    is_platform_admin: row.is_platform_admin === 1,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listUsers(): UserSummary[] {
  return getDb()
    .all<UserRow>("SELECT * FROM users ORDER BY id ASC")
    .map(toSummary);
}

export function getUserSummary(id: number): UserSummary | null {
  const row = findUserById(id);
  return row ? toSummary(row) : null;
}

export function createUser(input: {
  username: string;
  password: string;
  isPlatformAdmin: boolean;
}): UserSummary {
  const now = new Date().toISOString();
  const hash = bcrypt.hashSync(input.password, 10);
  const res = getDb().run(
    `INSERT INTO users (username, password_hash, is_platform_admin, status, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?)`,
    [input.username, hash, input.isPlatformAdmin ? 1 : 0, now, now],
  );
  return getUserSummary(Number(res.lastInsertRowid))!;
}

export function updateUser(
  id: number,
  patch: { password?: string; isPlatformAdmin?: boolean; status?: "active" | "disabled" },
): UserSummary | null {
  const existing = findUserById(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.password !== undefined) {
    sets.push("password_hash = ?");
    params.push(bcrypt.hashSync(patch.password, 10));
  }
  if (patch.isPlatformAdmin !== undefined) {
    sets.push("is_platform_admin = ?");
    params.push(patch.isPlatformAdmin ? 1 : 0);
  }
  if (patch.status !== undefined) {
    sets.push("status = ?");
    params.push(patch.status);
  }
  sets.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(id);

  getDb().run(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, params);
  return getUserSummary(id);
}

export function deleteUser(id: number): void {
  getDb().run("DELETE FROM users WHERE id = ?", [id]);
}

// Count of users who can still perform platform administration. Used to block
// removing/disabling/demoting the last platform admin (self-lockout guard).
export function countActivePlatformAdmins(excludeUserId?: number): number {
  const row = getDb().get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM users
      WHERE is_platform_admin = 1 AND status = 'active'
        AND (? IS NULL OR id != ?)`,
    [excludeUserId ?? null, excludeUserId ?? null],
  );
  return row?.n ?? 0;
}

// ---- Gateways ----

export interface GatewayRow {
  id: string;
  name: string;
  description: string | null;
  admin_addr: string;
  admin_user: string;
  admin_password_enc: string;
  caddy_admin_addr: string | null;
  dataplane_addr: string | null;
  readonly_server_ids: string | null;
  status: "active" | "disabled";
  created_at: string;
  updated_at: string;
}

export type GatewayHealth = "ok" | "credential_error" | "encryption_unconfigured";

// Public gateway shape: never exposes the ciphertext, surfaces a computed
// health_status separate from the persisted active/disabled status (§4).
export interface GatewaySummary {
  id: string;
  name: string;
  description: string | null;
  admin_addr: string;
  admin_user: string;
  admin_password_set: boolean;
  caddy_admin_addr: string | null;
  dataplane_addr: string | null;
  readonly_server_ids: string | null;
  status: "active" | "disabled";
  health_status: GatewayHealth;
  created_at: string;
  updated_at: string;
}

export function gatewayHealth(row: GatewayRow): GatewayHealth {
  if (!isEncryptionConfigured()) return "encryption_unconfigured";
  try {
    decryptSecret(row.admin_password_enc);
    return "ok";
  } catch {
    return "credential_error";
  }
}

export function toGatewaySummary(row: GatewayRow): GatewaySummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    admin_addr: row.admin_addr,
    admin_user: row.admin_user,
    admin_password_set: Boolean(row.admin_password_enc),
    caddy_admin_addr: row.caddy_admin_addr,
    dataplane_addr: row.dataplane_addr,
    readonly_server_ids: row.readonly_server_ids,
    status: row.status,
    health_status: gatewayHealth(row),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listGateways(): GatewayRow[] {
  return getDb().all<GatewayRow>("SELECT * FROM gateways ORDER BY name ASC");
}

export function getGateway(id: string): GatewayRow | null {
  return getDb().get<GatewayRow>("SELECT * FROM gateways WHERE id = ?", [id]) ?? null;
}

export interface GatewayWriteInput {
  id: string;
  name: string;
  description?: string | null;
  admin_addr: string;
  admin_user: string;
  admin_password?: string; // plaintext; encrypted here
  caddy_admin_addr?: string | null;
  dataplane_addr?: string | null;
  readonly_server_ids?: string | null;
  status?: "active" | "disabled";
}

export function createGateway(input: GatewayWriteInput): GatewayRow {
  const now = new Date().toISOString();
  const enc = encryptSecret(input.admin_password ?? "");
  getDb().run(
    `INSERT INTO gateways
       (id, name, description, admin_addr, admin_user, admin_password_enc,
        caddy_admin_addr, dataplane_addr, readonly_server_ids, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.name,
      input.description ?? null,
      input.admin_addr.replace(/\/$/, ""),
      input.admin_user,
      enc,
      input.caddy_admin_addr ?? null,
      input.dataplane_addr ?? null,
      input.readonly_server_ids ?? null,
      input.status ?? "active",
      now,
      now,
    ],
  );
  return getGateway(input.id)!;
}

export function updateGateway(
  id: string,
  patch: Partial<Omit<GatewayWriteInput, "id">>,
): GatewayRow | null {
  const existing = getGateway(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];
  const put = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    params.push(val);
  };

  if (patch.name !== undefined) put("name", patch.name);
  if (patch.description !== undefined) put("description", patch.description ?? null);
  if (patch.admin_addr !== undefined) put("admin_addr", patch.admin_addr.replace(/\/$/, ""));
  if (patch.admin_user !== undefined) put("admin_user", patch.admin_user);
  // Only re-encrypt when a new password is actually supplied (non-empty).
  if (patch.admin_password) put("admin_password_enc", encryptSecret(patch.admin_password));
  if (patch.caddy_admin_addr !== undefined) put("caddy_admin_addr", patch.caddy_admin_addr ?? null);
  if (patch.dataplane_addr !== undefined) put("dataplane_addr", patch.dataplane_addr ?? null);
  if (patch.readonly_server_ids !== undefined)
    put("readonly_server_ids", patch.readonly_server_ids ?? null);
  if (patch.status !== undefined) put("status", patch.status);

  put("updated_at", new Date().toISOString());
  params.push(id);
  getDb().run(`UPDATE gateways SET ${sets.join(", ")} WHERE id = ?`, params);
  return getGateway(id);
}

export function deleteGateway(id: string): void {
  getDb().run("DELETE FROM gateways WHERE id = ?", [id]);
}

// ---- Memberships (user_gateways) ----

export type GatewayRole = "operator" | "viewer";

export interface MembershipRow {
  user_id: number;
  gateway_id: string;
  role: GatewayRole;
}

export function getMembership(userId: number, gatewayId: string): MembershipRow | null {
  return (
    getDb().get<MembershipRow>(
      "SELECT * FROM user_gateways WHERE user_id = ? AND gateway_id = ?",
      [userId, gatewayId],
    ) ?? null
  );
}

export interface MemberSummary {
  user_id: number;
  username: string;
  role: GatewayRole;
}

export function listGatewayMembers(gatewayId: string): MemberSummary[] {
  return getDb().all<MemberSummary>(
    `SELECT ug.user_id, u.username, ug.role
       FROM user_gateways ug
       JOIN users u ON u.id = ug.user_id
      WHERE ug.gateway_id = ?
      ORDER BY u.username ASC`,
    [gatewayId],
  );
}

export interface UserGatewayEntry {
  id: string;
  name: string;
  role: GatewayRole | "admin";
  status: "active" | "disabled";
  health_status: GatewayHealth;
}

// Gateways a user may select in the switcher: all gateways for a platform admin
// (role 'admin'), else only those they hold a membership for.
export function listGatewaysForUser(userId: number, isPlatformAdmin: boolean): UserGatewayEntry[] {
  const rows = isPlatformAdmin
    ? getDb().all<GatewayRow>("SELECT * FROM gateways ORDER BY name ASC")
    : getDb().all<GatewayRow>(
        `SELECT g.* FROM gateways g
           JOIN user_gateways ug ON ug.gateway_id = g.id
          WHERE ug.user_id = ?
          ORDER BY g.name ASC`,
        [userId],
      );
  return rows.map((g) => ({
    id: g.id,
    name: g.name,
    role: isPlatformAdmin ? "admin" : (getMembership(userId, g.id)?.role ?? "viewer"),
    status: g.status,
    health_status: gatewayHealth(g),
  }));
}

export function setMembership(userId: number, gatewayId: string, role: GatewayRole): void {
  getDb().run(
    `INSERT INTO user_gateways (user_id, gateway_id, role) VALUES (?, ?, ?)
     ON CONFLICT (user_id, gateway_id) DO UPDATE SET role = excluded.role`,
    [userId, gatewayId, role],
  );
}

export function removeMembership(userId: number, gatewayId: string): void {
  getDb().run("DELETE FROM user_gateways WHERE user_id = ? AND gateway_id = ?", [userId, gatewayId]);
}

// ---- Audit log (§5.1) ----

export interface AuditEntry {
  request_id?: string | null;
  actor_user_id?: number | null;
  gateway_id?: string | null;
  action?: string | null;
  method?: string | null;
  path?: string | null;
  target_kind?: string | null;
  target_id?: string | null;
  decision: "allow" | "deny";
  failure_reason?: string | null;
  http_status?: number | null;
  ip?: string | null;
  user_agent?: string | null;
  duration_ms?: number | null;
}

// Insert an audit row and return its id (so an "allow" row can be finalized
// later with the real outcome).
export function insertAudit(e: AuditEntry): number {
  const res = getDb().run(
    `INSERT INTO audit_log
       (ts, request_id, actor_user_id, gateway_id, action, method, path,
        target_kind, target_id, decision, failure_reason, http_status, ip, user_agent, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      new Date().toISOString(),
      e.request_id ?? null,
      e.actor_user_id ?? null,
      e.gateway_id ?? null,
      e.action ?? null,
      e.method ?? null,
      e.path ?? null,
      e.target_kind ?? null,
      e.target_id ?? null,
      e.decision,
      e.failure_reason ?? null,
      e.http_status ?? null,
      e.ip ?? null,
      e.user_agent ?? null,
      e.duration_ms ?? null,
    ],
  );
  return Number(res.lastInsertRowid);
}

export interface AuditFinalizePatch {
  http_status?: number | null;
  target_kind?: string | null;
  target_id?: string | null;
  duration_ms?: number | null;
  failure_reason?: string | null;
}

// Update an open "allow" row with the real outcome once the handler completes.
export function finalizeAudit(id: number, patch: AuditFinalizePatch): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.http_status !== undefined) { sets.push("http_status = ?"); params.push(patch.http_status); }
  if (patch.target_kind !== undefined) { sets.push("target_kind = ?"); params.push(patch.target_kind); }
  if (patch.target_id !== undefined) { sets.push("target_id = ?"); params.push(patch.target_id); }
  if (patch.duration_ms !== undefined) { sets.push("duration_ms = ?"); params.push(patch.duration_ms); }
  if (patch.failure_reason !== undefined) { sets.push("failure_reason = ?"); params.push(patch.failure_reason); }
  if (sets.length === 0) return;
  params.push(id);
  getDb().run(`UPDATE audit_log SET ${sets.join(", ")} WHERE id = ?`, params);
}

export interface AuditRow {
  id: number;
  ts: string;
  request_id: string | null;
  actor_user_id: number | null;
  username: string | null;
  gateway_id: string | null;
  action: string | null;
  method: string | null;
  path: string | null;
  target_kind: string | null;
  target_id: string | null;
  decision: "allow" | "deny";
  failure_reason: string | null;
  http_status: number | null;
  ip: string | null;
  user_agent: string | null;
  duration_ms: number | null;
}

export interface AuditFilters {
  gateway_id?: string;
  decision?: "allow" | "deny";
  actor_user_id?: number;
  limit?: number;
}

export function listAudit(filters: AuditFilters = {}): AuditRow[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.gateway_id) { where.push("a.gateway_id = ?"); params.push(filters.gateway_id); }
  if (filters.decision) { where.push("a.decision = ?"); params.push(filters.decision); }
  if (filters.actor_user_id) { where.push("a.actor_user_id = ?"); params.push(filters.actor_user_id); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 1000);
  params.push(limit);
  return getDb().all<AuditRow>(
    `SELECT a.*, u.username
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_user_id
       ${whereSql}
      ORDER BY a.id DESC
      LIMIT ?`,
    params,
  );
}

// Re-export bcrypt so callers needing to hash on write share one implementation.
export { bcrypt };
