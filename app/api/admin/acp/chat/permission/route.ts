import { requireAuth } from "@/lib/require-auth";
import { ACPRouteError, dataplaneCandidates, resolveACPRouteTarget } from "@/lib/acp-dataplane";

// Resolves an interactive permission request on the ACP data plane. The agent's
// turn (held open on /turn) resumes once this lands. Explicit route — takes
// precedence over the gateway-admin catch-all.

interface PermissionBody {
  route_id?: string;
  virtual_key?: string;
  request_id?: string;
  outcome?: "selected" | "cancelled";
  option_id?: string;
}

export async function POST(req: Request): Promise<Response> {
  const deny = requireAuth(req);
  if (deny) return deny;

  let payload: PermissionBody;
  try {
    payload = (await req.json()) as PermissionBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const routeId = payload.route_id?.trim();
  if (!routeId) return Response.json({ error: "route_id is required" }, { status: 400 });
  if (!payload.request_id?.trim()) return Response.json({ error: "request_id is required" }, { status: 400 });

  let target;
  try {
    target = await resolveACPRouteTarget(routeId);
  } catch (e) {
    if (e instanceof ACPRouteError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: `gateway unreachable: ${String(e)}` }, { status: 502 });
  }

  const virtualKey = payload.virtual_key?.trim();
  const decision: Record<string, unknown> = {
    request_id: payload.request_id.trim(),
    outcome: payload.outcome ?? "cancelled",
  };
  if (payload.option_id?.trim()) decision.option_id = payload.option_id.trim();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (virtualKey) headers["Authorization"] = `Bearer ${virtualKey}`;
  if (target.host) headers["Host"] = target.host;

  const requestBody = JSON.stringify(decision);
  let lastError = "";

  // Same host-candidate handling as the turn route: a >=400 is a real dispatcher
  // rejection (surface it); a 2xx with a body is the resolved response; an empty
  // 2xx is a Caddy fall-through (wrong Host) — try the next candidate.
  for (const base of dataplaneCandidates()) {
    const url = `${base}${target.pathPrefix}/permission`;
    let upstream: Response;
    try {
      upstream = await fetch(url, { method: "POST", headers, body: requestBody });
    } catch (e) {
      lastError = `data plane unreachable at ${url}: ${String(e)}`;
      continue;
    }

    const text = await upstream.text().catch(() => "");
    if (upstream.status >= 400) {
      return Response.json(
        { error: text.trim() || `data plane returned ${upstream.status}` },
        { status: upstream.status },
      );
    }
    if (text.trim()) {
      try {
        return Response.json(JSON.parse(text), { status: 200 });
      } catch {
        return Response.json({ status: "resolved" }, { status: 200 });
      }
    }
    lastError = `data plane at ${url} did not acknowledge the permission — its Host (${new URL(base).host}) may not match the dispatcher site`;
  }

  return Response.json({ error: lastError || "data plane did not acknowledge the permission" }, { status: 502 });
}
