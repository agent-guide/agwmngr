"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { AutoRefreshControl } from "@/components/ui/auto-refresh-control";
import { useToast } from "@/components/ui/toast";
import { HelpTooltip } from "@/components/ui/tooltip";
import { useAdminSWR } from "@/hooks/use-admin-swr";
import {
  ApiError,
  getACPRuntime,
  resolveACPPermission,
  closeACPThread,
  type ACPPendingPermissionInfo,
} from "@/lib/api";

interface PermissionOption {
  optionId: string;
  name: string;
  kind?: string;
}

/** Best-effort extraction of selectable options from a raw ACP permission request. */
function parseOptions(data: unknown): PermissionOption[] {
  if (data && typeof data === "object" && "options" in data) {
    const opts = (data as { options?: unknown }).options;
    if (Array.isArray(opts)) {
      return opts
        .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
        .map((o) => ({
          optionId: String(o.optionId ?? o.option_id ?? ""),
          name: String(o.name ?? o.optionId ?? o.option_id ?? "option"),
          kind: typeof o.kind === "string" ? o.kind : undefined,
        }))
        .filter((o) => o.optionId);
    }
  }
  return [];
}

function permissionTitle(data: unknown): string | null {
  if (data && typeof data === "object" && "toolCall" in data) {
    const tc = (data as { toolCall?: { title?: unknown } }).toolCall;
    if (tc && typeof tc.title === "string") return tc.title;
  }
  return null;
}

/** scope is "{service_id}:{thread_id}"; split on the first colon. */
function parseScope(scope: string): { serviceId: string; threadId: string } | null {
  const idx = scope.indexOf(":");
  if (idx <= 0) return null;
  return { serviceId: scope.slice(0, idx), threadId: scope.slice(idx + 1) };
}

