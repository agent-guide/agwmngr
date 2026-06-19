import { API_BASE_URL, clearSession, getToken } from "./auth";

// SSE event names emitted by the ACP data plane (pkg/acp/runtime/acpupdate).
export type ACPTurnEventKind =
  | "session"
  | "delta"
  | "reasoning"
  | "content"
  | "plan"
  | "tool_call"
  | "usage"
  | "available_commands"
  | "session_info"
  | "mode"
  | "config_options"
  | "permission"
  | "done"
  | "error";

// Shape of each SSE event's `data` payload (pkg/acp/runtime/types.go TurnEvent).
export interface ACPTurnEventData {
  session_id?: string;
  request_id?: string;
  text?: string;
  stop_reason?: string;
  message?: string;
  data?: unknown;
}

export interface ACPTurnRequest {
  route_id: string;
  virtual_key?: string;
  thread_id: string;
  session_id?: string;
  input: string;
  cwd?: string;
  model?: string;
  fresh_session?: boolean;
  config_overrides?: Record<string, string>;
}

export interface ACPTurnCallbacks {
  // Fired for every parsed SSE event (including `done` and `error`).
  onEvent?: (kind: ACPTurnEventKind, data: ACPTurnEventData) => void;
  // Transport-level failure (request rejected, connection dropped, etc.).
  onTransportError?: (message: string) => void;
  // Stream closed for any reason (normal completion, error, or abort).
  onClose?: () => void;
}

/**
 * Streaming client for an ACP chat turn. Opens a fetch against the manager
 * backend proxy (`/api/admin/acp/chat/turn`) with the manager session token,
 * reads the SSE body, and dispatches typed events. Mirrors the ngent web UI's
 * TurnStream but as a small reusable class.
 */
export class ACPTurnStream {
  private aborter = new AbortController();
  private terminated = false;

  constructor(
    private readonly req: ACPTurnRequest,
    private readonly cb: ACPTurnCallbacks,
  ) {}

  abort(): void {
    this.terminated = true;
    this.aborter.abort();
  }

  async start(): Promise<void> {
    const token = getToken();
    let res: Response;
    try {
      res = await fetch(`${API_BASE_URL}/api/admin/acp/chat/turn`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(this.req),
        signal: this.aborter.signal,
      });
    } catch (e) {
      if (!this.terminated) this.cb.onTransportError?.(String(e));
      this.cb.onClose?.();
      return;
    }

    if (res.status === 401 && token) {
      clearSession();
      if (typeof window !== "undefined") window.location.replace("/login");
      return;
    }

    if (!res.ok || !res.body) {
      let msg = `request failed (${res.status})`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) msg = body.error;
      } catch {
        // keep default message
      }
      this.cb.onTransportError?.(msg);
      this.cb.onClose?.();
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // SSE frames are separated by a blank line.
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) this.dispatch(part);
        if (this.terminated) break;
      }
    } catch (e) {
      if (!this.terminated) this.cb.onTransportError?.(String(e));
    } finally {
      reader.releaseLock();
      this.cb.onClose?.();
    }
  }

  private dispatch(raw: string): void {
    const trimmed = raw.trim();
    if (!trimmed) return;

    let event = "message";
    const dataLines: string[] = [];
    for (const line of trimmed.split("\n")) {
      if (line.startsWith("event:")) event = line.slice("event:".length).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
    }
    if (!dataLines.length) return;

    let data: ACPTurnEventData;
    try {
      data = JSON.parse(dataLines.join("\n")) as ACPTurnEventData;
    } catch {
      return;
    }
    this.cb.onEvent?.(event as ACPTurnEventKind, data);
  }
}

export function startACPTurn(req: ACPTurnRequest, cb: ACPTurnCallbacks): ACPTurnStream {
  const stream = new ACPTurnStream(req, cb);
  void stream.start();
  return stream;
}
