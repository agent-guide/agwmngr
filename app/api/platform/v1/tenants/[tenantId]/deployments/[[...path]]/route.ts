import { getPlatformDeployments } from "@/lib/platform-deployments";
import { getPlatformDeploymentAccess } from "@/lib/platform-deployment-access";
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
    if (request.method === "GET" && path.length === 2 && path[1] === "operations") {
      const items = await deployments.history(actor, tenantId, path[0]);
      return Response.json({ items });
    }
    if (request.method === "POST" && path.length === 2) {
      if (path[1] === "invocations") {
        const body = await platformIdentityBody(request, ["key_id"]);
        const keyId = body.key_id === undefined ? undefined : requiredText(body, "key_id");
        const access = await getPlatformDeploymentAccess();
        const item = await access.createInvocationContext(
          actor,
          tenantId,
          path[0],
          keyId,
        );
        audit.set({
          action: "tenant:agent_invocation_create",
          targetKind: "deployment_invocation",
          targetId: item.id,
          effectiveAccess: "member",
        });
        return Response.json(item, { status: 201 });
      }
      const body = await platformIdentityBody(request, path[1] === "rollback"
        ? ["request_key", "release_id"] : ["request_key"]);
      const requestKey = requiredText(body, "request_key");
      const deploymentId = path[0];
      const operation = path[1] === "apply"
        ? await deployments.apply(actor, tenantId, deploymentId, requestKey)
        : path[1] === "retry"
          ? await deployments.retry(actor, tenantId, deploymentId, requestKey)
          : path[1] === "take-offline"
            ? await deployments.takeOffline(actor, tenantId, deploymentId, requestKey)
            : path[1] === "online"
              ? await deployments.online(actor, tenantId, deploymentId, requestKey)
              : path[1] === "verify"
                ? await deployments.verify(actor, tenantId, deploymentId, requestKey)
                : path[1] === "rollback"
                  ? await deployments.rollback(
                    actor,
                    tenantId,
                    deploymentId,
                    requiredText(body, "release_id"),
                    requestKey,
                  )
                  : null;
      if (operation) {
        audit.set({ targetId: deploymentId, effectiveAccess: "manage" });
        return Response.json(operation, { status: operation.status === "succeeded" ? 200 : 202 });
      }
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
