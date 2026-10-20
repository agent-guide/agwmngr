import { getPlatformDeploymentAccess } from "@/lib/platform-deployment-access";
import { forwardPlatformPermission } from "@/lib/platform-invocation-forward";
import { platformIdentityBody, requiredText, withPlatformIdentity } from "@/lib/platform-access";
import { IdentityError } from "@/packages/platform/services/identity";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tenantId: string; contextId: string }> };

export async function POST(request: Request, context: Context) {
  return withPlatformIdentity(request, async (_identity, actor, audit) => {
    const { tenantId, contextId } = await context.params;
    const body = await platformIdentityBody(request, ["request_id", "outcome", "option_id"]);
    const requestId = requiredText(body, "request_id");
    const outcome = body.outcome === undefined ? "cancelled" : requiredText(body, "outcome");
    if (outcome !== "selected" && outcome !== "cancelled") {
      throw new IdentityError("invalid_input", "outcome must be selected or cancelled");
    }
    audit.set({
      action: "tenant:agent_invocation_permission",
      tenantId,
      targetKind: "deployment_invocation",
      targetId: contextId,
      effectiveAccess: "member",
    });
    const access = await getPlatformDeploymentAccess();
    const upstream = await access.withInvocation(actor, tenantId, contextId, (authorized) =>
      forwardPlatformPermission(authorized, {
        request_id: requestId,
        outcome,
        ...(typeof body.option_id === "string" && body.option_id
          ? { option_id: body.option_id } : {}),
      }, request.signal));
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
    });
  });
}
