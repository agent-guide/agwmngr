"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { HelpTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  ApiError,
  getACPSessionTranscript,
  listACPServiceSessions,
  listVirtualKeys,
  resolveACPChatPermission,
  type ACPRoute,
  type ACPSessionInfo,
  type VirtualKeyItem,
} from "@/lib/api";
import { ACPTurnStream, type ACPTurnEventData, type ACPTurnEventKind } from "@/lib/acp-chat-stream";
import { MessageList } from "@/components/acp-chat/message-list";
import type { ChatMessage, ChatToolCall } from "@/components/acp-chat/types";

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function emptyAgentMessage(id: string): ChatMessage {
  return {
    id,
    role: "agent",
    text: "",
    reasoning: "",
    toolCalls: [],
    plan: null,
    permissions: [],
    status: "streaming",
  };
}

function toolCallId(data: unknown): string {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const key of ["toolCallId", "tool_call_id", "id"]) {
      const v = d[key];
      if (typeof v === "string" && v.trim()) return v;
    }
  }
  return "";
}

function toolCallFields(data: unknown): Omit<ChatToolCall, "id" | "raw"> {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const str = (k: string): string | undefined => (typeof d[k] === "string" ? (d[k] as string) : undefined);
  return {
    title: str("title") ?? str("name"),
    kind: str("kind") ?? str("type"),
    status: str("status"),
  };
}

function selectClass(): string {
  return cn(
    "w-full rounded-md glass-input px-3 py-2 text-sm text-white",
    "focus:outline-none focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/30",
    "disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200",
  );
}

interface AcpChatProps {
  /** Selectable ACP routes (full objects so auth_policy/service_id are available). */
  routes: ACPRoute[];
  /** Whether the parent is still loading the routes. */
  loadingRoutes?: boolean;
}

/**
 * Interactive ACP chat surface (data-plane). Drives a conversation against one
 * of the supplied routes: streamed text/reasoning/tool-calls/plan, interactive
 * permission cards, session resume + new session, and transcript history. The
 * caller chooses which routes are selectable — the standalone page passed every
 * active route, while the agent workspace scopes it to that agent's routes.
 */
