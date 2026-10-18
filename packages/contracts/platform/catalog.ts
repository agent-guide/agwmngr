export const catalogOfferingCategories = ["model", "tool"] as const;
export type CatalogOfferingCategory = (typeof catalogOfferingCategories)[number];

export const catalogOfferingKinds = ["platform-native", "gateway-backed"] as const;
export type CatalogOfferingKind = (typeof catalogOfferingKinds)[number];

export const catalogOfferingStatuses = ["draft", "active", "retired"] as const;
export type CatalogOfferingStatus = (typeof catalogOfferingStatuses)[number];

export const catalogAvailabilityModes = ["all-active-tenants", "tenant-allowlist"] as const;
export type CatalogAvailabilityMode = (typeof catalogAvailabilityModes)[number];

/** Platform-Admin projection. It contains infrastructure identity, never credentials. */
export interface PlatformCatalogOffering {
  offeringId: string;
  category: CatalogOfferingCategory;
  name: string;
  description: string;
  ownerPrincipalId: string;
  kind: CatalogOfferingKind;
  sourceGatewayId: string | null;
  upstreamStableId: string | null;
  sourceGatewayAuthorityEpoch: number | null;
  status: CatalogOfferingStatus;
  version: number;
  digest: string;
  availability: {
    mode: CatalogAvailabilityMode;
    tenantIds: string[];
  };
  sourceAvailable: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Tenant projection. Infrastructure binding identifiers are deliberately absent. */
export interface TenantCatalogOffering {
  offeringId: string;
  category: CatalogOfferingCategory;
  name: string;
  description: string;
  kind: CatalogOfferingKind;
  owner: "platform";
  version: number;
  digest: string;
}

/** Internal immutable dependency snapshot for later release construction. */
export interface CatalogOfferingReference {
  offeringId: string;
  category: CatalogOfferingCategory;
  kind: CatalogOfferingKind;
  version: number;
  digest: string;
  sourceGatewayId: string | null;
  upstreamStableId: string | null;
  sourceGatewayAuthorityEpoch: number | null;
}

export interface CreateCatalogOfferingInput {
  offeringId: string;
  category: CatalogOfferingCategory;
  name: string;
  description: string;
  kind: CatalogOfferingKind;
  sourceGatewayId?: string;
  upstreamStableId?: string;
  availability: {
    mode: CatalogAvailabilityMode;
    tenantIds?: string[];
  };
}
