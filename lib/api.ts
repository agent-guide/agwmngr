import { API_BASE_URL, clearSession, getToken } from "./auth";
import { extractApiError, extractRuntimeErrorType } from "./utils";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    // Stable code from the Agent runtime error contract ({error_type, message}),
    // when the failing endpoint answers with one. Callers branch on this rather
    // than on the status, since one status covers several causes.
    public readonly errorType?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Fetch wrapper for authenticated admin API calls.
 * Automatically injects the Bearer session token.
 * On 401, clears the session and redirects to /login.
 * Paths starting with /admin/ are proxied via /api/admin/.
 */
export async function adminFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = path.startsWith("/admin/")
    ? `${API_BASE_URL}/api${path}`
    : `${API_BASE_URL}${path}`;

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401 && token) {
    clearSession();
    if (typeof window !== "undefined") {
      window.location.replace("/login");
    }
    throw new ApiError(401, "Session expired");
  }

  if (!res.ok) {
    // Two error contracts reach here: the manager's own {error} bodies and the
    // gateway's normalized runtime contract ({error_type, message}, no wrapper).
    // Reading only `error` left every runtime failure reporting the bare HTTP
    // status name ("Bad Gateway"), which says nothing about what failed.
    let msg = res.statusText;
    let errorType: string | undefined;
    try {
      const body: unknown = await res.json();
      msg = extractApiError(body, res.statusText);
      errorType = extractRuntimeErrorType(body);
    } catch {
      // Non-JSON body; keep the status name.
    }
    throw new ApiError(res.status, msg, errorType);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text.trim()) return undefined as T;
  return JSON.parse(text) as T;
}

/**
 * Unauthenticated POST for the login endpoint.
 */
export async function login(
  username: string,
  password: string,
): Promise<{ token: string; username: string }> {
  const res = await fetch(`${API_BASE_URL}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  let msg = res.statusText;
  if (!res.ok) {
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      // ignore parse errors
    }
    throw new ApiError(res.status, msg);
  }

  return res.json() as Promise<{ token: string; username: string }>;
}

// ---- Provider types ----

export interface ProviderTypeItem {
  provider_type: string;
  enabled: boolean;
}

export interface ProviderItem {
  id: string;
  provider_type: string;
  api_key?: string;
  api_key_set?: boolean;
  base_url?: string;
  default_model?: string;
  options?: Record<string, unknown>;
  source?: string;
  read_only?: boolean;
}

export type ProviderPayload = Pick<
  ProviderItem,
  "id" | "provider_type" | "api_key" | "base_url" | "default_model" | "options"
>;
export type ProviderUpdatePayload = Omit<ProviderPayload, "id">;

// ---- Provider API functions ----

// Provider types are process capabilities configured only at gateway startup
// (Caddyfile `provider_types {}` block or daemon flags). The gateway exposes
// `GET /admin/llm/provider_types` as a read-only inspection endpoint; there are no
// runtime enable/disable endpoints.
export async function listProviderTypes(): Promise<ProviderTypeItem[]> {
  const res = await adminFetch<{ items: ProviderTypeItem[] }>("/admin/llm/provider_types");
  return res.items ?? [];
}

export async function listProviders(providerType?: string): Promise<ProviderItem[]> {
  const query = providerType ? `?provider_type=${encodeURIComponent(providerType)}` : "";
  const res = await adminFetch<{ items: ProviderItem[] }>(`/admin/llm/providers${query}`);
  return res.items ?? [];
}

export async function createProvider(payload: ProviderPayload): Promise<ProviderItem> {
  return adminFetch<ProviderItem>("/admin/llm/providers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateProvider(
  id: string,
  payload: ProviderUpdatePayload,
): Promise<ProviderItem> {
  return adminFetch<ProviderItem>(`/admin/llm/providers/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ id, ...payload }),
  });
}

