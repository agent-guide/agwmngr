import { extractBearerToken, lookupSession } from "./session";

export function getAuthToken(req: Request): string {
  return extractBearerToken(req.headers.get("Authorization"));
}

/**
 * Require a live, table-backed session. Used by entry points that only need
 * "a logged-in user" without gateway/role resolution (auth/me, logout, and —
 * until P3 wires the gateway guard — the proxy/caddy/acp entry points).
 */
export function requireAuth(req: Request): Response | null {
  const token = getAuthToken(req);
  if (!token) {
    return Response.json({ error: "authentication required" }, { status: 401 });
  }
  if (!lookupSession(token)) {
    return Response.json({ error: "invalid or expired session" }, { status: 401 });
  }
  return null;
}
