export const documentExtensions = [
  "pdf", "docx", "pptx", "xlsx", "md", "txt", "html", "csv", "json",
] as const;

export const maxDocumentBytes = 25 * 1024 * 1024;
export const maxDocumentBatch = 20;

export interface KnowledgeBase {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  status: "active" | "archived";
  documentCount: number;
  indexingStatus: "unavailable";
  retrievalStatus: "unavailable";
  createdByPrincipalId: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeBaseReference {
  knowledgeBaseId: string;
  updatedAt: string;
}

export interface KnowledgeDocument {
  id: string;
  knowledgeBaseId: string;
  tenantId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string | null;
  status: "pending" | "active" | "failed" | "deleted";
  failureReason: string | null;
  parseStatus: "unavailable";
  indexStatus: "unavailable";
  createdAt: string;
  updatedAt: string;
}

export interface DocumentUploadRequest {
  requestKey: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  contentHash?: string;
}

export type DocumentUploadResult =
  | {
      requestKey: string;
      ok: true;
      file: KnowledgeDocument;
      uploadUrl: string;
      method: "PUT";
      headers: { "Content-Type": string };
      expiresAt: string;
    }
  | {
      requestKey: string;
      ok: false;
      error: string;
      code: "invalid_input" | "conflict" | "forbidden" | "unavailable";
    };

export interface DocumentDownloadTicket {
  downloadUrl: string;
  method: "GET";
  expiresAt: string;
}
