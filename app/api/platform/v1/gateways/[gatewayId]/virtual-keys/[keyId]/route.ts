import { getPlatformDeploymentAccess } from "@/lib/platform-deployment-access";
import { platformIdentityBody, withPlatformIdentity } from "@/lib/platform-access";
import { resolvePlatformGatewayScope } from "@/lib/platform-gateway-scope";
import { proxySecretResource } from "@/lib/secret-resource-proxy";
import { withPlatformAccess } from "@/lib/access";
import { IdentityError } from "@/packages/platform/services/identity";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ gatewayId: string; keyId: string }> };

export const GET = withPlatformAccess(async (request, _access, context: Context) => {
  const { gatewayId, keyId } = await context.params;
  const scope = resolvePlatformGatewayScope(gatewayId);
  if (!scope.ok) return scope.response;
  return proxySecretResource(
    request,
    scope.gateway,
    `/admin/virtual_keys/${encodeURIComponent(keyId)}`,
    "virtualKey",
    keyId,
  );
});

export async function PUT(request: Request, context: Context) {
  return withPlatformIdentity(request, async (_identity, actor, audit) => {
    const { gatewayId, keyId } = await context.params;
    const body = await platformIdentityBody(request, [
      "tag", "description", "disabled", "allowed_route_ids", "rate_limits",
      "status_message", "expires_at",
    ]);
    if (typeof body.disabled !== "boolean" || !Array.isArray(body.allowed_route_ids) ||
      body.allowed_route_ids.some((value) => typeof value !== "string")) {
      throw new IdentityError(
        "invalid_input",
        "disabled and a string-array allowed_route_ids are required",
      );
    }
    audit.set({
      action: "platform:virtual_key_update",
      gatewayId,
      targetKind: "virtual_key",
      targetId: keyId,
      effectiveAccess: "platform_admin",
    });
    const access = await getPlatformDeploymentAccess();
    return Response.json(await access.updateKey(actor, gatewayId, keyId, {
      id: keyId,
      ...(typeof body.tag === "string" && body.tag ? { tag: body.tag } : {}),
      ...(typeof body.description === "string" && body.description
        ? { description: body.description } : {}),
      disabled: body.disabled,
      allowed_route_ids: body.allowed_route_ids as string[],
      ...(body.rate_limits && typeof body.rate_limits === "object"
        ? { rate_limits: body.rate_limits } : {}),
      ...(typeof body.status_message === "string" && body.status_message
        ? { status_message: body.status_message } : {}),
      ...(typeof body.expires_at === "string" && body.expires_at
        ? { expires_at: body.expires_at } : {}),
    }));
  });
}

export async function DELETE(request: Request, context: Context) {
  return withPlatformIdentity(request, async (_identity, actor, audit) => {
    const { gatewayId, keyId } = await context.params;
    audit.set({
      action: "platform:virtual_key_delete",
      gatewayId,
      targetKind: "virtual_key",
      targetId: keyId,
      effectiveAccess: "platform_admin",
    });
    const access = await getPlatformDeploymentAccess();
    await access.deleteKey(actor, gatewayId, keyId);
    return new Response(null, { status: 204 });
  });
}
