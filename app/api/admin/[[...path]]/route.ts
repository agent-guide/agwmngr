import {
  requireGatewayCompatibilityAccess,
  actionForProxyPath,
  finalizeAccess,
} from "@/lib/access";
import { proxyToGateway } from "@/lib/gateway-proxy";
import { gatewayCutoverDecision } from "@/lib/gateway-cutover";
import { withPlatformRouteMutationSafety } from "@/lib/platform-route-mutation";

async function handle(req: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path } = await params;
  const segments = path ?? [];
  const proxyPath = "/admin/" + segments.join("/");

  // Derive the action from method + canonical proxyPath (§2.1), then resolve the
  // active gateway, membership, role, and decrypted credentials in one guard.
  const action = actionForProxyPath(req.method, proxyPath);
  const start = Date.now();
  const guard = requireGatewayCompatibilityAccess(req, action);
  if (!guard.ok) return guard.res;

  const cutover = gatewayCutoverDecision(req.method, proxyPath);
  if (!cutover.allowed) {
    const status = cutover.reason === "scoped_replacement_required" ||
      cutover.reason === "runtime_execution_removed" ? 410 : 404;
    finalizeAccess(guard.ctx, {
      http_status: status,
      duration_ms: Date.now() - start,
      failure_reason: cutover.reason ?? "not_allowlisted",
    });
    return Response.json(
      { error: "this legacy Gateway route was removed; use its scoped platform API" },
      { status },
    );
  }

  const forward = (request = req) => proxyToGateway(request, proxyPath, guard.ctx.gateway);
  const res = cutover.routeMutation
    ? await withPlatformRouteMutationSafety(
      req,
      guard.ctx.gateway.id,
      guard.ctx.gateway,
      proxyPath,
      (signal) => forward(new Request(req, { signal })),
    )
    : await forward();

  // Finalize the open audit row (no-op for plain reads, which aren't audited).
  finalizeAccess(guard.ctx, { http_status: res.status, duration_ms: Date.now() - start });
  return res;
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;
