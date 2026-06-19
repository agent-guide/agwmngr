"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { HelpTooltip } from "@/components/ui/tooltip";
import {
  ApiError,
  getACPRuntime,
  resolveACPPermission,
  closeACPThread,
  type ACPRuntimeOverview,
  type ACPPendingPermissionInfo,
} from "@/lib/api";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{children}</p>;
}

export default function ACPRuntimePage() {
  const [data, setData] = useState<ACPRuntimeOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  // Resolve permission modal
  const [resolving, setResolving] = useState<ACPPendingPermissionInfo | null>(null);
  const [resolveOptionId, setResolveOptionId] = useState("");
  const [resolveBusy, setResolveBusy] = useState(false);

  // Close thread modal
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeServiceId, setCloseServiceId] = useState("");
  const [closeThreadId, setCloseThreadId] = useState("");
  const [closeBusy, setCloseBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getACPRuntime());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load runtime");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const handleResolve = async (outcome: "selected" | "cancelled") => {
    if (!resolving) return;
    if (outcome === "selected" && !resolveOptionId.trim()) {
      showToast("Option ID is required to approve", "error");
      return;
    }
    setResolveBusy(true);
    try {
      await resolveACPPermission(resolving.request_id, {
        request_id: resolving.request_id,
        outcome,
        ...(outcome === "selected" && { option_id: resolveOptionId.trim() }),
      });
      showToast(outcome === "selected" ? "Permission approved" : "Permission cancelled", "success");
      setResolving(null);
      setResolveOptionId("");
      void load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to resolve permission", "error");
    } finally {
      setResolveBusy(false);
    }
  };

  const handleCloseThread = async () => {
    if (!closeServiceId.trim() || !closeThreadId.trim()) {
      showToast("Service ID and thread ID are required", "error");
      return;
    }
    setCloseBusy(true);
    try {
      const res = await closeACPThread(closeServiceId.trim(), closeThreadId.trim());
      showToast(`Closed ${res.closed} instance(s)`, "success");
      setCloseOpen(false);
      setCloseServiceId("");
      setCloseThreadId("");
      void load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to close thread", "error");
    } finally {
      setCloseBusy(false);
    }
  };

  const inFlight = data?.in_flight ?? [];
  const instances = data?.instances ?? [];
  const pending = data?.pending_permissions ?? [];

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">ACP Runtime</h1>
            <p className="mt-1 text-xs text-slate-400">
              Inspect pooled agent instances, in-flight turns, and pending permission requests.
              <HelpTooltip content="The runtime pools long-lived agent processes. Use this page to observe activity and intervene." />
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => setCloseOpen(true)}>Close Thread</Button>
            <Button className="px-2.5 py-1 text-xs" onClick={() => void load()}>Refresh</Button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-3 gap-2">
        {[
          { label: "In-Flight Turns", value: inFlight.length },
          { label: "Pooled Instances", value: instances.length },
          { label: "Pending Permissions", value: pending.length },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-slate-700/70 bg-slate-900/40 px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{stat.label}</p>
            <p className="mt-0.5 text-lg font-semibold text-slate-100">{stat.value}</p>
          </div>
        ))}
      </section>

      {loading ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center">
          <p className="text-sm text-slate-400">Loading runtime…</p>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      ) : (
        <>
          {/* Pending permissions */}
          <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4 space-y-3">
            <SectionHeading>
              Pending Permissions
              <HelpTooltip content="Interactive permission requests awaiting a decision. Approve with an option ID or cancel." />
            </SectionHeading>
            {pending.length === 0 ? (
              <p className="text-[11px] text-slate-500">No pending permission requests.</p>
            ) : (
              <div className="space-y-2">
                {pending.map((p) => (
                  <div key={p.request_id} className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-mono text-xs font-semibold text-amber-200">{p.request_id}</span>
                        <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                          service: {p.service_id}{p.session_id ? ` · session: ${p.session_id}` : ""}
                        </p>
                      </div>
                      <Button className="shrink-0 px-2 py-1 text-[10px]" onClick={() => { setResolving(p); setResolveOptionId(""); }}>Resolve</Button>
                    </div>
                    {p.data != null && (
                      <pre className="mt-2 max-h-32 overflow-auto rounded bg-slate-950/70 p-2 font-mono text-[10px] text-slate-400">{JSON.stringify(p.data, null, 2)}</pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Pooled instances */}
          <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4 space-y-3">
            <SectionHeading>Pooled Instances</SectionHeading>
            {instances.length === 0 ? (
              <p className="text-[11px] text-slate-500">No pooled instances.</p>
            ) : (
              <div className="space-y-2">
                {instances.map((inst, i) => (
                  <div key={i} className="rounded-md border border-slate-700/60 bg-slate-900/50 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {inst.alive && <span className="inline-flex rounded-sm bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">alive</span>}
                      {inst.active && <span className="inline-flex rounded-sm bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-300">active</span>}
                      {inst.session_id && <span className="font-mono text-[10px] text-slate-400">session: {inst.session_id}</span>}
                      {inst.last_used && <span className="text-[10px] text-slate-500">last used {new Date(inst.last_used).toLocaleString()}</span>}
                    </div>
                    <p className="mt-1 break-all font-mono text-[10px] text-slate-500">{inst.scope}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* In-flight turns */}
          <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4 space-y-3">
            <SectionHeading>In-Flight Turns</SectionHeading>
            {inFlight.length === 0 ? (
              <p className="text-[11px] text-slate-500">No in-flight turns.</p>
            ) : (
              <div className="space-y-1.5">
                {inFlight.map((t, i) => (
                  <p key={i} className="break-all rounded-md border border-slate-700/60 bg-slate-900/50 px-3 py-1.5 font-mono text-[10px] text-slate-400">{t.scope}</p>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Resolve permission modal */}
      <Modal isOpen={!!resolving} onClose={() => setResolving(null)}>
        <ModalHeader><ModalTitle>Resolve Permission</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="space-y-3">
            <p className="font-mono text-[11px] text-slate-400">{resolving?.request_id}</p>
            {resolving?.data != null && (
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Request Data</p>
                <pre className="max-h-48 overflow-auto rounded bg-slate-950/70 p-2 font-mono text-[10px] text-slate-400">{JSON.stringify(resolving.data, null, 2)}</pre>
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">
                Option ID
                <HelpTooltip content="Exact option ID from the agent's permission offer (see request data above). Required to approve." />
              </label>
              <Input name="option-id" value={resolveOptionId} onChange={setResolveOptionId} placeholder="e.g. allow_once" />
            </div>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setResolving(null)} disabled={resolveBusy}>Cancel</Button>
          <Button variant="danger" onClick={() => handleResolve("cancelled")} disabled={resolveBusy}>Reject</Button>
          <Button onClick={() => handleResolve("selected")} disabled={resolveBusy}>{resolveBusy ? "Resolving…" : "Approve"}</Button>
        </ModalFooter>
      </Modal>

      {/* Close thread modal */}
      <Modal isOpen={closeOpen} onClose={() => setCloseOpen(false)}>
        <ModalHeader><ModalTitle>Close Thread</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="space-y-3">
            <p className="text-[11px] text-slate-400">Close all pooled instances for a service and thread.</p>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Service ID <span className="text-red-400">*</span></label>
              <Input name="close-service" value={closeServiceId} onChange={setCloseServiceId} placeholder="codex-main" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Thread ID <span className="text-red-400">*</span></label>
              <Input name="close-thread" value={closeThreadId} onChange={setCloseThreadId} placeholder="t-demo-1" />
            </div>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setCloseOpen(false)} disabled={closeBusy}>Cancel</Button>
          <Button variant="danger" onClick={handleCloseThread} disabled={closeBusy}>{closeBusy ? "Closing…" : "Close Thread"}</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
