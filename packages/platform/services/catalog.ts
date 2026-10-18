import {
  catalogAvailabilityModes,
  catalogOfferingCategories,
  catalogOfferingKinds,
  type CatalogAvailabilityMode,
  type CatalogOfferingCategory,
  type CatalogOfferingReference,
  type CreateCatalogOfferingInput,
  type PlatformCatalogOffering,
  type TenantCatalogOffering,
} from "../../contracts/platform/catalog";
import type { PlatformActorReference } from "../../contracts/platform/identity";
import type { CatalogRuntime, CatalogSourceDirectory } from "../ports/catalog";
import { IdentityError, type PlatformIdentityService } from "./identity";
import { CatalogRegistry, type StoredCatalogOffering } from "./catalog-registry";

function invalid(message: string): never {
  throw new IdentityError("invalid_input", message);
}

function slug(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) {
    return invalid(`${label} must be a lowercase slug up to 64 characters`);
  }
  return value;
}

function text(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string") return invalid(`${label} must be text`);
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > maximum) {
    return invalid(`${label} must be ${allowEmpty ? `at most ${maximum}` : `between 1 and ${maximum}`} characters`);
  }
  return normalized;
}

function category(value: unknown): CatalogOfferingCategory {
  if (!catalogOfferingCategories.includes(value as CatalogOfferingCategory)) {
    return invalid("category must be model or tool");
  }
  return value as CatalogOfferingCategory;
}

function gatewayUpstreamStableId(
  value: unknown,
  selectedCategory: CatalogOfferingCategory,
): string {
  const normalized = text(value, "upstream stable ID", 512);
  if (/\p{Cc}/u.test(normalized)) {
    invalid("source identifiers cannot contain control characters");
  }
  if (selectedCategory === "tool") {
    const parts = normalized.startsWith("mcp:")
      ? normalized.slice(4).split(":")
      : [];
    const serviceId = parts.shift();
    const toolName = parts.join(":");
    if (!serviceId || !toolName) {
      invalid("tool upstream stable ID must use mcp:<service-id>:<tool-name>");
    }
  }
  return normalized;
}

function availability(input: CreateCatalogOfferingInput["availability"]): {
  mode: CatalogAvailabilityMode;
  tenantIds: string[];
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return invalid("availability is required");
  }
  if (Object.keys(input).some((key) => !["mode", "tenantIds"].includes(key))) {
    return invalid("unsupported availability field");
  }
  if (!catalogAvailabilityModes.includes(input.mode)) {
    return invalid("invalid availability mode");
  }
  if (input.tenantIds !== undefined && !Array.isArray(input.tenantIds)) {
    return invalid("tenantIds must be an array");
  }
  const values = input.tenantIds ?? [];
  if (values.length > 1000) return invalid("Tenant allowlist exceeds 1000 entries");
  if (input.mode === "all-active-tenants" && values.length !== 0) {
    return invalid("all-active-tenants cannot include a Tenant allowlist");
  }
  const tenantIds = values.map((tenantId) => slug(tenantId, "Tenant ID"));
  if (new Set(tenantIds).size !== tenantIds.length) {
    return invalid("Tenant allowlist contains duplicates");
  }
  return { mode: input.mode, tenantIds: tenantIds.sort() };
}

export class PlatformCatalogService {
  constructor(
    private readonly registry: CatalogRegistry,
    private readonly identity: PlatformIdentityService,
    private readonly sources: CatalogSourceDirectory,
    private readonly runtime: CatalogRuntime,
  ) {}

  private async sourceAvailable(record: StoredCatalogOffering): Promise<boolean> {
    if (record.kind === "platform-native") return true;
    if (!record.sourceGatewayId || record.sourceGatewayAuthorityEpoch === null) return false;
    const gateway = await this.sources.findGateway(record.sourceGatewayId);
    return Boolean(
      gateway?.active && gateway.authorityEpoch === record.sourceGatewayAuthorityEpoch,
    );
  }

