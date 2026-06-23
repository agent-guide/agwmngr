import { getAuthToken } from "@/lib/require-auth";
import { lookupSession, setActiveGateway } from "@/lib/session";
import { listGatewaysForUser } from "@/lib/db";

// Point the current session at an active gateway (the switcher target). The
// target must be one the user can actually reach.
export async function POST(req: Request) {
  const session = lookupSession(getAuthToken(req));
  if (!session) return Response.json({ error: "invalid or expired session" }, { status: 401 });

  let body: { gateway_id?: string | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  const gatewayId = body.gateway_id ? String(body.gateway_id) : null;
  if (gatewayId) {
    const accessible = listGatewaysForUser(session.userId, session.isPlatformAdmin);
    if (!accessible.some((g) => g.id === gatewayId)) {
      return Response.json({ error: "you do not have access to that gateway" }, { status: 403 });
    }
  }

  setActiveGateway(session.token, gatewayId);
  return Response.json({ active_gateway_id: gatewayId });
}
