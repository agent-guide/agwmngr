import { getPlatformDeploymentAccess } from "@/lib/platform-deployment-access";
import { getPlatformRuntime } from "@/lib/platform-identity";
import { platformIdentityBody, requiredText, withPlatformIdentity } from "@/lib/platform-access";
import { AgentDeploymentRegistry } from "@/packages/platform/services/deployment-registry";
import { IdentityError } from "@/packages/platform/services/identity";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ gatewayId: string; deploymentId: string }> };

async function handle(request: Request, context: Context) {
  return withPlatformIdentity(request, async (identity, actor, audit) => {
    const { gatewayId, deploymentId } = await context.params;
    await identity.authorizePlatformGateway(actor, gatewayId);
    audit.set({
      action: request.method === "GET"
        ? "platform:deployment_decommission_status"
        : "platform:deployment_decommission",
      gatewayId,
      effectiveAccess: "platform_admin",
      targetKind: "agent_deployment",
      targetId: deploymentId,
    });
    if (request.method === "GET") {
      const { database } = await getPlatformRuntime();
      const registry = new AgentDeploymentRegistry(database);
      const item = await registry.get(deploymentId);
      if (!item || item.target.gatewayId !== gatewayId) {
        throw new IdentityError("not_found", "Agent deployment not found on this Gateway");
      }
      return Response.json({ item, operations: await registry.operations(deploymentId) });
    }
    const body = await platformIdentityBody(request, ["request_key"]);
    const operation = await (await getPlatformDeploymentAccess()).decommission(
      actor,
      gatewayId,
      deploymentId,
      requiredText(body, "request_key"),
    );
    return Response.json(operation, { status: operation.status === "succeeded" ? 200 : 202 });
  });
}

export { handle as GET, handle as POST };
