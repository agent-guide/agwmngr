import { adminFetch } from "./api";
import type {
  MembershipAddResolution,
  PlatformAccessProjection,
  PrincipalResolutionInput,
  TenantMember,
  TenantMembership,
  TenantRole,
} from "@/packages/contracts/platform/identity";

export type {
  MembershipAddResolution,
  PlatformAccessProjection,
  PrincipalResolutionInput,
  TenantMember,
  TenantMembership,
  TenantRole,
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
