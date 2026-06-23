import { API_BASE_URL, clearSession, getToken } from "./auth";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
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
    let msg = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      // ignore parse errors
    }
    throw new ApiError(res.status, msg);
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
  base_url?: string;
  default_model?: string;
  options?: Record<string, unknown>;
  read_only?: boolean;
}

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

export async function createProvider(payload: {
  id: string;
  provider_type: string;
  api_key?: string;
  base_url?: string;
  default_model?: string;
}): Promise<ProviderItem> {
  return adminFetch<ProviderItem>("/admin/llm/providers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateProvider(
  id: string,
  payload: {
    provider_type: string;
    api_key?: string;
    base_url?: string;
    default_model?: string;
  },
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
  disabled?: boolean;
  unavailable?: boolean;
  read_only: boolean;
  created_at: string;
  updated_at: string;
}

export interface CredentialCreatePayload {
  // Credential type is required by the gateway: "api_key" or "cliauth_token".
  type: "api_key" | "cliauth_token";
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

// ---- CLI Auth Authenticator types ----

export type AuthenticatorSource = "caddyfile" | "runtime";

export interface NetworkConfig {
  request_timeout_seconds?: number;
  max_retries?: number;
  retry_delay_seconds?: number;
  max_idle_connections?: number;
  max_idle_connections_per_host?: number;
  idle_keep_alive_timeout_seconds?: number;
  proxy_url?: string;
  extra_headers?: Record<string, string>;
}

export interface AuthenticatorConfig {
  callback_port?: number;
  no_browser?: boolean;
  device_flow?: boolean;
  network?: NetworkConfig;
}

export interface AuthenticatorState {
  name: string;
  provider_type?: string;
  source?: AuthenticatorSource;
  read_only: boolean;
  enabled: boolean;
  config: AuthenticatorConfig;
}

// ---- CLI Auth Authenticator API functions ----

export async function listCLIAuthAuthenticators(): Promise<AuthenticatorState[]> {
  const res = await adminFetch<{ items: AuthenticatorState[] }>("/admin/cliauth/authenticators");
  return res.items ?? [];
}

export interface UpdateCLIAuthAuthenticatorRequest {
  enabled?: boolean;
  config?: AuthenticatorConfig;
}

export async function updateCLIAuthAuthenticator(
  name: string,
  req: UpdateCLIAuthAuthenticatorRequest,
): Promise<{ status: string; authenticator: AuthenticatorState }> {
  return adminFetch(`/admin/cliauth/authenticators/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify(req),
  });
}

// ---- CLI Auth Refresher types ----

export interface CLIAuthRefresherStatus {
  enabled: boolean;
}

// ---- CLI Auth Refresher API functions ----

export async function getCLIAuthRefresherStatus(): Promise<CLIAuthRefresherStatus> {
  return adminFetch<CLIAuthRefresherStatus>("/admin/cliauth/refresher");
}

export async function enableCLIAuthRefresher(): Promise<{ status: string; enabled: boolean }> {
  return adminFetch("/admin/cliauth/refresher/enable", { method: "POST" });
}

export async function disableCLIAuthRefresher(): Promise<{ status: string; enabled: boolean }> {
  return adminFetch("/admin/cliauth/refresher/disable", { method: "POST" });
}

// ---- CLI Auth Login types ----

export interface CLIAuthLoginStartResponse {
  login_id: string;
  status: string;
  authenticator_name: string;
  message: string;
}

export interface CLIAuthLoginStatus {
  login_id: string;
  authenticator_name: string;
  status: string; // "running" | "succeeded" | "failed"
  started_at: string;
  finished_at?: string;
  phase?: string;
  message?: string;
  verification_url?: string;
  user_code?: string;
  error?: string;
  credential_id?: string;
}

// ---- CLI Auth Login API functions ----

export async function startCLIAuthLogin(
  authenticatorName: string,
  payload?: { provider_id?: string },
): Promise<CLIAuthLoginStartResponse> {
  return adminFetch<CLIAuthLoginStartResponse>(
    `/admin/cliauth/authenticators/${encodeURIComponent(authenticatorName)}/login`,
    { method: "POST", body: payload ? JSON.stringify(payload) : undefined },
  );
}

export async function getCLIAuthLoginStatus(loginId: string): Promise<CLIAuthLoginStatus> {
  return adminFetch<CLIAuthLoginStatus>(`/admin/cliauth/logins/${encodeURIComponent(loginId)}`);
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
// ACP (Agent Control Protocol) — Agent Control surface
// Mirrors the gateway /admin/acp/* admin API.
// ============================================================================

// ---- ACP Service types ----

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

export interface ACPService {
  id: string;
  name: string;
  agent_type: ACPAgentType;
  cwd: string;
  allowed_roots?: string[];
  default_model?: string;
  env?: Record<string, string>;
  config_overrides?: Record<string, string>;
  idle_ttl?: number;
  permission_mode?: ACPPermissionMode;
  disabled?: boolean;
  description?: string;
  created_at?: string;
  updated_at?: string;
  codex?: ACPCodexConfig;
  source?: string;
  read_only?: boolean;
}

export type ACPServicePayload = Omit<ACPService, "created_at" | "updated_at" | "source" | "read_only">;

// ---- ACP session / transcript types ----

export interface ACPSessionInfo {
  session_id: string;
  cwd: string;
  title?: string;
  updated_at?: string;
  _meta?: unknown;
}

export interface ACPListSessionsResponse {
  sessions: ACPSessionInfo[];
  next_cursor?: string;
}

export interface ACPTranscriptMessage {
  role: string; // "user" | "assistant" | "reasoning"
  text: string;
}

export interface ACPTranscriptResponse {
  session_id: string;
  messages: ACPTranscriptMessage[];
}

// ---- ACP runtime types ----

export interface ACPInFlightTurn {
  scope: string;
  trace_id?: string;
  span_id?: string;
  service_id?: string;
  thread_id?: string;
  session_id?: string;
  started_at?: string;
}

export interface ACPSessionMetadata {
  config_options?: unknown;
  available_commands?: unknown;
  session_info?: unknown;
  mode?: unknown;
  usage?: unknown;
}

export interface ACPPooledInstanceInfo {
  scope: string;
  session_id?: string;
  alive: boolean;
  active: boolean;
  last_used?: string;
  idle_ttl?: number;
  metadata?: ACPSessionMetadata;
}

export interface ACPPendingPermissionInfo {
  request_id: string;
  service_id: string;
  session_id?: string;
  created_at: string;
  data?: unknown;
}

export interface ACPRuntimeOverview {
  in_flight: ACPInFlightTurn[];
  instances: ACPPooledInstanceInfo[];
  pending_permissions: ACPPendingPermissionInfo[];
}

export interface ACPPermissionDecision {
  request_id: string;
  outcome: "selected" | "cancelled";
  option_id?: string;
}

// ---- ACP Route types ----

export interface ACPRoute {
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

export type ACPRoutePayload = Pick<
  ACPRoute,
  "id" | "description" | "disabled" | "match_policy" | "auth_policy" | "service_id"
>;

// ---- ACP Service API functions ----

export async function listACPServices(): Promise<ACPService[]> {
  const res = await adminFetch<{ items: ACPService[] }>("/admin/acp/services");
  return res.items ?? [];
}

export async function getACPService(id: string): Promise<ACPService> {
  return adminFetch<ACPService>(`/admin/acp/services/${encodeURIComponent(id)}`);
}

export async function createACPService(payload: ACPServicePayload): Promise<ACPService> {
  return adminFetch<ACPService>("/admin/acp/services", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateACPService(id: string, payload: ACPServicePayload): Promise<ACPService> {
  return adminFetch<ACPService>(`/admin/acp/services/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteACPService(id: string): Promise<void> {
  await adminFetch(`/admin/acp/services/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function listACPServiceSessions(
  id: string,
  params?: { cwd?: string; cursor?: string },
): Promise<ACPListSessionsResponse> {
  const query = new URLSearchParams();
  if (params?.cwd) query.set("cwd", params.cwd);
  if (params?.cursor) query.set("cursor", params.cursor);
  const qs = query.toString() ? `?${query.toString()}` : "";
  return adminFetch<ACPListSessionsResponse>(
    `/admin/acp/services/${encodeURIComponent(id)}/sessions${qs}`,
  );
}

export async function getACPSessionTranscript(
  id: string,
  sessionId: string,
  cwd?: string,
): Promise<ACPTranscriptResponse> {
  const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
  return adminFetch<ACPTranscriptResponse>(
    `/admin/acp/services/${encodeURIComponent(id)}/sessions/${encodeURIComponent(sessionId)}/transcript${qs}`,
  );
}

// ---- ACP Route API functions ----

export async function listACPRoutes(): Promise<ACPRoute[]> {
  const res = await adminFetch<{ items: ACPRoute[] }>("/admin/acp/routes");
  return res.items ?? [];
}

export async function createACPRoute(payload: ACPRoutePayload): Promise<ACPRoute> {
  return adminFetch<ACPRoute>("/admin/acp/routes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateACPRoute(id: string, payload: ACPRoutePayload): Promise<ACPRoute> {
  return adminFetch<ACPRoute>(`/admin/acp/routes/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteACPRoute(id: string): Promise<void> {
  await adminFetch(`/admin/acp/routes/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ---- ACP Runtime API functions ----

export async function getACPRuntime(): Promise<ACPRuntimeOverview> {
  return adminFetch<ACPRuntimeOverview>("/admin/acp/runtime");
}

export async function resolveACPPermission(
  requestId: string,
  decision: ACPPermissionDecision,
): Promise<{ status: string }> {
  return adminFetch(`/admin/acp/runtime/permissions/${encodeURIComponent(requestId)}`, {
    method: "POST",
    body: JSON.stringify(decision),
  });
}

export async function closeACPThread(
  serviceId: string,
  threadId: string,
): Promise<{ closed: number }> {
  return adminFetch(
    `/admin/acp/runtime/threads/${encodeURIComponent(serviceId)}/${encodeURIComponent(threadId)}`,
    { method: "DELETE" },
  );
}

// ---- ACP Chat (data-plane) API functions ----
// Driving a conversation is a data-plane operation, not an admin one. These go
// through the manager backend proxy (app/api/admin/acp/chat/*), which forwards
// to the runtime's public ACP route. The streamed turn lives in
// lib/acp-chat-stream.ts; only permission resolution is a plain JSON call.

export async function resolveACPChatPermission(payload: {
  route_id: string;
  virtual_key?: string;
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

export interface VirtualKeyItem {
  id: string;
  key: string;
  tag?: string;
  description?: string;
  disabled: boolean;
  allowed_route_ids?: string[];
  read_only?: boolean;
}

export async function listVirtualKeys(): Promise<VirtualKeyItem[]> {
  const res = await adminFetch<{ items: VirtualKeyItem[] }>("/admin/virtual_keys");
  return res.items ?? [];
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

/** Per-group aggregate row. Numeric fields are optional per protocol; the
 *  group-key column (e.g. `upstream_model`, `route_id`) is read via bracket. */
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
export type BreakdownItem = UsageStat & Record<string, unknown>;
export type TimeseriesPoint = UsageStat & { timestamp: string } & Record<string, unknown>;

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
  route_kind: string; // "llm" | "mcp" | "acp"
  route_protocol?: string;
  virtual_key_id?: string;
  success: boolean;
  status_code?: number;
  error_type?: string | null;
  latency_ms: number;
  agent_id?: string | null;
  // Protocol-specific extras (present depending on route_kind).
  provider_id?: string;
  provider_type?: string;
  upstream_model?: string;
  logical_model?: string | null;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
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
// Agents Control Plane (/admin/agents/*) — P0a/P0b/P1 implemented.
// ============================================================================

export interface AgentRuntimeACP {
  service_id: string;
}
export interface AgentRuntimeHTTP {
  endpoint: string;
  auth_ref?: string;
}
export interface AgentRuntime {
  type: string; // "acp" | "http"
  acp?: AgentRuntimeACP;
  http?: AgentRuntimeHTTP;
}
export interface AgentRoutes {
  acp_route_ids?: string[];
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
  routes: AgentRoutes;
  resources: AgentResources;
  policy: AgentPolicy;
  disabled: boolean;
  owns_service?: boolean;
  created_at: string;
  updated_at: string;
  source?: string;
}
export type AgentPayload = Pick<
  Agent,
  "id" | "name" | "description" | "runtime" | "routes" | "resources" | "policy" | "disabled"
>;

export interface AgentWorkspaceACPService {
  id: string;
  name: string;
  agent_type?: string;
  cwd?: string;
  max_instances?: number;
  permission_mode?: string;
  allowed_roots?: string[];
  default_cwd?: string;
  idle_ttl_ms?: number;
  disabled?: boolean;
  created_at?: string;
  updated_at?: string;
  source?: string;
  read_only?: boolean;
}
export interface AgentWorkspaceRoute {
  id: string;
  path_prefix?: string;
  service_id?: string;
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
export interface AgentWorkspaceLinks {
  sessions?: string;
  transcript?: string;
  admin_sessions?: string;
  admin_runtime?: string;
}
export interface AgentWorkspace {
  agent: Agent;
  runtime: string;
  acp_service?: AgentWorkspaceACPService | null;
  acp_routes?: AgentWorkspaceRoute[];
  runtime_view?: AgentWorkspaceRuntimeView;
  usage?: AgentWorkspaceUsage;
  links?: AgentWorkspaceLinks;
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
  acp_routes?: AgentResourceRef[];
}
export interface AgentResourcesView {
  resources: AgentResources;
  routes: AgentRoutes;
  resolved: AgentResourcesResolved;
}

export interface AgentActivity {
  interactions: InteractionEvent[];
  pending_permissions: ACPPendingPermissionInfo[];
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

export interface AgentDeleteResult {
  status: string;
  id: string;
  unbound?: { acp_service_id?: string; acp_route_ids?: string[] };
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
  role: "admin" | "operator" | "viewer";
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
  role: "operator" | "viewer";
}

export async function listGatewayMembers(gatewayId: string): Promise<GatewayMember[]> {
  const res = await adminFetch<{ items: GatewayMember[] }>(`/admin/gateways/${encodeURIComponent(gatewayId)}/members`);
  return res.items ?? [];
}

export async function setGatewayMember(
  gatewayId: string,
  userId: number,
  role: "operator" | "viewer",
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
