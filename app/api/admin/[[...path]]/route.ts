import { requireGatewayAccess, actionForProxyPath, finalizeAccess } from "@/lib/access";
import { proxyToGateway } from "@/lib/gateway-proxy";

async function handle(req: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path } = await params;
  const segments = path ?? [];
  const proxyPath = "/admin/" + segments.join("/");

  // Derive the action from method + canonical proxyPath (§2.1), then resolve the
  // active gateway, membership, role, and decrypted credentials in one guard.
  const action = actionForProxyPath(req.method, proxyPath);
  const start = Date.now();
  const guard = requireGatewayAccess(req, action);
  if (!guard.ok) return guard.res;

  const res = await proxyToGateway(req, proxyPath, guard.ctx.gateway);

  // Finalize the open audit row (no-op for plain reads, which aren't audited).
  finalizeAccess(guard.ctx, { http_status: res.status, duration_ms: Date.now() - start });
  return res;
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;
