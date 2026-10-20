import { withPlatformAccess } from "@/lib/access";
import { resolvePlatformGatewayScope } from "@/lib/platform-gateway-scope";
import { gatewayRequestJSON } from "@/packages/gateway-client/admin";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ gatewayId: string; keyId: string }> };

export const POST = withPlatformAccess(async (_request, _access, context: Context) => {
  const { gatewayId, keyId } = await context.params;
  const scope = resolvePlatformGatewayScope(gatewayId);
  if (!scope.ok) return scope.response;
  const result = await gatewayRequestJSON(
    "GET",
    `/admin/virtual_keys/${encodeURIComponent(keyId)}`,
    scope.gateway,
  );
  if (result.status >= 400) {
    return Response.json({ error: "Virtual Key could not be recovered" }, { status: result.status });
  }
  const row = result.body as { id?: unknown; key?: unknown } | null;
  if (typeof row?.key !== "string" || !row.key) {
    return Response.json({ error: "Virtual Key has no stored bearer" }, { status: 404 });
  }
  return Response.json({ id: typeof row.id === "string" ? row.id : keyId, key: row.key });
});
