export const authoredResourceKinds = ["skill", "instruction"] as const;
export type AuthoredResourceKind = (typeof authoredResourceKinds)[number];

export const authoredResourceStatuses = ["active", "archived"] as const;
export type AuthoredResourceStatus = (typeof authoredResourceStatuses)[number];

export const authoredRevisionStatuses = ["draft", "published", "archived"] as const;
export type AuthoredRevisionStatus = (typeof authoredRevisionStatuses)[number];

export const packageLimits = {
  files: 500,
  fileBytes: 10 * 1024 * 1024,
  totalBytes: 50 * 1024 * 1024,
} as const;

export interface PackageFile {
  path: string;
  /** Canonical base64-encoded bytes. */
  data: string;
}

export interface AuthoredResourceContent {
  text: string;
  files: PackageFile[];
  tags: string[];
}

export type AuthoredResourceOwner =
  | { kind: "tenant"; tenantId: string }
  | { kind: "platform" };

export interface AuthoredResource {
  id: string;
  kind: AuthoredResourceKind;
  name: string;
  description: string;
  owner: AuthoredResourceOwner;
  ownerPrincipalId: string;
  status: AuthoredResourceStatus;
  availability: null | {
    mode: "all-active-tenants" | "tenant-allowlist";
    tenantIds: string[];
  };
  latestRevisionNumber: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuthoredResourceRevision {
  id: string;
  resourceId: string;
  number: number;
  status: AuthoredRevisionStatus;
  content: AuthoredResourceContent;
  contentHash: string;
  createdByPrincipalId: string;
  createdAt: string;
}

export interface AuthoredResourceDetail {
  resource: AuthoredResource;
  revisions: AuthoredResourceRevision[];
}

export interface AuthoredResourceRevisionReference {
  resourceId: string;
  kind: AuthoredResourceKind;
  revisionId: string;
  revisionNumber: number;
  status: "draft" | "published";
  contentHash: string;
}

export interface AuthoredResourceRevisionSnapshot extends AuthoredResourceRevisionReference {
  name: string;
  description: string;
  content: AuthoredResourceContent;
}

export interface CreateAuthoredResourceInput {
  name: string;
  description: string;
  content: AuthoredResourceContent;
}

export function safePackagePath(path: string): boolean {
  return typeof path === "string" && path.length > 0 && path.length <= 512 &&
    !/[\\\x00-\x1f\x7f:]/.test(path) &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}
