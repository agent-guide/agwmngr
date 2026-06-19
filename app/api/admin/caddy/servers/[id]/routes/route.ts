import { requireAuth } from "@/lib/require-auth";
import { addRoute, listRoutes } from "@/lib/caddy-manager";
import { AppError, ErrConflict, ErrNotFound, ErrReadOnly, type RouteRequest } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const { id } = await params;
  try {
    const routes = await listRoutes(id);
    return Response.json({ items: routes });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, { params }: Params) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const { id: serverID } = await params;
  let body: RouteRequest;
  try {
    body = (await req.json()) as RouteRequest;
  } catch {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  try {
    await addRoute(serverID, body);
    const routes = await listRoutes(serverID);
    const created = routes.find((r) => r.id === body.id);
    return Response.json(created ?? { id: body.id }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

function errorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    if (e.message.includes(ErrNotFound)) return Response.json({ error: "server not found" }, { status: 404 });
    if (e.message.includes(ErrReadOnly)) return Response.json({ error: e.message }, { status: 403 });
    if (e.message.includes(ErrConflict)) return Response.json({ error: e.message }, { status: 409 });
    return Response.json({ error: e.message }, { status: e.status });
  }
  return Response.json({ error: String(e) }, { status: 500 });
}
