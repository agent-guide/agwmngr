import { requireAuth } from "@/lib/require-auth";
import { createServer, getServer, listServers } from "@/lib/caddy-manager";
import { AppError, ErrConflict, ErrReadOnly, type ServerRequest } from "@/lib/types";

export async function GET(req: Request) {
  const deny = requireAuth(req);
  if (deny) return deny;

  try {
    const servers = await listServers();
    return Response.json({ items: servers });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  const deny = requireAuth(req);
  if (deny) return deny;

  let body: ServerRequest;
  try {
    body = (await req.json()) as ServerRequest;
  } catch {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  try {
    await createServer(body);
    const srv = await getServer(body.id);
    return Response.json(srv, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

function errorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    if (e.message.includes(ErrReadOnly)) return Response.json({ error: e.message }, { status: 403 });
    if (e.message.includes(ErrConflict)) return Response.json({ error: e.message }, { status: 409 });
    return Response.json({ error: e.message }, { status: e.status });
  }
  return Response.json({ error: String(e) }, { status: 500 });
}
