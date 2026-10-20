import { withPlatformAccess } from "@/lib/access";
import { getPlatformDeploymentAccess } from "@/lib/platform-deployment-access";
import { platformIdentityBody, requiredText, withPlatformIdentity } from "@/lib/platform-access";
import { resolvePlatformGatewayScope } from "@/lib/platform-gateway-scope";
import { proxySecretResource } from "@/lib/secret-resource-proxy";
import { IdentityError } from "@/packages/platform/services/identity";

type Context = { params: Promise<{ gatewayId: string }> };
export const dynamic = "force-dynamic";

export const GET = withPlatformAccess(async (request, _access, context: Context) => {
  const { gatewayId } = await context.params;
  const scope = resolvePlatformGatewayScope(gatewayId);
  if (!scope.ok) return scope.response;
  return proxySecretResource(
    request,
    scope.gateway,
    "/admin/virtual_keys",
    "virtualKey",
  );
});

export const POST = async (request: Request, context: Context) =>
  withPlatformIdentity(request, async (_identity, actor, audit) => {
    const { gatewayId } = await context.params;
    const body = await platformIdentityBody(request, [
      "id", "tag", "description", "disabled", "allowed_route_ids", "rate_limits",
      "status_message", "expires_at",
    ]);
    if (body.allowed_route_ids !== undefined && (!Array.isArray(body.allowed_route_ids) ||
      body.allowed_route_ids.some((value) => typeof value !== "string"))) {
      throw new IdentityError("invalid_input", "allowed_route_ids must be a string array");
    }
    const id = requiredText(body, "id");
    audit.set({
      action: "platform:virtual_key_create",
      gatewayId,
      targetKind: "virtual_key",
      targetId: id,
      effectiveAccess: "platform_admin",
    });
    const access = await getPlatformDeploymentAccess();
    const created = await access.createKey(actor, gatewayId, {
      id,
      ...(typeof body.tag === "string" && body.tag ? { tag: body.tag } : {}),
      ...(typeof body.description === "string" && body.description
        ? { description: body.description } : {}),
      disabled: body.disabled === undefined ? true : body.disabled === true,
      allowed_route_ids: (body.allowed_route_ids as string[] | undefined) ?? [],
      ...(body.rate_limits && typeof body.rate_limits === "object"
        ? { rate_limits: body.rate_limits } : {}),
      ...(typeof body.status_message === "string" && body.status_message
        ? { status_message: body.status_message } : {}),
      ...(typeof body.expires_at === "string" && body.expires_at
        ? { expires_at: body.expires_at } : {}),
    });
    return Response.json({ ...created.policy, key: created.bearer }, { status: 201 });
  });
