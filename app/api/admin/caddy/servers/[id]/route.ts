import { requireAuth } from "@/lib/require-auth";
import { deleteServer, getServer, updateServer } from "@/lib/caddy-manager";
import { AppError, ErrNotFound, ErrReadOnly, type ServerRequest } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const { id } = await params;
  try {
    const srv = await getServer(id);
    return Response.json(srv);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: Request, { params }: Params) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const { id } = await params;
  let body: ServerRequest;
  try {
    body = (await req.json()) as ServerRequest;
  } catch {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }
  body.id = id;

  try {
    await updateServer(body);
    const srv = await getServer(id);
    return Response.json(srv);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const deny = requireAuth(req);
  if (deny) return deny;

  const { id } = await params;
  try {
    await deleteServer(id);
    return Response.json({ status: "deleted", id });
  } catch (e) {
    return errorResponse(e);
  }
}

function errorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    if (e.message.includes(ErrNotFound)) return Response.json({ error: "server not found" }, { status: 404 });
    if (e.message.includes(ErrReadOnly)) return Response.json({ error: e.message }, { status: 403 });
    return Response.json({ error: e.message }, { status: e.status });
  }
  return Response.json({ error: String(e) }, { status: 500 });
}
