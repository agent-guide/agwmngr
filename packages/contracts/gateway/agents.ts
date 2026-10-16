import type { ACPAgentType, ACPPermissionMode, ACPCodexConfig } from "./acp";

// Gateway execution configuration, distinct from future platform definitions
// and releases. These types mirror the currently supported Gateway contract.
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

/** Remote A2A Agent Card execution configuration (Gateway v0.7). */
export interface AgentRuntimeHTTP {
  card_url: string;
  protocol: "a2a";
  auth_ref?: string;
  timeout_seconds?: number;
}

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
  retry?: { max_retries: number };
}

export interface BuiltinGeneration {
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
}

export interface BuiltinToolSelection {
  mcp_service_id: string;
  tools?: string[];
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
  factory?: string;
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
 * Management/display route references. Ingress ownership is one-way: an
 * AgentRoute points at the Agent, never the reverse.
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

export interface AgentRuntimeSummary {
  type: string;
  executable: boolean;
  healthy: boolean;
  state:
    | "unknown"
    | "disabled"
    | "not_executable"
    | "starting"
    | "ready"
    | "degraded"
    | "unhealthy";
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
