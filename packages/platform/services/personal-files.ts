import {
  maxPersonalFileBytes,
  type PersonalFile,
  type PersonalFileUploadRequest,
} from "../../contracts/platform/personal-files";
import type {
  HumanPrincipal,
  PlatformActorReference,
} from "../../contracts/platform/identity";
import type { ContentRuntime } from "../ports/content";
import { ObjectStoreConflictError, type ObjectStore } from "../ports/objects";
import { IdentityError, type PlatformIdentityService } from "./identity";
import {
  PersonalFileRegistry,
  type StoredPersonalFile,
} from "./personal-file-registry";

const previewMimeTypes = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp",
  "application/pdf", "application/json", "text/plain", "text/csv", "text/markdown",
]);

function invalid(message: string): never {
  throw new IdentityError("invalid_input", message);
}

function name(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 240 || /[\\/\x00-\x1f\x7f]/.test(value)) {
    return invalid("file name must be 1–240 safe characters");
  }
  return value.trim();
}

function mime(value: unknown): string {
  if (typeof value !== "string" || value.length > 120 || !/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(value)) {
    return invalid("invalid MIME type");
  }
  return value;
}

export class PersonalFileService {
  constructor(
    private readonly registry: PersonalFileRegistry,
    private readonly identity: PlatformIdentityService,
    private readonly objects: ObjectStore,
    private readonly runtime: ContentRuntime,
  ) {}

  private expires(minutes: number): string {
    return new Date(new Date(this.runtime.now()).getTime() + minutes * 60_000).toISOString();
  }