export default function ACPRuntimePage() {
  const { showToast } = useToast();
  const { data, error, isLoading, isValidating, mutate, lastUpdated } = useAdminSWR(
    "acp-runtime",
    getACPRuntime,
    { live: true },
  );

  const [busyId, setBusyId] = useState<string | null>(null);
  // Fallback manual-resolve modal for permissions without parseable options.
  const [manual, setManual] = useState<ACPPendingPermissionInfo | null>(null);
  const [manualOptionId, setManualOptionId] = useState("");

  const inFlight = data?.in_flight ?? [];
  const instances = data?.instances ?? [];
  const pending = data?.pending_permissions ?? [];

  const resolve = async (p: ACPPendingPermissionInfo, outcome: "selected" | "cancelled", optionId?: string) => {
    setBusyId(p.request_id);
    try {
      await resolveACPPermission(p.request_id, {
        request_id: p.request_id,
        outcome,
        ...(outcome === "selected" && optionId ? { option_id: optionId } : {}),
      });
      showToast(outcome === "selected" ? "Permission approved" : "Permission rejected", "success");
      setManual(null);
      setManualOptionId("");
      void mutate();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to resolve permission", "error");
    } finally {
      setBusyId(null);
    }
  };

  const close = async (serviceId: string, threadId: string) => {
    const key = `${serviceId}:${threadId}`;
    setBusyId(key);
    try {
      const res = await closeACPThread(serviceId, threadId);
      showToast(`Closed ${res.closed} instance(s)`, "success");
      void mutate();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to close thread", "error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="ACP Runtime"
        description={
          <>
            Pooled agent instances, in-flight turns, and pending permissions.
            <HelpTooltip content="The runtime pools long-lived agent processes. Observe activity and intervene inline." />
          </>
        }
        actions={<AutoRefreshControl lastUpdated={lastUpdated} onRefresh={() => void mutate()} refreshing={isValidating} />}
      />

      <StatGrid>
        <StatCard label="In-Flight Turns" value={inFlight.length} />
        <StatCard label="Pooled Instances" value={instances.length} />
        <StatCard label="Pending Permissions" value={pending.length} tone={pending.length > 0 ? "text-amber-300" : "text-slate-100"} />
      </StatGrid>

      {isLoading && !data ? (
        <Card className="p-8 text-center text-sm text-slate-400">Loading runtime…</Card>
      ) : error ? (
        <Card className="p-8 text-center text-sm text-rose-300">{error instanceof Error ? error.message : "Failed to load runtime"}</Card>
      ) : (
        <>
          {/* Pending permissions */}
          <Card>
            <CardHeader>
              <CardTitle>Pending Permissions <HelpTooltip content="Interactive permission requests awaiting a decision. Approve an offered option or reject." /></CardTitle>
            </CardHeader>
            {pending.length === 0 ? (
              <p className="text-xs text-slate-500">No pending permission requests.</p>
            ) : (
              <div className="space-y-2">
                {pending.map((p) => {
                  const options = parseOptions(p.data);
                  const title = permissionTitle(p.data);
                  const busy = busyId === p.request_id;
                  return (
                    <div key={p.request_id} className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          {title && <p className="text-sm font-medium text-amber-100">{title}</p>}
                          <p className="font-mono text-xs text-amber-300">{p.request_id}</p>
                          <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                            service: {p.service_id}{p.session_id ? ` · session: ${p.session_id}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                          {options.length > 0 ? (
                            options.map((o) => (
                              <Button
                                key={o.optionId}
                                variant={o.kind?.startsWith("reject") || o.kind === "cancel" ? "danger" : "primary"}
                                className="px-2.5 py-1 text-xs"
                                disabled={busy}
                                onClick={() => void resolve(p, "selected", o.optionId)}
                              >
                                {o.name}
                              </Button>
                            ))
                          ) : (
                            <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={busy} onClick={() => { setManual(p); setManualOptionId(""); }}>
                              Resolve…
                            </Button>
                          )}
                          <Button variant="danger" className="px-2.5 py-1 text-xs" disabled={busy} onClick={() => void resolve(p, "cancelled")}>
                            Reject
                          </Button>
                        </div>
                      </div>
                      {p.data != null && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-300">Raw request</summary>
                          <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-950/70 p-2 font-mono text-[11px] text-slate-400">{JSON.stringify(p.data, null, 2)}</pre>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Pooled instances */}
          <Card>
            <CardHeader><CardTitle>Pooled Instances</CardTitle></CardHeader>
            {instances.length === 0 ? (
              <p className="text-xs text-slate-500">No pooled instances.</p>
            ) : (
              <div className="space-y-2">
                {instances.map((inst, i) => {
                  const parsed = parseScope(inst.scope);
                  const key = parsed ? `${parsed.serviceId}:${parsed.threadId}` : inst.scope;
                  const busy = busyId === key;
                  return (
                    <div key={i} className="flex items-start justify-between gap-2 rounded-md border border-slate-700/60 bg-slate-900/50 p-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {inst.alive && <Badge tone="green">alive</Badge>}
                          {inst.active && <Badge tone="blue">active</Badge>}
                          {inst.session_id && <span className="font-mono text-[11px] text-slate-400">session: {inst.session_id}</span>}
                          {inst.last_used && <span className="text-[11px] text-slate-500" suppressHydrationWarning>last used {new Date(inst.last_used).toLocaleString()}</span>}
                        </div>
                        <p className="mt-1 break-all font-mono text-[11px] text-slate-500">{inst.scope}</p>
                      </div>
                      {parsed && (
                        <Button variant="ghost" className="shrink-0 px-2.5 py-1 text-xs" disabled={busy} onClick={() => void close(parsed.serviceId, parsed.threadId)}>
                          {busy ? "Closing…" : "Close"}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* In-flight turns */}
          <Card>
            <CardHeader><CardTitle>In-Flight Turns</CardTitle></CardHeader>
            {inFlight.length === 0 ? (
              <p className="text-xs text-slate-500">No in-flight turns.</p>
            ) : (
              <div className="space-y-1.5">
                {inFlight.map((t, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 rounded-md border border-slate-700/60 bg-slate-900/50 px-3 py-1.5">
                    <span className="break-all font-mono text-[11px] text-slate-400">{t.scope}</span>
                    {t.service_id && t.thread_id && (
                      <Button variant="ghost" className="shrink-0 px-2 py-0.5 text-[11px]" disabled={busyId === `${t.service_id}:${t.thread_id}`} onClick={() => void close(t.service_id!, t.thread_id!)}>
                        Close
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {/* Fallback manual resolve modal */}
      {manual && (
        <ManualResolveModal
          permission={manual}
          optionId={manualOptionId}
          setOptionId={setManualOptionId}
          busy={busyId === manual.request_id}
          onClose={() => setManual(null)}
          onApprove={() => void resolve(manual, "selected", manualOptionId.trim())}
          onReject={() => void resolve(manual, "cancelled")}
        />
      )}
    </div>
  );
}

function ManualResolveModal({
  permission, optionId, setOptionId, busy, onClose, onApprove, onReject,
}: {
  permission: ACPPendingPermissionInfo;
  optionId: string;
  setOptionId: (v: string) => void;
  busy: boolean;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-modal-overlay" onClick={onClose}>
      <div className="w-full max-w-md glass-card animate-modal-card rounded-lg p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-slate-100">Resolve Permission</h3>
        <p className="mt-1 font-mono text-[11px] text-slate-400">{permission.request_id}</p>
        <label className="mt-3 mb-1.5 block text-sm font-medium text-slate-300">
          Option ID
          <HelpTooltip content="Exact option ID from the agent's permission offer (see raw request). Required to approve." />
        </label>
        <input
          value={optionId}
          onChange={(e) => setOptionId(e.target.value)}
          placeholder="e.g. allow_once"
          className="glass-input w-full rounded-md px-3 py-2 text-sm text-slate-100"
        />
        <div className="mt-4 flex justify-end gap-1.5">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={onReject} disabled={busy}>Reject</Button>
          <Button onClick={onApprove} disabled={busy || !optionId.trim()}>{busy ? "Resolving…" : "Approve"}</Button>
        </div>
      </div>
    </div>
  );
}
