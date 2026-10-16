import {
  humanPrincipalId,
  tenantRoles,
  tenantRoleAllows,
  tenantStatuses,
  type HumanPrincipal,
  type PlatformActorReference,
  type Principal,
  type ServicePrincipal,
  type Tenant,
  type TenantMembership,
  type TenantRole,
} from "../../contracts/platform/identity";
import type { ServiceCredentialIssuer } from "../ports/credentials";
import type { IdentityDirectory, ManagerUserIdentity } from "../ports/identity";
import { IdentityRegistry, type StoredPrincipal } from "./identity-registry";

export type IdentityErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "invalid_input"
  | "not_found"
  | "conflict";

export class IdentityError extends Error {
  constructor(
    readonly code: IdentityErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "PlatformIdentityError";
  }
}

export function isIdentityError(error: unknown): error is IdentityError {
  return (
    error instanceof Error &&
    error.name === "PlatformIdentityError" &&
    "code" in error &&
    ["unauthenticated", "forbidden", "invalid_input", "not_found", "conflict"].includes(
      String(error.code),
    )
  );
}

function validateSlug(value: string, label: string): void {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) {
    throw new IdentityError("invalid_input", `${label} must be a lowercase slug up to 64 characters`);
  }
}

function humanPrincipal(user: ManagerUserIdentity): HumanPrincipal {
  return {
    id: humanPrincipalId(user.id),
    kind: "human",
    userId: user.id,
    label: user.username,
    status: user.active ? "active" : "disabled",
  };
}

function servicePrincipal(record: StoredPrincipal): ServicePrincipal {
  if (record.kind !== "service" || !record.serviceName) {
    throw new Error("invalid stored service principal");
  }
  return {
    id: record.id,
    kind: "service",
    userId: null,
    label: record.serviceName,
    status: record.status,
  };
}

export interface TenantAuthorization {
  principal: Principal;
  tenant: Tenant;
  membership: TenantMembership;
}

export class PlatformIdentityService {
  constructor(
    private readonly registry: IdentityRegistry,
    private readonly directory: IdentityDirectory,
    private readonly credentials: ServiceCredentialIssuer,
    private readonly now = () => new Date(),
  ) {}

  private nowIso(): string {
    return this.now().toISOString();
  }

