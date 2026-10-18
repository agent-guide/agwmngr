import { adminFetch } from "./api";
import type {
  MembershipAddResolution,
  PlatformAccessProjection,
  PrincipalResolutionInput,
  Principal,
  ServicePrincipalCreation,
  Tenant,
  TenantMember,
  TenantMembership,
  TenantRole,
  TenantStatus,
} from "@/packages/contracts/platform/identity";

export type {
  MembershipAddResolution,
  PlatformAccessProjection,
  PrincipalResolutionInput,
  Principal,
  ServicePrincipalCreation,
  Tenant,
  TenantMember,
  TenantMembership,
  TenantRole,
  TenantStatus,
} from "@/packages/contracts/platform/identity";

function tenantPath(tenantId: string, suffix: string): string {
  return `/api/platform/v1/tenants/${encodeURIComponent(tenantId)}${suffix}`;
}

export function getPlatformAccess(): Promise<PlatformAccessProjection> {
  return adminFetch<PlatformAccessProjection>("/api/platform/v1/access");
}

export async function listTenantMembers(tenantId: string): Promise<TenantMember[]> {
  const result = await adminFetch<{ items: TenantMember[] }>(tenantPath(tenantId, "/members"));
  return result.items ?? [];
}

export function resolveTenantMember(
  tenantId: string,
  input: PrincipalResolutionInput,
): Promise<MembershipAddResolution> {
  const body = input.kind === "human"
    ? { kind: input.kind, username: input.username }
    : { kind: input.kind, principal_id: input.principalId };
  return adminFetch<MembershipAddResolution>(tenantPath(tenantId, "/member-resolutions"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function addTenantMember(
  tenantId: string,
  receipt: string,
  role: TenantRole,
): Promise<TenantMembership> {
  return adminFetch<TenantMembership>(tenantPath(tenantId, "/members"), {
    method: "POST",
    body: JSON.stringify({ receipt, role }),
  });
}

export function updateTenantMember(
  tenantId: string,
  principalId: string,
  role: TenantRole,
): Promise<TenantMembership> {
  return adminFetch<TenantMembership>(
    tenantPath(tenantId, `/members/${encodeURIComponent(principalId)}`),
    { method: "PUT", body: JSON.stringify({ role }) },
  );
}

export async function removeTenantMember(
  tenantId: string,
  principalId: string,
): Promise<void> {
  await adminFetch(
    tenantPath(tenantId, `/members/${encodeURIComponent(principalId)}`),
    { method: "DELETE" },
  );
}

export async function listPlatformTenants(): Promise<Tenant[]> {
  const result = await adminFetch<{ items: Tenant[] }>("/api/platform/v1/identity/tenants");
  return result.items ?? [];
}

export function createPlatformTenant(id: string, name: string): Promise<Tenant> {
  return adminFetch<Tenant>("/api/platform/v1/identity/tenants", {
    method: "POST",
    body: JSON.stringify({ id, name }),
  });
}

export function setPlatformTenantStatus(id: string, status: TenantStatus): Promise<Tenant> {
  return adminFetch<Tenant>(`/api/platform/v1/identity/tenants/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
}

export async function deletePlatformTenant(id: string): Promise<void> {
  await adminFetch(`/api/platform/v1/identity/tenants/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function listPlatformPrincipals(): Promise<Principal[]> {
  const result = await adminFetch<{ items: Principal[] }>("/api/platform/v1/identity/principals");
  return result.items ?? [];
}

export async function listPlatformTenantMembers(tenantId: string): Promise<TenantMember[]> {
  const result = await adminFetch<{ items: TenantMember[] }>(
    `/api/platform/v1/identity/tenants/${encodeURIComponent(tenantId)}/members`,
  );
  return result.items ?? [];
}

export function bootstrapPlatformTenantMember(
  tenantId: string,
  principalId: string,
  role: TenantRole,
): Promise<TenantMembership> {
  return adminFetch<TenantMembership>(
    `/api/platform/v1/identity/tenants/${encodeURIComponent(tenantId)}/members/bootstrap`,
    { method: "POST", body: JSON.stringify({ principal_id: principalId, role }) },
  );
}

export function updatePlatformTenantMember(
  tenantId: string,
  principalId: string,
  role: TenantRole,
): Promise<TenantMembership> {
  return adminFetch<TenantMembership>(
    `/api/platform/v1/identity/tenants/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(principalId)}`,
    { method: "PUT", body: JSON.stringify({ role }) },
  );
}

export async function removePlatformTenantMember(
  tenantId: string,
  principalId: string,
): Promise<void> {
  await adminFetch(
    `/api/platform/v1/identity/tenants/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(principalId)}`,
    { method: "DELETE" },
  );
}

export function createServiceAccount(
  name: string,
  expiresAt: string,
): Promise<ServicePrincipalCreation> {
  return adminFetch<ServicePrincipalCreation>("/api/platform/v1/identity/service-principals", {
    method: "POST",
    body: JSON.stringify({ name, expires_at: expiresAt }),
  });
}

export async function revokeServiceAccount(principalId: string): Promise<void> {
  await adminFetch(
    `/api/platform/v1/identity/service-principals/${encodeURIComponent(principalId)}`,
    { method: "DELETE" },
  );
}
