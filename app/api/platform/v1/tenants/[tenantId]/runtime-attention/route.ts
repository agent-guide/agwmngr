import { getPlatformDeploymentObservability } from "@/lib/platform-deployment-observability";
import { withPlatformIdentity } from "@/lib/platform-access";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tenantId: string }> };

export async function GET(request: Request, context: Context) {
  return withPlatformIdentity(request, async (_identity, actor, audit) => {
    const { tenantId } = await context.params;
    audit.set({
      action: "tenant:runtime_attention_read",
      tenantId,
      targetKind: "invocation_context",
      effectiveAccess: "member",
    });
    const service = await getPlatformDeploymentObservability();
    const result = await service.runtimeAttention(actor, tenantId);
    return Response.json({
      own_invocations: result.ownInvocations,
      managed: result.managed,
    });
  });
}
