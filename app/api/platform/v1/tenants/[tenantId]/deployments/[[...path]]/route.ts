import { getPlatformDeployments } from "@/lib/platform-deployments";
import { platformIdentityBody, requiredText, withPlatformIdentity } from "@/lib/platform-access";
import { IdentityError } from "@/packages/platform/services/identity";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tenantId: string; path?: string[] }> };

async function handler(request: Request, context: Context) {
  return withPlatformIdentity(request, async (_identity, actor, audit) => {
    const { tenantId, path = [] } = await context.params;
    const deployments = await getPlatformDeployments();
    audit.set({
      action: `tenant:agent_deployment_${request.method.toLowerCase()}`,
      tenantId,
      targetKind: "agent_deployment",
      targetId: path[0] ?? null,
    });
    if (request.method === "GET" && path.length === 0) {
      return Response.json({ items: await deployments.list(actor, tenantId) });
    }
    if (request.method === "POST" && path.length === 0) {
      const body = await platformIdentityBody(request, ["release_id", "gateway_id", "request_key"]);
      const item = await deployments.create(actor, tenantId, {
        releaseId: requiredText(body, "release_id"),
        gatewayId: requiredText(body, "gateway_id"),
        requestKey: requiredText(body, "request_key"),
      });
      audit.set({ gatewayId: item.target.gatewayId, targetId: item.id, effectiveAccess: "manage" });
      return Response.json(item, { status: 201 });
    }
    if (request.method === "GET" && path.length === 1) {
      const item = await deployments.get(actor, tenantId, path[0]);
      audit.set({ gatewayId: item.target.gatewayId, effectiveAccess: "view" });
      return Response.json(item);
    }
    if (request.method === "DELETE" && path.length === 1) {
      await deployments.cancel(actor, tenantId, path[0]);
      return new Response(null, { status: 204 });
    }
    throw new IdentityError("not_found", "Agent deployment route not found");
  });
}

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
