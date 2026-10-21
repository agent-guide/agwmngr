import { getPlatformDeploymentAccess } from "@/lib/platform-deployment-access";
import { getPlatformRuntime } from "@/lib/platform-identity";
import { platformIdentityBody, requiredText, withPlatformIdentity } from "@/lib/platform-access";
import { AgentDeploymentRegistry } from "@/packages/platform/services/deployment-registry";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ gatewayId: string }> };

async function handle(request: Request, context: Context) {
  return withPlatformIdentity(request, async (identity, actor, audit) => {
    const { gatewayId } = await context.params;
    await identity.authorizePlatformGateway(actor, gatewayId);
    audit.set({
      action: request.method === "GET"
        ? "platform:gateway_decommission_status"
        : "platform:gateway_decommission",
      gatewayId,
      effectiveAccess: "platform_admin",
      targetKind: "gateway_decommission",
      targetId: gatewayId,
    });
    if (request.method === "GET") {
      const { database } = await getPlatformRuntime();
      return Response.json({
        items: await new AgentDeploymentRegistry(database).listForGateway(gatewayId),
      });
    }
    const body = await platformIdentityBody(request, ["request_key"]);
    const result = await (await getPlatformDeploymentAccess()).decommissionSubject(
      actor,
      { gatewayId },
      requiredText(body, "request_key"),
    );
    return Response.json(result, { status: result.failed.length === 0 ? 200 : 202 });
  });
}

export { handle as GET, handle as POST };
