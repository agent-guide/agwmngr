import { requireAuth } from "@/lib/require-auth";
import { extractBearerToken, revokeSession } from "@/lib/session";

export function POST(req: Request) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const token = extractBearerToken(req.headers.get("Authorization"));
  if (token) revokeSession(token);
  return Response.json({ status: "logged_out" });
}
