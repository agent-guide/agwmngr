import type { CatalogOfferingReference } from "../../contracts/platform/catalog";

export interface OfferingCapabilityCheck {
  available: boolean;
  reason?: "source_unavailable" | "upstream_missing" | "capability_missing";
}

export interface OfferingCapabilityDirectory {
  check(reference: CatalogOfferingReference): Promise<OfferingCapabilityCheck>;
}
