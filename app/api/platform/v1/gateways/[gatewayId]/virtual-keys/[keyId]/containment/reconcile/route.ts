import { getPlatformDeploymentAccess } from "@/lib/platform-deployment-access";
import { withPlatformIdentity } from "@/lib/platform-access";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ gatewayId: string; keyId: string }> };

export async function POST(request: Request, context: Context) {
  return withPlatformIdentity(request, async (_identity, actor, audit) => {
    const { gatewayId, keyId } = await context.params;
    audit.set({
      action: "platform:virtual_key_containment_reconcile",
      gatewayId,
      targetKind: "virtual_key",
      targetId: keyId,
      effectiveAccess: "platform_admin",
    });
    const access = await getPlatformDeploymentAccess();
    return Response.json(await access.reconcileContainedKey(actor, gatewayId, keyId));
  });
}
