// View models for the ACP chat surface. These are derived on the client by
// folding the streamed SSE events into per-message state.

export interface ChatToolCall {
  id: string;
  title?: string;
  kind?: string;
  status?: string;
  raw: unknown;
}

export interface ChatPermission {
  request_id: string;
  data: unknown;
  // Local resolution state once the user (or a timeout) answers.
  resolved?: "selected" | "cancelled";
  optionId?: string;
}

export type ChatMessageStatus = "streaming" | "done" | "error" | "cancelled";

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "error";
  text: string;
  reasoning: string;
  toolCalls: ChatToolCall[];
  // Latest plan payload (raw ACP plan update); entries rendered generically.
  plan: unknown;
  permissions: ChatPermission[];
  usage?: unknown;
  status: ChatMessageStatus;
  stopReason?: string;
}

// A permission option as offered by the agent inside a `permission` event's data.
export interface ACPPermissionOption {
  optionId?: string;
  option_id?: string;
  id?: string;
  name?: string;
  label?: string;
  kind?: string;
}