export function AcpChat({ routes, loadingRoutes }: AcpChatProps) {
  const { showToast } = useToast();

  const [virtualKeys, setVirtualKeys] = useState<VirtualKeyItem[]>([]);
  const [routeChoice, setRouteChoice] = useState("");
  const [selectedVkId, setSelectedVkId] = useState("");
  const [cwd, setCwd] = useState("");
  const [loadingVks, setLoadingVks] = useState(true);

  const [threadId, setThreadId] = useState(() => newId());
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);

  const [sessions, setSessions] = useState<ACPSessionInfo[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const streamRef = useRef<ACPTurnStream | null>(null);
  // Mirror of sessionId so an in-flight turn's callbacks always read the latest
  // value (the `session` event arrives mid-turn for fresh sessions).
  const sessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Effective route: honour the user's choice while it stays valid, otherwise
  // fall back to the first available route as the supplied list changes.
  const selectedRouteId = useMemo(
    () => (routeChoice && routes.some((r) => r.id === routeChoice) ? routeChoice : routes[0]?.id ?? ""),
    [routeChoice, routes],
  );

  const selectedRoute = useMemo(
    () => routes.find((r) => r.id === selectedRouteId) ?? null,
    [routes, selectedRouteId],
  );
  const requireVk = Boolean(selectedRoute?.auth_policy?.require_virtual_key);
  const serviceId = selectedRoute?.service_id ?? "";

  // Virtual keys usable on the selected route: unrestricted keys, or keys that
  // explicitly allow this route.
  const eligibleVks = useMemo(
    () =>
      virtualKeys.filter(
        (vk) =>
          !vk.disabled &&
          (!vk.allowed_route_ids ||
            vk.allowed_route_ids.length === 0 ||
            (selectedRouteId ? vk.allowed_route_ids.includes(selectedRouteId) : true)),
      ),
    [virtualKeys, selectedRouteId],
  );
  const selectedVk = useMemo(
    () => virtualKeys.find((vk) => vk.id === selectedVkId) ?? null,
    [virtualKeys, selectedVkId],
  );

  // ---- Virtual keys ----
  const loadVks = useCallback(async () => {
    setLoadingVks(true);
    try {
      setVirtualKeys(await listVirtualKeys());
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to load virtual keys", "error");
    } finally {
      setLoadingVks(false);
    }
  }, [showToast]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadVks(), 0);
    return () => window.clearTimeout(timer);
  }, [loadVks]);

  // ---- Sessions sidebar (per selected route's service) ----
  const loadSessions = useCallback(async () => {
    if (!serviceId) {
      setSessions([]);
      return;
    }
    setLoadingSessions(true);
    try {
      const res = await listACPServiceSessions(serviceId, cwd.trim() ? { cwd: cwd.trim() } : undefined);
      setSessions(res.sessions ?? []);
    } catch (err) {
      // Some agents don't support session listing — surface quietly.
      setSessions([]);
      if (err instanceof ApiError && err.status !== 501) {
        showToast(err.message, "error");
      }
    } finally {
      setLoadingSessions(false);
    }
  }, [serviceId, cwd, showToast]);

  useEffect(() => {
    if (!serviceId) return;
    const timer = window.setTimeout(() => void loadSessions(), 0);
    return () => window.clearTimeout(timer);
  }, [serviceId, loadSessions]);

  // ---- Chat actions ----
  const startNewChat = useCallback(() => {
    streamRef.current?.abort();
    streamRef.current = null;
    setThreadId(newId());
    setSessionId(null);
    setMessages([]);
    setStreaming(false);
  }, []);

  const openSession = useCallback(
    async (session: ACPSessionInfo) => {
      if (streaming || !serviceId) return;
      try {
        const transcript = await getACPSessionTranscript(serviceId, session.session_id, session.cwd);
        const mapped: ChatMessage[] = (transcript.messages ?? []).map((m) => ({
          id: newId(),
          role: m.role === "user" ? "user" : "agent",
          text: m.role === "reasoning" ? "" : m.text,
          reasoning: m.role === "reasoning" ? m.text : "",
          toolCalls: [],
          plan: null,
          permissions: [],
          status: "done",
        }));
        streamRef.current?.abort();
        streamRef.current = null;
        setThreadId(newId());
        setSessionId(session.session_id);
        if (session.cwd) setCwd(session.cwd);
        setMessages(mapped);
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : "Failed to load transcript", "error");
      }
    },
    [serviceId, streaming, showToast],
  );

  const updateAgent = useCallback((agentId: string, mut: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === agentId ? mut(m) : m)));
  }, []);

  const handleEvent = useCallback(
    (agentId: string, kind: ACPTurnEventKind, data: ACPTurnEventData) => {
      switch (kind) {
        case "session":
          if (data.session_id) setSessionId(data.session_id);
          break;
        case "delta":
          if (data.text) updateAgent(agentId, (m) => ({ ...m, text: m.text + data.text }));
          break;
        case "reasoning":
          if (data.text) updateAgent(agentId, (m) => ({ ...m, reasoning: m.reasoning + data.text }));
          break;
        case "plan":
          updateAgent(agentId, (m) => ({ ...m, plan: data.data ?? m.plan }));
          break;
        case "tool_call": {
          const id = toolCallId(data.data) || newId();
          updateAgent(agentId, (m) => {
            const fields = toolCallFields(data.data);
            const existing = m.toolCalls.find((t) => t.id === id);
            if (existing) {
              return {
                ...m,
                toolCalls: m.toolCalls.map((t) =>
                  t.id === id
                    ? {
                        ...t,
                        ...fields,
                        title: fields.title ?? t.title,
                        kind: fields.kind ?? t.kind,
                        status: fields.status ?? t.status,
                        raw: data.data,
                      }
                    : t,
                ),
              };
            }
            return { ...m, toolCalls: [...m.toolCalls, { id, ...fields, raw: data.data }] };
          });
          break;
        }
        case "usage":
          updateAgent(agentId, (m) => ({ ...m, usage: data.data ?? m.usage }));
          break;
        case "permission":
          if (data.request_id) {
            updateAgent(agentId, (m) =>
              m.permissions.some((p) => p.request_id === data.request_id)
                ? m
                : { ...m, permissions: [...m.permissions, { request_id: data.request_id!, data: data.data }] },
            );
          }
          break;
        case "done":
          updateAgent(agentId, (m) => ({
            ...m,
            status: data.stop_reason === "cancelled" ? "cancelled" : "done",
            stopReason: data.stop_reason,
          }));
          break;
        case "error":
          updateAgent(agentId, (m) => ({
            ...m,
            status: "error",
            text: m.text || data.message || "Agent error",
          }));
          break;
        default:
          break;
      }
    },
    [updateAgent],
  );

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || streaming) return;
    if (!selectedRouteId) {
      showToast("Select an ACP route first", "error");
      return;
    }
    if (requireVk && !selectedVk) {
      showToast("This route requires a virtual key", "error");
      return;
    }

    const userMsg: ChatMessage = {
      id: newId(),
      role: "user",
      text,
      reasoning: "",
      toolCalls: [],
      plan: null,
      permissions: [],
      status: "done",
    };
    const agentId = newId();
    setMessages((prev) => [...prev, userMsg, emptyAgentMessage(agentId)]);
    setInput("");
    setStreaming(true);

    const stream = new ACPTurnStream(
      {
        route_id: selectedRouteId,
        virtual_key: selectedVk?.key,
        thread_id: threadId,
        session_id: sessionIdRef.current ?? undefined,
        input: text,
        cwd: cwd.trim() || undefined,
      },
      {
        onEvent: (kind, data) => handleEvent(agentId, kind, data),
        onTransportError: (message) =>
          updateAgent(agentId, (m) => ({
            ...m,
            status: "error",
            text: m.text || message,
          })),
        onClose: () => {
          setStreaming(false);
          streamRef.current = null;
          // Reload sessions so a newly created session appears in the sidebar.
          void loadSessions();
          // If no terminal event arrived, leave whatever partial state exists
          // but stop the streaming indicator.
          updateAgent(agentId, (m) => (m.status === "streaming" ? { ...m, status: "done" } : m));
        },
      },
    );
    streamRef.current = stream;
    void stream.start();
  }, [
    input,
    streaming,
    selectedRouteId,
    requireVk,
    selectedVk,
    threadId,
    cwd,
    handleEvent,
    updateAgent,
    loadSessions,
    showToast,
  ]);

  const handleStop = useCallback(() => {
    streamRef.current?.abort();
    streamRef.current = null;
    setStreaming(false);
  }, []);

  const handleResolvePermission = useCallback(
    async (messageId: string, requestId: string, outcome: "selected" | "cancelled", optionId?: string) => {
      try {
        await resolveACPChatPermission({
          route_id: selectedRouteId,
          virtual_key: selectedVk?.key,
          request_id: requestId,
          outcome,
          option_id: optionId,
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  permissions: m.permissions.map((p) =>
                    p.request_id === requestId ? { ...p, resolved: outcome, optionId } : p,
                  ),
                }
              : m,
          ),
        );
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : "Failed to resolve permission", "error");
      }
    },
    [selectedRouteId, selectedVk, showToast],
  );

  const noRoutes = !loadingRoutes && routes.length === 0;
  const controlsDisabled = loadingRoutes || loadingVks || streaming;

  return (
    <div className="flex h-[calc(100vh-15rem)] min-h-[28rem] flex-col gap-3">
      {/* Header / configuration bar */}
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              ACP Route
            </label>
            <select
              className={selectClass()}
              value={selectedRouteId}
              disabled={controlsDisabled || noRoutes}
              onChange={(e) => {
                setRouteChoice(e.target.value);
                startNewChat();
              }}
            >
              {routes.length === 0 && <option value="">No ACP routes</option>}
              {routes.map((r) => (
                <option key={r.id} value={r.id} className="bg-slate-900">
                  {r.id} → {r.service_id}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0 flex-1">
            <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Virtual Key
              {requireVk && <span className="text-amber-300">*</span>}
              <HelpTooltip content="Bearer credential used to call the data plane. Required when the route enforces a virtual key." />
            </label>
            <select
              className={selectClass()}
              value={selectedVkId}
              disabled={controlsDisabled || noRoutes}
              onChange={(e) => setSelectedVkId(e.target.value)}
            >
              <option value="" className="bg-slate-900">
                {requireVk ? "Select a key…" : "None"}
              </option>
              {eligibleVks.map((vk) => (
                <option key={vk.id} value={vk.id} className="bg-slate-900">
                  {vk.tag ? `${vk.tag} (${vk.id})` : vk.id}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0 flex-1">
            <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Working Dir
              <HelpTooltip content="Optional. Overrides the service default cwd for this conversation. Must match the session's cwd when resuming." />
            </label>
            <Input
              name="cwd"
              value={cwd}
              onChange={setCwd}
              placeholder="(service default)"
              disabled={streaming}
            />
          </div>

          <div className="shrink-0">
            <Button variant="secondary" onClick={startNewChat} disabled={streaming || noRoutes}>
              New chat
            </Button>
          </div>
        </div>
      </section>

      {noRoutes ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center text-sm text-slate-500">
          No ACP routes are bound to this agent. Expose the backing service over a route to enable chat.
        </div>
      ) : (
        /* Body: sessions sidebar + chat column */
        <div className="flex min-h-0 flex-1 gap-3">
          <aside className="hidden w-60 shrink-0 flex-col rounded-lg border border-slate-700/70 bg-slate-900/40 md:flex">
            <div className="flex items-center justify-between border-b border-slate-700/70 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Sessions</p>
              <button
                type="button"
                onClick={() => void loadSessions()}
                className="text-[10px] text-slate-400 hover:text-slate-200"
                disabled={loadingSessions || !serviceId}
              >
                Refresh
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {loadingSessions ? (
                <p className="px-1 py-2 text-[11px] text-slate-500">Loading…</p>
              ) : sessions.length === 0 ? (
                <p className="px-1 py-2 text-[11px] text-slate-500">No sessions yet.</p>
              ) : (
                <ul className="space-y-1">
                  {sessions.map((s) => (
                    <li key={s.session_id}>
                      <button
                        type="button"
                        onClick={() => void openSession(s)}
                        disabled={streaming}
                        className={cn(
                          "w-full rounded-md border px-2.5 py-1.5 text-left transition-colors",
                          sessionId === s.session_id
                            ? "border-blue-500/40 bg-blue-500/10"
                            : "border-transparent hover:border-slate-700/70 hover:bg-slate-800/50",
                          "disabled:cursor-not-allowed disabled:opacity-50",
                        )}
                      >
                        <p className="truncate text-xs text-slate-200">{s.title || s.session_id}</p>
                        {s.cwd && <p className="truncate text-[10px] text-slate-500">{s.cwd}</p>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>

          <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-slate-700/70 bg-slate-900/40">
            <div className="min-h-0 flex-1 px-3">
              <MessageList messages={messages} onResolvePermission={handleResolvePermission} />
            </div>

            <div className="border-t border-slate-700/70 p-3">
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  rows={2}
                  placeholder={
                    selectedRouteId ? "Type a message… (Enter to send, Shift+Enter for newline)" : "Select an ACP route to begin"
                  }
                  disabled={!selectedRouteId}
                  className={cn(
                    "max-h-40 min-h-[2.5rem] flex-1 resize-y rounded-md glass-input px-3 py-2 text-sm text-white",
                    "focus:outline-none focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/30",
                    "placeholder:text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed",
                  )}
                />
                {streaming ? (
                  <Button variant="danger" onClick={handleStop}>
                    Stop
                  </Button>
                ) : (
                  <Button onClick={handleSend} disabled={!input.trim() || !selectedRouteId}>
                    Send
                  </Button>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