export async function deleteProvider(id: string): Promise<void> {
  await adminFetch(`/admin/llm/providers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ---- Credential types ----

export interface CredentialItem {
  id: string;
  provider_type: string;
  provider_id?: string;
  source: string;
  label?: string;
  attributes?: Record<string, string>;
  api_key_set?: boolean;
  disabled?: boolean;
  unavailable?: boolean;
  read_only: boolean;
  created_at: string;
  updated_at: string;
}

export interface CredentialCreatePayload {
  // Credential type is required by the gateway: "api_key" or "oauth_token".
  type: "api_key" | "oauth_token";
  provider_id: string;
  label?: string;
  attributes?: Record<string, string>;
}

export interface CredentialUpdatePayload {
  label?: string;
  attributes?: Record<string, string>;
  disabled?: boolean;
}

// ---- Credential API functions ----

export async function listCredentials(params?: { provider_type?: string; source?: string }): Promise<CredentialItem[]> {
  const query = new URLSearchParams();
  if (params?.provider_type) query.set("provider_type", params.provider_type);
  if (params?.source) query.set("source", params.source);
  const qs = query.toString() ? `?${query.toString()}` : "";
  const res = await adminFetch<{ items: CredentialItem[] }>(`/admin/credentials${qs}`);
  return res.items ?? [];
}

export async function createCredential(payload: CredentialCreatePayload): Promise<CredentialItem> {
  return adminFetch<CredentialItem>("/admin/credentials", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateCredential(id: string, payload: CredentialUpdatePayload): Promise<CredentialItem> {
  return adminFetch<CredentialItem>(`/admin/credentials/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteCredential(id: string): Promise<void> {
  await adminFetch(`/admin/credentials/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ---- Model types ----

export interface ModelCapabilities {
  streaming?: boolean;
  tools?: boolean;
}

export interface DiscoveredModel {
  provider_id: string;
  provider_type: string;
  upstream_model: string;
  display_name?: string;
  description?: string;
  capabilities?: ModelCapabilities;
  status: string;
  fetched_at: string;
  last_error?: string;
}

export interface ManagedConcreteModel {
  provider_id: string;
  upstream_model: string;
  credential_scope?: string;
  enabled: boolean;
  capability_overrides?: ModelCapabilities | null;
  provider_type?: string;
  display_name?: string;
  description?: string;
  capabilities?: ModelCapabilities;
  snapshot_status?: string;
  fetched_at?: string;
  last_error?: string;
}

export interface ManagedModelPayload {
  provider_id: string;
  upstream_model: string;
  credential_scope?: string;
  enabled?: boolean;
  capability_overrides?: ModelCapabilities | null;
}

export interface RefreshModelsResponse {
  provider_id: string;
  items: DiscoveredModel[];
}

// ---- Model API functions ----

export async function listDiscoveredModels(providerID: string): Promise<DiscoveredModel[]> {
  const res = await adminFetch<{ items: DiscoveredModel[] }>(
    `/admin/llm/models/providers/${encodeURIComponent(providerID)}/discovered`,
  );
  return res.items ?? [];
}

export async function refreshProviderModels(providerID: string): Promise<RefreshModelsResponse> {
  return adminFetch<RefreshModelsResponse>(
    `/admin/llm/models/providers/${encodeURIComponent(providerID)}/refresh`,
    { method: "POST" },
  );
}

export async function listManagedModels(providerID?: string): Promise<ManagedConcreteModel[]> {
  const query = providerID ? `?provider_id=${encodeURIComponent(providerID)}` : "";
  const res = await adminFetch<{ items: ManagedConcreteModel[] }>(`/admin/llm/models/managed${query}`);
  return res.items ?? [];
}

export async function getManagedModel(providerID: string, upstreamModel: string): Promise<ManagedConcreteModel> {
  return adminFetch<ManagedConcreteModel>(
    `/admin/llm/models/managed/${encodeURIComponent(providerID)}/${encodeURIComponent(upstreamModel)}`,
  );
}

export async function createManagedModel(payload: ManagedModelPayload): Promise<ManagedConcreteModel> {
  return adminFetch<ManagedConcreteModel>("/admin/llm/models/managed", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateManagedModel(
  providerID: string,
  upstreamModel: string,
  payload: ManagedModelPayload,
): Promise<ManagedConcreteModel> {
  return adminFetch<ManagedConcreteModel>(
    `/admin/llm/models/managed/${encodeURIComponent(providerID)}/${encodeURIComponent(upstreamModel)}`,
    { method: "PUT", body: JSON.stringify(payload) },
  );
}

export async function deleteManagedModel(providerID: string, upstreamModel: string): Promise<void> {
  await adminFetch(
    `/admin/llm/models/managed/${encodeURIComponent(providerID)}/${encodeURIComponent(upstreamModel)}`,
    { method: "DELETE" },
  );
}

// ---- LLM Route types ----
// Mirrors the gateway LLMRouteView / AgentRouteConfig schema served at /admin/llm/routes.

export type RouteProtocol = "openai" | "anthropic" | "cc" | string;
export type RouteTargetPolicyKind = "direct-provider" | "logical-model";
export type RouteSelectionStrategy = "auto" | "weighted" | "priority";

export interface RouteModelCandidate {
  provider_id: string;
  upstream_model: string;
  weight?: number;
  priority?: number;
  default?: boolean;
}

export interface RouteModelTarget {
  name: string;
  strategy?: RouteSelectionStrategy;
  default_candidate?: string;
  candidates?: RouteModelCandidate[];
}

export interface RouteTargetPolicy {
  type?: RouteTargetPolicyKind;
  provider_id?: string;
  provider_target?: { provider_id: string };
  default_model?: string;
  model_selector_strategy?: RouteSelectionStrategy;
  fallback?: { enabled?: boolean; max_num?: number };
  model_targets?: RouteModelTarget[];
}

export interface RouteMatchPolicy {
  host?: string;
  path_prefix?: string;
  methods?: string[];
}

export interface LLMRoute {
  id: string;
  kind?: string;
  protocol?: RouteProtocol;
  description?: string;
  disabled: boolean;
  match_policy: RouteMatchPolicy;
  target_policy: RouteTargetPolicy;
  auth_policy: { require_virtual_key: boolean };
  created_at: string;
  updated_at: string;
  source?: string;
  read_only?: boolean;
}

export type LLMRoutePayload = Omit<LLMRoute, "created_at" | "updated_at" | "source" | "read_only">;

export interface LLMApiHandlerEntry {
  llm_api_handler_type: string;
}

// ---- LLM Route API functions ----

export async function listLLMRoutes(): Promise<LLMRoute[]> {
  const res = await adminFetch<{ items: LLMRoute[] }>("/admin/llm/routes");
  return res.items ?? [];
}

export async function listLLMApiHandlerTypes(): Promise<LLMApiHandlerEntry[]> {
  const res = await adminFetch<{ items: LLMApiHandlerEntry[] }>("/admin/llm/api_handler_types");
  return res.items ?? [];
}

export async function createLLMRoute(payload: LLMRoutePayload): Promise<LLMRoute> {
  return adminFetch<LLMRoute>("/admin/llm/routes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateLLMRoute(id: string, payload: LLMRoutePayload): Promise<LLMRoute> {
  return adminFetch<LLMRoute>(`/admin/llm/routes/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteLLMRoute(id: string): Promise<void> {
  await adminFetch(`/admin/llm/routes/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function enableLLMRoute(id: string): Promise<void> {
  await adminFetch(`/admin/llm/routes/${encodeURIComponent(id)}/enable`, { method: "POST" });
}

export async function disableLLMRoute(id: string): Promise<void> {
  await adminFetch(`/admin/llm/routes/${encodeURIComponent(id)}/disable`, { method: "POST" });
}

// ============================================================================
// MCP (Model Context Protocol) — Resource Access surface
// Mirrors the gateway /admin/mcp/* admin API.
// ============================================================================

// ---- MCP Service types ----

export type MCPTransport = "stdio" | "sse" | "streamable_http";
export type MCPAuthType = "api_key" | "oauth2" | "basic" | "bearer" | "";

export interface MCPAuthConfig {
  type?: MCPAuthType;
  api_key?: string;
  username?: string;
  password?: string;
}

export interface MCPService {
  id: string;
  name: string;
  transport: MCPTransport;
  command?: string;
  args?: string[];
  url?: string;
  post_url?: string;
  env?: Record<string, string>;
  auto_auth?: boolean;
  auth?: MCPAuthConfig;
  disabled?: boolean;
  description?: string;
  created_at?: string;
  updated_at?: string;
  source?: string;
  read_only?: boolean;
}

export type MCPServicePayload = Omit<MCPService, "created_at" | "updated_at" | "source" | "read_only">;

// ---- MCP discovery / inspection types ----

export interface MCPTool {
  name: string;
  description?: string;
  input_schema?: unknown;
}

export interface MCPToolResult {
  content?: unknown;
  structured_content?: unknown;
  is_error?: boolean;
  _meta?: Record<string, unknown>;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mime_type?: string;
}

export interface MCPResourceTemplate {
  name: string;
  title?: string;
  uriTemplate: string;
  description?: string;
  mimeType?: string;
}

export interface MCPResourceContent {
  uri: string;
  mime_type?: string;
  text?: string;
  blob?: string;
}

export interface MCPPrompt {
  name: string;
  description?: string;
}

export interface MCPSession {
  id: string;
  service_id: string;
  upstream_session_id?: string;
  transport: string;
  state: string; // "connecting" | "ready" | "error" | "closed"
  created_at: string;
  last_used_at: string;
}

// ---- MCP runtime types ----

export interface MCPInFlightRequest {
  route_id: string;
  request_id?: unknown;
  request_key?: string;
  method: string;
  progress_token?: unknown;
  started_at: string;
  cancelled_at?: string;
  cancel_reason?: string;
}

export interface MCPProgressNotification {
  route_id: string;
  progress_token?: unknown;
  request_key?: string;
  progress: number;
  total?: number;
  message?: string;
  last_method?: string;
  updated_at: string;
}

export interface MCPCompletedRequest {
  route_id: string;
  request_key?: string;
  method: string;
  started_at: string;
  completed_at: string;
  cancelled?: boolean;
  cancel_reason?: string;
  error?: string;
}

export interface MCPRuntimeView {
  in_flight: MCPInFlightRequest[];
  progress: MCPProgressNotification[];
}

// ---- MCP Route types ----

export interface MCPRoute {
  id: string;
  kind?: string;
  protocol?: string;
  description?: string;
  disabled: boolean;
  match_policy: RouteMatchPolicy;
  auth_policy: { require_virtual_key: boolean };
  service_id: string;
  created_at: string;
  updated_at: string;
  source?: string;
  read_only?: boolean;
}

export type MCPRoutePayload = Pick<
  MCPRoute,
  "id" | "description" | "disabled" | "match_policy" | "auth_policy" | "service_id"
>;

// ---- MCP Service API functions ----

export async function listMCPServices(): Promise<MCPService[]> {
  const res = await adminFetch<{ items: MCPService[] }>("/admin/mcp/services");
  return res.items ?? [];
}

export async function getMCPService(id: string): Promise<MCPService> {
  return adminFetch<MCPService>(`/admin/mcp/services/${encodeURIComponent(id)}`);
}

export async function createMCPService(payload: MCPServicePayload): Promise<MCPService> {
  return adminFetch<MCPService>("/admin/mcp/services", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateMCPService(id: string, payload: MCPServicePayload): Promise<MCPService> {
  return adminFetch<MCPService>(`/admin/mcp/services/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteMCPService(id: string): Promise<void> {
  await adminFetch(`/admin/mcp/services/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function getMCPServiceCapabilities(id: string): Promise<unknown> {
  return adminFetch(`/admin/mcp/services/${encodeURIComponent(id)}/capabilities`);
}

export async function getMCPServiceSession(id: string): Promise<MCPSession | null> {
  const res = await adminFetch<{ session: MCPSession | null }>(
    `/admin/mcp/services/${encodeURIComponent(id)}/sessions`,
  );
  return res.session ?? null;
}

export async function listMCPTools(id: string): Promise<MCPTool[]> {
  const res = await adminFetch<{ items: MCPTool[] }>(
    `/admin/mcp/services/${encodeURIComponent(id)}/tools`,
  );
  return res.items ?? [];
}

export async function callMCPTool(
  id: string,
  payload: { name: string; arguments?: Record<string, unknown> },
): Promise<MCPToolResult> {
  return adminFetch<MCPToolResult>(`/admin/mcp/services/${encodeURIComponent(id)}/tools/call`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listMCPResources(id: string): Promise<MCPResource[]> {
  const res = await adminFetch<{ items: MCPResource[] }>(
    `/admin/mcp/services/${encodeURIComponent(id)}/resources`,
  );
  return res.items ?? [];
}

export async function listMCPResourceTemplates(id: string): Promise<MCPResourceTemplate[]> {
  const res = await adminFetch<{ items: MCPResourceTemplate[] }>(
    `/admin/mcp/services/${encodeURIComponent(id)}/resource-templates`,
  );
  return res.items ?? [];
}

export async function readMCPResource(id: string, uri: string): Promise<{ contents: MCPResourceContent[] }> {
  return adminFetch(`/admin/mcp/services/${encodeURIComponent(id)}/resources/read`, {
    method: "POST",
    body: JSON.stringify({ uri }),
  });
}

export async function listMCPPrompts(id: string): Promise<MCPPrompt[]> {
  const res = await adminFetch<{ items: MCPPrompt[] }>(
    `/admin/mcp/services/${encodeURIComponent(id)}/prompts`,
  );
  return res.items ?? [];
}

// ---- MCP Runtime API functions ----

export async function getMCPRuntime(): Promise<MCPRuntimeView> {
  return adminFetch<MCPRuntimeView>("/admin/mcp/runtime");
}

export async function listMCPHistory(routeId?: string): Promise<MCPCompletedRequest[]> {
  const query = routeId ? `?route_id=${encodeURIComponent(routeId)}` : "";
  const res = await adminFetch<{ items: MCPCompletedRequest[] }>(`/admin/mcp/runtime/history${query}`);
  return res.items ?? [];
}

// ---- MCP Route API functions ----

export async function listMCPRoutes(): Promise<MCPRoute[]> {
  const res = await adminFetch<{ items: MCPRoute[] }>("/admin/mcp/routes");
  return res.items ?? [];
}

export async function createMCPRoute(payload: MCPRoutePayload): Promise<MCPRoute> {
  return adminFetch<MCPRoute>("/admin/mcp/routes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateMCPRoute(id: string, payload: MCPRoutePayload): Promise<MCPRoute> {
  return adminFetch<MCPRoute>(`/admin/mcp/routes/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteMCPRoute(id: string): Promise<void> {
  await adminFetch(`/admin/mcp/routes/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ============================================================================
// Agent runtime — execution config, ingress routes, and runtime diagnostics
// Mirrors the gateway /admin/agents/* and /admin/{acp,builtin}/runtime APIs.
//
// v0.5.0 removed the ACP "service" object entirely: execution config is inlined
// on Agent.runtime.acp, ingress is one unified AgentRoute keyed by agent_id, and
// session/transcript/permission/run operations are agent-scoped. Only genuinely
// lower-level pool and host inspection stays under /admin/{acp,builtin}/runtime.
// See docs/v0.5-alignment-plan.md §2 and unified-agent-runtime.md §6.7.
// ============================================================================

// ---- ACP execution config (inlined at Agent.runtime.acp) ----

export type ACPAgentType = "codex" | "opencode";
export type ACPPermissionMode = "deny" | "auto_approve" | "interactive";

export interface ACPCodexConfig {
  mode?: string; // "adapter" | "app_server" (app_server deferred)
  adapter_command?: string;
  adapter_args?: string[];
  app_server_command?: string | null;
  app_server_args?: string[] | null;
  default_profile?: string;
  initial_auth_mode?: string;
  trace_json?: boolean;
  retry_turn_on_crash?: boolean;
}

// ---- Agent session / transcript types ----
// runtimeapi.Session drops the flat `cwd` field the old ACP service sessions
// carried; backend-specific fields now live in the opaque `details` blob.

export interface AgentSessionInfo {
  session_id: string;
  title?: string;
  updated_at?: string;
  details?: unknown;
}

export interface AgentListSessionsResponse {
  sessions: AgentSessionInfo[];
  next_cursor?: string;
}

export interface AgentTranscriptMessage {
  role: string; // "user" | "assistant" | "reasoning"
  text: string;
}

export interface AgentTranscriptResponse {
  session_id: string;
  messages: AgentTranscriptMessage[];
}

// ---- Agent run lifecycle ----

export type AgentRunState = "running" | "completed" | "cancelled" | "failed";

export interface AgentRunInfo {
  agent_id: string;
  runtime_type: string;
  run_id: string;
  session_id?: string;
  state: AgentRunState;
  started_at: string;
  finished_at?: string;
  stop_reason?: string;
}

export type AgentCancelMode = "force" | "graceful";

export interface AgentCancelResult {
  run_id: string;
  state: AgentRunState;
  stop_reason?: string;
  finished_at?: string;
}

// ---- Agent permissions (runtime-neutral broker records) ----

export interface AgentPermissionAction {
  action_id: string;
  name?: string;
}

export interface AgentPermissionOption {
  option_id: string;
  kind?: string;
  name?: string;
}

export interface AgentPendingPermission {
  request_id: string;
  agent_id: string;
  runtime_type: string;
  run_id: string;
  session_id?: string;
  created_at: string;
  expires_at: string;
  actions?: AgentPermissionAction[];
  options?: AgentPermissionOption[];
  resume_mode: "active_stream" | "new_stream";
}

export interface AgentPermissionDecision {
  request_id: string;
  outcome?: "selected" | "cancelled";
  option_id?: string;
  decisions?: { action_id: string; outcome: string }[];
}

// ---- ACP runtime diagnostics (native pool/process state) ----

export interface ACPSessionMetadata {
  config_options?: unknown;
  available_commands?: unknown;
  session_info?: unknown;
  mode?: unknown;
  usage?: unknown;
}

/** Raw acpruntime.PooledInstanceInfo, as embedded in an agent workspace. */
export interface ACPPooledInstanceInfo {
  scope: string;
  session_id?: string;
  alive: boolean;
  active: boolean;
  last_used?: string;
  idle_ttl?: number;
  metadata?: ACPSessionMetadata;
}

/** Raw acpruntime.PendingPermissionInfo — note `owner_id`, not `agent_id`. */
export interface ACPPendingPermissionInfo {
  request_id: string;
  owner_id: string;
  session_id?: string;
  created_at: string;
  data?: unknown;
}

// The /admin/acp/runtime views wrap the raw pool records with the owning
// agent_id (pkg/admin/acp.go). The workspace runtime_view embeds the raw
// records instead, so the two shapes are deliberately modelled apart.

export interface ACPRuntimeInFlightTurn {
  agent_id: string;
  scope: string;
}

export interface ACPRuntimeInstanceView extends ACPPooledInstanceInfo {
  agent_id: string;
}

export interface ACPRuntimePermissionView {
  request_id: string;
  agent_id: string;
  session_id?: string;
  created_at: string;
}

export interface ACPRuntimeOverview {
  in_flight: ACPRuntimeInFlightTurn[];
  instances: ACPRuntimeInstanceView[];
  pending_permissions: ACPRuntimePermissionView[];
}

// ---- Builtin runtime diagnostics ----

export interface BuiltinRuntimeEntryState {
  materialized: boolean;
  materialized_at?: string;
  topology_kind?: string;
  inflight_turns: number;
  live_sessions: number;
}

export interface BuiltinInFlightTurn {
  agent_id: string;
  session_id: string;
  run_id: string;
  request_id?: string;
  operation: "turn" | "resume" | string;
  topology_kind?: string;
  started_at: string;
}

export interface BuiltinPendingPermissionCall {
  call_id: string;
  mcp_service_id: string;
  name: string;
  arguments?: string;
}

export interface BuiltinPendingPermission {
  request_id: string;
  agent_id: string;
  session_id: string;
  run_id: string;
  created_at: string;
  expires_at: string;
  calls: BuiltinPendingPermissionCall[];
}

export interface BuiltinRuntimeOverview {
  agents: Record<string, BuiltinRuntimeEntryState>;
  pending_permissions: BuiltinPendingPermission[];
  in_flight: BuiltinInFlightTurn[];
}

// ---- Agent ingress route types ----

export interface AgentRoute {
  id: string;
  kind?: string; // always "agent"
  protocol?: string; // always "agent"
  description?: string;
  disabled: boolean;
  match_policy: RouteMatchPolicy;
  auth_policy: { require_virtual_key: boolean };
  agent_id: string;
  created_at: string;
  updated_at: string;
  source?: string;
  read_only?: boolean;
}

export type AgentRoutePayload = Pick<
  AgentRoute,
  "id" | "description" | "disabled" | "match_policy" | "auth_policy" | "agent_id"
>;

// ---- Agent ingress route API functions ----
//
// The literal segment "routes" is a reserved agent id: the gateway dispatches
// /admin/agents/routes* to a separate mux ahead of /admin/agents/{id}, so an
// agent named "routes" would be shadowed (docs/v0.5-alignment-plan.md §8.4).

export const RESERVED_AGENT_ID = "routes";

export async function listAgentRoutes(): Promise<AgentRoute[]> {
  const res = await adminFetch<{ items: AgentRoute[] }>("/admin/agents/routes");
  return res.items ?? [];
}

export async function getAgentRoute(id: string): Promise<AgentRoute> {
  return adminFetch<AgentRoute>(`/admin/agents/routes/${encodeURIComponent(id)}`);
}

export async function createAgentRoute(payload: AgentRoutePayload): Promise<AgentRoute> {
  return adminFetch<AgentRoute>("/admin/agents/routes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateAgentRoute(id: string, payload: AgentRoutePayload): Promise<AgentRoute> {
  return adminFetch<AgentRoute>(`/admin/agents/routes/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteAgentRoute(id: string): Promise<void> {
  await adminFetch(`/admin/agents/routes/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ---- Agent runtime operation API functions ----

export async function getAgentCapabilities(id: string): Promise<AgentCapabilities> {
  return adminFetch<AgentCapabilities>(`/admin/agents/${encodeURIComponent(id)}/capabilities`);
}

export async function listAgentSessions(
  id: string,
  params?: { cwd?: string; cursor?: string },
): Promise<AgentListSessionsResponse> {
  const query = new URLSearchParams();
  if (params?.cwd) query.set("cwd", params.cwd);
  if (params?.cursor) query.set("cursor", params.cursor);
  const qs = query.toString() ? `?${query.toString()}` : "";
  return adminFetch<AgentListSessionsResponse>(
    `/admin/agents/${encodeURIComponent(id)}/sessions${qs}`,
  );
}

export async function getAgentTranscript(
  id: string,
  sessionId: string,
  cwd?: string,
): Promise<AgentTranscriptResponse> {
  const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
  return adminFetch<AgentTranscriptResponse>(
    `/admin/agents/${encodeURIComponent(id)}/sessions/${encodeURIComponent(sessionId)}/transcript${qs}`,
  );
}

export async function listAgentRuns(id: string): Promise<AgentRunInfo[]> {
  const res = await adminFetch<{ items: AgentRunInfo[]; durable: boolean }>(
    `/admin/agents/${encodeURIComponent(id)}/runs`,
  );
  return res.items ?? [];
}

/** Cancel one exact run. An unadvertised mode returns 501 capability_not_supported. */
export async function cancelAgentRun(
  id: string,
  runId: string,
  mode: AgentCancelMode = "force",
): Promise<AgentCancelResult> {
  return adminFetch<AgentCancelResult>(
    `/admin/agents/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}?mode=${mode}`,
    { method: "DELETE" },
  );
}

export async function listAgentPermissions(id: string): Promise<AgentPendingPermission[]> {
  const res = await adminFetch<{ items: AgentPendingPermission[] }>(
    `/admin/agents/${encodeURIComponent(id)}/permissions`,
  );
  return res.items ?? [];
}

export async function resolveAgentPermission(
  id: string,
  requestId: string,
  decision: AgentPermissionDecision,
): Promise<{ status: string }> {
  return adminFetch(
    `/admin/agents/${encodeURIComponent(id)}/permissions/${encodeURIComponent(requestId)}`,
    { method: "POST", body: JSON.stringify(decision) },
  );
}

// ---- Runtime diagnostics API functions ----

export async function getACPRuntime(): Promise<ACPRuntimeOverview> {
  return adminFetch<ACPRuntimeOverview>("/admin/acp/runtime");
}

/** Destructive ACP pool recovery — deliberately separate from run cancellation. */
export async function closeACPThread(
  agentId: string,
  threadId: string,
): Promise<{ closed: number }> {
  return adminFetch(
    `/admin/acp/runtime/agents/${encodeURIComponent(agentId)}/threads/${encodeURIComponent(threadId)}`,
    { method: "DELETE" },
  );
}

export async function getBuiltinRuntime(): Promise<BuiltinRuntimeOverview> {
  return adminFetch<BuiltinRuntimeOverview>("/admin/builtin/runtime");
}

export async function getBuiltinInFlight(): Promise<BuiltinInFlightTurn[]> {
  const res = await adminFetch<{ items: BuiltinInFlightTurn[] }>("/admin/builtin/runtime/inflight");
  return res.items ?? [];
}

// ---- ACP Chat (data-plane) API functions ----
// Driving a conversation is a data-plane operation, not an admin one. These go
// through the manager backend proxy (app/api/admin/acp/chat/*), which forwards
// to the runtime's public ACP route. The streamed turn lives in
// lib/acp-chat-stream.ts; only permission resolution is a plain JSON call.

export async function resolveACPChatPermission(payload: {
  route_id: string;
  virtual_key_id?: string;
  request_id: string;
  outcome: "selected" | "cancelled";
  option_id?: string;
}): Promise<{ status: string }> {
  return adminFetch("/admin/acp/chat/permission", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ---- Virtual Key types / API functions ----

export interface VirtualKeyRateLimit {
  requests_per_minute: number;
  burst: number;
}

/**
 * Per-protocol request limits. The gateway decodes these strictly (unknown
 * fields are rejected), so only send the protocols actually being limited.
 */
export interface VirtualKeyRateLimits {
  llm?: VirtualKeyRateLimit;
  mcp?: VirtualKeyRateLimit;
  agent?: VirtualKeyRateLimit;
}

/**
 * A Virtual Key as the manager exposes it. The upstream `key` field is stripped
 * by the manager's own handlers (app/api/admin/virtual_keys/), so no list or get
 * ever carries bearer material — `key_set` says whether one exists and
 * `key_preview` is a masked label for telling two keys apart.
 */
export interface VirtualKeyItem {
  id: string;
  key_set: boolean;
  key_preview?: string;
  tag?: string;
  description?: string;
  disabled: boolean;
  allowed_route_ids?: string[];
  rate_limits?: VirtualKeyRateLimits;
  status_message?: string;
  expires_at?: string;
  source?: string;
  read_only?: boolean;
}

/**
 * The create response, and only the create response, additionally carries the
 * generated bearer — delivered once, never returned again by a read.
 */
export interface CreatedVirtualKey extends VirtualKeyItem {
  key?: string;
}

export type VirtualKeyPayload = Omit<
  VirtualKeyItem,
  "key_set" | "key_preview" | "source" | "read_only"
>;

export async function listVirtualKeys(): Promise<VirtualKeyItem[]> {
  const res = await adminFetch<{ items: VirtualKeyItem[] }>("/admin/virtual_keys");
  return res.items ?? [];
}

export async function createVirtualKey(payload: VirtualKeyPayload): Promise<CreatedVirtualKey> {
  return adminFetch<CreatedVirtualKey>("/admin/virtual_keys", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Recover an existing key's bearer. Platform Admin only (`gateway:secrets_raw`)
 * and audited on every call — a Gateway Admin gets 403.
 */
export async function revealVirtualKey(id: string): Promise<{ id: string; key: string }> {
  return adminFetch<{ id: string; key: string }>(
    `/admin/virtual_keys/${encodeURIComponent(id)}/reveal`,
    { method: "POST" },
  );
}

export async function updateVirtualKey(id: string, payload: VirtualKeyPayload): Promise<VirtualKeyItem> {
  return adminFetch<VirtualKeyItem>(`/admin/virtual_keys/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

// ============================================================================
// Metrics / Observability (/admin/metrics/*) — fully implemented backend.
// ============================================================================

export interface MetricsQuery {
  from?: string;
  to?: string;
  bucket?: string;
  group_by?: string;
  order_by?: string;
  limit?: number;
  success?: boolean;
  // Common filters (only the relevant subset applies per endpoint).
  route_id?: string;
  route_kind?: string;
  route_protocol?: string;
  virtual_key_id?: string;
  provider_id?: string;
  logical_model?: string;
  upstream_model?: string;
  llm_api?: string;
  api_operation?: string;
  service_id?: string;
  tool_name?: string;
  method?: string;
  agent_type?: string;
  operation?: string;
  trace_id?: string;
  parent_span_id?: string;
  agent_depth?: number;
  agent_id?: string;
}

function metricsQuery(q?: MetricsQuery): string {
  if (!q) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === "") continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** Per-group aggregate measures. Numeric fields are optional per protocol;
 *  grouped dimensions are represented separately by `GroupedRow`. */
export interface UsageStat {
  request_count?: number;
  success_count?: number;
  failure_count?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  tools_call_count?: number;
  turn_count?: number;
  avg_latency_ms?: number;
}
/**
 * A breakdown/timeseries row carries the grouped dimension as `group_value`,
 * **not** under a column named after `group_by`: the gateway's SQL projects
 * `SELECT <col> AS group_value` (`pkg/configstore/sqlite/usage_query.go`), and
 * only the response envelope echoes which dimension that was. Read the value
 * through `group_value` — indexing a row by the group_by key yields undefined.
 */
export type GroupedRow = { group_value?: string | null };
export type BreakdownItem = UsageStat & GroupedRow & Record<string, unknown>;
export type TimeseriesPoint = UsageStat & GroupedRow & { timestamp: string } & Record<string, unknown>;

export interface BreakdownResponse {
  group_by: string;
  items: BreakdownItem[];
  limit?: number;
}
export interface TimeseriesResponse {
  bucket: string;
  group_by: string;
  items: TimeseriesPoint[];
}

/** Common interaction fields shared by every event row + the unified feed. */
export interface InteractionEvent {
  event_id: string;
  trace_id: string;
  span_id: string;
  parent_span_id?: string | null;
  agent_depth: number;
  started_at: string;
  finished_at?: string;
  route_id: string;
  /** "llm" | "mcp" | "agent"; admin audit spans still report "acp". */
  route_kind: string;
  route_protocol?: string;
  virtual_key_id?: string;
  success: boolean;
  status_code?: number;
  error_type?: string | null;
  latency_ms: number;
  agent_id?: string | null;
  /** Which backend executed the turn: "acp" | "builtin" | "http". */
  runtime_type?: string | null;
  run_id?: string | null;
  // Protocol-specific extras (present depending on route_kind).
  provider_id?: string;
  provider_type?: string;
  upstream_model?: string;
  logical_model?: string | null;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  // LLM tool-use (carried through the interactions UNION). The *_names fields
  // are JSON-encoded string arrays as stored (e.g. '["exec_command"]').
  request_tool_count?: number | null;
  request_tool_names?: string | null;
  tool_call_count?: number | null;
  tool_names?: string | null;
  service_id?: string;
  method?: string;
  tool_name?: string;
  agent_type?: string;
  operation?: string;
  thread_id?: string;
  session_id?: string;
}

export interface MetricsSummaryProtocol {
  request_count?: number;
  success_count?: number;
  failure_count?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  tools_call_count?: number;
  turn_count?: number;
  avg_latency_ms?: number;
}
export interface MetricsSummary {
  llm?: MetricsSummaryProtocol;
  mcp?: MetricsSummaryProtocol;
  acp?: MetricsSummaryProtocol;
  pipeline?: { dropped_events?: number; write_failures?: number };
}

export async function getMetricsSummary(): Promise<MetricsSummary> {
  return adminFetch<MetricsSummary>("/admin/metrics");
}

export async function getLLMTimeseries(q?: MetricsQuery): Promise<TimeseriesResponse> {
  return adminFetch<TimeseriesResponse>(`/admin/metrics/llm/timeseries${metricsQuery(q)}`);
}
export async function getLLMBreakdown(q?: MetricsQuery): Promise<BreakdownResponse> {
  return adminFetch<BreakdownResponse>(`/admin/metrics/llm/breakdown${metricsQuery(q)}`);
}
export async function getLLMEvents(q?: MetricsQuery): Promise<{ items: InteractionEvent[]; limit?: number }> {
  return adminFetch(`/admin/metrics/llm/events${metricsQuery(q)}`);
}
export async function getMCPEvents(q?: MetricsQuery): Promise<{ items: InteractionEvent[]; limit?: number }> {
  return adminFetch(`/admin/metrics/mcp/events${metricsQuery(q)}`);
}
export async function getMCPToolsSummary(q?: MetricsQuery): Promise<BreakdownResponse> {
  return adminFetch<BreakdownResponse>(`/admin/metrics/mcp/tools/summary${metricsQuery(q)}`);
}
export async function getMCPBreakdown(q?: MetricsQuery): Promise<BreakdownResponse> {
  return adminFetch<BreakdownResponse>(`/admin/metrics/mcp/breakdown${metricsQuery(q)}`);
}
export async function getMCPTimeseries(q?: MetricsQuery): Promise<TimeseriesResponse> {
  return adminFetch<TimeseriesResponse>(`/admin/metrics/mcp/timeseries${metricsQuery(q)}`);
}
export async function getACPEvents(q?: MetricsQuery): Promise<{ items: InteractionEvent[]; limit?: number }> {
  return adminFetch(`/admin/metrics/acp/events${metricsQuery(q)}`);
}
export async function getACPBreakdown(q?: MetricsQuery): Promise<BreakdownResponse> {
  return adminFetch<BreakdownResponse>(`/admin/metrics/acp/breakdown${metricsQuery(q)}`);
}
export async function getACPTimeseries(q?: MetricsQuery): Promise<TimeseriesResponse> {
  return adminFetch<TimeseriesResponse>(`/admin/metrics/acp/timeseries${metricsQuery(q)}`);
}
export async function getInteractions(q?: MetricsQuery): Promise<{ items: InteractionEvent[]; limit?: number }> {
  return adminFetch(`/admin/metrics/interactions${metricsQuery(q)}`);
}
export async function getInteractionsSummary(q?: MetricsQuery): Promise<BreakdownResponse> {
  return adminFetch<BreakdownResponse>(`/admin/metrics/interactions/summary${metricsQuery(q)}`);
}

// ============================================================================
// Agents Control Plane (/admin/agents/*)
//
// The Agent is the unit of execution: runtime.<type> is authoritative and binds
// the agent to exactly one backend. Exactly one of acp/http/builtin is present,
// selected by runtime.type — the gateway nils out the others on normalize.
// ============================================================================

export type AgentRuntimeType = "acp" | "http" | "builtin";

/** Inlined ACP execution config. v0.5.0 replaced the old `service_id` ref. */
export interface AgentRuntimeACP {
  agent_type: ACPAgentType;
  cwd: string;
  allowed_roots?: string[];
  default_model?: string;
  env?: Record<string, string>;
  config_overrides?: Record<string, string>;
  idle_ttl?: number; // nanoseconds (Go time.Duration)
  max_instances?: number;
  permission_mode?: ACPPermissionMode;
  codex?: ACPCodexConfig;
}

/** The agent service owns its own lifecycle; not executable before M8. */
export interface AgentRuntimeHTTP {
  endpoint: string;
  auth_ref?: string;
}

// ---- Builtin (in-process eino ADK) runtime ----

export type BuiltinTopologyKind =
  | "single"
  | "sequential"
  | "parallel"
  | "loop"
  | "supervisor"
  | "planexecute"
  | "deep"
  | "custom";

export interface BuiltinModel {
  llm_route_id: string;
  model?: string;
  retry?: { max_retries: number }; // 1..5
}
export interface BuiltinGeneration {
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
}
export interface BuiltinToolSelection {
  mcp_service_id: string;
  tools?: string[]; // empty means every tool the service exposes
}
export interface BuiltinSubAgent {
  name?: string;
  description?: string;
  model?: BuiltinModel;
  system_prompt?: string;
  tools?: BuiltinToolSelection[];
  topology?: BuiltinTopology;
  [key: string]: unknown;
}
export interface BuiltinTopology {
  kind: BuiltinTopologyKind;
  factory?: string; // required only when kind is "custom"
  max_iterations?: number;
  sub_agents?: BuiltinSubAgent[];
  plan_execute?: Record<string, unknown>;
}
export interface BuiltinPermissions {
  mode?: "auto_approve" | "interactive";
  timeout_seconds?: number;
  max_pending?: number;
  /** Fully-qualified "<mcp_service_id>/<tool_name>" entries. */
  auto_approve_tools?: string[];
}
export interface AgentRuntimeBuiltin {
  model: BuiltinModel;
  system_prompt?: string;
  generation?: BuiltinGeneration;
  tools?: BuiltinToolSelection[];
  topology: BuiltinTopology;
  middlewares?: Record<string, unknown>;
  permissions?: BuiltinPermissions;
  limits?: Record<string, unknown>;
}

export interface AgentRuntime {
  type: AgentRuntimeType;
  acp?: AgentRuntimeACP;
  http?: AgentRuntimeHTTP;
  builtin?: AgentRuntimeBuiltin;
}

/**
 * Management/display route references used for attribution. Ingress is NOT
 * here: an AgentRoute points at the agent, never the reverse, so `acp_route_ids`
 * is gone (unified-agent-runtime.md §6.2, ownership is one-way).
 */
export interface AgentRouteRefs {
  llm_route_ids?: string[];
  mcp_route_ids?: string[];
}
export interface AgentResources {
  provider_ids?: string[];
  mcp_service_ids?: string[];
  virtual_key_ids?: string[];
}
export interface AgentBudget {
  max_turns_per_day?: number;
  max_tokens_per_day?: number;
}
export interface AgentPolicy {
  max_agent_depth?: number;
  budget?: AgentBudget;
}
export interface Agent {
  id: string;
  name: string;
  description?: string;
  runtime: AgentRuntime;
  routes: AgentRouteRefs;
  resources: AgentResources;
  policy: AgentPolicy;
  disabled: boolean;
  created_at: string;
  updated_at: string;
  source?: string;
  runtime_status?: AgentRuntimeSummary;
  capabilities?: AgentCapabilities;
}
export type AgentPayload = Pick<
  Agent,
  "id" | "name" | "description" | "runtime" | "routes" | "resources" | "policy" | "disabled"
>;

export interface AgentWorkspaceRoute {
  id: string;
  path_prefix?: string;
  agent_id: string;
}
export interface BuiltinDefinitionSummary {
  llm_route_id: string;
  model?: string;
  topology_kind: string;
  tool_service_ids?: string[];
  max_concurrent_turns?: number;
  turn_timeout_seconds?: number;
  summarization_enabled: boolean;
}
export interface BuiltinWorkspaceView {
  definition: BuiltinDefinitionSummary;
  host_state: BuiltinRuntimeEntryState;
}
export interface AgentWorkspaceUsage {
  request_count?: number;
  turn_count?: number;
  success_count?: number;
  failure_count?: number;
  avg_latency_ms?: number;
}
export interface AgentWorkspaceRuntimeView {
  pooled_instances?: ACPPooledInstanceInfo[];
  in_flight_turns?: number;
  pending_permissions?: ACPPendingPermissionInfo[];
}
export interface AgentRuntimeSummary {
  type: string;
  executable: boolean;
  healthy: boolean;
  state: "unknown" | "disabled" | "not_executable" | "starting" | "ready" | "degraded" | "unhealthy";
  active_runs: number;
  pending_permissions: number;
  session_count: number;
  last_activity_at?: string;
}
export interface AgentCapabilities {
  executable: boolean;
  turn?: { streaming?: boolean };
  sessions?: { resume?: boolean; list?: boolean; transcript?: boolean; durable?: boolean };
  permissions?: { interactive?: boolean; resume_mode?: string };
  cancellation?: { force?: boolean; graceful?: boolean };
  events?: string[];
}
export interface AgentWorkspace {
  agent: Agent;
  runtime_type: string;
  runtime?: AgentRuntimeSummary;
  runtime_details?: unknown;
  capabilities?: AgentCapabilities;
  agent_routes?: AgentWorkspaceRoute[];
  builtin?: BuiltinWorkspaceView;
  runtime_view?: AgentWorkspaceRuntimeView;
  usage?: AgentWorkspaceUsage;
  links?: Record<string, string>;
}

export interface AgentResourceRef {
  id: string;
  kind?: string;
  disabled?: boolean;
  detail?: string | null;
  exists: boolean;
}
export interface AgentResourcesResolved {
  providers?: AgentResourceRef[];
  mcp_services?: AgentResourceRef[];
  virtual_keys?: AgentResourceRef[];
  llm_routes?: AgentResourceRef[];
  mcp_routes?: AgentResourceRef[];
}
export interface AgentResourcesView {
  resources: AgentResources;
  routes: AgentRouteRefs;
  resolved: AgentResourcesResolved;
}

export interface AgentActivity {
  interactions: InteractionEvent[];
  /** From the runtime-neutral permission broker, not the raw ACP pool. */
  pending_permissions: AgentPendingPermission[];
}

export interface AgentUsage {
  agent_id: string;
  llm?: { group_by: string; items: BreakdownItem[] | null; limit?: number };
  mcp?: UsageStat;
  acp?: { group_by: string; items: BreakdownItem[] | null; limit?: number };
  // Per-protocol time series scoped to this agent (currently only `llm`, grouped
  // by route_id by the gateway). Present alongside the breakdown rollups above.
  timeseries?: { llm?: TimeseriesResponse };
}

export interface AgentHealth {
  agent_id: string;
  disabled: boolean;
  runtime: string;
  pooled_instances: number;
  in_flight_turns: number;
  pending_permissions: number;
  recent_window: number;
  recent_failures: number;
  pipeline?: { dropped_events?: number; write_failures?: number };
}

/**
 * Agent delete now fails closed rather than orphaning ingress: the gateway
 * answers 409 with `agent is targeted by an agent route` while any AgentRoute
 * still points at the agent, so its routes must be deleted first. On success it
 * drains pending permissions and cancels in-flight runs.
 */
export interface AgentDeleteResult {
  status: string;
  id: string;
}

export async function listAgents(): Promise<Agent[]> {
  const res = await adminFetch<{ items: Agent[] }>("/admin/agents");
  return res.items ?? [];
}
export async function getAgent(id: string): Promise<Agent> {
  return adminFetch<Agent>(`/admin/agents/${encodeURIComponent(id)}`);
}
export async function createAgent(payload: AgentPayload): Promise<Agent> {
  return adminFetch<Agent>("/admin/agents", { method: "POST", body: JSON.stringify(payload) });
}
export async function updateAgent(id: string, payload: AgentPayload): Promise<Agent> {
  return adminFetch<Agent>(`/admin/agents/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}
export async function deleteAgent(id: string): Promise<AgentDeleteResult> {
  return adminFetch<AgentDeleteResult>(`/admin/agents/${encodeURIComponent(id)}`, { method: "DELETE" });
}
export async function getAgentWorkspace(id: string): Promise<AgentWorkspace> {
  return adminFetch<AgentWorkspace>(`/admin/agents/${encodeURIComponent(id)}/workspace`);
}
export async function getAgentActivity(
  id: string,
  q?: MetricsQuery,
): Promise<AgentActivity> {
  return adminFetch<AgentActivity>(`/admin/agents/${encodeURIComponent(id)}/activity${metricsQuery(q)}`);
}
export async function getAgentUsage(id: string, q?: MetricsQuery): Promise<AgentUsage> {
  return adminFetch<AgentUsage>(`/admin/agents/${encodeURIComponent(id)}/usage${metricsQuery(q)}`);
}
export async function getAgentInteractions(
  id: string,
  q?: MetricsQuery,
): Promise<{ items: InteractionEvent[]; limit?: number }> {
  return adminFetch(`/admin/agents/${encodeURIComponent(id)}/interactions${metricsQuery(q)}`);
}
export async function getAgentResources(id: string): Promise<AgentResourcesView> {
  return adminFetch<AgentResourcesView>(`/admin/agents/${encodeURIComponent(id)}/resources`);
}
export async function getAgentHealth(id: string): Promise<AgentHealth> {
  return adminFetch<AgentHealth>(`/admin/agents/${encodeURIComponent(id)}/health`);
}

// ---- Platform: current user ----

export interface CurrentUser {
  username: string;
  is_platform_admin: boolean;
  active_gateway_id: string | null;
  created_at: string;
}

export async function getCurrentUser(): Promise<CurrentUser> {
  return adminFetch<CurrentUser>("/admin/auth/me");
}

// ---- Platform: users (platform-admin only) ----

export interface ManagerUser {
  id: number;
  username: string;
  is_platform_admin: boolean;
  status: "active" | "disabled";
  created_at: string;
  updated_at: string;
}

export async function listManagerUsers(): Promise<ManagerUser[]> {
  const res = await adminFetch<{ items: ManagerUser[] }>("/admin/users");
  return res.items ?? [];
}

export async function createManagerUser(input: {
  username: string;
  password: string;
  is_platform_admin: boolean;
}): Promise<ManagerUser> {
  return adminFetch<ManagerUser>("/admin/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateManagerUser(
  id: number,
  patch: { password?: string; is_platform_admin?: boolean; status?: "active" | "disabled" },
): Promise<ManagerUser> {
  return adminFetch<ManagerUser>(`/admin/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export async function deleteManagerUser(id: number): Promise<void> {
  await adminFetch(`/admin/users/${id}`, { method: "DELETE" });
}

// ---- Session: active gateway + switcher ----

export interface SessionGateway {
  id: string;
  name: string;
  role: "platform_admin" | "admin" | "member";
  status: "active" | "disabled";
  health_status: "ok" | "credential_error" | "encryption_unconfigured";
}

export async function listSessionGateways(): Promise<{ items: SessionGateway[]; active_gateway_id: string | null }> {
  return adminFetch("/admin/session/gateways");
}

export async function setActiveGateway(gatewayId: string | null): Promise<{ active_gateway_id: string | null }> {
  return adminFetch("/admin/session/active-gateway", {
    method: "POST",
    body: JSON.stringify({ gateway_id: gatewayId }),
  });
}

// ---- Platform: gateways registry (platform-admin only) ----

export interface ManagerGateway {
  id: string;
  name: string;
  description: string | null;
  admin_addr: string;
  admin_user: string;
  admin_password_set: boolean;
  caddy_admin_addr: string | null;
  dataplane_addr: string | null;
  readonly_server_ids: string | null;
  status: "active" | "disabled";
  health_status: "ok" | "credential_error" | "encryption_unconfigured";
  created_at: string;
  updated_at: string;
}

export interface GatewayWriteBody {
  id?: string;
  name?: string;
  description?: string | null;
  admin_addr?: string;
  admin_user?: string;
  admin_password?: string;
  caddy_admin_addr?: string | null;
  dataplane_addr?: string | null;
  readonly_server_ids?: string | null;
  status?: "active" | "disabled";
}

export async function listGateways(): Promise<ManagerGateway[]> {
  const res = await adminFetch<{ items: ManagerGateway[] }>("/admin/gateways");
  return res.items ?? [];
}

export async function createGateway(body: GatewayWriteBody): Promise<ManagerGateway> {
  return adminFetch<ManagerGateway>("/admin/gateways", { method: "POST", body: JSON.stringify(body) });
}

export async function updateGateway(id: string, body: GatewayWriteBody): Promise<ManagerGateway> {
  return adminFetch<ManagerGateway>(`/admin/gateways/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteGateway(id: string): Promise<void> {
  await adminFetch(`/admin/gateways/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export interface ConnectivityResult {
  ok: boolean;
  reason?: "unreachable" | "unauthorized" | "gateway_error";
  status?: number;
  message?: string;
}

export async function testGatewayCredentials(body: {
  admin_addr: string;
  admin_user: string;
  admin_password: string;
}): Promise<ConnectivityResult> {
  return adminFetch<ConnectivityResult>("/admin/gateways/test", { method: "POST", body: JSON.stringify(body) });
}

export async function testGatewayStored(id: string): Promise<ConnectivityResult> {
  return adminFetch<ConnectivityResult>(`/admin/gateways/${encodeURIComponent(id)}/test`, { method: "POST" });
}

// ---- Platform: gateway memberships ----

export interface GatewayMember {
  user_id: number;
  username: string;
  role: "admin" | "member";
}

export async function listGatewayMembers(gatewayId: string): Promise<GatewayMember[]> {
  const res = await adminFetch<{ items: GatewayMember[] }>(`/admin/gateways/${encodeURIComponent(gatewayId)}/members`);
  return res.items ?? [];
}

export async function setGatewayMember(
  gatewayId: string,
  userId: number,
  role: "admin" | "member",
): Promise<GatewayMember[]> {
  const res = await adminFetch<{ items: GatewayMember[] }>(
    `/admin/gateways/${encodeURIComponent(gatewayId)}/members`,
    { method: "PUT", body: JSON.stringify({ user_id: userId, role }) },
  );
  return res.items ?? [];
}

export async function removeGatewayMember(gatewayId: string, userId: number): Promise<GatewayMember[]> {
  const res = await adminFetch<{ items: GatewayMember[] }>(
    `/admin/gateways/${encodeURIComponent(gatewayId)}/members/${userId}`,
    { method: "DELETE" },
  );
  return res.items ?? [];
}

// ---- Platform: audit log (platform-admin only) ----

export interface AuditLogEntry {
  id: number;
  ts: string;
  request_id: string | null;
  actor_user_id: number | null;
  username: string | null;
  gateway_id: string | null;
  action: string | null;
  method: string | null;
  path: string | null;
  target_kind: string | null;
  target_id: string | null;
  decision: "allow" | "deny";
  failure_reason: string | null;
  http_status: number | null;
  ip: string | null;
  user_agent: string | null;
  duration_ms: number | null;
}

export async function listAuditLog(params?: {
  gateway_id?: string;
  decision?: "allow" | "deny";
  limit?: number;
}): Promise<AuditLogEntry[]> {
  const q = new URLSearchParams();
  if (params?.gateway_id) q.set("gateway_id", params.gateway_id);
  if (params?.decision) q.set("decision", params.decision);
  if (params?.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  const res = await adminFetch<{ items: AuditLogEntry[] }>(`/admin/audit${qs ? `?${qs}` : ""}`);
  return res.items ?? [];
}
