import { requireAuth } from "@/lib/require-auth";
import { deleteRoute, listRoutes, updateRoute } from "@/lib/caddy-manager";
import { AppError, ErrNotFound, ErrReadOnly, type RouteRequest } from "@/lib/types";

type Params = { params: Promise<{ id: string; routeId: string }> };

export async function PUT(req: Request, { params }: Params) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const { id: serverID, routeId } = await params;
  let body: RouteRequest;
  try {
    body = (await req.json()) as RouteRequest;
  } catch {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }
  body.id = routeId;

  try {
    await updateRoute(serverID, routeId, body);
    const routes = await listRoutes(serverID);
    const updated = routes.find((r) => r.id === routeId);
    return Response.json(updated ?? { id: routeId });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const { id: serverID, routeId } = await params;
  try {
    await deleteRoute(serverID, routeId);
    return Response.json({ status: "deleted", id: routeId });
  } catch (e) {
    return errorResponse(e);
  }
}

function errorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    if (e.message.includes(ErrNotFound)) return Response.json({ error: "route not found" }, { status: 404 });
    if (e.message.includes(ErrReadOnly)) return Response.json({ error: e.message }, { status: 403 });
    return Response.json({ error: e.message }, { status: e.status });
  }
  return Response.json({ error: String(e) }, { status: 500 });
}
