import { withPlatformAccess } from "@/lib/access";
import { resolvePlatformGatewayScope } from "@/lib/platform-gateway-scope";
import { proxySecretResource } from "@/lib/secret-resource-proxy";

type Context = { params: Promise<{ gatewayId: string }> };
export const dynamic = "force-dynamic";

export const GET = withPlatformAccess(async (request, _access, context: Context) => {
  const { gatewayId } = await context.params;
  const scope = resolvePlatformGatewayScope(gatewayId);
  if (!scope.ok) return scope.response;
  return proxySecretResource(request, scope.gateway, "/admin/llm/providers", "provider");
});
