import { getPlatformDeploymentAccess } from "@/lib/platform-deployment-access";
import { platformIdentityBody, withPlatformIdentity } from "@/lib/platform-access";
import { IdentityError } from "@/packages/platform/services/identity";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ gatewayId: string; keyId: string; action: string }> };

export async function POST(request: Request, context: Context) {
  return withPlatformIdentity(request, async (_identity, actor, audit) => {
    const { gatewayId, keyId, action } = await context.params;
    if (action !== "enable" && action !== "disable" && action !== "reconcile") {
      throw new IdentityError("not_found", "Virtual Key lifecycle action not found");
    }
    audit.set({
      action: `platform:virtual_key_${action}`,
      gatewayId,
      targetKind: "virtual_key",
      targetId: keyId,
      effectiveAccess: "platform_admin",
    });
    const access = await getPlatformDeploymentAccess();
    if (action === "reconcile") {
      const body = await platformIdentityBody(request, ["resolution"]);
      const resolution = body.resolution ?? "apply_desired";
      if (resolution !== "apply_desired" && resolution !== "adopt_live") {
        throw new IdentityError(
          "invalid_input",
          "resolution must be apply_desired or adopt_live",
        );
      }
      return Response.json(await access.reconcileKey(
        actor,
        gatewayId,
        keyId,
        resolution,
      ));
    }
    return Response.json(await access.setKeyEnabled(
      actor,
      gatewayId,
      keyId,
      action === "enable",
    ));
  });
}
