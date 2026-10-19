import {
  documentExtensions,
  maxDocumentBatch,
  maxDocumentBytes,
  type DocumentUploadRequest,
  type KnowledgeBase,
  type KnowledgeDocument,
} from "../../contracts/platform/knowledge";
import type { PlatformActorReference, Principal } from "../../contracts/platform/identity";
import type { ContentRuntime } from "../ports/content";
import { ObjectStoreConflictError, type ObjectStore } from "../ports/objects";
import { IdentityError, type PlatformIdentityService } from "./identity";
import {
  KnowledgeRegistry,
  type StoredKnowledgeBase,
  type StoredKnowledgeDocument,
} from "./knowledge-registry";

function invalid(message: string): never {
  throw new IdentityError("invalid_input", message);
}

function bounded(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string") return invalid(`${label} must be text`);
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > maximum) {
    return invalid(`${label} must be ${allowEmpty ? `at most ${maximum}` : `between 1 and ${maximum}`} characters`);
  }
  return normalized;
}

function documentName(value: unknown): string {
  const name = bounded(value, "document name", 240);
  if (/[\\/\x00-\x1f\x7f]/.test(name)) return invalid("document name contains unsafe characters");
  const extension = name.split(".").pop()?.toLowerCase();
  if (!documentExtensions.includes(extension as (typeof documentExtensions)[number])) {
    return invalid(`document extension must be one of: ${documentExtensions.join(", ")}`);
  }
  return name;
}

function mimeType(value: unknown): string {
  if (typeof value !== "string" || value.length > 120 || !/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(value)) {
    return invalid("invalid document MIME type");
  }
  return value;
}

export class KnowledgeService {
  constructor(
    private readonly registry: KnowledgeRegistry,
    private readonly identity: PlatformIdentityService,
    private readonly objects: ObjectStore,
    private readonly runtime: ContentRuntime,
  ) {}

  private expires(minutes: number): string {
    return new Date(new Date(this.runtime.now()).getTime() + minutes * 60_000).toISOString();
  }

