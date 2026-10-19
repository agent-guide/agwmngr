import {
  authoredResourceKinds,
  packageLimits,
  safePackagePath,
  type AuthoredResource,
  type AuthoredResourceContent,
  type AuthoredResourceDetail,
  type AuthoredResourceKind,
  type AuthoredResourceRevision,
  type CreateAuthoredResourceInput,
} from "../../contracts/platform/authored-resources";
import {
  catalogAvailabilityModes,
  type CatalogAvailabilityMode,
} from "../../contracts/platform/catalog";
import type { PlatformActorReference, Principal } from "../../contracts/platform/identity";
import type { ContentRuntime } from "../ports/content";
import { IdentityError, type PlatformIdentityService } from "./identity";
import {
  AuthoredResourceRegistry,
  type StoredAuthoredResource,
  type StoredAuthoredRevision,
} from "./authored-resource-registry";

function invalid(message: string): never {
  throw new IdentityError("invalid_input", message);
}

function resourceKind(value: unknown): AuthoredResourceKind {
  if (!authoredResourceKinds.includes(value as AuthoredResourceKind)) {
    return invalid("resource kind must be skill or instruction");
  }
  return value as AuthoredResourceKind;
}

function boundedText(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string") return invalid(`${label} must be text`);
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > maximum) {
    return invalid(`${label} must be ${allowEmpty ? `at most ${maximum}` : `between 1 and ${maximum}`} characters`);
  }
  return normalized;
}

function availability(input: {
  mode: CatalogAvailabilityMode;
  tenantIds?: string[];
}): { mode: CatalogAvailabilityMode; tenantIds: string[] } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return invalid("availability is required");
  }
  if (Object.keys(input).some((key) => !["mode", "tenantIds"].includes(key))) {
    return invalid("unsupported availability field");
  }
  if (!catalogAvailabilityModes.includes(input.mode)) return invalid("invalid availability mode");
  if (input.tenantIds !== undefined && !Array.isArray(input.tenantIds)) {
    return invalid("tenantIds must be an array");
  }
  const tenantIds = input.tenantIds ?? [];
  if (tenantIds.length > 1000) return invalid("Tenant allowlist exceeds 1000 entries");
  if (tenantIds.some((tenantId) => typeof tenantId !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(tenantId))) {
    return invalid("Tenant IDs must be lowercase slugs");
  }
  if (new Set(tenantIds).size !== tenantIds.length) return invalid("Tenant allowlist contains duplicates");
  if (input.mode === "all-active-tenants" && tenantIds.length) {
    return invalid("all-active-tenants cannot include a Tenant allowlist");
  }
  return { mode: input.mode, tenantIds: [...tenantIds].sort() };
}

export class AuthoredResourceService {
  constructor(
    private readonly registry: AuthoredResourceRegistry,
    private readonly identity: PlatformIdentityService,
    private readonly runtime: ContentRuntime,
  ) {}

  private validateContent(kind: AuthoredResourceKind, value: unknown): AuthoredResourceContent {
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("content is required");
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some((key) => !["text", "files", "tags"].includes(key))) {
      return invalid("unsupported content field");
    }
    if (typeof input.text !== "string" || !Array.isArray(input.files) || !Array.isArray(input.tags)) {
      return invalid("content requires text, files and tags");
    }
    const textBytes = new TextEncoder().encode(input.text).byteLength;
    if (textBytes > packageLimits.fileBytes) return invalid("content text exceeds 10 MiB");
    if (kind === "instruction" && !input.text.trim()) return invalid("instruction text is required");
    if (input.tags.length > 30 || input.tags.some((tag) =>
      typeof tag !== "string" || !tag.trim() || tag.trim().length > 80
    )) return invalid("tags must contain at most 30 non-empty values up to 80 characters");
    if (input.files.length > packageLimits.files) return invalid("Skill package exceeds 500 files");
    if (kind === "instruction" && input.files.length) return invalid("instructions cannot contain package files");

