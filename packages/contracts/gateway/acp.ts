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
