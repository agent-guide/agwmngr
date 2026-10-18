export const principalStatuses = ["active", "disabled"] as const;
export type PrincipalStatus = (typeof principalStatuses)[number];

export const tenantStatuses = ["active", "disabled"] as const;
export type TenantStatus = (typeof tenantStatuses)[number];

export const tenantRoles = ["admin", "user"] as const;
export type TenantRole = (typeof tenantRoles)[number];

export const tenantGatewayAccessLevels = ["view", "manage"] as const;
export type TenantGatewayAccess = (typeof tenantGatewayAccessLevels)[number];

interface PrincipalBase {
  id: string;
  status: PrincipalStatus;
  label: string;
}

export interface HumanPrincipal extends PrincipalBase {
  kind: "human";
  userId: number;
}

export interface ServicePrincipal extends PrincipalBase {
  kind: "service";
  userId: null;
}

export type Principal = HumanPrincipal | ServicePrincipal;

export interface Tenant {
  id: string;
  name: string;
  status: TenantStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TenantMembership {
  principalId: string;
  tenantId: string;
  role: TenantRole;
  createdAt: string;
  updatedAt: string;
}

export interface TenantGatewayGrant {
  principalId: string;
  tenantId: string;
  gatewayId: string;
  access: TenantGatewayAccess;
  createdAt: string;
  updatedAt: string;
}

export type PrincipalResolutionInput =
  | { kind: "human"; username: string }
  | { kind: "service"; principalId: string };

export interface MembershipAddResolution {
  kind: Principal["kind"];
  label: string;
  status: "active";
  receipt: string;
  expiresAt: string;
}

export interface TenantMember extends TenantMembership {
  principal: Principal;
}

export interface PlatformAccessProjection {
  principal: Principal;
  memberships: Array<TenantMembership & { tenant: Tenant }>;
}

// Authentication proves only identity. Services must reload all current
// authority before each domain operation.
export type PlatformActorReference =
  | { kind: "human"; userId: number }
  | { kind: "service"; principalId: string; credentialDigest: string };

export function humanPrincipalId(userId: number): string {
  return `user:${userId}`;
}

export function tenantRoleAllows(actual: TenantRole, required: TenantRole): boolean {
  return actual === "admin" || required === "user";
}

export function tenantGatewayAccessAllows(
  actual: TenantGatewayAccess,
  required: TenantGatewayAccess,
): boolean {
  return actual === "manage" || required === "view";
}