  private knowledge(record: StoredKnowledgeBase): KnowledgeBase {
    return {
      id: record.id,
      tenantId: record.tenantId,
      name: record.name,
      description: record.description,
      status: record.status,
      documentCount: record.documentCount,
      indexingStatus: "unavailable",
      retrievalStatus: "unavailable",
      createdByPrincipalId: record.createdByPrincipalId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private documentProjection(record: StoredKnowledgeDocument): KnowledgeDocument {
    return {
      id: record.id,
      knowledgeBaseId: record.knowledgeBaseId,
      tenantId: record.tenantId,
      name: record.name,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      contentHash: record.contentHash,
      status: record.status,
      failureReason: record.failureReason,
      parseStatus: "unavailable",
      indexStatus: "unavailable",
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private async visibleKnowledge(
    actor: PlatformActorReference,
    tenantId: string,
    knowledgeBaseId: string,
    active = false,
  ): Promise<{ principal: Principal; record: StoredKnowledgeBase }> {
    const authority = await this.identity.authorizeTenant(actor, tenantId);
    const record = (await this.registry.listKnowledgeBases(tenantId)).find((item) => item.id === knowledgeBaseId);
    await this.identity.authorizeTenant(actor, tenantId);
    if (!record || active && record.status !== "active") {
      throw new IdentityError("not_found", active ? "active knowledge base not found" : "knowledge base not found");
    }
    return { principal: authority.principal, record };
  }

  private async visibleDocument(
    actor: PlatformActorReference,
    tenantId: string,
    knowledgeBaseId: string,
    documentId: string,
    includePending = false,
  ): Promise<{ principal: Principal; record: StoredKnowledgeDocument }> {
    const { principal } = await this.visibleKnowledge(actor, tenantId, knowledgeBaseId, true);
    const record = await this.registry.getDocument(documentId);
    if (!record || record.tenantId !== tenantId || record.knowledgeBaseId !== knowledgeBaseId ||
      record.status === "deleted" || !includePending && record.status !== "active") {
      throw new IdentityError("not_found", "document not found");
    }
    await this.identity.authorizeTenant(actor, tenantId);
    return { principal, record };
  }

  async list(actor: PlatformActorReference, tenantId: string): Promise<KnowledgeBase[]> {
    await this.identity.authorizeTenant(actor, tenantId);
    const records = await this.registry.listKnowledgeBases(tenantId);
    await this.identity.authorizeTenant(actor, tenantId);
    return records.map((record) => this.knowledge(record));
  }

  async get(actor: PlatformActorReference, tenantId: string, id: string): Promise<KnowledgeBase> {
    return this.knowledge((await this.visibleKnowledge(actor, tenantId, id)).record);
  }

  async create(
    actor: PlatformActorReference,
    tenantId: string,
    input: { name: string; description: string },
  ): Promise<KnowledgeBase> {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => !["name", "description"].includes(key))) {
      return invalid("invalid knowledge-base input");
    }
    const authority = await this.identity.authorizeTenant(actor, tenantId);
    const now = this.runtime.now();
    const record: StoredKnowledgeBase = {
      id: `knowledge:${this.runtime.id()}`,
      tenantId,
      tenantAuthorityEpoch: 0,
      name: bounded(input.name, "name", 200),
      description: bounded(input.description, "description", 2000, true),
      status: "active",
      createdByPrincipalId: authority.principal.id,
      documentCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    const result = await this.registry.createKnowledgeBase(record);
    if (result !== "created") throw new IdentityError(result === "exists" ? "conflict" : "forbidden");
    await this.identity.authorizeTenant(actor, tenantId);
    return this.knowledge(record);
  }

  async update(
    actor: PlatformActorReference,
    tenantId: string,
    id: string,
    input: { name: string; description: string },
  ): Promise<KnowledgeBase> {
    await this.visibleKnowledge(actor, tenantId, id, true);
    const name = bounded(input.name, "name", 200);
    const description = bounded(input.description, "description", 2000, true);
    const now = this.runtime.now();
    if (!await this.registry.updateKnowledgeBase(id, name, description, now)) {
      throw new IdentityError("conflict", "archived knowledge bases are immutable");
    }
    await this.identity.authorizeTenant(actor, tenantId);
    return this.knowledge((await this.registry.getKnowledgeBase(id))!);
  }

  async remove(actor: PlatformActorReference, tenantId: string, id: string): Promise<void> {
    await this.visibleKnowledge(actor, tenantId, id);
    const result = await this.registry.archiveKnowledgeBase(id, this.runtime.now());
    if (result === "missing") throw new IdentityError("not_found", "knowledge base not found");
    if (result === "not_empty") throw new IdentityError("conflict", "delete every document before archiving the knowledge base");
    if (result === "referenced") throw new IdentityError("conflict", "referenced knowledge bases cannot be archived");
    await this.identity.authorizeTenant(actor, tenantId);
  }

  async listDocuments(
    actor: PlatformActorReference,
    tenantId: string,
    knowledgeBaseId: string,
  ): Promise<KnowledgeDocument[]> {
    await this.visibleKnowledge(actor, tenantId, knowledgeBaseId, true);
    const records = await this.registry.listDocuments(knowledgeBaseId);
    await this.identity.authorizeTenant(actor, tenantId);
    return records.map((record) => this.documentProjection(record));
  }

  private validateUpload(input: DocumentUploadRequest) {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) =>
      !["requestKey", "name", "mimeType", "sizeBytes", "contentHash"].includes(key)
    )) return invalid("invalid upload request");
    const requestKey = bounded(input.requestKey, "request key", 100);
    if (!/^[a-zA-Z0-9_-]+$/.test(requestKey)) return invalid("invalid request key");
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > maxDocumentBytes) {
      return invalid("document must be between 1 byte and 25 MiB");
    }
    if (input.contentHash !== undefined && !/^[0-9a-f]{64}$/.test(input.contentHash)) {
      return invalid("contentHash must be lowercase SHA-256");
    }
    return {
      requestKey,
      name: documentName(input.name),
      mimeType: mimeType(input.mimeType),
      sizeBytes: input.sizeBytes,
      expectedHash: input.contentHash ?? null,
    };
  }

  private async initiateOne(
    principal: Principal,
    tenantId: string,
    knowledgeBaseId: string,
    input: DocumentUploadRequest,
    retried = false,
  ): Promise<{ item: KnowledgeDocument; token: string; expiresAt: string }> {
    const values = this.validateUpload(input);
    const now = this.runtime.now();
    const record: StoredKnowledgeDocument = {
      id: `document:${this.runtime.id()}`,
      knowledgeBaseId,
      tenantId,
      tenantAuthorityEpoch: 0,
      name: values.name,
      mimeType: values.mimeType,
      sizeBytes: values.sizeBytes,
      expectedHash: values.expectedHash,
      contentHash: null,
      objectKey: `documents/${this.runtime.id()}`,
      status: "pending",
      failureReason: null,
      createdByPrincipalId: principal.id,
      requestKey: values.requestKey,
      expiresAt: this.expires(60),
      createdAt: now,
      updatedAt: now,
    };
    const result = await this.registry.createOrRetryDocument(record);
    if (result.status === "missing_parent") throw new IdentityError("not_found", "active knowledge base not found");
    if (result.status === "conflict") throw new IdentityError("conflict", "request key was already used with different document metadata");
    const item = result.item!;
    if (item.status === "pending" && item.expiresAt <= now && !retried) {
      await this.registry.failDocument(item.id, "upload session expired", now);
      return this.initiateOne(principal, tenantId, knowledgeBaseId, input, true);
    }
    const token = `${this.runtime.id()}${this.runtime.id()}`;
    const expiresAt = this.expires(10);
    await this.registry.createTicket({
      digest: this.runtime.hash(token),
      documentId: item.id,
      operation: "upload",
      principalId: principal.id,
      expiresAt,
      createdAt: now,
    });
    return { item: this.documentProjection(item), token, expiresAt };
  }

  async initiateUploads(
    actor: PlatformActorReference,
    tenantId: string,
    knowledgeBaseId: string,
    inputs: DocumentUploadRequest[],
  ): Promise<Array<
    | { requestKey: string; ok: true; item: KnowledgeDocument; token: string; expiresAt: string }
    | { requestKey: string; ok: false; error: string; code: "invalid_input" | "conflict" | "forbidden" | "unavailable" }
  >> {
    const { principal } = await this.visibleKnowledge(actor, tenantId, knowledgeBaseId, true);
    if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > maxDocumentBatch) {
      return invalid(`upload batch must contain between 1 and ${maxDocumentBatch} files`);
    }
    const results = [];
    for (const input of inputs) {
      const requestKey = typeof input?.requestKey === "string" ? input.requestKey : "";
      try {
        const created = await this.initiateOne(principal, tenantId, knowledgeBaseId, input);
        results.push({ requestKey, ok: true as const, ...created });
      } catch (error) {
        if (error instanceof IdentityError) {
          results.push({
            requestKey,
            ok: false as const,
            error: error.message,
            code: error.code === "invalid_input" || error.code === "conflict" || error.code === "forbidden"
              ? error.code
              : "unavailable" as const,
          });
        } else {
          results.push({ requestKey, ok: false as const, error: "document store unavailable", code: "unavailable" as const });
        }
      }
    }
    await this.identity.authorizeTenant(actor, tenantId);
    return results;
  }

  private async ticketDocument(actor: PlatformActorReference, token: string, operation: "upload" | "download") {
    if (typeof token !== "string" || token.length > 200 || token.length < 32) throw new IdentityError("unauthenticated", "invalid object ticket");
    const ticket = await this.registry.ticket(this.runtime.hash(token));
    if (!ticket || ticket.operation !== operation || ticket.expires_at <= this.runtime.now()) {
      throw new IdentityError("unauthenticated", "object ticket expired or invalid");
    }
    const principal = await this.identity.resolve(actor);
    if (principal.id !== ticket.principal_id) throw new IdentityError("forbidden", "object ticket belongs to another Principal");
    const record = await this.registry.getDocument(ticket.document_id);
    if (!record || record.status === "deleted") throw new IdentityError("not_found", "document not found");
    await this.visibleDocument(actor, record.tenantId, record.knowledgeBaseId, record.id, true);
    return record;
  }

  async upload(
    actor: PlatformActorReference,
    token: string,
    bytes: Uint8Array,
    suppliedMimeType: string,
  ): Promise<KnowledgeDocument> {
    const record = await this.ticketDocument(actor, token, "upload");
    if (record.status !== "pending" && record.status !== "active") {
      throw new IdentityError("conflict", "upload session is not pending");
    }
    if (record.status === "pending" && record.expiresAt <= this.runtime.now()) {
      await this.registry.failDocument(record.id, "upload session expired", this.runtime.now());
      throw new IdentityError("conflict", "upload session expired");
    }
    if (bytes.byteLength !== record.sizeBytes || suppliedMimeType !== record.mimeType) {
      await this.registry.failDocument(record.id, "upload size or MIME type mismatch", this.runtime.now());
      throw new IdentityError("invalid_input", "upload size or MIME type mismatch");
    }
    const contentHash = this.runtime.hashBytes(bytes);
    if (record.expectedHash && record.expectedHash !== contentHash) {
      await this.registry.failDocument(record.id, "content hash mismatch", this.runtime.now());
      throw new IdentityError("invalid_input", "content hash mismatch");
    }
    try {
      await this.objects.put(record.objectKey, bytes);
    } catch (error) {
      if (!(error instanceof ObjectStoreConflictError)) throw error;
      await this.registry.failDocument(record.id, "stored document content is immutable", this.runtime.now());
      throw new IdentityError("conflict", "stored document content is immutable");
    }
    const result = await this.registry.setUploaded(record.id, contentHash, this.runtime.now());
    if (result === "missing") throw new IdentityError("not_found", "document not found");
    if (result === "conflict") throw new IdentityError("conflict", "stored document content is immutable");
    await this.identity.authorizeTenant(actor, record.tenantId);
    return this.documentProjection((await this.registry.getDocument(record.id))!);
  }

  async complete(
    actor: PlatformActorReference,
    tenantId: string,
    knowledgeBaseId: string,
    documentId: string,
  ): Promise<KnowledgeDocument> {
    const { record } = await this.visibleDocument(actor, tenantId, knowledgeBaseId, documentId, true);
    if (record.status === "active") return this.documentProjection(record);
    if (record.status !== "pending") throw new IdentityError("conflict", "failed uploads must be retried with the same request key");
    const stored = await this.objects.stat(record.objectKey);
    if (!stored || stored.sizeBytes !== record.sizeBytes || !record.contentHash || stored.contentHash !== record.contentHash ||
      record.expectedHash && record.expectedHash !== stored.contentHash) {
      await this.registry.failDocument(record.id, "uploaded object is missing or does not match", this.runtime.now());
      throw new IdentityError("conflict", "uploaded object is missing or does not match");
    }
    const result = await this.registry.activateDocument(record.id, this.runtime.now());
    if (result !== "active") throw new IdentityError(result === "missing" ? "not_found" : "conflict");
    await this.identity.authorizeTenant(actor, tenantId);
    return this.documentProjection((await this.registry.getDocument(record.id))!);
  }

  async downloadTicket(
    actor: PlatformActorReference,
    tenantId: string,
    knowledgeBaseId: string,
    documentId: string,
  ): Promise<{ token: string; expiresAt: string }> {
    const { principal, record } = await this.visibleDocument(actor, tenantId, knowledgeBaseId, documentId);
    const token = `${this.runtime.id()}${this.runtime.id()}`;
    const now = this.runtime.now();
    const expiresAt = this.expires(5);
    await this.registry.createTicket({ digest: this.runtime.hash(token), documentId: record.id,
      operation: "download", principalId: principal.id, expiresAt, createdAt: now });
    await this.identity.authorizeTenant(actor, tenantId);
    return { token, expiresAt };
  }

  async download(actor: PlatformActorReference, token: string): Promise<{ item: KnowledgeDocument; bytes: Uint8Array }> {
    const record = await this.ticketDocument(actor, token, "download");
    if (record.status !== "active") throw new IdentityError("not_found", "document not found");
    return { item: this.documentProjection(record), bytes: await this.objects.read(record.objectKey) };
  }

  async deleteDocument(
    actor: PlatformActorReference,
    tenantId: string,
    knowledgeBaseId: string,
    documentId: string,
  ): Promise<void> {
    await this.visibleDocument(actor, tenantId, knowledgeBaseId, documentId, true);
    const result = await this.registry.deleteDocument(documentId, this.runtime.now());
    if (result === "missing") throw new IdentityError("not_found", "document not found");
    if (result === "referenced") throw new IdentityError("conflict", "referenced documents cannot be deleted");
    await this.identity.authorizeTenant(actor, tenantId);
  }
}

export async function collectKnowledgeDocumentGarbage(
  registry: KnowledgeRegistry,
  objects: ObjectStore,
  now = new Date().toISOString(),
): Promise<{ removed: number; failed: string[] }> {
  await registry.purgeExpiredTickets(now);
  let removed = 0;
  const failed: string[] = [];
  for (const item of await registry.deletedObjects()) {
    try {
      await objects.remove(item.objectKey);
      removed += 1;
    } catch {
      failed.push(item.id);
    }
  }
  return { removed, failed };
}
