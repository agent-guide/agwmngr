import { getPlatformCatalog } from "@/lib/platform-catalog";
import { platformIdentityBody, requiredText, withPlatformIdentity } from "@/lib/platform-access";
import { IdentityError } from "@/packages/platform/services/identity";
import type {
  CatalogAvailabilityMode,
  CatalogOfferingCategory,
  CatalogOfferingKind,
} from "@/packages/contracts/platform/catalog";

export const dynamic = "force-dynamic";

function requestAvailability(value: unknown): {
  mode: CatalogAvailabilityMode;
  tenantIds?: string[];
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new IdentityError("invalid_input", "availability is required");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["mode", "tenant_ids"].includes(key))) {
    throw new IdentityError("invalid_input", "unsupported availability field");
  }
  if (typeof record.mode !== "string") {
    throw new IdentityError("invalid_input", "availability mode is required");
  }
  if (record.tenant_ids !== undefined && (
    !Array.isArray(record.tenant_ids) ||
    record.tenant_ids.some((tenantId) => typeof tenantId !== "string")
  )) {
    throw new IdentityError("invalid_input", "tenant_ids must be a text array");
  }
  return {
    mode: record.mode as CatalogAvailabilityMode,
    tenantIds: record.tenant_ids as string[] | undefined,
  };
}

export function GET(request: Request) {
  return withPlatformIdentity(request, async (_identity, actor, audit) => {
    audit.set({ action: "platform:catalog_list", targetKind: "catalog_offering_collection" });
    const requestedCategory = new URL(request.url).searchParams.get("category") ?? undefined;
    const catalog = await getPlatformCatalog();
    return Response.json({
      items: await catalog.listPlatformOfferings(
        actor,
        requestedCategory as CatalogOfferingCategory | undefined,
      ),
    });
  });
}

export function POST(request: Request) {
  return withPlatformIdentity(request, async (_identity, actor, audit) => {
    audit.set({ action: "platform:catalog_create", targetKind: "catalog_offering" });
    const body = await platformIdentityBody(request, [
      "offering_id",
      "category",
      "name",
      "description",
      "kind",
      "source_gateway_id",
      "upstream_stable_id",
      "availability",
    ]);
    const offeringId = requiredText(body, "offering_id");
    if (body.description !== undefined && typeof body.description !== "string") {
      throw new IdentityError("invalid_input", "description must be text");
    }
    audit.set({ targetId: offeringId });
    const catalog = await getPlatformCatalog();
    const result = await catalog.createOffering(actor, {
      offeringId,
      category: requiredText(body, "category") as CatalogOfferingCategory,
      name: requiredText(body, "name"),
      description: body.description ?? "",
      kind: requiredText(body, "kind") as CatalogOfferingKind,
      ...(body.source_gateway_id === undefined
        ? {}
        : { sourceGatewayId: requiredText(body, "source_gateway_id") }),
      ...(body.upstream_stable_id === undefined
        ? {}
        : { upstreamStableId: requiredText(body, "upstream_stable_id") }),
      availability: requestAvailability(body.availability),
    });
    return Response.json(result, { status: 201 });
  });
}
