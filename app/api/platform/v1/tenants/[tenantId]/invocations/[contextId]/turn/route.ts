import { getPlatformDeploymentAccess } from "@/lib/platform-deployment-access";
import { forwardPlatformTurn } from "@/lib/platform-invocation-forward";
import { platformIdentityBody, withPlatformIdentity } from "@/lib/platform-access";
import { IdentityError } from "@/packages/platform/services/identity";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tenantId: string; contextId: string }> };

export async function POST(request: Request, context: Context) {
  return withPlatformIdentity(request, async (_identity, actor, audit) => {
    const { tenantId, contextId } = await context.params;
    const body = await platformIdentityBody(request, ["input", "session_id", "permission"]);
    if (typeof body.input !== "string" && body.permission === undefined) {
      throw new IdentityError("invalid_input", "input or permission is required");
    }
    if (body.session_id !== undefined && typeof body.session_id !== "string") {
      throw new IdentityError("invalid_input", "session_id must be a string");
    }
    if (body.permission !== undefined && (!body.permission ||
      typeof body.permission !== "object" || Array.isArray(body.permission))) {
      throw new IdentityError("invalid_input", "permission must be an object");
    }
    audit.set({
      action: "tenant:agent_invocation_turn",
      tenantId,
      targetKind: "deployment_invocation",
      targetId: contextId,
      effectiveAccess: "member",
    });
    const access = await getPlatformDeploymentAccess();
    const upstream = await access.withInvocation(actor, tenantId, contextId, (authorized) =>
      forwardPlatformTurn(authorized, {
        input: typeof body.input === "string" ? body.input : "",
        ...(typeof body.session_id === "string" && body.session_id
          ? { session_id: body.session_id } : {}),
        ...(body.permission ? { permission: body.permission } : {}),
        options: { version: "v1" },
      }, request.signal));
    if (!upstream.ok || !upstream.body) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
      });
    }
    const reader = upstream.body.getReader();
    let finalized = false;
    const complete = () => {
      if (finalized) return;
      finalized = true;
      void access.completeInvocation(actor, tenantId, contextId);
    };
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            complete();
            controller.close();
          } else {
            controller.enqueue(value);
          }
        } catch (error) {
          complete();
          controller.error(error);
        }
      },
      cancel(reason) {
        complete();
        return reader.cancel(reason);
      },
    });
    return new Response(stream, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  });
}