    const seen = new Set<string>();
    let totalBytes = textBytes;
    const files = input.files.map((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        return invalid("invalid package file");
      }
      const file = candidate as Record<string, unknown>;
      if (Object.keys(file).some((key) => !["path", "data"].includes(key))) {
        return invalid("unsupported package file field");
      }
      if (typeof file.path !== "string" || !safePackagePath(file.path) || seen.has(file.path)) {
        return invalid("unsafe or duplicate package path");
      }
      if (typeof file.data !== "string" || file.data.length > Math.ceil(packageLimits.fileBytes / 3) * 4 + 4) {
        return invalid("package file exceeds 10 MiB");
      }
      let bytes: Uint8Array;
      try {
        bytes = this.runtime.decodeBase64(file.data);
      } catch {
        return invalid("package file is not valid base64");
      }
      if (bytes.byteLength > packageLimits.fileBytes) return invalid("package file exceeds 10 MiB");
      const canonical = this.runtime.encodeBase64(bytes);
      if (canonical !== file.data) return invalid("package file data must use canonical base64");
      totalBytes += bytes.byteLength;
      if (totalBytes > packageLimits.totalBytes) return invalid("package exceeds 50 MiB expanded");
      seen.add(file.path);
      return { path: file.path, data: canonical };
    }).sort((left, right) => left.path.localeCompare(right.path));
    if (kind === "skill" && !seen.has("SKILL.md")) return invalid("Skill packages require root SKILL.md");
    const tags = [...new Set((input.tags as string[]).map((tag) => tag.trim()))].sort();
    return { text: input.text, files, tags };
  }

  private validateCreate(kind: AuthoredResourceKind, input: CreateAuthoredResourceInput) {
    resourceKind(kind);
    if (!input || typeof input !== "object" || Array.isArray(input)) return invalid("resource input is required");
    if (Object.keys(input).some((key) => !["name", "description", "content"].includes(key))) {
      return invalid("unsupported resource field");
    }
    return {
      name: boundedText(input.name, "name", 200),
      description: boundedText(input.description, "description", 2000, true),
      content: this.validateContent(kind, input.content),
    };
  }

  private async project(record: StoredAuthoredResource): Promise<AuthoredResource> {
    return {
      id: record.id,
      kind: record.kind,
      name: record.name,
      description: record.description,
      owner: record.ownerKind === "tenant"
        ? { kind: "tenant", tenantId: record.tenantId! }
        : { kind: "platform" },
      ownerPrincipalId: record.ownerPrincipalId,
      status: record.status,
      availability: record.ownerKind === "platform"
        ? {
            mode: record.availabilityMode!,
            tenantIds: record.availabilityMode === "tenant-allowlist"
              ? await this.registry.availabilityTenantIds(record.id)
              : [],
          }
        : null,
      latestRevisionNumber: record.latestRevisionNumber,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private revision(record: StoredAuthoredRevision): AuthoredResourceRevision {
    return {
      id: record.id,
      resourceId: record.resourceId,
      number: record.number,
      status: record.status,
      content: JSON.parse(record.contentJson) as AuthoredResourceContent,
      contentHash: record.contentHash,
      createdByPrincipalId: record.createdByPrincipalId,
      createdAt: record.createdAt,
    };
  }

  private newRecords(
    kind: AuthoredResourceKind,
    owner: Principal,
    tenantId: string | null,
    values: ReturnType<AuthoredResourceService["validateCreate"]>,
    availabilityMode: CatalogAvailabilityMode | null,
  ): { resource: StoredAuthoredResource; revision: StoredAuthoredRevision } {
    const id = `${kind}:${this.runtime.id()}`;
    const now = this.runtime.now();
    const contentJson = JSON.stringify(values.content);
    return {
      resource: {
        id,
        kind,
        name: values.name,
        description: values.description,
        ownerKind: tenantId === null ? "platform" : "tenant",
        tenantId,
        tenantAuthorityEpoch: null,
        ownerPrincipalId: owner.id,
        status: "active",
        availabilityMode,
        latestRevisionNumber: 1,
        createdAt: now,
        updatedAt: now,
      },
      revision: {
        id: `revision:${this.runtime.id()}`,
        resourceId: id,
        number: 1,
        status: "draft",
        contentJson,
        contentHash: this.runtime.hash(contentJson),
        createdByPrincipalId: owner.id,
        createdAt: now,
      },
    };
  }

  async listTenant(actor: PlatformActorReference, tenantId: string, kind: AuthoredResourceKind): Promise<AuthoredResource[]> {
    await this.identity.authorizeTenant(actor, tenantId);
    const records = await this.registry.listForTenant(tenantId, resourceKind(kind));
    await this.identity.authorizeTenant(actor, tenantId);
    return Promise.all(records.map((record) => this.project(record)));
  }

  async getTenant(actor: PlatformActorReference, tenantId: string, kind: AuthoredResourceKind, id: string): Promise<AuthoredResourceDetail> {
    const record = (await this.visibleTenantRecord(actor, tenantId, kind, id));
    return {
      resource: await this.project(record),
      revisions: (await this.registry.revisions(record.id)).map((revision) => this.revision(revision)),
    };
  }

  private async visibleTenantRecord(actor: PlatformActorReference, tenantId: string, kind: AuthoredResourceKind, id: string): Promise<StoredAuthoredResource> {
    await this.identity.authorizeTenant(actor, tenantId);
    const record = (await this.registry.listForTenant(tenantId, resourceKind(kind))).find((item) => item.id === id);
    await this.identity.authorizeTenant(actor, tenantId);
    if (!record) throw new IdentityError("not_found", "resource not found");
    return record;
  }

  private async mutableTenantRecord(actor: PlatformActorReference, tenantId: string, kind: AuthoredResourceKind, id: string) {
    const authority = await this.identity.authorizeTenant(actor, tenantId);
    const record = (await this.registry.listForTenant(tenantId, resourceKind(kind)))
      .find((item) => item.id === id && item.ownerKind === "tenant");
    if (!record) {
      throw new IdentityError("not_found", "resource not found");
    }
    await this.identity.authorizeTenant(actor, tenantId);
    return { authority, record };
  }

  async createTenant(actor: PlatformActorReference, tenantId: string, kind: AuthoredResourceKind, input: CreateAuthoredResourceInput): Promise<AuthoredResourceDetail> {
    const authority = await this.identity.authorizeTenant(actor, tenantId);
    const records = this.newRecords(kind, authority.principal, tenantId, this.validateCreate(kind, input), null);
    const result = await this.registry.create(records.resource, records.revision);
    if (result !== "created") throw new IdentityError(result === "exists" ? "conflict" : "forbidden");
    await this.identity.authorizeTenant(actor, tenantId);
    return { resource: await this.project(records.resource), revisions: [this.revision(records.revision)] };
  }

  async listPlatform(actor: PlatformActorReference, kind: AuthoredResourceKind): Promise<AuthoredResource[]> {
    await this.identity.requirePlatformAdmin(actor);
    return Promise.all((await this.registry.listPlatform(resourceKind(kind))).map((record) => this.project(record)));
  }

  async getPlatform(actor: PlatformActorReference, kind: AuthoredResourceKind, id: string): Promise<AuthoredResourceDetail> {
    await this.identity.requirePlatformAdmin(actor);
    const record = await this.registry.get(id);
    if (!record || record.kind !== resourceKind(kind) || record.ownerKind !== "platform") {
      throw new IdentityError("not_found", "resource not found");
    }
    return { resource: await this.project(record), revisions: (await this.registry.revisions(id)).map((item) => this.revision(item)) };
  }

  async createPlatform(
    actor: PlatformActorReference,
    kind: AuthoredResourceKind,
    input: CreateAuthoredResourceInput,
    availabilityInput: { mode: CatalogAvailabilityMode; tenantIds?: string[] },
  ): Promise<AuthoredResourceDetail> {
    const owner = await this.identity.requirePlatformAdmin(actor);
    const selected = availability(availabilityInput);
    const records = this.newRecords(kind, owner, null, this.validateCreate(kind, input), selected.mode);
    const result = await this.registry.create(records.resource, records.revision, selected.tenantIds);
    if (result === "invalid_tenant") throw new IdentityError("invalid_input", "Tenant allowlist must contain active Tenants");
    if (result === "exists") throw new IdentityError("conflict", "resource ID collision");
    return { resource: await this.project(records.resource), revisions: [this.revision(records.revision)] };
  }

  async updateMetadata(
    actor: PlatformActorReference,
    tenantId: string | null,
    kind: AuthoredResourceKind,
    id: string,
    input: { name: string; description: string },
  ): Promise<AuthoredResource> {
    const name = boundedText(input.name, "name", 200);
    const description = boundedText(input.description, "description", 2000, true);
    let record: AuthoredResource;
    if (tenantId === null) {
      record = (await this.getPlatform(actor, kind, id)).resource;
    } else {
      await this.mutableTenantRecord(actor, tenantId, kind, id);
      record = (await this.getTenant(actor, tenantId, kind, id)).resource;
    }
    const updatedAt = this.runtime.now();
    const result = await this.registry.updateMetadata(id, name, description, updatedAt);
    if (result === "missing") {
      throw new IdentityError("not_found", "resource not found");
    }
    if (result === "archived") throw new IdentityError("conflict", "archived resources are immutable");
    if (tenantId === null) await this.identity.requirePlatformAdmin(actor);
    else await this.identity.authorizeTenant(actor, tenantId);
    return { ...record, name, description, updatedAt };
  }

  async addRevision(
    actor: PlatformActorReference,
    tenantId: string | null,
    kind: AuthoredResourceKind,
    id: string,
    contentInput: AuthoredResourceContent,
  ): Promise<AuthoredResourceRevision> {
    let principal: Principal;
    if (tenantId === null) {
      principal = await this.identity.requirePlatformAdmin(actor);
      await this.getPlatform(actor, kind, id);
    } else {
      principal = (await this.mutableTenantRecord(actor, tenantId, kind, id)).authority.principal;
    }
    const content = this.validateContent(kind, contentInput);
    const contentJson = JSON.stringify(content);
    const revision: StoredAuthoredRevision = {
      id: `revision:${this.runtime.id()}`,
      resourceId: id,
      number: 0,
      status: "draft",
      contentJson,
      contentHash: this.runtime.hash(contentJson),
      createdByPrincipalId: principal.id,
      createdAt: this.runtime.now(),
    };
    const result = await this.registry.addRevision(id, revision);
    if (result === "missing") throw new IdentityError("not_found", "resource not found");
    if (result === "archived") throw new IdentityError("conflict", "archived resources are immutable");
    if (tenantId === null) await this.identity.requirePlatformAdmin(actor);
    else await this.identity.authorizeTenant(actor, tenantId);
    const created = (await this.registry.revisions(id)).find((item) => item.id === revision.id)!;
    return this.revision(created);
  }

  async setRevisionStatus(
    actor: PlatformActorReference,
    tenantId: string | null,
    kind: AuthoredResourceKind,
    id: string,
    revisionId: string,
    status: "published" | "archived",
  ): Promise<AuthoredResourceRevision> {
    if (status !== "published" && status !== "archived") return invalid("revision status must be published or archived");
    if (tenantId === null) await this.getPlatform(actor, kind, id);
    else await this.mutableTenantRecord(actor, tenantId, kind, id);
    const result = await this.registry.setRevisionStatus(id, revisionId, status);
    if (result === "missing") throw new IdentityError("not_found", "revision not found");
    if (result === "referenced") throw new IdentityError("conflict", "referenced revisions cannot be archived");
    if (result === "resource_archived" || result === "revision_archived") {
      throw new IdentityError("conflict", "archived resources and revisions are immutable");
    }
    if (tenantId === null) await this.identity.requirePlatformAdmin(actor);
    else await this.identity.authorizeTenant(actor, tenantId);
    const revision = (await this.registry.revisions(id)).find((item) => item.id === revisionId)!;
    return this.revision(revision);
  }

  async remove(actor: PlatformActorReference, tenantId: string | null, kind: AuthoredResourceKind, id: string): Promise<void> {
    if (tenantId === null) await this.getPlatform(actor, kind, id);
    else await this.mutableTenantRecord(actor, tenantId, kind, id);
    const result = await this.registry.remove(id, tenantId === null, this.runtime.now());
    if (result === "missing") throw new IdentityError("not_found", "resource not found");
    if (result === "referenced") throw new IdentityError("conflict", "referenced resources cannot be archived or deleted");
    if (tenantId === null) await this.identity.requirePlatformAdmin(actor);
    else await this.identity.authorizeTenant(actor, tenantId);
  }

  async setPlatformAvailability(
    actor: PlatformActorReference,
    kind: AuthoredResourceKind,
    id: string,
    input: { mode: CatalogAvailabilityMode; tenantIds?: string[] },
  ): Promise<AuthoredResource> {
    await this.getPlatform(actor, kind, id);
    const selected = availability(input);
    const result = await this.registry.setAvailability(id, selected.mode, selected.tenantIds, this.runtime.now());
    if (result === "missing") throw new IdentityError("not_found", "resource not found");
    if (result === "archived") throw new IdentityError("conflict", "archived resource availability is immutable");
    if (result === "invalid_tenant") throw new IdentityError("invalid_input", "Tenant allowlist must contain active Tenants");
    await this.identity.requirePlatformAdmin(actor);
    return this.project((await this.registry.get(id))!);
  }
}
