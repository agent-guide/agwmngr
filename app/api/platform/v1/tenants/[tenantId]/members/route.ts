import {
  platformIdentityBody,
  requiredText,
  withPlatformIdentity,
} from "@/lib/platform-access";
import type { TenantRole } from "@/packages/contracts/platform/identity";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tenantId: string }> };

export function GET(request: Request, context: Context) {
  return withPlatformIdentity(request, async (service, actor, audit) => {
    const { tenantId } = await context.params;
    audit.set({ action: "tenant:membership_list", tenantId, targetKind: "tenant_membership" });
    return Response.json({ items: await service.listTenantMemberships(actor, tenantId) });
  });
}

export function POST(request: Request, context: Context) {
  return withPlatformIdentity(request, async (service, actor, audit) => {
    const { tenantId } = await context.params;
    audit.set({ action: "tenant:membership_add", tenantId, targetKind: "tenant_membership" });
    const body = await platformIdentityBody(request, ["receipt", "role"]);
    return Response.json(
      await service.addMembershipWithReceipt(
        actor,
        tenantId,
        requiredText(body, "receipt"),
        requiredText(body, "role") as TenantRole,
      ),
      { status: 201 },
    );
  });
}
