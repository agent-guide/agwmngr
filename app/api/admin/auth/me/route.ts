import { requireAuth, getAuthToken } from "@/lib/require-auth";
import { lookupSession } from "@/lib/session";

export function GET(req: Request) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const session = lookupSession(getAuthToken(req))!;
  return Response.json({
    username: session.username,
    is_platform_admin: session.isPlatformAdmin,
    active_gateway_id: session.activeGatewayId,
    created_at: session.createdAt,
  });
}
