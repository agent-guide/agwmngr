import { extractBearerToken, lookupSession } from "./session";

export function getAuthToken(req: Request): string {
  return extractBearerToken(req.headers.get("Authorization"));
}

export function requireAuth(req: Request): Response | null {
  const adminUser = process.env.CADDYMGR_ADMIN_USER ?? "";
  if (!adminUser) {
    return Response.json({ error: "admin authentication not configured" }, { status: 401 });
  }
  const token = getAuthToken(req);
  if (!token) {
    return Response.json({ error: "authentication required" }, { status: 401 });
  }
  if (!lookupSession(token)) {
    return Response.json({ error: "invalid or expired session" }, { status: 401 });
  }
  return null;
}
