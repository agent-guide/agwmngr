import { withPlatformAccess } from "@/lib/access";
import { resolvePlatformGatewayScope } from "@/lib/platform-gateway-scope";
import { proxyToGateway } from "@/lib/gateway-proxy";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ gatewayId: string; path?: string[] }> };

function upstreamPath(method: string, path: string[]): string | null {
  if (method === "GET") {
    const key = path.join("/");
    const allowed = new Set([
      "acp", "acp/inflight", "builtin", "builtin/inflight",
      "mcp", "mcp/inflight", "mcp/progress", "mcp/history",
    ]);
    if (allowed.has(key)) {
      return `/admin/${path[0]}/runtime${path.length > 1 ? `/${path.slice(1).join("/")}` : ""}`;
    }
  }
  if (method === "DELETE" && path.length === 5 && path[0] === "acp" &&
    path[1] === "agents" && path[3] === "threads") {
    return `/admin/acp/runtime/agents/${encodeURIComponent(path[2])}` +
      `/threads/${encodeURIComponent(path[4])}`;
  }
  return null;
}

const handle = withPlatformAccess(async (request, _access, context: Context) => {
  const { gatewayId, path = [] } = await context.params;
  const target = upstreamPath(request.method, path);
  if (!target) return Response.json({ error: "runtime diagnostic route not found" }, { status: 404 });
  const scope = resolvePlatformGatewayScope(gatewayId);
  if (!scope.ok) return scope.response;
  return proxyToGateway(request, target, scope.gateway);
});

export { handle as GET, handle as DELETE };
