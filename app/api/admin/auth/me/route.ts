import { requireAuth, getAuthToken } from "@/lib/require-auth";
import { lookupSession } from "@/lib/session";

export function GET(req: Request) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const session = lookupSession(getAuthToken(req))!;
  return Response.json({ username: session.username, created_at: session.createdAt });
}
