import type {
  CreateTenantToolDefinitionInput,
  TenantToolDefinition,
  TenantToolDefinitionReference,
} from "../../contracts/platform/tools";
import type { PlatformActorReference, Principal } from "../../contracts/platform/identity";
import type { ContentRuntime } from "../ports/content";
import type { OfferingCapabilityDirectory } from "../ports/offering-capabilities";
import type { PlatformCatalogService } from "./catalog";
import { IdentityError, type PlatformIdentityService } from "./identity";
import {
  ToolDefinitionRegistry,
  type StoredToolDefinition,
} from "./tool-definition-registry";

function invalid(message: string): never {
  throw new IdentityError("invalid_input", message);
}

function text(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string") return invalid(`${label} must be text`);
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > maximum) {
    return invalid(`${label} must be ${allowEmpty ? `at most ${maximum}` : `between 1 and ${maximum}`} characters`);
  }
  return normalized;
}

export class TenantToolDefinitionService {
  constructor(
    private readonly registry: ToolDefinitionRegistry,
    private readonly identity: PlatformIdentityService,
    private readonly catalog: PlatformCatalogService,
    private readonly capabilities: OfferingCapabilityDirectory,
    private readonly runtime: ContentRuntime,
  ) {}

  private validateInput(input: CreateTenantToolDefinitionInput) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return invalid("tool definition input is required");
    if (Object.keys(input).some((key) => !["name", "description", "offeringId"].includes(key))) {
      return invalid("tool definitions accept only name, description and offeringId");
    }
    return {
      name: text(input.name, "name", 200),
      description: text(input.description, "description", 2000, true),
      offeringId: text(input.offeringId, "offering ID", 200),
    };
  }

  private async currentAvailability(
    actor: PlatformActorReference,
    record: StoredToolDefinition,
  ): Promise<{ availability: "available" | "unavailable"; unavailableReason: string | null }> {
    if (record.status === "archived") return { availability: "unavailable", unavailableReason: "definition_archived" };
    try {
      const offering = await this.catalog.resolveReference(actor, record.tenantId, record.offeringId, "tool");
      if (offering.version !== record.offeringVersion || offering.digest !== record.offeringDigest) {
        return { availability: "unavailable", unavailableReason: "offering_version_changed" };
      }
      const check = await this.capabilities.check(offering);
      return check.available
        ? { availability: "available", unavailableReason: null }
        : { availability: "unavailable", unavailableReason: check.reason ?? "offering_unavailable" };
    } catch {
      return { availability: "unavailable", unavailableReason: "offering_unavailable" };
    }
  }

  private async projection(
    actor: PlatformActorReference,
    record: StoredToolDefinition,
  ): Promise<TenantToolDefinition> {
    return {
      id: record.id,
      tenantId: record.tenantId,
      name: record.name,
      description: record.description,
      offeringId: record.offeringId,
      offeringVersion: record.offeringVersion,
      offeringDigest: record.offeringDigest,
      version: record.version,
      digest: record.digest,
      status: record.status,
      ...await this.currentAvailability(actor, record),
      createdByPrincipalId: record.createdByPrincipalId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private async visible(
    actor: PlatformActorReference,
    tenantId: string,
    id: string,
  ): Promise<{ principal: Principal; record: StoredToolDefinition }> {
    const authority = await this.identity.authorizeTenant(actor, tenantId);
    const record = (await this.registry.list(tenantId)).find((item) => item.id === id);
    await this.identity.authorizeTenant(actor, tenantId);
    if (!record) throw new IdentityError("not_found", "tool definition not found");
    return { principal: authority.principal, record };
  }

  private digest(values: {
    id: string;
    version: number;
    name: string;
    description: string;
    offeringId: string;
    offeringVersion: number;
    offeringDigest: string;
  }): string {
    return this.runtime.hash(JSON.stringify({
      description: values.description,
      id: values.id,
      name: values.name,
      offering: {
        digest: values.offeringDigest,
        id: values.offeringId,
        version: values.offeringVersion,
      },
      version: values.version,
    }));
  }

  private async approvedOffering(
    actor: PlatformActorReference,
    tenantId: string,
    offeringId: string,
  ) {
    const offering = await this.catalog.resolveReference(actor, tenantId, offeringId, "tool");
    const check = await this.capabilities.check(offering);
    if (!check.available) throw new IdentityError("conflict", "tool offering capability is unavailable");
    return offering;
  }

  async list(actor: PlatformActorReference, tenantId: string): Promise<TenantToolDefinition[]> {
    await this.identity.authorizeTenant(actor, tenantId);
    const records = await this.registry.list(tenantId);
    const projected = await Promise.all(records.map((record) => this.projection(actor, record)));
    await this.identity.authorizeTenant(actor, tenantId);
    return projected;
  }

  async get(actor: PlatformActorReference, tenantId: string, id: string): Promise<TenantToolDefinition> {
    const item = await this.projection(actor, (await this.visible(actor, tenantId, id)).record);
    await this.identity.authorizeTenant(actor, tenantId);
    return item;
  }

  async create(
    actor: PlatformActorReference,
    tenantId: string,
    input: CreateTenantToolDefinitionInput,
  ): Promise<TenantToolDefinition> {
    const authority = await this.identity.authorizeTenant(actor, tenantId);
    const values = this.validateInput(input);
    const offering = await this.approvedOffering(actor, tenantId, values.offeringId);
    const now = this.runtime.now();
    const id = `tool:${this.runtime.id()}`;
    const version = 1;
    const record: StoredToolDefinition = {
      id,
      tenantId,
      tenantAuthorityEpoch: 0,
      status: "active",
      version,
      createdByPrincipalId: authority.principal.id,
      createdAt: now,
      updatedAt: now,
      ...values,
      offeringVersion: offering.version,
      offeringDigest: offering.digest,
      digest: "",
    };
    record.digest = this.digest(record);
    const result = await this.registry.create(record);
    if (result !== "created") throw new IdentityError(result === "exists" ? "conflict" : "forbidden");
    await this.identity.authorizeTenant(actor, tenantId);
    return this.projection(actor, record);
  }

  async update(
    actor: PlatformActorReference,
    tenantId: string,
    id: string,
    input: CreateTenantToolDefinitionInput,
  ): Promise<TenantToolDefinition> {
    const { principal, record } = await this.visible(actor, tenantId, id);
    if (record.status === "archived") throw new IdentityError("conflict", "archived tool definitions are immutable");
    const values = this.validateInput(input);
    const offering = await this.approvedOffering(actor, tenantId, values.offeringId);
    const now = this.runtime.now();
    const next = {
      ...record,
      ...values,
      version: record.version + 1,
      offeringVersion: offering.version,
      offeringDigest: offering.digest,
      createdByPrincipalId: principal.id,
      digest: "",
      updatedAt: now,
    };
    next.digest = this.digest(next);
    const result = await this.registry.update(id, next, now);
    if (result === "missing") throw new IdentityError("conflict", "tool definition changed concurrently");
    if (result === "archived") throw new IdentityError("conflict", "archived tool definitions are immutable");
    await this.identity.authorizeTenant(actor, tenantId);
    return this.projection(actor, next);
  }

  async remove(actor: PlatformActorReference, tenantId: string, id: string): Promise<void> {
    await this.visible(actor, tenantId, id);
    const result = await this.registry.archive(id, this.runtime.now());
    if (result === "missing") throw new IdentityError("not_found", "tool definition not found");
    if (result === "referenced") throw new IdentityError("conflict", "referenced tool definitions cannot be archived");
    await this.identity.authorizeTenant(actor, tenantId);
  }

  async resolveReference(
    actor: PlatformActorReference,
    tenantId: string,
    id: string,
  ): Promise<TenantToolDefinitionReference> {
    const item = await this.get(actor, tenantId, id);
    if (item.status !== "active" || item.availability !== "available") {
      throw new IdentityError("conflict", "tool definition is unavailable");
    }
    return {
      definitionId: item.id,
      definitionVersion: item.version,
      definitionDigest: item.digest,
      offeringId: item.offeringId,
      offeringVersion: item.offeringVersion,
      offeringDigest: item.offeringDigest,
    };
  }
}
