import { getAuthToken } from "@/lib/require-auth";
import { lookupSession, setActiveGateway } from "@/lib/session";
import { listGatewaysForUser } from "@/lib/db";

// Gateways the current user may select in the switcher (platform admins see all,
// members see only those they belong to). Available to any logged-in user.
export function GET(req: Request) {
  const session = lookupSession(getAuthToken(req));
  if (!session) return Response.json({ error: "invalid or expired session" }, { status: 401 });

  const items = listGatewaysForUser(session.userId, session.isPlatformAdmin);

  // Self-heal a stale active gateway: if the session points at a gateway the
  // user can no longer reach (membership removed / gateway deleted), drop it and
  // fall back to the first accessible one.
  let active = session.activeGatewayId;
  if (active && !items.some((g) => g.id === active)) {
    active = items[0]?.id ?? null;
    setActiveGateway(session.token, active);
  }

  return Response.json({ items, active_gateway_id: active });
}
