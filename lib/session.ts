import { randomBytes } from "crypto";

interface Session {
  username: string;
  createdAt: Date;
}

// Module-level singleton so it survives across hot-reloads in dev via globalThis.
const g = globalThis as typeof globalThis & { __sessions?: Map<string, Session> };
if (!g.__sessions) g.__sessions = new Map();
const sessions = g.__sessions;

export function createSession(username: string): string {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { username, createdAt: new Date() });
  return token;
}

export function lookupSession(token: string): Session | undefined {
  return sessions.get(token);
}

export function revokeSession(token: string): void {
  sessions.delete(token);
}

export function extractBearerToken(authHeader: string | null): string {
  if (!authHeader?.startsWith("Bearer ")) return "";
  return authHeader.slice(7);
}
