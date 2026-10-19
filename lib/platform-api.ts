import { adminFetch, ApiError } from "./api";
import { API_BASE_URL, getToken } from "./auth";
import type {
  MembershipAddResolution,
  PlatformAccessProjection,
  PrincipalResolutionInput,
  Principal,
  ServicePrincipalCreation,
  Tenant,
  TenantMember,
  TenantMembership,
  TenantGatewayAccess,
  TenantGatewayGrant,
  TenantRole,
  TenantStatus,
} from "@/packages/contracts/platform/identity";
import type {
  CatalogAvailabilityMode,
  CatalogOfferingCategory,
  CreateCatalogOfferingInput,
  PlatformCatalogOffering,
  TenantCatalogOffering,
} from "@/packages/contracts/platform/catalog";
import type {
  AuthoredResource,
  AuthoredResourceContent,
  AuthoredResourceDetail,
  AuthoredResourceKind,
  AuthoredResourceRevision,
  CreateAuthoredResourceInput,
} from "@/packages/contracts/platform/authored-resources";
import type {
  DocumentUploadRequest,
  DocumentUploadResult,
  KnowledgeBase,
  KnowledgeDocument,
} from "@/packages/contracts/platform/knowledge";
import type {
  PersonalFile,
  PersonalFileUploadRequest,
  PersonalFileUploadSession,
} from "@/packages/contracts/platform/personal-files";
import type {
  CreateTenantModelDefinitionInput,
  TenantModelDefinition,
} from "@/packages/contracts/platform/models";
import type {
  CreateTenantToolDefinitionInput,
  TenantToolDefinition,
} from "@/packages/contracts/platform/tools";

export type {
  MembershipAddResolution,
  PlatformAccessProjection,
  PrincipalResolutionInput,
  Principal,
  ServicePrincipalCreation,
  Tenant,
  TenantMember,
  TenantMembership,
  TenantGatewayAccess,
  TenantGatewayGrant,
  TenantRole,
  TenantStatus,
} from "@/packages/contracts/platform/identity";
export type {
  CatalogAvailabilityMode,
  CatalogOfferingCategory,
  CatalogOfferingKind,
  CatalogOfferingStatus,
  CreateCatalogOfferingInput,
  PlatformCatalogOffering,
  TenantCatalogOffering,
} from "@/packages/contracts/platform/catalog";
export type {
  AuthoredResource,
  AuthoredResourceContent,
  AuthoredResourceDetail,
  AuthoredResourceKind,
  AuthoredResourceRevision,
  CreateAuthoredResourceInput,
} from "@/packages/contracts/platform/authored-resources";
export type {
  DocumentUploadRequest,
  DocumentUploadResult,
  KnowledgeBase,
  KnowledgeDocument,
} from "@/packages/contracts/platform/knowledge";
export type {
  PersonalFile,
  PersonalFileUploadRequest,
  PersonalFileUploadSession,
} from "@/packages/contracts/platform/personal-files";
export type {
  CreateTenantModelDefinitionInput,
  TenantModelDefinition,
  TenantModelDefinitionReference,
} from "@/packages/contracts/platform/models";
export type {
  CreateTenantToolDefinitionInput,
  TenantToolDefinition,
  TenantToolDefinitionReference,
} from "@/packages/contracts/platform/tools";

function tenantPath(tenantId: string, suffix: string): string {
  return `/api/platform/v1/tenants/${encodeURIComponent(tenantId)}${suffix}`;
}

export function getPlatformAccess(): Promise<PlatformAccessProjection> {
  return adminFetch<PlatformAccessProjection>("/api/platform/v1/access");
}

export async function listTenantMembers(tenantId: string): Promise<TenantMember[]> {
  const result = await adminFetch<{ items: TenantMember[] }>(tenantPath(tenantId, "/members"));
  return result.items ?? [];
}

