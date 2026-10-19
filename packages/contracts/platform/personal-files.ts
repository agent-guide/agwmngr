export const maxPersonalFileBytes = 25 * 1024 * 1024;

export interface PersonalFile {
  id: string;
  tenantId: string;
  ownerPrincipalId: string;
  ownerUserId: number;
  name: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string | null;
  status: "pending" | "active" | "failed" | "deleted";
  failureReason: string | null;
  previewAvailable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalFileUploadRequest {
  requestKey: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  contentHash?: string;
}

export interface PersonalFileUploadSession {
  file: PersonalFile;
  uploadUrl: string;
  method: "PUT";
  headers: { "Content-Type": string };
  expiresAt: string;
}
