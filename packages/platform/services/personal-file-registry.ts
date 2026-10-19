import type { DatabaseSession, PlatformDatabase } from "../ports/database";

interface FileRow {
  id: string;
  tenant_id: string;
  tenant_authority_epoch: number;
  owner_principal_id: string;
  owner_user_id: number;
  name: string;
  mime_type: string;
  size_bytes: number;
  expected_hash: string | null;
  content_hash: string | null;
  object_key: string;
  status: "pending" | "active" | "failed" | "deleted";
  failure_reason: string | null;
  request_key: string;
  expires_at: string;
  object_deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoredPersonalFile {
  id: string;
  tenantId: string;
  tenantAuthorityEpoch: number;
  ownerPrincipalId: string;
  ownerUserId: number;
  name: string;
  mimeType: string;
  sizeBytes: number;
  expectedHash: string | null;
  contentHash: string | null;
  objectKey: string;
  status: "pending" | "active" | "failed" | "deleted";
  failureReason: string | null;
  requestKey: string;
  expiresAt: string;
  objectDeletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TicketRow {
  file_id: string;
  operation: "upload" | "download" | "preview";
  owner_principal_id: string;
  expires_at: string;
}

const columns = `id, tenant_id, tenant_authority_epoch, owner_principal_id, owner_user_id,
  name, mime_type, size_bytes, expected_hash, content_hash, object_key, status,
  failure_reason, request_key, expires_at, object_deleted_at, created_at, updated_at`;

function toFile(row: FileRow): StoredPersonalFile {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantAuthorityEpoch: Number(row.tenant_authority_epoch),
    ownerPrincipalId: row.owner_principal_id,
    ownerUserId: Number(row.owner_user_id),
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    expectedHash: row.expected_hash,
    contentHash: row.content_hash,
    objectKey: row.object_key,
    status: row.status,
    failureReason: row.failure_reason,
    requestKey: row.request_key,
    expiresAt: row.expires_at,
    objectDeletedAt: row.object_deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PersonalFileRegistry {
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
       WHERE tenant.id = ? AND tenant.status = 'active'`, [tenantId],
    );
    return row ? Number(row.authority_epoch) : null;
  }

  async get(id: string, session: DatabaseSession = this.database): Promise<StoredPersonalFile | null> {
    const [row] = await session.query<FileRow>(
      `SELECT ${columns} FROM platform_personal_files WHERE id = ?`, [id],
    );
    return row ? toFile(row) : null;
  }

  async list(tenantId: string, ownerPrincipalId: string): Promise<StoredPersonalFile[]> {
    return (await this.database.query<FileRow>(
      `SELECT ${columns} FROM platform_personal_files file
        WHERE file.tenant_id = ? AND file.owner_principal_id = ? AND file.status <> 'deleted'
          AND EXISTS (
            SELECT 1 FROM platform_authority_fences fence
             WHERE fence.subject_kind = 'tenant' AND fence.subject_id = ? AND fence.tenant_id = ''
               AND fence.authority_epoch = file.tenant_authority_epoch
          ) ORDER BY file.created_at, file.id`,
      [tenantId, ownerPrincipalId, tenantId],
    )).map(toFile);
  }

  async byRequest(
    tenantId: string,
    ownerPrincipalId: string,
    requestKey: string,
    session: DatabaseSession = this.database,
  ): Promise<StoredPersonalFile | null> {
    const [row] = await session.query<FileRow>(
      `SELECT ${columns} FROM platform_personal_files
        WHERE tenant_id = ? AND owner_principal_id = ? AND request_key = ?`,
      [tenantId, ownerPrincipalId, requestKey],
    );
    return row ? toFile(row) : null;
  }

  async createOrRetry(
    record: StoredPersonalFile,
  ): Promise<{ status: "created" | "retried" | "existing" | "conflict" | "stale" | "invalid_tenant"; item?: StoredPersonalFile }> {
    return this.write(async (tx) => {
      const epoch = await this.activeTenantEpoch(record.tenantId, tx);
      if (epoch === null) return { status: "invalid_tenant" };
      const existing = await this.byRequest(record.tenantId, record.ownerPrincipalId, record.requestKey, tx);
      if (existing) {
        if (existing.tenantAuthorityEpoch !== epoch) return { status: "stale" };
        if (existing.name !== record.name || existing.mimeType !== record.mimeType ||
          existing.sizeBytes !== record.sizeBytes || existing.expectedHash !== record.expectedHash ||
          existing.status === "deleted") return { status: "conflict" };
        if (existing.status === "failed") {
          await tx.query(
            `UPDATE platform_personal_files SET status = 'pending', failure_reason = NULL,
               content_hash = NULL, expires_at = ?, updated_at = ? WHERE id = ?`,
            [record.expiresAt, record.updatedAt, existing.id],
          );
          return { status: "retried", item: { ...existing, status: "pending", failureReason: null, contentHash: null, expiresAt: record.expiresAt, updatedAt: record.updatedAt } };
        }
        return { status: "existing", item: existing };
      }
      await tx.query(
        `INSERT INTO platform_personal_files
          (id, tenant_id, tenant_authority_epoch, owner_principal_id, owner_user_id,
           name, mime_type, size_bytes, expected_hash, content_hash, object_key, status,
           failure_reason, request_key, expires_at, object_deleted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'pending', NULL, ?, ?, NULL, ?, ?)`,
        [record.id, record.tenantId, epoch, record.ownerPrincipalId, record.ownerUserId,
          record.name, record.mimeType, record.sizeBytes, record.expectedHash, record.objectKey,
          record.requestKey, record.expiresAt, record.createdAt, record.updatedAt],
      );
      return { status: "created", item: { ...record, tenantAuthorityEpoch: epoch } };
    });
  }

  async createTicket(input: {
    digest: string;
    fileId: string;
    operation: "upload" | "download" | "preview";
    ownerPrincipalId: string;
    expiresAt: string;
    createdAt: string;
  }): Promise<void> {
    await this.write(async (tx) => {
      await tx.query(
        `INSERT INTO platform_personal_file_tickets
          (digest, file_id, operation, owner_principal_id, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [input.digest, input.fileId, input.operation, input.ownerPrincipalId, input.expiresAt, input.createdAt],
      );
    });
  }