export function resolveTenantMember(
  tenantId: string,
  input: PrincipalResolutionInput,
): Promise<MembershipAddResolution> {
  const body = input.kind === "human"
    ? { kind: input.kind, username: input.username }
    : { kind: input.kind, principal_id: input.principalId };
  return adminFetch<MembershipAddResolution>(tenantPath(tenantId, "/member-resolutions"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function addTenantMember(
  tenantId: string,
  receipt: string,
  role: TenantRole,
): Promise<TenantMembership> {
  return adminFetch<TenantMembership>(tenantPath(tenantId, "/members"), {
    method: "POST",
    body: JSON.stringify({ receipt, role }),
  });
}

export function updateTenantMember(
  tenantId: string,
  principalId: string,
  role: TenantRole,
): Promise<TenantMembership> {
  return adminFetch<TenantMembership>(
    tenantPath(tenantId, `/members/${encodeURIComponent(principalId)}`),
    { method: "PUT", body: JSON.stringify({ role }) },
  );
}

export async function removeTenantMember(
  tenantId: string,
  principalId: string,
): Promise<void> {
  await adminFetch(
    tenantPath(tenantId, `/members/${encodeURIComponent(principalId)}`),
    { method: "DELETE" },
  );
}

export async function listPlatformTenants(): Promise<Tenant[]> {
  const result = await adminFetch<{ items: Tenant[] }>("/api/platform/v1/identity/tenants");
  return result.items ?? [];
}

export function createPlatformTenant(id: string, name: string): Promise<Tenant> {
  return adminFetch<Tenant>("/api/platform/v1/identity/tenants", {
    method: "POST",
    body: JSON.stringify({ id, name }),
  });
}

export function setPlatformTenantStatus(id: string, status: TenantStatus): Promise<Tenant> {
  return adminFetch<Tenant>(`/api/platform/v1/identity/tenants/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
}

export async function deletePlatformTenant(id: string): Promise<void> {
  await adminFetch(`/api/platform/v1/identity/tenants/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function listPlatformPrincipals(): Promise<Principal[]> {
  const result = await adminFetch<{ items: Principal[] }>("/api/platform/v1/identity/principals");
  return result.items ?? [];
}

export async function listPlatformTenantMembers(tenantId: string): Promise<TenantMember[]> {
  const result = await adminFetch<{ items: TenantMember[] }>(
    `/api/platform/v1/identity/tenants/${encodeURIComponent(tenantId)}/members`,
  );
  return result.items ?? [];
}

export function bootstrapPlatformTenantMember(
  tenantId: string,
  principalId: string,
  role: TenantRole,
): Promise<TenantMembership> {
  return adminFetch<TenantMembership>(
    `/api/platform/v1/identity/tenants/${encodeURIComponent(tenantId)}/members/bootstrap`,
    { method: "POST", body: JSON.stringify({ principal_id: principalId, role }) },
  );
}

export function updatePlatformTenantMember(
  tenantId: string,
  principalId: string,
  role: TenantRole,
): Promise<TenantMembership> {
  return adminFetch<TenantMembership>(
    `/api/platform/v1/identity/tenants/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(principalId)}`,
    { method: "PUT", body: JSON.stringify({ role }) },
  );
}

export async function removePlatformTenantMember(
  tenantId: string,
  principalId: string,
): Promise<void> {
  await adminFetch(
    `/api/platform/v1/identity/tenants/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(principalId)}`,
    { method: "DELETE" },
  );
}

export function createServiceAccount(
  name: string,
  expiresAt: string,
): Promise<ServicePrincipalCreation> {
  return adminFetch<ServicePrincipalCreation>("/api/platform/v1/identity/service-principals", {
    method: "POST",
    body: JSON.stringify({ name, expires_at: expiresAt }),
  });
}

export async function revokeServiceAccount(principalId: string): Promise<void> {
  await adminFetch(
    `/api/platform/v1/identity/service-principals/${encodeURIComponent(principalId)}`,
    { method: "DELETE" },
  );
}

export async function listTenantGatewayGrants(filters: {
  principalId?: string;
  tenantId?: string;
  gatewayId?: string;
} = {}): Promise<TenantGatewayGrant[]> {
  const query = new URLSearchParams();
  if (filters.principalId) query.set("principal_id", filters.principalId);
  if (filters.tenantId) query.set("tenant_id", filters.tenantId);
  if (filters.gatewayId) query.set("gateway_id", filters.gatewayId);
  const suffix = query.size ? `?${query.toString()}` : "";
  const result = await adminFetch<{ items: TenantGatewayGrant[] }>(
    `/api/platform/v1/identity/tenant-gateway-grants${suffix}`,
  );
  return result.items ?? [];
}

export function setTenantGatewayGrant(input: {
  principalId: string;
  tenantId: string;
  gatewayId: string;
  access: TenantGatewayAccess;
}): Promise<TenantGatewayGrant> {
  return adminFetch<TenantGatewayGrant>("/api/platform/v1/identity/tenant-gateway-grants", {
    method: "PUT",
    body: JSON.stringify({
      principal_id: input.principalId,
      tenant_id: input.tenantId,
      gateway_id: input.gatewayId,
      access: input.access,
    }),
  });
}

export async function revokeTenantGatewayGrant(input: {
  principalId: string;
  tenantId: string;
  gatewayId: string;
}): Promise<void> {
  await adminFetch("/api/platform/v1/identity/tenant-gateway-grants", {
    method: "DELETE",
    body: JSON.stringify({
      principal_id: input.principalId,
      tenant_id: input.tenantId,
      gateway_id: input.gatewayId,
    }),
  });
}

export async function listPlatformCatalogOfferings(
  category?: CatalogOfferingCategory,
): Promise<PlatformCatalogOffering[]> {
  const query = category ? `?category=${encodeURIComponent(category)}` : "";
  const result = await adminFetch<{ items: PlatformCatalogOffering[] }>(
    `/api/platform/v1/catalog/offerings${query}`,
  );
  return result.items ?? [];
}

export function createPlatformCatalogOffering(
  input: CreateCatalogOfferingInput,
): Promise<PlatformCatalogOffering> {
  return adminFetch<PlatformCatalogOffering>("/api/platform/v1/catalog/offerings", {
    method: "POST",
    body: JSON.stringify({
      offering_id: input.offeringId,
      category: input.category,
      name: input.name,
      description: input.description,
      kind: input.kind,
      ...(input.sourceGatewayId === undefined
        ? {}
        : { source_gateway_id: input.sourceGatewayId }),
      ...(input.upstreamStableId === undefined
        ? {}
        : { upstream_stable_id: input.upstreamStableId }),
      availability: {
        mode: input.availability.mode,
        tenant_ids: input.availability.tenantIds ?? [],
      },
    }),
  });
}

function offeringActionPath(offeringId: string, action: string): string {
  return `/api/platform/v1/catalog/offerings/${encodeURIComponent(offeringId)}/${action}`;
}

export function approvePlatformCatalogOffering(
  offeringId: string,
): Promise<PlatformCatalogOffering> {
  return adminFetch<PlatformCatalogOffering>(offeringActionPath(offeringId, "approve"), {
    method: "POST",
  });
}

export function retirePlatformCatalogOffering(
  offeringId: string,
): Promise<PlatformCatalogOffering> {
  return adminFetch<PlatformCatalogOffering>(offeringActionPath(offeringId, "retire"), {
    method: "POST",
  });
}

export function setPlatformCatalogAvailability(
  offeringId: string,
  mode: CatalogAvailabilityMode,
  tenantIds: string[],
): Promise<PlatformCatalogOffering> {
  return adminFetch<PlatformCatalogOffering>(offeringActionPath(offeringId, "availability"), {
    method: "PUT",
    body: JSON.stringify({ mode, tenant_ids: tenantIds }),
  });
}

export async function listTenantCatalogOfferings(
  tenantId: string,
  category?: CatalogOfferingCategory,
): Promise<TenantCatalogOffering[]> {
  const query = category ? `?category=${encodeURIComponent(category)}` : "";
  const result = await adminFetch<{ items: TenantCatalogOffering[] }>(
    tenantPath(tenantId, `/catalog${query}`),
  );
  return result.items ?? [];
}

function authoredResourcePath(
  scope: { tenantId: string } | { platform: true },
  kind: AuthoredResourceKind,
  suffix = "",
): string {
  const collection = kind === "skill" ? "skills" : "instructions";
  return "tenantId" in scope
    ? tenantPath(scope.tenantId, `/${collection}${suffix}`)
    : `/api/platform/v1/catalog/${collection}${suffix}`;
}

export async function listAuthoredResources(
  scope: { tenantId: string } | { platform: true },
  kind: AuthoredResourceKind,
): Promise<AuthoredResource[]> {
  const result = await adminFetch<{ items: AuthoredResource[] }>(authoredResourcePath(scope, kind));
  return result.items ?? [];
}

export function getAuthoredResource(
  scope: { tenantId: string } | { platform: true },
  kind: AuthoredResourceKind,
  id: string,
): Promise<AuthoredResourceDetail> {
  return adminFetch<AuthoredResourceDetail>(
    authoredResourcePath(scope, kind, `/${encodeURIComponent(id)}`),
  );
}

export function createAuthoredResource(
  scope: { tenantId: string } | { platform: true },
  kind: AuthoredResourceKind,
  input: CreateAuthoredResourceInput,
  sharedAvailability?: { mode: CatalogAvailabilityMode; tenantIds: string[] },
): Promise<AuthoredResourceDetail> {
  return adminFetch<AuthoredResourceDetail>(authoredResourcePath(scope, kind), {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      description: input.description,
      content: input.content,
      ...(sharedAvailability ? {
        availability: {
          mode: sharedAvailability.mode,
          tenant_ids: sharedAvailability.tenantIds,
        },
      } : {}),
    }),
  });
}

export function updateAuthoredResource(
  scope: { tenantId: string } | { platform: true },
  kind: AuthoredResourceKind,
  id: string,
  input: { name: string; description: string },
): Promise<AuthoredResource> {
  return adminFetch<AuthoredResource>(authoredResourcePath(scope, kind, `/${encodeURIComponent(id)}`), {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteAuthoredResource(
  scope: { tenantId: string } | { platform: true },
  kind: AuthoredResourceKind,
  id: string,
): Promise<void> {
  await adminFetch(authoredResourcePath(scope, kind, `/${encodeURIComponent(id)}`), {
    method: "DELETE",
  });
}

export function addAuthoredResourceRevision(
  scope: { tenantId: string } | { platform: true },
  kind: AuthoredResourceKind,
  id: string,
  content: AuthoredResourceContent,
): Promise<AuthoredResourceRevision> {
  return adminFetch<AuthoredResourceRevision>(
    authoredResourcePath(scope, kind, `/${encodeURIComponent(id)}/revisions`),
    { method: "POST", body: JSON.stringify(content) },
  );
}

export function setAuthoredRevisionStatus(
  scope: { tenantId: string } | { platform: true },
  kind: AuthoredResourceKind,
  id: string,
  revisionId: string,
  status: "published" | "archived",
): Promise<AuthoredResourceRevision> {
  return adminFetch<AuthoredResourceRevision>(authoredResourcePath(
    scope,
    kind,
    `/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}`,
  ), { method: "PUT", body: JSON.stringify({ status }) });
}

export function setAuthoredResourceAvailability(
  kind: AuthoredResourceKind,
  id: string,
  mode: CatalogAvailabilityMode,
  tenantIds: string[],
): Promise<AuthoredResource> {
  return adminFetch<AuthoredResource>(authoredResourcePath(
    { platform: true }, kind, `/${encodeURIComponent(id)}/availability`,
  ), { method: "PUT", body: JSON.stringify({ mode, tenant_ids: tenantIds }) });
}

function knowledgePath(tenantId: string, suffix = ""): string {
  return tenantPath(tenantId, `/knowledge-bases${suffix}`);
}

export async function listKnowledgeBases(tenantId: string): Promise<KnowledgeBase[]> {
  const result = await adminFetch<{ items: KnowledgeBase[] }>(knowledgePath(tenantId));
  return result.items ?? [];
}

export function createKnowledgeBase(
  tenantId: string,
  input: { name: string; description: string },
): Promise<KnowledgeBase> {
  return adminFetch<KnowledgeBase>(knowledgePath(tenantId), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateKnowledgeBase(
  tenantId: string,
  id: string,
  input: { name: string; description: string },
): Promise<KnowledgeBase> {
  return adminFetch<KnowledgeBase>(knowledgePath(tenantId, `/${encodeURIComponent(id)}`), {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteKnowledgeBase(tenantId: string, id: string): Promise<void> {
  await adminFetch(knowledgePath(tenantId, `/${encodeURIComponent(id)}`), { method: "DELETE" });
}

export async function listKnowledgeDocuments(
  tenantId: string,
  knowledgeBaseId: string,
): Promise<KnowledgeDocument[]> {
  const result = await adminFetch<{ items: KnowledgeDocument[] }>(
    knowledgePath(tenantId, `/${encodeURIComponent(knowledgeBaseId)}/documents`),
  );
  return result.items ?? [];
}

export async function createDocumentUploadSessions(
  tenantId: string,
  knowledgeBaseId: string,
  files: DocumentUploadRequest[],
): Promise<DocumentUploadResult[]> {
  const response = await adminFetch<{ items: Array<Record<string, unknown>> }>(
    knowledgePath(tenantId, `/${encodeURIComponent(knowledgeBaseId)}/documents/upload-sessions`),
    {
      method: "POST",
      body: JSON.stringify({
        files: files.map((file) => ({
          request_key: file.requestKey,
          name: file.name,
          mime_type: file.mimeType,
          size_bytes: file.sizeBytes,
          ...(file.contentHash ? { content_hash: file.contentHash } : {}),
        })),
      }),
    },
  );
  return response.items.map((item) => item.ok ? {
    requestKey: item.request_key as string,
    ok: true,
    file: item.document as KnowledgeDocument,
    uploadUrl: item.upload_url as string,
    method: "PUT",
    headers: item.headers as { "Content-Type": string },
    expiresAt: item.expires_at as string,
  } : {
    requestKey: item.request_key as string,
    ok: false,
    error: item.error as string,
    code: item.code as "invalid_input" | "conflict" | "forbidden" | "unavailable",
  });
}

async function authenticatedStorageFetch(path: string, options: RequestInit): Promise<Response> {
  const token = getToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.headers as Record<string, string>),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = await response.json() as { error?: string };
      message = body.error ?? message;
    } catch {}
    throw new ApiError(response.status, message);
  }
  return response;
}

export async function uploadKnowledgeDocument(
  result: Extract<DocumentUploadResult, { ok: true }>,
  file: File,
): Promise<KnowledgeDocument> {
  const response = await authenticatedStorageFetch(result.uploadUrl, {
    method: "PUT",
    headers: result.headers,
    body: file,
  });
  return response.json() as Promise<KnowledgeDocument>;
}

export function completeKnowledgeDocument(
  tenantId: string,
  knowledgeBaseId: string,
  documentId: string,
): Promise<KnowledgeDocument> {
  return adminFetch<KnowledgeDocument>(knowledgePath(
    tenantId,
    `/${encodeURIComponent(knowledgeBaseId)}/documents/${encodeURIComponent(documentId)}/complete`,
  ), { method: "POST" });
}

export async function downloadKnowledgeDocument(
  tenantId: string,
  knowledgeBaseId: string,
  documentId: string,
): Promise<Blob> {
  const ticket = await adminFetch<{ download_url: string }>(knowledgePath(
    tenantId,
    `/${encodeURIComponent(knowledgeBaseId)}/documents/${encodeURIComponent(documentId)}/download-url`,
  ));
  return (await authenticatedStorageFetch(ticket.download_url, { method: "GET" })).blob();
}

export async function deleteKnowledgeDocument(
  tenantId: string,
  knowledgeBaseId: string,
  documentId: string,
): Promise<void> {
  await adminFetch(knowledgePath(
    tenantId,
    `/${encodeURIComponent(knowledgeBaseId)}/documents/${encodeURIComponent(documentId)}`,
  ), { method: "DELETE" });
}

function personalFilesPath(tenantId: string, suffix = ""): string {
  return tenantPath(tenantId, `/files${suffix}`);
}

export async function listPersonalFiles(tenantId: string): Promise<PersonalFile[]> {
  const result = await adminFetch<{ items: PersonalFile[] }>(personalFilesPath(tenantId));
  return result.items ?? [];
}

export async function createPersonalFileUploadSession(
  tenantId: string,
  input: PersonalFileUploadRequest,
): Promise<PersonalFileUploadSession> {
  const result = await adminFetch<{
    file: PersonalFile;
    upload_url: string;
    method: "PUT";
    headers: { "Content-Type": string };
    expires_at: string;
  }>(personalFilesPath(tenantId, "/upload-session"), {
    method: "POST",
    body: JSON.stringify({
      request_key: input.requestKey,
      name: input.name,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      ...(input.contentHash ? { content_hash: input.contentHash } : {}),
    }),
  });
  return {
    file: result.file,
    uploadUrl: result.upload_url,
    method: result.method,
    headers: result.headers,
    expiresAt: result.expires_at,
  };
}

export async function uploadPersonalFile(
  session: PersonalFileUploadSession,
  file: File,
): Promise<PersonalFile> {
  const response = await authenticatedStorageFetch(session.uploadUrl, {
    method: "PUT",
    headers: session.headers,
    body: file,
  });
  return response.json() as Promise<PersonalFile>;
}

export function completePersonalFile(
  tenantId: string,
  id: string,
): Promise<PersonalFile> {
  return adminFetch<PersonalFile>(personalFilesPath(tenantId, `/${encodeURIComponent(id)}/complete`), {
    method: "POST",
  });
}

export async function readPersonalFile(
  tenantId: string,
  id: string,
  operation: "preview" | "download",
): Promise<Blob> {
  const ticket = await adminFetch<{ url: string }>(personalFilesPath(
    tenantId,
    `/${encodeURIComponent(id)}/${operation}-url`,
  ));
  return (await authenticatedStorageFetch(ticket.url, { method: "GET" })).blob();
}

export async function deletePersonalFile(tenantId: string, id: string): Promise<void> {
  await adminFetch(personalFilesPath(tenantId, `/${encodeURIComponent(id)}`), { method: "DELETE" });
}

function modelDefinitionsPath(tenantId: string, suffix = ""): string {
  return tenantPath(tenantId, `/models${suffix}`);
}

export async function listTenantModelDefinitions(tenantId: string): Promise<TenantModelDefinition[]> {
  const result = await adminFetch<{ items: TenantModelDefinition[] }>(modelDefinitionsPath(tenantId));
  return result.items ?? [];
}

export function createTenantModelDefinition(
  tenantId: string,
  input: CreateTenantModelDefinitionInput,
): Promise<TenantModelDefinition> {
  return adminFetch<TenantModelDefinition>(modelDefinitionsPath(tenantId), {
    method: "POST",
    body: JSON.stringify({ name: input.name, description: input.description, offering_id: input.offeringId }),
  });
}

export function updateTenantModelDefinition(
  tenantId: string,
  id: string,
  input: CreateTenantModelDefinitionInput,
): Promise<TenantModelDefinition> {
  return adminFetch<TenantModelDefinition>(modelDefinitionsPath(tenantId, `/${encodeURIComponent(id)}`), {
    method: "PUT",
    body: JSON.stringify({ name: input.name, description: input.description, offering_id: input.offeringId }),
  });
}

export async function deleteTenantModelDefinition(tenantId: string, id: string): Promise<void> {
  await adminFetch(modelDefinitionsPath(tenantId, `/${encodeURIComponent(id)}`), { method: "DELETE" });
}

function toolDefinitionsPath(tenantId: string, suffix = ""): string {
  return tenantPath(tenantId, `/tools${suffix}`);
}

export async function listTenantToolDefinitions(tenantId: string): Promise<TenantToolDefinition[]> {
  const result = await adminFetch<{ items: TenantToolDefinition[] }>(toolDefinitionsPath(tenantId));
  return result.items ?? [];
}

export function createTenantToolDefinition(
  tenantId: string,
  input: CreateTenantToolDefinitionInput,
): Promise<TenantToolDefinition> {
  return adminFetch<TenantToolDefinition>(toolDefinitionsPath(tenantId), {
    method: "POST",
    body: JSON.stringify({ name: input.name, description: input.description, offering_id: input.offeringId }),
  });
}

export function updateTenantToolDefinition(
  tenantId: string,
  id: string,
  input: CreateTenantToolDefinitionInput,
): Promise<TenantToolDefinition> {
  return adminFetch<TenantToolDefinition>(toolDefinitionsPath(tenantId, `/${encodeURIComponent(id)}`), {
    method: "PUT",
    body: JSON.stringify({ name: input.name, description: input.description, offering_id: input.offeringId }),
  });
}

export async function deleteTenantToolDefinition(tenantId: string, id: string): Promise<void> {
  await adminFetch(toolDefinitionsPath(tenantId, `/${encodeURIComponent(id)}`), { method: "DELETE" });
}
