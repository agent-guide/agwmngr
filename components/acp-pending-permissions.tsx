"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { HelpTooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { ApiError, resolveACPPermission, type ACPPendingPermissionInfo } from "@/lib/api";

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

/**
 * Inline list of pending ACP permission requests with approve/reject actions.
 * Shared by the ACP Runtime page and the agent Overview "Live Runtime" card.
 * Callers own the surrounding Card/heading; `onResolved` should re-fetch the
 * source data (SWR mutate) after a decision.
 */
export function PendingPermissions({
  pending,
  onResolved,
  emptyText = "No pending permission requests.",
}: {
  pending: ACPPendingPermissionInfo[];
  onResolved: () => void;
  emptyText?: string;
}) {
  const { showToast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  // Fallback manual-resolve modal for permissions without parseable options.
  const [manual, setManual] = useState<ACPPendingPermissionInfo | null>(null);
  const [manualOptionId, setManualOptionId] = useState("");

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
      onResolved();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to resolve permission", "error");
    } finally {
      setBusyId(null);
    }
  };

  if (pending.length === 0) {
    return <p className="text-xs text-slate-500">{emptyText}</p>;
  }

  return (
    <>
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

      {manual && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-modal-overlay" onClick={() => setManual(null)}>
          <div className="w-full max-w-md glass-card animate-modal-card rounded-lg p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-slate-100">Resolve Permission</h3>
            <p className="mt-1 font-mono text-[11px] text-slate-400">{manual.request_id}</p>
            <label className="mt-3 mb-1.5 block text-sm font-medium text-slate-300">
              Option ID
              <HelpTooltip content="Exact option ID from the agent's permission offer (see raw request). Required to approve." />
            </label>
            <input
              value={manualOptionId}
              onChange={(e) => setManualOptionId(e.target.value)}
              placeholder="e.g. allow_once"
              className="glass-input w-full rounded-md px-3 py-2 text-sm text-slate-100"
            />
            <div className="mt-4 flex justify-end gap-1.5">
              <Button variant="ghost" onClick={() => setManual(null)} disabled={busyId === manual.request_id}>Cancel</Button>
              <Button variant="danger" onClick={() => void resolve(manual, "cancelled")} disabled={busyId === manual.request_id}>Reject</Button>
              <Button onClick={() => void resolve(manual, "selected", manualOptionId.trim())} disabled={busyId === manual.request_id || !manualOptionId.trim()}>
                {busyId === manual.request_id ? "Resolving…" : "Approve"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
