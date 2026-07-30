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
import { PendingPermissions, normalizeACPRuntimePermission } from "@/components/acp-pending-permissions";
import {
  ApiError,
  getACPRuntime,
  closeACPThread,
} from "@/lib/api";

// A pool scope is NUL-separated: ownerID \0 cwd \0 threadID \0 sessionID \0 model
// (pkg/acp/runtime/manager.go). The admin views already surface the owning
// agent_id, so only the thread id has to be recovered from the scope. Rendering
// the raw scope would emit invisible NUL bytes, so it is always split for display.
const SCOPE_SEP = "\u0000";

interface ParsedScope {
  ownerId: string;
  cwd: string;
  threadId: string;
  sessionId: string;
  model: string;
}

function parseScope(scope: string): ParsedScope | null {
  const parts = scope.split(SCOPE_SEP);
  if (parts.length !== 5) return null;
  const [ownerId, cwd, threadId, sessionId, model] = parts;
  return { ownerId, cwd, threadId, sessionId, model };
}

/** Human-readable scope: NUL is not printable, so join with a visible separator. */
function formatScope(scope: string): string {
  return scope.split(SCOPE_SEP).join(" · ");
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

  const close = async (agentId: string, threadId: string) => {
    const key = `${agentId}:${threadId}`;
    setBusyId(key);
    try {
      const res = await closeACPThread(agentId, threadId);
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
            Native pool state for ACP agents: pooled processes, in-flight turns, and pending permissions.
            <HelpTooltip content="This is lower-level process diagnostics, keyed by pool scope. For logical run control use the agent's Runs panel — closing a thread is destructive recovery, not run cancellation." />
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
              <CardTitle>Pending Permissions <HelpTooltip content="Interactive permission requests awaiting a decision. This overview carries identity only, so approving needs the exact option id — the agent Overview tab shows the offered options." /></CardTitle>
            </CardHeader>
            <PendingPermissions
              pending={pending.map(normalizeACPRuntimePermission)}
              onResolved={() => void mutate()}
            />
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
                  const closable = parsed?.threadId ? { agentId: inst.agent_id, threadId: parsed.threadId } : null;
                  const busy = closable ? busyId === `${closable.agentId}:${closable.threadId}` : false;
                  return (
                    <div key={i} className="flex items-start justify-between gap-2 rounded-md border border-slate-700/60 bg-slate-900/50 p-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[11px] text-slate-300">{inst.agent_id}</span>
                          {inst.alive && <Badge tone="green">alive</Badge>}
                          {inst.active && <Badge tone="blue">active</Badge>}
                          {inst.session_id && <span className="font-mono text-[11px] text-slate-400">session: {inst.session_id}</span>}
                          {inst.last_used && <span className="text-[11px] text-slate-500" suppressHydrationWarning>last used {new Date(inst.last_used).toLocaleString()}</span>}
                        </div>
                        {parsed?.threadId && (
                          <p className="mt-1 font-mono text-[11px] text-slate-400">thread: {parsed.threadId}</p>
                        )}
                        <p className="mt-1 break-all font-mono text-[11px] text-slate-500">{formatScope(inst.scope)}</p>
                      </div>
                      {closable && (
                        <Button variant="ghost" className="shrink-0 px-2.5 py-1 text-xs" disabled={busy} onClick={() => void close(closable.agentId, closable.threadId)}>
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
                {inFlight.map((t, i) => {
                  const parsed = parseScope(t.scope);
                  const closable = parsed?.threadId ? { agentId: t.agent_id, threadId: parsed.threadId } : null;
                  const busy = closable ? busyId === `${closable.agentId}:${closable.threadId}` : false;
                  return (
                    <div key={i} className="flex items-center justify-between gap-2 rounded-md border border-slate-700/60 bg-slate-900/50 px-3 py-1.5">
                      <div className="min-w-0">
                        <span className="font-mono text-[11px] text-slate-300">{t.agent_id}</span>
                        <span className="ml-2 break-all font-mono text-[11px] text-slate-500">{formatScope(t.scope)}</span>
                      </div>
                      {closable && (
                        <Button variant="ghost" className="shrink-0 px-2 py-0.5 text-[11px]" disabled={busy} onClick={() => void close(closable.agentId, closable.threadId)}>
                          Close
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
