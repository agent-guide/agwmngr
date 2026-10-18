import { getPlatformCatalog } from "@/lib/platform-catalog";
import { withPlatformIdentity } from "@/lib/platform-access";
import type { CatalogOfferingCategory } from "@/packages/contracts/platform/catalog";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tenantId: string }> };

export function GET(request: Request, context: Context) {
  return withPlatformIdentity(request, async (_identity, actor, audit) => {
    const { tenantId } = await context.params;
    audit.set({
      action: "tenant:catalog_list",
      tenantId,
      targetKind: "catalog_offering_collection",
    });
    const requestedCategory = new URL(request.url).searchParams.get("category") ?? undefined;
    return Response.json({
      items: await (await getPlatformCatalog()).listTenantOfferings(
        actor,
        tenantId,
        requestedCategory as CatalogOfferingCategory | undefined,
      ),
    });
  });
}
