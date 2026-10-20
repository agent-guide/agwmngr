import { getPlatformDeploymentAccess } from "@/lib/platform-deployment-access";
import { platformIdentityBody, requiredText, withPlatformIdentity } from "@/lib/platform-access";
import { IdentityError } from "@/packages/platform/services/identity";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ gatewayId: string; path?: string[] }> };

async function handler(request: Request, context: Context) {
  return withPlatformIdentity(request, async (_identity, actor, audit) => {
    const { gatewayId, path = [] } = await context.params;
    const access = await getPlatformDeploymentAccess();
    audit.set({
      action: `platform:deployment_key_binding_${request.method.toLowerCase()}`,
      gatewayId,
      targetKind: "deployment_key_binding",
      targetId: path[0] ?? null,
      effectiveAccess: "platform_admin",
    });
    if (request.method === "GET" && path.length === 0) {
      const [items, candidates] = await Promise.all([
        access.bindings(actor, gatewayId),
        access.bindingCandidates(actor, gatewayId),
      ]);
      return Response.json({ items, candidates });
    }
    if (request.method === "PUT" && path.length === 1) {
      const body = await platformIdentityBody(request, ["key_id"]);
      return Response.json(await access.bind(
        actor,
        gatewayId,
        path[0],
        requiredText(body, "key_id"),
      ));
    }
    if (request.method === "POST" && path.length === 2 && path[1] === "abandon") {
      await access.abandonBinding(actor, gatewayId, path[0]);
      return new Response(null, { status: 204 });
    }
    if (request.method === "DELETE" && path.length === 1) {
      await access.unbind(actor, gatewayId, path[0]);
      return new Response(null, { status: 204 });
    }
    throw new IdentityError("not_found", "deployment key-binding route not found");
  });
}

export const GET = handler;
export const PUT = handler;
export const POST = handler;
export const DELETE = handler;
