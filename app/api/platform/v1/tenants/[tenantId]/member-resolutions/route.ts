import {
  platformIdentityBody,
  principalResolutionInput,
  withPlatformIdentity,
} from "@/lib/platform-access";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tenantId: string }> };

export function POST(request: Request, context: Context) {
  return withPlatformIdentity(request, async (service, actor, audit) => {
    const { tenantId } = await context.params;
    audit.set({
      action: "tenant:membership_resolve",
      tenantId,
      targetKind: "membership_add_receipt",
    });
    const body = await platformIdentityBody(request, ["kind", "username", "principal_id"]);
    return Response.json(
      await service.resolveMembershipTarget(actor, tenantId, principalResolutionInput(body)),
      { status: 201 },
    );
  });
}
