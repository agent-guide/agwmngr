import { withGatewayAccess } from "@/lib/access";
import { caddyConfigFor, createServer, getServer, listServers } from "@/lib/caddy-manager";
import { AppError, ErrConflict, ErrReadOnly, type ServerRequest } from "@/lib/types";

export const GET = withGatewayAccess("gateway:read", async (_req, access) => {
  const cfg = caddyConfigFor(access.gateway);

  try {
    const servers = await listServers(cfg);
    return Response.json({ items: servers });
  } catch (e) {
    return errorResponse(e);
  }
});

export const POST = withGatewayAccess("gateway:write", async (req, access) => {
  const cfg = caddyConfigFor(access.gateway);

  let body: ServerRequest;
  try {
    body = (await req.json()) as ServerRequest;
  } catch {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  try {
    await createServer(cfg, body);
    const srv = await getServer(cfg, body.id);
    return Response.json(srv, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
});

function errorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    if (e.message.includes(ErrReadOnly)) return Response.json({ error: e.message }, { status: 403 });
    if (e.message.includes(ErrConflict)) return Response.json({ error: e.message }, { status: 409 });
    return Response.json({ error: e.message }, { status: e.status });
  }
  return Response.json({ error: String(e) }, { status: 500 });
}
