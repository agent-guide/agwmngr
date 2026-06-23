import { withGatewayAccess } from "@/lib/access";
import { caddyConfigFor, addRoute, listRoutes } from "@/lib/caddy-manager";
import { AppError, ErrConflict, ErrNotFound, ErrReadOnly, type RouteRequest } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export const GET = withGatewayAccess("gateway:read", async (_req, access, { params }: Params) => {
  const cfg = caddyConfigFor(access.gateway);

  const { id } = await params;
  try {
    const routes = await listRoutes(cfg, id);
    return Response.json({ items: routes });
  } catch (e) {
    return errorResponse(e);
  }
});

export const POST = withGatewayAccess("gateway:write", async (req, access, { params }: Params) => {
  const cfg = caddyConfigFor(access.gateway);

  const { id: serverID } = await params;
  let body: RouteRequest;
  try {
    body = (await req.json()) as RouteRequest;
  } catch {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  try {
    await addRoute(cfg, serverID, body);
    const routes = await listRoutes(cfg, serverID);
    const created = routes.find((r) => r.id === body.id);
    return Response.json(created ?? { id: body.id }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
});

function errorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    if (e.message.includes(ErrNotFound)) return Response.json({ error: "server not found" }, { status: 404 });
    if (e.message.includes(ErrReadOnly)) return Response.json({ error: e.message }, { status: 403 });
    if (e.message.includes(ErrConflict)) return Response.json({ error: e.message }, { status: 409 });
    return Response.json({ error: e.message }, { status: e.status });
  }
  return Response.json({ error: String(e) }, { status: 500 });
}
