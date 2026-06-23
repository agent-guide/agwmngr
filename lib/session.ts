import { randomBytes } from "crypto";
import { getDb, findUserByUsername, listGatewaysForUser, type UserRow } from "./db";
import { getServerEnv } from "./server-env";

// A resolved session joined with its owning user. This is what callers see;
// the raw row stores only ids/timestamps.
export interface SessionRecord {
  token: string;
  userId: number;
  username: string;
  isPlatformAdmin: boolean;
  status: "active" | "disabled";
  activeGatewayId: string | null;
  createdAt: string;
  expiresAt: string;
}

interface SessionJoinRow {
  token: string;
  user_id: number;
  active_gateway_id: string | null;
  created_at: string;
  expires_at: string;
  username: string;
  is_platform_admin: number;
  status: "active" | "disabled";
}

function parseTtlMs(): number {
  const raw = (getServerEnv("MANAGER_SESSION_TTL") || "7d").trim();
  const m = raw.match(/^(\d+)\s*([smhd]?)$/i);
  if (!m) return 7 * 24 * 60 * 60 * 1000;
  const n = parseInt(m[1], 10);
  const unit = (m[2] || "s").toLowerCase();
  const mult = unit === "d" ? 86400 : unit === "h" ? 3600 : unit === "m" ? 60 : 1;
  return n * mult * 1000;
}

function toRecord(row: SessionJoinRow): SessionRecord {
  return {
    token: row.token,
    userId: row.user_id,
    username: row.username,
    isPlatformAdmin: row.is_platform_admin === 1,
    status: row.status,
    activeGatewayId: row.active_gateway_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/** Create a session bound to an existing user row. */
export function createSessionForUser(user: UserRow): string {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + parseTtlMs());
  // Default the active gateway to the user's first accessible gateway so the
  // dashboard has a target immediately after login; the switcher can change it.
  const gateways = listGatewaysForUser(user.id, user.is_platform_admin === 1);
  const initialGateway = gateways[0]?.id ?? null;
  getDb().run(
    `INSERT INTO sessions (token, user_id, active_gateway_id, created_at, expires_at, last_seen)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [token, user.id, initialGateway, now.toISOString(), expires.toISOString(), now.toISOString()],
  );
  return token;
}

/**
 * Convenience used by the current (P1) env-based login: resolve the username to
 * a seeded user row and create a session. Returns null if no backing user row
 * exists (misconfiguration — env admin not seeded).
 */
export function createSession(username: string): string | null {
  const user = findUserByUsername(username);
  if (!user) return null;
  return createSessionForUser(user);
}

/**
 * Resolve a token to a live session. Returns null for unknown, expired, or
 * disabled-user sessions; expired rows are cleaned up opportunistically.
 */
export function lookupSession(token: string): SessionRecord | null {
  if (!token) return null;
  const row = getDb().get<SessionJoinRow>(
    `SELECT s.token, s.user_id, s.active_gateway_id, s.created_at, s.expires_at,
            u.username, u.is_platform_admin, u.status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`,
    [token],
  );
  if (!row) return null;

  const nowIso = new Date().toISOString();
  if (row.expires_at <= nowIso || row.status === "disabled") {
    // Expired or owner disabled — drop the row so it cannot be reused.
    getDb().run("DELETE FROM sessions WHERE token = ?", [token]);
    return null;
  }

  getDb().run("UPDATE sessions SET last_seen = ? WHERE token = ?", [nowIso, token]);
  return toRecord(row);
}

export function revokeSession(token: string): void {
  if (!token) return;
  getDb().run("DELETE FROM sessions WHERE token = ?", [token]);
}

/** Revoke every session owned by a user (used when disabling/deleting a user). */
export function revokeSessionsForUser(userId: number): void {
  getDb().run("DELETE FROM sessions WHERE user_id = ?", [userId]);
}

/** Point a session at an active gateway (the header switcher target). */
export function setActiveGateway(token: string, gatewayId: string | null): void {
  getDb().run("UPDATE sessions SET active_gateway_id = ? WHERE token = ?", [gatewayId, token]);
}

export function extractBearerToken(authHeader: string | null): string {
  if (!authHeader?.startsWith("Bearer ")) return "";
  return authHeader.slice(7);
}
