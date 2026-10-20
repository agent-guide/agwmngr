import { listTenantAudit } from "@/lib/db";
import { withPlatformIdentity } from "@/lib/platform-access";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tenantId: string }> };

export async function GET(request: Request, context: Context) {
  return withPlatformIdentity(request, async (identity, actor, audit) => {
    const { tenantId } = await context.params;
    await identity.authorizeTenant(actor, tenantId, "admin");
    const url = new URL(request.url);
    const beforeValue = Number(url.searchParams.get("before"));
    const limitValue = Number(url.searchParams.get("limit"));
    audit.set({
      action: "tenant:audit_read",
      tenantId,
      targetKind: "tenant_audit",
      targetId: tenantId,
      effectiveAccess: "admin",
    });
    const items = listTenantAudit(tenantId, {
      ...(Number.isSafeInteger(beforeValue) && beforeValue > 0 ? { before: beforeValue } : {}),
      ...(Number.isSafeInteger(limitValue) && limitValue > 0 ? { limit: limitValue } : {}),
    });
    return Response.json({
      items,
      next_cursor: items.length ? items.at(-1)!.id : null,
    });
  });
}