  async ticket(digest: string): Promise<TicketRow | null> {
    const [row] = await this.database.query<TicketRow>(
      "SELECT file_id, operation, owner_principal_id, expires_at FROM platform_personal_file_tickets WHERE digest = ?",
      [digest],
    );
    return row ?? null;
  }

  async purgeExpiredTickets(now: string): Promise<void> {
    await this.write(async (tx) => {
      await tx.query("DELETE FROM platform_personal_file_tickets WHERE expires_at <= ?", [now]);
    });
  }

  async setUploaded(id: string, hash: string, now: string): Promise<"updated" | "missing" | "conflict"> {
    return this.write(async (tx) => {
      const current = await this.get(id, tx);
      if (!current || current.status === "deleted") return "missing";
      if (current.contentHash && current.contentHash !== hash) return "conflict";
      await tx.query(
        "UPDATE platform_personal_files SET content_hash = ?, failure_reason = NULL, updated_at = ? WHERE id = ?",
        [hash, now, id],
      );
      return "updated";
    });
  }

  async fail(id: string, reason: string, now: string): Promise<void> {
    await this.write(async (tx) => {
      const current = await this.get(id, tx);
      if (!current || current.status !== "pending") return;
      await tx.query(
        "UPDATE platform_personal_files SET status = 'failed', failure_reason = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
        [reason, now, id],
      );
      await tx.query("DELETE FROM platform_personal_file_tickets WHERE file_id = ? AND operation = 'upload'", [id]);
    });
  }

  async activate(id: string, now: string): Promise<"active" | "missing" | "failed"> {
    return this.write(async (tx) => {
      const current = await this.get(id, tx);
      if (!current || current.status === "deleted") return "missing";
      if (current.status === "active") return "active";
      if (current.status !== "pending") return "failed";
      await tx.query(
        "UPDATE platform_personal_files SET status = 'active', failure_reason = NULL, updated_at = ? WHERE id = ?",
        [now, id],
      );
      await tx.query("DELETE FROM platform_personal_file_tickets WHERE file_id = ? AND operation = 'upload'", [id]);
      return "active";
    });
  }

  async remove(id: string, now: string): Promise<"deleted" | "missing" | "referenced"> {
    return this.write(async (tx) => {
      const current = await this.get(id, tx);
      if (!current || current.status === "deleted") return "missing";
      const [reference] = await tx.query<{ source_id: string }>(
        "SELECT source_id FROM platform_personal_file_refs WHERE file_id = ? LIMIT 1", [id],
      );
      if (reference) return "referenced";
      await tx.query(
        "UPDATE platform_personal_files SET status = 'deleted', updated_at = ? WHERE id = ?", [now, id],
      );
      await tx.query("DELETE FROM platform_personal_file_tickets WHERE file_id = ?", [id]);
      return "deleted";
    });
  }

  async deletedObjects(): Promise<Array<{ id: string; objectKey: string }>> {
    return (await this.database.query<{ id: string; object_key: string }>(
      "SELECT id, object_key FROM platform_personal_files WHERE status = 'deleted' AND object_deleted_at IS NULL ORDER BY id",
    )).map((row) => ({ id: row.id, objectKey: row.object_key }));
  }

  async markObjectDeleted(id: string, now: string): Promise<void> {
    await this.write(async (tx) => {
      await tx.query(
        "UPDATE platform_personal_files SET object_deleted_at = ? WHERE id = ? AND status = 'deleted'",
        [now, id],
      );
    });
  }
}