  private async liveUser(userId: number): Promise<ManagerUserIdentity> {
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new IdentityError("unauthenticated");
    }
    const user = await this.directory.findUser(userId);
    if (!user?.active) throw new IdentityError("unauthenticated");
    return user;
  }

  async resolve(actor: PlatformActorReference): Promise<Principal> {
    if (actor.kind === "human") {
      const user = await this.liveUser(actor.userId);
      const stored = await this.registry.ensureHuman(user.id, this.nowIso());
      if (stored.kind !== "human" || stored.userId !== user.id || stored.status !== "active") {
        throw new IdentityError("unauthenticated");
      }
      return humanPrincipal(user);
    }

    if (!actor.credentialDigest) throw new IdentityError("unauthenticated");
    const stored = await this.registry.serviceForCredential(actor.credentialDigest, this.nowIso());
    if (!stored || stored.id !== actor.principalId) throw new IdentityError("unauthenticated");
    return servicePrincipal(stored);
  }

  async authenticateService(token: string): Promise<PlatformActorReference> {
    if (!/^agwmngr_svc_[0-9a-f]{64}$/.test(token)) {
      throw new IdentityError("unauthenticated");
    }
    const digest = this.credentials.digest(token);
    const stored = await this.registry.serviceForCredential(digest, this.nowIso());
    if (!stored) throw new IdentityError("unauthenticated");
    return { kind: "service", principalId: stored.id, credentialDigest: digest };
  }

  async isPlatformAdmin(actor: PlatformActorReference): Promise<boolean> {
    if (actor.kind !== "human") {
      await this.resolve(actor);
      return false;
    }
    const user = await this.liveUser(actor.userId);
    await this.registry.ensureHuman(user.id, this.nowIso());
    return user.platformAdmin;
  }

  private async requirePlatformAdmin(actor: PlatformActorReference): Promise<HumanPrincipal> {
    if (actor.kind !== "human") {
      await this.resolve(actor);
      throw new IdentityError("forbidden", "Platform Admin access required");
    }
    const user = await this.liveUser(actor.userId);
    await this.registry.ensureHuman(user.id, this.nowIso());
    if (!user.platformAdmin) {
      throw new IdentityError("forbidden", "Platform Admin access required");
    }
    return humanPrincipal(user);
  }

  async authorizeTenant(
    actor: PlatformActorReference,
    tenantId: string,
    requiredRole: TenantRole = "user",
  ): Promise<TenantAuthorization> {
    validateSlug(tenantId, "tenant ID");
    if (!tenantRoles.includes(requiredRole)) throw new IdentityError("invalid_input");
    const principal = await this.resolve(actor);
    const tenant = await this.registry.tenant(tenantId);
    if (!tenant || tenant.status !== "active") throw new IdentityError("forbidden");
    const membership = await this.registry.membership(principal.id, tenantId);
    if (!membership || !tenantRoleAllows(membership.role, requiredRole)) {
      throw new IdentityError("forbidden");
    }
    return { principal, tenant, membership };
  }

  async access(actor: PlatformActorReference): Promise<{
    principal: Principal;
    memberships: Array<TenantMembership & { tenant: Tenant }>;
  }> {
    const principal = await this.resolve(actor);
    const memberships = await this.registry.membershipsForPrincipal(principal.id);
    const active: Array<TenantMembership & { tenant: Tenant }> = [];
    for (const membership of memberships) {
      const tenant = await this.registry.tenant(membership.tenantId);
      if (tenant?.status === "active") active.push({ ...membership, tenant });
    }
    return { principal, memberships: active };
  }

  async listPrincipals(actor: PlatformActorReference): Promise<Principal[]> {
    await this.requirePlatformAdmin(actor);
    const users = await this.directory.listUsers();
    const stored = await this.registry.principals();
    const services = stored
      .filter((principal) => principal.kind === "service")
      .map(servicePrincipal);
    return [...users.map(humanPrincipal), ...services].sort((a, b) => a.id.localeCompare(b.id));
  }

  async listTenants(actor: PlatformActorReference): Promise<Tenant[]> {
    await this.requirePlatformAdmin(actor);
    return this.registry.tenants();
  }

  async createTenant(
    actor: PlatformActorReference,
    id: string,
    name: string,
  ): Promise<Tenant> {
    await this.requirePlatformAdmin(actor);
    validateSlug(id, "tenant ID");
    if (typeof name !== "string" || !name.trim() || name.trim().length > 200) {
      throw new IdentityError("invalid_input", "tenant name must be between 1 and 200 characters");
    }
    if (await this.registry.tenant(id)) throw new IdentityError("conflict", "Tenant already exists");
    const now = this.nowIso();
    const tenant: Tenant = {
      id,
      name: name.trim(),
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    await this.registry.createTenant(tenant);
    return tenant;
  }

  async setTenantStatus(
    actor: PlatformActorReference,
    id: string,
    status: Tenant["status"],
  ): Promise<Tenant> {
    await this.requirePlatformAdmin(actor);
    validateSlug(id, "tenant ID");
    if (!tenantStatuses.includes(status)) throw new IdentityError("invalid_input");
    const existing = await this.registry.tenant(id);
    if (!existing) throw new IdentityError("not_found", "Tenant not found");
    const now = this.nowIso();
    await this.registry.setTenantStatus(id, status, now);
    return { ...existing, status, updatedAt: now };
  }

  private async targetPrincipal(id: string): Promise<Principal> {
    if (typeof id !== "string") throw new IdentityError("invalid_input");
    const human = /^user:([1-9][0-9]*)$/.exec(id);
    if (human) {
      const userId = Number(human[1]);
      if (!Number.isSafeInteger(userId)) throw new IdentityError("invalid_input");
      const user = await this.directory.findUser(userId);
      if (!user) throw new IdentityError("not_found", "manager user not found");
      if (!user.active) throw new IdentityError("invalid_input", "manager user is disabled");
      await this.registry.ensureHuman(userId, this.nowIso());
      return humanPrincipal(user);
    }
    const stored = await this.registry.principal(id);
    if (!stored || stored.kind !== "service") {
      throw new IdentityError("not_found", "service Principal not found");
    }
    const principal = servicePrincipal(stored);
    if (principal.status !== "active") {
      throw new IdentityError("invalid_input", "service Principal is disabled");
    }
    return principal;
  }

  private async requireMembershipManager(
    actor: PlatformActorReference,
    tenantId: string,
  ): Promise<"platform" | "tenant"> {
    if (await this.isPlatformAdmin(actor)) return "platform";
    await this.authorizeTenant(actor, tenantId, "admin");
    return "tenant";
  }

  async listMemberships(
    actor: PlatformActorReference,
    tenantId: string,
  ): Promise<Array<TenantMembership & { principal: Principal }>> {
    validateSlug(tenantId, "tenant ID");
    await this.requireMembershipManager(actor, tenantId);
    const tenant = await this.registry.tenant(tenantId);
    if (!tenant) throw new IdentityError("not_found", "Tenant not found");
    const memberships = await this.registry.membershipsForTenant(tenantId);
    const result: Array<TenantMembership & { principal: Principal }> = [];
    for (const membership of memberships) {
      const stored = await this.registry.principal(membership.principalId);
      if (!stored) continue;
      if (stored.kind === "human" && stored.userId !== null) {
        const user = await this.directory.findUser(stored.userId);
        if (user) result.push({ ...membership, principal: humanPrincipal(user) });
      } else if (stored.kind === "service") {
        result.push({ ...membership, principal: servicePrincipal(stored) });
      }
    }
    return result;
  }

  async setMembership(
    actor: PlatformActorReference,
    tenantId: string,
    principalId: string,
    role: TenantRole,
  ): Promise<TenantMembership> {
    validateSlug(tenantId, "tenant ID");
    if (!tenantRoles.includes(role)) throw new IdentityError("invalid_input", "invalid Tenant role");
    const manager = await this.requireMembershipManager(actor, tenantId);
    const tenant = await this.registry.tenant(tenantId);
    if (!tenant) throw new IdentityError("not_found", "Tenant not found");
    if (tenant.status !== "active") throw new IdentityError("invalid_input", "Tenant is disabled");
    if (manager === "tenant" && !await this.registry.membership(principalId, tenantId)) {
      // Do not turn the update path into an exact platform-directory oracle.
      // Tenant Admins know stable IDs only from their existing-member projection.
      throw new IdentityError(
        "forbidden",
        "Tenant Admin membership creation requires an add receipt",
      );
    }
    await this.targetPrincipal(principalId);
    const now = this.nowIso();
    const updated = await this.registry.updateMembership(principalId, tenantId, role, now);
    if (!updated) {
      throw new IdentityError(
        manager === "platform" ? "not_found" : "forbidden",
        manager === "platform"
          ? "Tenant membership not found"
          : "Tenant Admin membership creation requires an add receipt",
      );
    }
    return (await this.registry.membership(principalId, tenantId))!;
  }

  async bootstrapMembership(
    actor: PlatformActorReference,
    tenantId: string,
    principalId: string,
    role: TenantRole,
  ): Promise<TenantMembership> {
    await this.requirePlatformAdmin(actor);
    validateSlug(tenantId, "tenant ID");
    if (!tenantRoles.includes(role)) throw new IdentityError("invalid_input", "invalid Tenant role");
    const tenant = await this.registry.tenant(tenantId);
    if (!tenant) throw new IdentityError("not_found", "Tenant not found");
    if (tenant.status !== "active") throw new IdentityError("invalid_input", "Tenant is disabled");
    await this.targetPrincipal(principalId);
    const now = this.nowIso();
    if (!await this.registry.createMembership(principalId, tenantId, role, now)) {
      throw new IdentityError("conflict", "Tenant membership already exists");
    }
    return (await this.registry.membership(principalId, tenantId))!;
  }

  async removeMembership(
    actor: PlatformActorReference,
    tenantId: string,
    principalId: string,
  ): Promise<void> {
    validateSlug(tenantId, "tenant ID");
    await this.requireMembershipManager(actor, tenantId);
    if (!await this.registry.tenant(tenantId)) {
      throw new IdentityError("not_found", "Tenant not found");
    }
    await this.registry.removeMembership(principalId, tenantId);
  }

  async createService(
    actor: PlatformActorReference,
    name: string,
    expiresAt: string,
  ): Promise<{ principal: ServicePrincipal; credentialId: string; token: string; expiresAt: string }> {
    await this.requirePlatformAdmin(actor);
    validateSlug(name, "service name");
    const expiry = new Date(expiresAt);
    const remaining = expiry.getTime() - this.now().getTime();
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 366 * 86_400_000) {
      throw new IdentityError("invalid_input", "credential expiry must be within one year");
    }
    const id = `service:${name}`;
    if (await this.registry.principal(id)) {
      throw new IdentityError("conflict", "service Principal already exists");
    }
    const issued = this.credentials.issue();
    await this.registry.createService({
      id,
      name,
      credentialId: issued.id,
      digest: issued.digest,
      expiresAt: expiry.toISOString(),
      now: this.nowIso(),
    });
    const stored = await this.registry.principal(id);
    if (!stored) throw new Error("created service Principal is missing");
    return {
      principal: servicePrincipal(stored),
      credentialId: issued.id,
      token: issued.token,
      expiresAt: expiry.toISOString(),
    };
  }

  async disableService(actor: PlatformActorReference, id: string): Promise<void> {
    await this.requirePlatformAdmin(actor);
    const principal = await this.registry.principal(id);
    if (!principal || principal.kind !== "service") {
      throw new IdentityError("not_found", "service Principal not found");
    }
    await this.registry.disableService(id, this.nowIso());
  }
}
