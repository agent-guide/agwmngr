import { withPlatformIdentity } from "@/lib/platform-access";
import { getPlatformRuntime } from "@/lib/platform-identity";
import { resolvePlatformGatewayScope } from "@/lib/platform-gateway-scope";
import { GatewayAgentCompatibilityService } from "@/lib/platform-gateway-agent-compatibility";
import { platformDeploymentGateway } from "@/lib/platform-deployment-gateway";
import { DeploymentAccessRegistry } from "@/packages/platform/services/deployment-access-registry";
import { AgentDeploymentRegistry } from "@/packages/platform/services/deployment-registry";
import { GatewayCompatibilityRegistry } from "@/packages/platform/services/gateway-compatibility-registry";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ gatewayId: string; path?: string[] }> };

async function handle(request: Request, context: Context) {
  return withPlatformIdentity(request, async (identity, actor, audit) => {
    const { gatewayId, path = [] } = await context.params;
    await identity.requirePlatformAdmin(actor);
    audit.set({
      action: `platform:gateway_agent_${request.method.toLowerCase()}`,
      gatewayId,
      effectiveAccess: "platform_admin",
      targetKind: path[0] === "routes" ? "gateway_agent_route" : "gateway_agent",
      targetId: path[0] === "routes" ? path[1] ?? null : path[0] ?? null,
    });
    const scope = resolvePlatformGatewayScope(gatewayId);
    if (!scope.ok) return scope.response;
    let body: unknown;
    if (!["GET", "DELETE"].includes(request.method)) {
      try { body = await request.json(); }
      catch { return Response.json({ error: "invalid JSON body" }, { status: 400 }); }
    }
    const { database } = await getPlatformRuntime();
    return new GatewayAgentCompatibilityService(
      new AgentDeploymentRegistry(database),
      new GatewayCompatibilityRegistry(database),
      new DeploymentAccessRegistry(database),
      identity,
      platformDeploymentGateway,
    ).handle({
      actor,
      gatewayId,
      gateway: scope.gateway,
      method: request.method,
      path,
      query: new URL(request.url).search,
      body,
    });
  });
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