  private projection(record: StoredPersonalFile): PersonalFile {
    return {
      id: record.id,
      tenantId: record.tenantId,
      ownerPrincipalId: record.ownerPrincipalId,
      ownerUserId: record.ownerUserId,
      name: record.name,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      contentHash: record.contentHash,
      status: record.status,
      failureReason: record.failureReason,
      previewAvailable: record.status === "active" && previewMimeTypes.has(record.mimeType),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private async humanAuthority(
    actor: PlatformActorReference,
    tenantId: string,
  ): Promise<HumanPrincipal> {
    const authority = await this.identity.authorizeTenant(actor, tenantId);
    if (authority.principal.kind !== "human") {
      throw new IdentityError("forbidden", "personal files require a human Principal");
    }
    return authority.principal;
  }

  private async visible(
    actor: PlatformActorReference,
    tenantId: string,
    id: string,
    includePending = false,
  ): Promise<{ principal: HumanPrincipal; record: StoredPersonalFile }> {
    const principal = await this.humanAuthority(actor, tenantId);
    const record = (await this.registry.list(tenantId, principal.id)).find((item) => item.id === id);
    await this.humanAuthority(actor, tenantId);
    if (!record || record.status === "deleted" || !includePending && record.status !== "active") {
      throw new IdentityError("not_found", "personal file not found");
    }
    return { principal, record };
  }

  async list(actor: PlatformActorReference, tenantId: string): Promise<PersonalFile[]> {
    const principal = await this.humanAuthority(actor, tenantId);
    const records = await this.registry.list(tenantId, principal.id);
    await this.humanAuthority(actor, tenantId);
    return records.map((record) => this.projection(record));
  }

  private validateUpload(input: PersonalFileUploadRequest) {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) =>
      !["requestKey", "name", "mimeType", "sizeBytes", "contentHash"].includes(key)
    )) return invalid("invalid upload request");
    if (typeof input.requestKey !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.requestKey)) {
      return invalid("invalid request key");
    }
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > maxPersonalFileBytes) {
      return invalid("file must be between 1 byte and 25 MiB");
    }
    if (input.contentHash !== undefined && !/^[0-9a-f]{64}$/.test(input.contentHash)) {
      return invalid("contentHash must be lowercase SHA-256");
    }
    return {
      requestKey: input.requestKey,
      name: name(input.name),
      mimeType: mime(input.mimeType),
      sizeBytes: input.sizeBytes,
      expectedHash: input.contentHash ?? null,
    };
  }

  async initiate(
    actor: PlatformActorReference,
    tenantId: string,
    input: PersonalFileUploadRequest,
    retried = false,
  ): Promise<{ item: PersonalFile; token: string; expiresAt: string }> {
    const principal = await this.humanAuthority(actor, tenantId);
    const values = this.validateUpload(input);
    const now = this.runtime.now();
    const record: StoredPersonalFile = {
      id: `file:${this.runtime.id()}`,
      tenantId,
      tenantAuthorityEpoch: 0,
      ownerPrincipalId: principal.id,
      ownerUserId: principal.userId,
      name: values.name,
      mimeType: values.mimeType,
      sizeBytes: values.sizeBytes,
      expectedHash: values.expectedHash,
      contentHash: null,
      objectKey: `files/${this.runtime.id()}`,
      status: "pending",
      failureReason: null,
      requestKey: values.requestKey,
      expiresAt: this.expires(60),
      objectDeletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const result = await this.registry.createOrRetry(record);
    if (result.status === "invalid_tenant") throw new IdentityError("forbidden");
    if (result.status === "stale") throw new IdentityError("conflict", "request key belongs to a prior Tenant authority epoch");
    if (result.status === "conflict") throw new IdentityError("conflict", "request key was already used with different file metadata");
    const item = result.item!;
    if (item.status === "pending" && item.expiresAt <= now && !retried) {
      await this.registry.fail(item.id, "upload session expired", now);
      return this.initiate(actor, tenantId, input, true);
    }
    const token = `${this.runtime.id()}${this.runtime.id()}`;
    const expiresAt = this.expires(10);
    await this.registry.createTicket({ digest: this.runtime.hash(token), fileId: item.id,
      operation: "upload", ownerPrincipalId: principal.id, expiresAt, createdAt: now });
    await this.humanAuthority(actor, tenantId);
    return { item: this.projection(item), token, expiresAt };
  }

  private async ticketFile(
    actor: PlatformActorReference,
    token: string,
    operation: "upload" | "download" | "preview",
  ): Promise<StoredPersonalFile> {
    if (typeof token !== "string" || token.length < 32 || token.length > 200) {
      throw new IdentityError("unauthenticated", "invalid object ticket");
    }
    const ticket = await this.registry.ticket(this.runtime.hash(token));
    if (!ticket || ticket.operation !== operation || ticket.expires_at <= this.runtime.now()) {
      throw new IdentityError("unauthenticated", "object ticket expired or invalid");
    }
    const stored = await this.registry.get(ticket.file_id);
    if (!stored || stored.status === "deleted") throw new IdentityError("not_found", "personal file not found");
    const principal = await this.humanAuthority(actor, stored.tenantId);
    if (principal.id !== ticket.owner_principal_id || principal.id !== stored.ownerPrincipalId) {
      throw new IdentityError("forbidden", "personal file belongs to another human");
    }
    const record = (await this.registry.list(stored.tenantId, principal.id))
      .find((item) => item.id === stored.id);
    await this.humanAuthority(actor, stored.tenantId);
    if (!record) throw new IdentityError("not_found", "personal file not found");
    return record;
  }

  async upload(
    actor: PlatformActorReference,
    token: string,
    bytes: Uint8Array,
    suppliedMime: string,
  ): Promise<PersonalFile> {
    const record = await this.ticketFile(actor, token, "upload");
    if (record.status !== "pending" && record.status !== "active") throw new IdentityError("conflict", "upload session is not pending");
    if (record.status === "pending" && record.expiresAt <= this.runtime.now()) {
      await this.registry.fail(record.id, "upload session expired", this.runtime.now());
      throw new IdentityError("conflict", "upload session expired");
    }
    if (bytes.byteLength !== record.sizeBytes || suppliedMime !== record.mimeType) {
      await this.registry.fail(record.id, "upload size or MIME type mismatch", this.runtime.now());
      throw new IdentityError("invalid_input", "upload size or MIME type mismatch");
    }
    const hash = this.runtime.hashBytes(bytes);
    if (record.expectedHash && record.expectedHash !== hash) {
      await this.registry.fail(record.id, "content hash mismatch", this.runtime.now());
      throw new IdentityError("invalid_input", "content hash mismatch");
    }
    try {
      await this.objects.put(record.objectKey, bytes);
    } catch (error) {
      if (!(error instanceof ObjectStoreConflictError)) throw error;
      await this.registry.fail(record.id, "stored file content is immutable", this.runtime.now());
      throw new IdentityError("conflict", "stored file content is immutable");
    }
    const result = await this.registry.setUploaded(record.id, hash, this.runtime.now());
    if (result === "missing") throw new IdentityError("not_found", "personal file not found");
    if (result === "conflict") throw new IdentityError("conflict", "stored file content is immutable");
    await this.humanAuthority(actor, record.tenantId);
    return this.projection((await this.registry.get(record.id))!);
  }

  async complete(actor: PlatformActorReference, tenantId: string, id: string): Promise<PersonalFile> {
    const { record } = await this.visible(actor, tenantId, id, true);
    if (record.status === "active") return this.projection(record);
    if (record.status !== "pending") throw new IdentityError("conflict", "failed uploads must be retried with the same request key");
    const stored = await this.objects.stat(record.objectKey);
    if (!stored || stored.sizeBytes !== record.sizeBytes || !record.contentHash || stored.contentHash !== record.contentHash ||
      record.expectedHash && record.expectedHash !== stored.contentHash) {
      await this.registry.fail(record.id, "uploaded object is missing or does not match", this.runtime.now());
      throw new IdentityError("conflict", "uploaded object is missing or does not match");
    }
    const result = await this.registry.activate(id, this.runtime.now());
    if (result !== "active") throw new IdentityError(result === "missing" ? "not_found" : "conflict");
    await this.humanAuthority(actor, tenantId);
    return this.projection((await this.registry.get(id))!);
  }

  async createReadTicket(
    actor: PlatformActorReference,
    tenantId: string,
    id: string,
    operation: "download" | "preview",
  ): Promise<{ token: string; expiresAt: string }> {
    const { principal, record } = await this.visible(actor, tenantId, id);
    if (operation === "preview" && !previewMimeTypes.has(record.mimeType)) {
      throw new IdentityError("conflict", "preview is unavailable for this file type");
    }
    const token = `${this.runtime.id()}${this.runtime.id()}`;
    const now = this.runtime.now();
    const expiresAt = this.expires(5);
    await this.registry.createTicket({ digest: this.runtime.hash(token), fileId: record.id,
      operation, ownerPrincipalId: principal.id, expiresAt, createdAt: now });
    await this.humanAuthority(actor, tenantId);
    return { token, expiresAt };
  }

  async read(
    actor: PlatformActorReference,
    token: string,
    operation: "download" | "preview",
  ): Promise<{ item: PersonalFile; bytes: Uint8Array }> {
    const record = await this.ticketFile(actor, token, operation);
    if (record.status !== "active") throw new IdentityError("not_found", "personal file not found");
    if (operation === "preview" && !previewMimeTypes.has(record.mimeType)) {
      throw new IdentityError("conflict", "preview is unavailable for this file type");
    }
    return { item: this.projection(record), bytes: await this.objects.read(record.objectKey) };
  }

  async remove(actor: PlatformActorReference, tenantId: string, id: string): Promise<void> {
    await this.visible(actor, tenantId, id, true);
    const result = await this.registry.remove(id, this.runtime.now());
    if (result === "missing") throw new IdentityError("not_found", "personal file not found");
    if (result === "referenced") throw new IdentityError("conflict", "referenced personal files cannot be deleted");
    await this.humanAuthority(actor, tenantId);
  }
}

export async function collectPersonalFileGarbage(
  registry: PersonalFileRegistry,
  objects: ObjectStore,
  now = new Date().toISOString(),
): Promise<{ removed: number; failed: string[] }> {
  await registry.purgeExpiredTickets(now);
  let removed = 0;
  const failed: string[] = [];
  for (const item of await registry.deletedObjects()) {
    try {
      await objects.remove(item.objectKey);
      await registry.markObjectDeleted(item.id, now);
      removed += 1;
    } catch {
      failed.push(item.id);
    }
  }
  return { removed, failed };
}
