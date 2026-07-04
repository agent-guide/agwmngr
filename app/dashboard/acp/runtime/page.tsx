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
import { PendingPermissions } from "@/components/acp-pending-permissions";
import {
  ApiError,
  getACPRuntime,
  closeACPThread,
} from "@/lib/api";

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

  const inFlight = data?.in_flight ?? [];
  const instances = data?.instances ?? [];
  const pending = data?.pending_permissions ?? [];

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
            <PendingPermissions pending={pending} onResolved={() => void mutate()} />
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
    </div>
  );
}
