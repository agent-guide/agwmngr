import { withPlatformAccess } from "@/lib/access";
import { proxyToGateway } from "@/lib/gateway-proxy";
import { resolvePlatformGatewayScope } from "@/lib/platform-gateway-scope";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ gatewayId: string; path?: string[] }> };

const handle = withPlatformAccess(async (request, _access, context: Context) => {
  const { gatewayId, path = [] } = await context.params;
  if (request.method !== "GET") {
    return Response.json({ error: "Gateway observability is read-only" }, { status: 405 });
  }
  const allowedRoots = new Set(["llm", "mcp", "acp", "interactions"]);
  if (path.length > 0 && !allowedRoots.has(path[0])) {
    return Response.json({ error: "Gateway metric route not found" }, { status: 404 });
  }
  const scope = resolvePlatformGatewayScope(gatewayId);
  if (!scope.ok) return scope.response;
  const suffix = path.length ? `/${path.map(encodeURIComponent).join("/")}` : "";
  // proxyToGateway preserves the inbound query string. Passing it in the
  // target as well would turn `?limit=50` into `?limit=50?limit=50`.
  return proxyToGateway(request, `/admin/metrics${suffix}`, scope.gateway);
});

export { handle as GET };
