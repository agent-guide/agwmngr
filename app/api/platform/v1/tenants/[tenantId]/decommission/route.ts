import { getPlatformDeploymentAccess } from "@/lib/platform-deployment-access";
import { getPlatformRuntime } from "@/lib/platform-identity";
import { platformIdentityBody, requiredText, withPlatformIdentity } from "@/lib/platform-access";
import { AgentDeploymentRegistry } from "@/packages/platform/services/deployment-registry";
import { IdentityError } from "@/packages/platform/services/identity";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tenantId: string }> };

async function handle(request: Request, context: Context) {
  return withPlatformIdentity(request, async (identity, actor, audit) => {
    const { tenantId } = await context.params;
    await identity.requirePlatformAdmin(actor);
    const tenant = (await identity.listTenants(actor)).find((candidate) => candidate.id === tenantId);
    if (!tenant) throw new IdentityError("not_found", "Tenant not found");
    audit.set({
      action: request.method === "GET"
        ? "platform:tenant_decommission_status"
        : "platform:tenant_decommission",
      tenantId,
      effectiveAccess: "platform_admin",
      targetKind: "tenant_decommission",
      targetId: tenantId,
    });
    if (request.method === "GET") {
      const { database } = await getPlatformRuntime();
      return Response.json({
        items: await new AgentDeploymentRegistry(database).listForTenantSubject(tenantId),
      });
    }
    const body = await platformIdentityBody(request, ["request_key"]);
    const result = await (await getPlatformDeploymentAccess()).decommissionSubject(
      actor,
      { tenantId },
      requiredText(body, "request_key"),
    );
    return Response.json(result, { status: result.failed.length === 0 ? 200 : 202 });
  });
}

export { handle as GET, handle as POST };
