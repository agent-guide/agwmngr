import { getPlatformCatalog } from "@/lib/platform-catalog";
import { platformIdentityBody, requiredText, withPlatformIdentity } from "@/lib/platform-access";
import { IdentityError } from "@/packages/platform/services/identity";
import type { CatalogAvailabilityMode } from "@/packages/contracts/platform/catalog";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ offeringId: string }> };

export function PUT(request: Request, context: Context) {
  return withPlatformIdentity(request, async (_identity, actor, audit) => {
    const { offeringId } = await context.params;
    audit.set({
      action: "platform:catalog_availability",
      targetKind: "catalog_offering",
      targetId: offeringId,
    });
    const body = await platformIdentityBody(request, ["mode", "tenant_ids"]);
    if (body.tenant_ids !== undefined && (
      !Array.isArray(body.tenant_ids) ||
      body.tenant_ids.some((tenantId) => typeof tenantId !== "string")
    )) {
      throw new IdentityError("invalid_input", "tenant_ids must be a text array");
    }
    return Response.json(await (await getPlatformCatalog()).setAvailability(
      actor,
      offeringId,
      {
        mode: requiredText(body, "mode") as CatalogAvailabilityMode,
        tenantIds: body.tenant_ids as string[] | undefined,
      },
    ));
  });
}