  private async platformProjection(
    record: StoredCatalogOffering,
  ): Promise<PlatformCatalogOffering> {
    return {
      offeringId: record.offeringId,
      category: record.category,
      name: record.name,
      description: record.description,
      ownerPrincipalId: record.ownerPrincipalId,
      kind: record.kind,
      sourceGatewayId: record.sourceGatewayId,
      upstreamStableId: record.upstreamStableId,
      sourceGatewayAuthorityEpoch: record.sourceGatewayAuthorityEpoch,
      status: record.status,
      version: record.version,
      digest: record.digest,
      availability: {
        mode: record.availabilityMode,
        tenantIds: record.availabilityMode === "tenant-allowlist"
          ? await this.registry.availabilityTenantIds(record.offeringId)
          : [],
      },
      sourceAvailable: await this.sourceAvailable(record),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private tenantProjection(record: StoredCatalogOffering): TenantCatalogOffering {
    return {
      offeringId: record.offeringId,
      category: record.category,
      name: record.name,
      description: record.description,
      kind: record.kind,
      owner: "platform",
      version: record.version,
      digest: record.digest,
    };
  }

  async listPlatformOfferings(
    actor: PlatformActorReference,
    requestedCategory?: CatalogOfferingCategory,
  ): Promise<PlatformCatalogOffering[]> {
    await this.identity.requirePlatformAdmin(actor);
    const selectedCategory = requestedCategory === undefined
      ? undefined
      : category(requestedCategory);
    return Promise.all(
      (await this.registry.list(selectedCategory)).map((record) =>
        this.platformProjection(record)
      ),
    );
  }

  async createOffering(
    actor: PlatformActorReference,
    input: CreateCatalogOfferingInput,
  ): Promise<PlatformCatalogOffering> {
    const owner = await this.identity.requirePlatformAdmin(actor);
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new IdentityError("invalid_input", "offering input is required");
    }
    if (Object.keys(input).some((key) => ![
      "offeringId",
      "category",
      "name",
      "description",
      "kind",
      "sourceGatewayId",
      "upstreamStableId",
      "availability",
    ].includes(key))) {
      throw new IdentityError("invalid_input", "unsupported offering field");
    }
    const offeringId = slug(input.offeringId, "offering ID");
    const selectedCategory = category(input.category);
    const name = text(input.name, "name", 200);
    const description = text(input.description, "description", 2000, true);
    if (!catalogOfferingKinds.includes(input.kind)) invalid("invalid offering kind");
    const selectedAvailability = availability(input.availability);

    let sourceGatewayId: string | null = null;
    let upstreamStableId: string | null = null;
    let sourceGatewayAuthorityEpoch: number | null = null;
    if (input.kind === "gateway-backed") {
      sourceGatewayId = text(input.sourceGatewayId, "source Gateway ID", 200);
      upstreamStableId = gatewayUpstreamStableId(input.upstreamStableId, selectedCategory);
      if (/\p{Cc}/u.test(sourceGatewayId)) {
        invalid("source identifiers cannot contain control characters");
      }
      const gateway = await this.sources.findGateway(sourceGatewayId);
      if (!gateway?.active) {
        throw new IdentityError("invalid_input", "source Gateway must be active");
      }
      sourceGatewayAuthorityEpoch = gateway.authorityEpoch;
    } else if (
      input.sourceGatewayId !== undefined || input.upstreamStableId !== undefined
    ) {
      invalid("platform-native offerings cannot include Gateway source fields");
    }

    const version = 1;
    const digest = this.runtime.digest(JSON.stringify({
      category: selectedCategory,
      kind: input.kind,
      offeringId,
      sourceGatewayAuthorityEpoch,
      sourceGatewayId,
      upstreamStableId,
      version,
    }));
    const now = this.runtime.now();
    const record: StoredCatalogOffering = {
      offeringId,
      category: selectedCategory,
      name,
      description,
      ownerPrincipalId: owner.id,
      kind: input.kind,
      sourceGatewayId,
      upstreamStableId,
      sourceGatewayAuthorityEpoch,
      status: "draft",
      version,
      digest,
      availabilityMode: selectedAvailability.mode,
      createdAt: now,
      updatedAt: now,
    };
    const created = await this.registry.create(record, selectedAvailability.tenantIds);
    if (created === "exists") {
      throw new IdentityError("conflict", "offering ID was already issued");
    }
    if (created === "invalid_tenant") {
      throw new IdentityError("invalid_input", "Tenant allowlist must contain active Tenants");
    }
    return this.platformProjection(record);
  }

  async approveOffering(
    actor: PlatformActorReference,
    offeringId: string,
  ): Promise<PlatformCatalogOffering> {
    await this.identity.requirePlatformAdmin(actor);
    const id = slug(offeringId, "offering ID");
    const current = await this.registry.get(id);
    if (!current) throw new IdentityError("not_found", "offering not found");
    if (current.status === "retired") {
      throw new IdentityError("conflict", "retired offerings cannot be approved");
    }
    if (!await this.sourceAvailable(current)) {
      throw new IdentityError("conflict", "offering source is unavailable or stale");
    }
    if (current.status === "draft") {
      if (!await this.registry.setStatus(id, ["draft"], "active", this.runtime.now())) {
        throw new IdentityError("conflict", "offering changed while it was approved");
      }
    }
    return this.platformProjection((await this.registry.get(id))!);
  }

  async retireOffering(
    actor: PlatformActorReference,
    offeringId: string,
  ): Promise<PlatformCatalogOffering> {
    await this.identity.requirePlatformAdmin(actor);
    const id = slug(offeringId, "offering ID");
    const current = await this.registry.get(id);
    if (!current) throw new IdentityError("not_found", "offering not found");
    if (current.status !== "retired") {
      if (!await this.registry.setStatus(
        id,
        ["draft", "active"],
        "retired",
        this.runtime.now(),
      )) {
        throw new IdentityError("conflict", "offering changed while it was retired");
      }
    }
    return this.platformProjection((await this.registry.get(id))!);
  }

  async setAvailability(
    actor: PlatformActorReference,
    offeringId: string,
    input: CreateCatalogOfferingInput["availability"],
  ): Promise<PlatformCatalogOffering> {
    await this.identity.requirePlatformAdmin(actor);
    const id = slug(offeringId, "offering ID");
    const selected = availability(input);
    const result = await this.registry.setAvailability(
      id,
      selected.mode,
      selected.tenantIds,
      this.runtime.now(),
    );
    if (result === "not_found") throw new IdentityError("not_found", "offering not found");
    if (result === "retired") {
      throw new IdentityError("conflict", "retired offering availability is immutable");
    }
    if (result === "invalid_tenant") {
      throw new IdentityError("invalid_input", "Tenant allowlist must contain active Tenants");
    }
    return this.platformProjection((await this.registry.get(id))!);
  }

  async listTenantOfferings(
    actor: PlatformActorReference,
    tenantId: string,
    requestedCategory?: CatalogOfferingCategory,
  ): Promise<TenantCatalogOffering[]> {
    const authority = await this.identity.authorizeTenant(actor, tenantId);
    const selectedCategory = requestedCategory === undefined
      ? undefined
      : category(requestedCategory);
    const records = await this.registry.tenantOfferings(
      tenantId,
      authority.principal.id,
      selectedCategory,
    );
    await this.identity.authorizeTenant(actor, tenantId);
    const available: TenantCatalogOffering[] = [];
    for (const record of records) {
      if (await this.sourceAvailable(record)) available.push(this.tenantProjection(record));
    }
    return available;
  }

  async resolveReference(
    actor: PlatformActorReference,
    tenantId: string,
    offeringId: string,
    requiredCategory: CatalogOfferingCategory,
  ): Promise<CatalogOfferingReference> {
    const id = slug(offeringId, "offering ID");
    const selectedCategory = category(requiredCategory);
    const authority = await this.identity.authorizeTenant(actor, tenantId);
    const records = await this.registry.tenantOfferings(
      tenantId,
      authority.principal.id,
      selectedCategory,
    );
    await this.identity.authorizeTenant(actor, tenantId);
    const record = records.find((candidate) => candidate.offeringId === id);
    if (!record || !await this.sourceAvailable(record)) {
      throw new IdentityError("forbidden", "offering is unavailable to this Tenant");
    }
    return {
      offeringId: record.offeringId,
      category: record.category,
      kind: record.kind,
      version: record.version,
      digest: record.digest,
      sourceGatewayId: record.sourceGatewayId,
      upstreamStableId: record.upstreamStableId,
      sourceGatewayAuthorityEpoch: record.sourceGatewayAuthorityEpoch,
    };
  }
}
