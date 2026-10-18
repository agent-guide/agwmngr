import {
  platformIdentityBody,
  requiredText,
  withPlatformIdentity,
} from "@/lib/platform-access";
import type { TenantRole } from "@/packages/contracts/platform/identity";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tenantId: string; principalId: string }> };

export function PUT(request: Request, context: Context) {
  return withPlatformIdentity(request, async (service, actor, audit) => {
    const { tenantId, principalId } = await context.params;
    audit.set({
      action: "tenant:membership_update",
      tenantId,
      targetKind: "tenant_membership",
      targetId: principalId,
    });
    const body = await platformIdentityBody(request, ["role"]);
    return Response.json(
      await service.setTenantMembership(
        actor,
        tenantId,
        principalId,
        requiredText(body, "role") as TenantRole,
      ),
    );
  });
}

export function DELETE(request: Request, context: Context) {
  return withPlatformIdentity(request, async (service, actor, audit) => {
    const { tenantId, principalId } = await context.params;
    audit.set({
      action: "tenant:membership_remove",
      tenantId,
      targetKind: "tenant_membership",
      targetId: principalId,
    });
    await service.removeTenantMembership(actor, tenantId, principalId);
    return Response.json({ status: "deleted" });
  });
}
