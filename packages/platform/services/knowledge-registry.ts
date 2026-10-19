import type { DatabaseSession, PlatformDatabase } from "../ports/database";

interface KnowledgeRow {
  id: string;
  tenant_id: string;
  tenant_authority_epoch: number;
  name: string;
  description: string;
  status: "active" | "archived";
  created_by_principal_id: string;
  created_at: string;
  updated_at: string;
  document_count: number;
}

interface DocumentRow {
  id: string;
  knowledge_base_id: string;
  tenant_id: string;
  tenant_authority_epoch: number;
  name: string;
  mime_type: string;
  size_bytes: number;
  expected_hash: string | null;
  content_hash: string | null;
  object_key: string;
  status: "pending" | "active" | "failed" | "deleted";
  failure_reason: string | null;
  created_by_principal_id: string;
  request_key: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface StoredKnowledgeBase {
  id: string;
  tenantId: string;
  tenantAuthorityEpoch: number;
  name: string;
  description: string;
  status: "active" | "archived";
  createdByPrincipalId: string;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoredKnowledgeDocument {
  id: string;
  knowledgeBaseId: string;
  tenantId: string;
  tenantAuthorityEpoch: number;
  name: string;
  mimeType: string;
  sizeBytes: number;
  expectedHash: string | null;
  contentHash: string | null;
  objectKey: string;
  status: "pending" | "active" | "failed" | "deleted";
  failureReason: string | null;
  createdByPrincipalId: string;
  requestKey: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

interface TicketRow {
  document_id: string;
  operation: "upload" | "download";
  principal_id: string;
  expires_at: string;
}

const knowledgeColumns = `knowledge.id, knowledge.tenant_id, knowledge.tenant_authority_epoch,
  knowledge.name, knowledge.description, knowledge.status, knowledge.created_by_principal_id,
  knowledge.created_at, knowledge.updated_at,
  COALESCE((SELECT COUNT(*) FROM platform_knowledge_documents document
    WHERE document.knowledge_base_id = knowledge.id AND document.status <> 'deleted'), 0) AS document_count`;
const documentColumns = `id, knowledge_base_id, tenant_id, tenant_authority_epoch, name,
  mime_type, size_bytes, expected_hash, content_hash, object_key, status, failure_reason,
  created_by_principal_id, request_key, expires_at, created_at, updated_at`;

function toKnowledge(row: KnowledgeRow): StoredKnowledgeBase {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantAuthorityEpoch: Number(row.tenant_authority_epoch),
    name: row.name,
    description: row.description,
    status: row.status,
    createdByPrincipalId: row.created_by_principal_id,
    documentCount: Number(row.document_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDocument(row: DocumentRow): StoredKnowledgeDocument {
  return {
    id: row.id,
    knowledgeBaseId: row.knowledge_base_id,
    tenantId: row.tenant_id,
    tenantAuthorityEpoch: Number(row.tenant_authority_epoch),
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    expectedHash: row.expected_hash,
    contentHash: row.content_hash,
    objectKey: row.object_key,
    status: row.status,
    failureReason: row.failure_reason,
    createdByPrincipalId: row.created_by_principal_id,
    requestKey: row.request_key,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class KnowledgeRegistry {
  constructor(readonly database: PlatformDatabase) {}

  private async write<T>(work: (transaction: DatabaseSession) => Promise<T>): Promise<T> {
    return this.database.transaction(async (transaction) => {
      const suffix = this.database.dialect === "postgres" ? " FOR UPDATE" : "";
      await transaction.query(`SELECT id FROM platform_schema_lock WHERE id = 1${suffix}`);
      return work(transaction);
    });
  }

  private async activeTenantEpoch(tenantId: string, tx: DatabaseSession): Promise<number | null> {
    const [row] = await tx.query<{ authority_epoch: number }>(
      `SELECT fence.authority_epoch FROM platform_tenants tenant
        JOIN platform_authority_fences fence
          ON fence.subject_kind = 'tenant' AND fence.subject_id = tenant.id AND fence.tenant_id = ''
       WHERE tenant.id = ? AND tenant.status = 'active'`,
      [tenantId],
    );
    return row ? Number(row.authority_epoch) : null;
  }

  async createKnowledgeBase(record: StoredKnowledgeBase): Promise<"created" | "invalid_tenant" | "exists"> {
    return this.write(async (tx) => {
      const [existing] = await tx.query<{ id: string }>("SELECT id FROM platform_knowledge_bases WHERE id = ?", [record.id]);
      if (existing) return "exists";
      const epoch = await this.activeTenantEpoch(record.tenantId, tx);
      if (epoch === null) return "invalid_tenant";
      await tx.query(
        `INSERT INTO platform_knowledge_bases
          (id, tenant_id, tenant_authority_epoch, name, description, status,
           created_by_principal_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [record.id, record.tenantId, epoch, record.name, record.description, record.status,
          record.createdByPrincipalId, record.createdAt, record.updatedAt],
      );
      return "created";
    });
  }

  async listKnowledgeBases(tenantId: string): Promise<StoredKnowledgeBase[]> {
    return (await this.database.query<KnowledgeRow>(
      `SELECT ${knowledgeColumns} FROM platform_knowledge_bases knowledge
        WHERE knowledge.tenant_id = ? AND EXISTS (
          SELECT 1 FROM platform_authority_fences fence
           WHERE fence.subject_kind = 'tenant' AND fence.subject_id = ? AND fence.tenant_id = ''
             AND fence.authority_epoch = knowledge.tenant_authority_epoch
        ) ORDER BY knowledge.name, knowledge.id`,
      [tenantId, tenantId],
    )).map(toKnowledge);
  }

  async getKnowledgeBase(id: string, session: DatabaseSession = this.database): Promise<StoredKnowledgeBase | null> {
    const [row] = await session.query<KnowledgeRow>(
      `SELECT ${knowledgeColumns} FROM platform_knowledge_bases knowledge WHERE knowledge.id = ?`,
      [id],
    );
    return row ? toKnowledge(row) : null;
  }

  async updateKnowledgeBase(id: string, name: string, description: string, now: string): Promise<boolean> {
    return this.write(async (tx) => {
      const current = await this.getKnowledgeBase(id, tx);
      if (!current || current.status !== "active") return false;
      await tx.query("UPDATE platform_knowledge_bases SET name = ?, description = ?, updated_at = ? WHERE id = ?", [name, description, now, id]);
      return true;
    });
  }

  async archiveKnowledgeBase(id: string, now: string): Promise<"archived" | "missing" | "not_empty" | "referenced"> {
    return this.write(async (tx) => {
      const current = await this.getKnowledgeBase(id, tx);
      if (!current) return "missing";
      const [file] = await tx.query<{ id: string }>(
        "SELECT id FROM platform_knowledge_documents WHERE knowledge_base_id = ? AND status <> 'deleted' LIMIT 1",
        [id],
      );
      if (file) return "not_empty";
      const [reference] = await tx.query<{ source_id: string }>(
        "SELECT source_id FROM platform_knowledge_base_refs WHERE knowledge_base_id = ? LIMIT 1", [id],
      );
      if (reference) return "referenced";
      await tx.query("UPDATE platform_knowledge_bases SET status = 'archived', updated_at = ? WHERE id = ?", [now, id]);
      return "archived";
    });
  }

  async documentByRequest(
    knowledgeBaseId: string,
    principalId: string,
    requestKey: string,
    session: DatabaseSession = this.database,
  ): Promise<StoredKnowledgeDocument | null> {
    const [row] = await session.query<DocumentRow>(
      `SELECT ${documentColumns} FROM platform_knowledge_documents
        WHERE knowledge_base_id = ? AND created_by_principal_id = ? AND request_key = ?`,
      [knowledgeBaseId, principalId, requestKey],
    );
    return row ? toDocument(row) : null;
  }

  async createOrRetryDocument(
    record: StoredKnowledgeDocument,
  ): Promise<{ status: "created" | "retried" | "existing" | "conflict" | "missing_parent"; item?: StoredKnowledgeDocument }> {
    return this.write(async (tx) => {
      const parent = await this.getKnowledgeBase(record.knowledgeBaseId, tx);
      if (!parent || parent.status !== "active" || parent.tenantId !== record.tenantId) return { status: "missing_parent" };
      const existing = await this.documentByRequest(record.knowledgeBaseId, record.createdByPrincipalId, record.requestKey, tx);
      if (existing) {
        if (existing.name !== record.name || existing.mimeType !== record.mimeType ||
          existing.sizeBytes !== record.sizeBytes || existing.expectedHash !== record.expectedHash ||
          existing.status === "deleted") return { status: "conflict" };
        if (existing.status === "failed") {
          await tx.query(
            `UPDATE platform_knowledge_documents
                SET status = 'pending', failure_reason = NULL, content_hash = NULL,
                    expires_at = ?, updated_at = ? WHERE id = ?`,
            [record.expiresAt, record.updatedAt, existing.id],
          );
          return { status: "retried", item: { ...existing, status: "pending", failureReason: null, contentHash: null, expiresAt: record.expiresAt, updatedAt: record.updatedAt } };
        }
        return { status: "existing", item: existing };
      }
      await tx.query(
        `INSERT INTO platform_knowledge_documents
          (id, knowledge_base_id, tenant_id, tenant_authority_epoch, name, mime_type,
           size_bytes, expected_hash, content_hash, object_key, status, failure_reason,
           created_by_principal_id, request_key, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, ?, ?, ?)`,
        [record.id, record.knowledgeBaseId, record.tenantId, parent.tenantAuthorityEpoch,
          record.name, record.mimeType, record.sizeBytes, record.expectedHash, record.contentHash,
          record.objectKey, record.createdByPrincipalId, record.requestKey, record.expiresAt,
          record.createdAt, record.updatedAt],
      );
      return { status: "created", item: { ...record, tenantAuthorityEpoch: parent.tenantAuthorityEpoch } };
    });
  }

  async getDocument(id: string, session: DatabaseSession = this.database): Promise<StoredKnowledgeDocument | null> {
    const [row] = await session.query<DocumentRow>(
      `SELECT ${documentColumns} FROM platform_knowledge_documents WHERE id = ?`, [id],
    );
    return row ? toDocument(row) : null;
  }

  async listDocuments(knowledgeBaseId: string): Promise<StoredKnowledgeDocument[]> {
    return (await this.database.query<DocumentRow>(
      `SELECT ${documentColumns} FROM platform_knowledge_documents
        WHERE knowledge_base_id = ? AND status <> 'deleted' ORDER BY created_at, id`,
      [knowledgeBaseId],
    )).map(toDocument);
  }

  async createTicket(input: {
    digest: string;
    documentId: string;
    operation: "upload" | "download";
    principalId: string;
    expiresAt: string;
    createdAt: string;
  }): Promise<void> {
    await this.write(async (tx) => {
      await tx.query(
        `INSERT INTO platform_document_object_tickets
          (digest, document_id, operation, principal_id, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [input.digest, input.documentId, input.operation, input.principalId, input.expiresAt, input.createdAt],
      );
    });
  }

  async ticket(digest: string): Promise<TicketRow | null> {
    const [row] = await this.database.query<TicketRow>(
      "SELECT document_id, operation, principal_id, expires_at FROM platform_document_object_tickets WHERE digest = ?",
      [digest],
    );
    return row ?? null;
  }

  async purgeExpiredTickets(now: string): Promise<void> {
    await this.write(async (tx) => {
      await tx.query("DELETE FROM platform_document_object_tickets WHERE expires_at <= ?", [now]);
    });
  }

  async setUploaded(id: string, contentHash: string, now: string): Promise<"updated" | "missing" | "conflict"> {
    return this.write(async (tx) => {
      const current = await this.getDocument(id, tx);
      if (!current || current.status === "deleted") return "missing";
      if (current.contentHash && current.contentHash !== contentHash) return "conflict";
      await tx.query(
        "UPDATE platform_knowledge_documents SET content_hash = ?, failure_reason = NULL, updated_at = ? WHERE id = ?",
        [contentHash, now, id],
      );
      return "updated";
    });
  }

  async failDocument(id: string, reason: string, now: string): Promise<void> {
    await this.write(async (tx) => {
      const current = await this.getDocument(id, tx);
      if (!current || current.status !== "pending") return;
      await tx.query(
        `UPDATE platform_knowledge_documents SET status = 'failed', failure_reason = ?, updated_at = ?
          WHERE id = ? AND status = 'pending'`,
        [reason, now, id],
      );
      await tx.query("DELETE FROM platform_document_object_tickets WHERE document_id = ? AND operation = 'upload'", [id]);
    });
  }

  async activateDocument(id: string, now: string): Promise<"active" | "missing" | "failed"> {
    return this.write(async (tx) => {
      const current = await this.getDocument(id, tx);
      if (!current || current.status === "deleted") return "missing";
      if (current.status === "active") return "active";
      if (current.status !== "pending") return "failed";
      await tx.query(
        "UPDATE platform_knowledge_documents SET status = 'active', failure_reason = NULL, updated_at = ? WHERE id = ?",
        [now, id],
      );
      await tx.query("DELETE FROM platform_document_object_tickets WHERE document_id = ? AND operation = 'upload'", [id]);
      return "active";
    });
  }

  async deleteDocument(id: string, now: string): Promise<"deleted" | "missing" | "referenced"> {
    return this.write(async (tx) => {
      const current = await this.getDocument(id, tx);
      if (!current || current.status === "deleted") return "missing";
      const [reference] = await tx.query<{ source_id: string }>(
        "SELECT source_id FROM platform_knowledge_document_refs WHERE document_id = ? LIMIT 1", [id],
      );
      if (reference) return "referenced";
      await tx.query(
        "UPDATE platform_knowledge_documents SET status = 'deleted', updated_at = ? WHERE id = ?",
        [now, id],
      );
      await tx.query("DELETE FROM platform_document_object_tickets WHERE document_id = ?", [id]);
      return "deleted";
    });
  }

  async deletedObjects(): Promise<Array<{ id: string; objectKey: string }>> {
    return (await this.database.query<{ id: string; object_key: string }>(
      "SELECT id, object_key FROM platform_knowledge_documents WHERE status = 'deleted' ORDER BY id",
    )).map((row) => ({ id: row.id, objectKey: row.object_key }));
  }
}
