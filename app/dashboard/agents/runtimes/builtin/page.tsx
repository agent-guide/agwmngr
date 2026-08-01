"use client";

import Link from "next/link";
import { AutoRefreshControl } from "@/components/ui/auto-refresh-control";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { HelpTooltip } from "@/components/ui/tooltip";
import { useAdminSWR } from "@/hooks/use-admin-swr";
import {
  getBuiltinRuntime,
  type BuiltinPendingPermissionCall,
} from "@/lib/api";

function formatTimestamp(value?: string): string {
  if (!value || value.startsWith("0001-01-01")) return "—";
  return new Date(value).toLocaleString();
}

function elapsedSince(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "—";
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatToolCall(call: BuiltinPendingPermissionCall): string {
  return `${call.mcp_service_id}/${call.name}`;
}

export default function BuiltinRuntimePage() {
  const { data, error, isLoading, isValidating, mutate, lastUpdated } = useAdminSWR(
    "builtin-runtime",
    getBuiltinRuntime,
    { live: true },
  );

  const agents = Object.entries(data?.agents ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const inFlight = data?.in_flight ?? [];
  const pending = data?.pending_permissions ?? [];
  const liveSessions = agents.reduce((sum, [, state]) => sum + state.live_sessions, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Builtin Runtime"
        description={
          <>
            Native host diagnostics for in-process ADK agents: materialized graphs, live sessions,
            active turns, and suspended tool permissions.
            <HelpTooltip content="Builtin definitions are materialized lazily on the first turn and rebuilt after their agent definition changes. Run control remains on each agent's Runs tab." />
          </>
        }
        actions={
          <AutoRefreshControl
            lastUpdated={lastUpdated}
            onRefresh={() => void mutate()}
            refreshing={isValidating}
          />
        }
      />

      <StatGrid>
        <StatCard label="Materialized Agents" value={agents.length} />
        <StatCard label="In-Flight Turns" value={inFlight.length} />
        <StatCard label="Live Sessions" value={liveSessions} />
        <StatCard
          label="Pending Permissions"
          value={pending.length}
          tone={pending.length > 0 ? "text-amber-300" : "text-slate-100"}
        />
      </StatGrid>

      {isLoading && !data ? (
        <Card className="p-8 text-center text-sm text-slate-400">Loading runtime…</Card>
      ) : error ? (
        <Card className="p-8 text-center text-sm text-rose-300">
          {error instanceof Error ? error.message : "Failed to load builtin runtime"}
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                Materialized Agents
                <HelpTooltip content="Only agents whose builtin graph has been built appear here. Configured but never-run builtin agents are intentionally absent." />
              </CardTitle>
            </CardHeader>
            {agents.length === 0 ? (
              <p className="text-xs text-slate-500">
                No builtin graphs have been materialized. A graph appears after its first turn.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-700/60 text-slate-500">
                    <tr>
                      <th className="pb-2 pr-4 font-medium">Agent</th>
                      <th className="pb-2 pr-4 font-medium">Topology</th>
                      <th className="pb-2 pr-4 font-medium">State</th>
                      <th className="pb-2 pr-4 text-right font-medium">In flight</th>
                      <th className="pb-2 pr-4 text-right font-medium">Sessions</th>
                      <th className="pb-2 font-medium">Materialized at</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {agents.map(([agentId, state]) => (
                      <tr key={agentId}>
                        <td className="py-2.5 pr-4">
                          <Link className="font-mono text-blue-300 hover:text-blue-200" href={`/dashboard/agents/${encodeURIComponent(agentId)}`}>
                            {agentId}
                          </Link>
                        </td>
                        <td className="py-2.5 pr-4"><Badge tone="violet">{state.topology_kind || "unknown"}</Badge></td>
                        <td className="py-2.5 pr-4">
                          <Badge tone={state.materialized ? "green" : "neutral"}>
                            {state.materialized ? "materialized" : "not materialized"}
                          </Badge>
                        </td>
                        <td className="py-2.5 pr-4 text-right tabular-nums text-slate-300">{state.inflight_turns}</td>
                        <td className="py-2.5 pr-4 text-right tabular-nums text-slate-300">{state.live_sessions}</td>
                        <td className="py-2.5 text-slate-400" suppressHydrationWarning>{formatTimestamp(state.materialized_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                In-Flight Turns
                <HelpTooltip content="This is the host execution view. To force or gracefully cancel a logical run, open the owning agent's Runs tab." />
              </CardTitle>
            </CardHeader>
            {inFlight.length === 0 ? (
              <p className="text-xs text-slate-500">No in-flight builtin turns.</p>
            ) : (
              <div className="space-y-2">
                {inFlight.map((turn) => (
                  <div key={`${turn.agent_id}:${turn.session_id}:${turn.run_id}`} className="rounded-md border border-slate-700/60 bg-slate-900/50 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link className="font-mono text-xs text-blue-300 hover:text-blue-200" href={`/dashboard/agents/${encodeURIComponent(turn.agent_id)}`}>
                        {turn.agent_id}
                      </Link>
                      <Badge tone="blue">{turn.operation}</Badge>
                      {turn.topology_kind && <Badge tone="violet">{turn.topology_kind}</Badge>}
                      <span className="text-xs text-slate-500" suppressHydrationWarning>
                        running {elapsedSince(turn.started_at)}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-1 font-mono text-[11px] text-slate-400 sm:grid-cols-2">
                      <span>run: {turn.run_id}</span>
                      <span>session: {turn.session_id}</span>
                      {turn.request_id && <span>request: {turn.request_id}</span>}
                      <span suppressHydrationWarning>started: {formatTimestamp(turn.started_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                Suspended Permissions
                <HelpTooltip content="Builtin permissions resume on a new Chat turn stream. The side-channel permission endpoint used by ACP active streams is not valid for builtin agents." />
              </CardTitle>
            </CardHeader>
            {pending.length === 0 ? (
              <p className="text-xs text-slate-500">No suspended builtin permission requests.</p>
            ) : (
              <div className="space-y-2">
                {pending.map((permission) => (
                  <div key={permission.request_id} className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-mono text-xs text-amber-300">{permission.request_id}</p>
                        <p className="mt-1 font-mono text-[11px] text-slate-400">
                          agent: {permission.agent_id} · run: {permission.run_id} · session: {permission.session_id}
                        </p>
                      </div>
                      <Link className="text-xs font-medium text-blue-300 hover:text-blue-200" href={`/dashboard/agents/${encodeURIComponent(permission.agent_id)}`}>
                        Open agent
                      </Link>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {permission.calls.map((call) => (
                        <span key={call.call_id} className="rounded border border-slate-700 bg-slate-900/60 px-2 py-1 font-mono text-[11px] text-slate-300" title={call.arguments}>
                          {formatToolCall(call)}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-[11px] text-slate-500" suppressHydrationWarning>
                      created {formatTimestamp(permission.created_at)} · expires {formatTimestamp(permission.expires_at)}
                    </p>
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
