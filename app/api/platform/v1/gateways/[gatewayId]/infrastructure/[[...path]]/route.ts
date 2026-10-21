import { withPlatformAccess } from "@/lib/access";
import { proxyToGateway } from "@/lib/gateway-proxy";
import {
  isPlatformGatewayInfrastructureRouteMutation,
  platformGatewayInfrastructureTarget,
} from "@/lib/platform-gateway-infrastructure";
import { resolvePlatformGatewayScope } from "@/lib/platform-gateway-scope";
import { withPlatformRouteMutationSafety } from "@/lib/platform-route-mutation";
import { proxySecretResource } from "@/lib/secret-resource-proxy";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ gatewayId: string; path?: string[] }> };

const handle = withPlatformAccess(async (request, _access, context: Context) => {
  const { gatewayId, path = [] } = await context.params;
  const target = platformGatewayInfrastructureTarget(request.method, path);
  if (!target) return Response.json({ error: "Gateway infrastructure route not found" }, { status: 404 });
  const scope = resolvePlatformGatewayScope(gatewayId);
  if (!scope.ok) return scope.response;
  const forward = (proxyRequest = request) => {
    if (path[0] === "llm" && path[1] === "providers") {
      const itemId = path.length === 3 ? path[2] : undefined;
      return proxySecretResource(proxyRequest, scope.gateway, target, "provider", itemId);
    }
    return proxyToGateway(proxyRequest, target, scope.gateway);
  };
  return isPlatformGatewayInfrastructureRouteMutation(request.method, path)
    ? withPlatformRouteMutationSafety(
      request,
      gatewayId,
      scope.gateway,
      target,
      (signal) => forward(new Request(request, { signal })),
    )
    : forward();
});

export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
