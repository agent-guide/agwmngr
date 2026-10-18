import { getPlatformCatalog } from "@/lib/platform-catalog";
import { withPlatformIdentity } from "@/lib/platform-access";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ offeringId: string }> };

export function POST(request: Request, context: Context) {
  return withPlatformIdentity(request, async (_identity, actor, audit) => {
    const { offeringId } = await context.params;
    audit.set({
      action: "platform:catalog_approve",
      targetKind: "catalog_offering",
      targetId: offeringId,
    });
    return Response.json(await (await getPlatformCatalog()).approveOffering(actor, offeringId));
  });
}
