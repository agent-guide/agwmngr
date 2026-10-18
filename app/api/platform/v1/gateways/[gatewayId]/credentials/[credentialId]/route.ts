import { withPlatformAccess } from "@/lib/access";
import { resolvePlatformGatewayScope } from "@/lib/platform-gateway-scope";
import { proxySecretResource } from "@/lib/secret-resource-proxy";

type Context = { params: Promise<{ gatewayId: string; credentialId: string }> };
export const dynamic = "force-dynamic";

const handle = withPlatformAccess(async (request, _access, context: Context) => {
  const { gatewayId, credentialId } = await context.params;
  const scope = resolvePlatformGatewayScope(gatewayId);
  if (!scope.ok) return scope.response;
  return proxySecretResource(
    request,
    scope.gateway,
    `/admin/credentials/${encodeURIComponent(credentialId)}`,
    "credential",
    credentialId,
  );
});

export { handle as GET, handle as PUT, handle as DELETE };
