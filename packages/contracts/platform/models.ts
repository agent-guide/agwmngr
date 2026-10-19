export interface TenantModelDefinition {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  offeringId: string;
  offeringVersion: number;
  offeringDigest: string;
  version: number;
  digest: string;
  status: "active" | "archived";
  availability: "available" | "unavailable";
  unavailableReason: string | null;
  createdByPrincipalId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantModelDefinitionReference {
  definitionId: string;
  definitionVersion: number;
  definitionDigest: string;
  offeringId: string;
  offeringVersion: number;
  offeringDigest: string;
}

export interface CreateTenantModelDefinitionInput {
  name: string;
  description: string;
  offeringId: string;
}
