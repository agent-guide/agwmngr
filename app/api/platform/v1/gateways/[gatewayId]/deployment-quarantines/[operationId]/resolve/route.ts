import { getPlatformDeploymentAccess } from "@/lib/platform-deployment-access";
import { withPlatformIdentity } from "@/lib/platform-access";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ gatewayId: string; operationId: string }> };

export async function POST(request: Request, context: Context) {
  return withPlatformIdentity(request, async (_identity, actor, audit) => {
    const { gatewayId, operationId } = await context.params;
    audit.set({
      action: "platform:deployment_quarantine_resolve",
      gatewayId,
      effectiveAccess: "platform_admin",
      targetKind: "deployment_operation",
      targetId: operationId,
    });
    return Response.json(await (await getPlatformDeploymentAccess()).resolveDeploymentQuarantine(
      actor,
      gatewayId,
      operationId,
    ));
  });
}
