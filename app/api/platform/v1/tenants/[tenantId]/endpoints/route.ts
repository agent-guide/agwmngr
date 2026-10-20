import { getPlatformDeploymentAccess } from "@/lib/platform-deployment-access";
import { withPlatformIdentity } from "@/lib/platform-access";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tenantId: string }> };

export async function GET(request: Request, context: Context) {
  return withPlatformIdentity(request, async (_identity, actor, audit) => {
    const { tenantId } = await context.params;
    audit.set({
      action: "tenant:agent_endpoint_read",
      tenantId,
      targetKind: "agent_endpoint",
      effectiveAccess: "member",
    });
    const access = await getPlatformDeploymentAccess();
    return Response.json({ items: await access.endpoints(actor, tenantId) });
  });
}
