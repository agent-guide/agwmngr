"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { Badge, protocolTone } from "@/components/ui/badge";
import { AutoRefreshControl } from "@/components/ui/auto-refresh-control";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { useAdminSWR } from "@/hooks/use-admin-swr";
import { num, errorRate, pct } from "@/lib/metrics-util";
import {
  ApiError,
  cancelAgentRun,
  deleteAgent,
  getAgentWorkspace,
  getAgentResources,
  getAgentHealth,
  listAgentRoutes,
  listLLMRoutes,
  listMCPRoutes,
  listAgentRuns,
  listVirtualKeys,
  type AgentCancelMode,
  type AgentCapabilities,
  type AgentResourceRef,
  type AgentRoute,
  type AgentRunInfo,
  type AgentWorkspace,
  type LLMRoute,
  type MCPRoute,
} from "@/lib/api";
import { AcpChat } from "@/components/acp-chat/acp-chat";
import { PendingPermissions, normalizeACPPoolPermission } from "@/components/acp-pending-permissions";

const TABS = ["Overview", "Chat", "Runs", "Resources", "Health", "Configuration"] as const;
type Tab = (typeof TABS)[number];

/**
 * Tab visibility is capability-driven, not runtime.type-driven: the backend's
 * capabilities object is authoritative about what an agent actually supports, so
 * a builtin agent that streams turns gets a Chat tab and an ACP agent whose
 * backend is down does not (docs/v0.5-alignment-plan.md D4).
 */
function visibleTabs(capabilities: AgentCapabilities | undefined): Tab[] {
  const chattable = capabilities ? capabilities.executable && capabilities.turn?.streaming !== false : false;
  const cancellable = !!(capabilities?.cancellation?.force || capabilities?.cancellation?.graceful);
  return TABS.filter((t) => {
    if (t === "Chat") return chattable;
    if (t === "Runs") return cancellable;
    return true;
  });
}

export default function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>("Overview");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const ws = useAdminSWR(["agent-ws", id], () => getAgentWorkspace(id), { live: true });
  const agent = ws.data?.agent;
  const tabs = visibleTabs(ws.data?.capabilities);
  // The selected tab can vanish once capabilities arrive (e.g. Chat on a
  // non-executable runtime), so fall back rather than render a blank panel.
  const activeTab = tabs.includes(tab) ? tab : "Overview";

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteAgent(id);
      showToast("Agent deleted", "success");
      router.push("/dashboard/agents");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to delete agent", "error");
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {agent?.name ?? id}
            {agent && <Badge tone={protocolTone(agent.runtime.type)}>{agent.runtime.type}</Badge>}
            {agent?.disabled && <Badge tone="neutral">disabled</Badge>}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/dashboard/agents" className="text-blue-400 hover:underline">← Agents</Link>
            <span className="font-mono text-xs text-slate-500">{id}</span>
          </span>
        }
        actions={
          <>
            <AutoRefreshControl lastUpdated={ws.lastUpdated} onRefresh={() => void ws.mutate()} refreshing={ws.isValidating} />
            <Link href={`/dashboard/agents/usage?agent=${encodeURIComponent(id)}`}><Button variant="secondary" className="px-2.5 py-1 text-xs">Usage</Button></Link>
            <Link href={`/dashboard/agents/interactions?agent=${encodeURIComponent(id)}`}><Button variant="secondary" className="px-2.5 py-1 text-xs">Interactions</Button></Link>
            <Link href={`/dashboard/agents/${encodeURIComponent(id)}/edit`}><Button variant="secondary" className="px-2.5 py-1 text-xs">Edit</Button></Link>
            <Button variant="danger" className="px-2.5 py-1 text-xs" onClick={() => setConfirmDelete(true)}>Delete</Button>
          </>
        }
      />

      {ws.error && !ws.data ? (
        <Card className="p-8 text-center text-sm text-rose-300">{ws.error instanceof Error ? ws.error.message : "Failed to load agent"}</Card>
      ) : (
        <>
          {ws.data?.capabilities?.executable === false && !agent?.disabled && (
            <div className="rounded-lg border-2 border-rose-500/70 bg-rose-500/10 p-4 shadow-[0_0_24px_rgba(244,63,94,0.12)]" role="alert">
              <p className="text-sm font-semibold text-rose-200">This Agent runtime is not executable</p>
              <p className="mt-1 text-xs leading-5 text-rose-300/90">
                The Agent and its ingress route are valid and may accept VirtualKey assignment, but the runtime backend is inactive. Calls to POST /turn return 501 runtime_not_executable. Do not troubleshoot route matching or authentication for this state.
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-1 border-b border-slate-700/70">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === t ? "border-blue-500 text-slate-100" : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {activeTab === "Overview" && <OverviewTab id={id} workspace={ws.data} loading={ws.isLoading && !ws.data} refresh={() => void ws.mutate()} />}
          {activeTab === "Chat" && <ChatTab workspace={ws.data} loading={ws.isLoading && !ws.data} />}
          {activeTab === "Runs" && (
            <RunsTab
              id={id}
              capabilities={ws.data?.capabilities}
              onChanged={() => void ws.mutate()}
            />
          )}
          {activeTab === "Resources" && <ResourcesTab id={id} />}
          {activeTab === "Health" && <HealthTab id={id} />}
          {activeTab === "Configuration" && <ConfigurationTab id={id} workspace={ws.data} />}
        </>
      )}

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
        title="Delete agent?"
        message={
          <span>
            Deleting drains this agent&apos;s pending permissions and cancels its in-flight runs. The gateway
            <strong> refuses with 409</strong> while any agent route still targets it — delete those routes first.
            {deleting && " Deleting…"}
          </span>
        }
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────

function KV({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-xs text-slate-500">{label}</span>
      <span className={`min-w-0 truncate text-right text-xs text-slate-200 ${mono ? "font-mono" : ""}`}>{value ?? "—"}</span>
    </div>
  );
}

function runtimeStateTone(state: string): "green" | "amber" | "red" | "neutral" {
  if (state === "ready") return "green";
  if (state === "starting" || state === "degraded") return "amber";
  if (state === "unhealthy" || state === "not_executable") return "red";
  return "neutral";
}

/**
 * Pending permissions come from the ACP pool for ACP agents and from the
 * runtime-neutral summary for everything else; prefer whichever is populated.
 */
function pendingCount(
  rv: AgentWorkspace["runtime_view"],
  summary: AgentWorkspace["runtime"],
): number {
  return rv?.pending_permissions?.length ?? summary?.pending_permissions ?? 0;
}

function OverviewTab({ id, workspace, loading, refresh }: { id: string; workspace: AgentWorkspace | undefined; loading: boolean; refresh: () => void }) {
  if (loading || !workspace) return <Card className="p-8 text-center text-sm text-slate-400">Loading workspace…</Card>;

  const rv = workspace.runtime_view;
  const usage = workspace.usage;
  const runtimeType = workspace.runtime_type;
  const summary = workspace.runtime;
  const acp = workspace.agent.runtime.acp;
  const builtin = workspace.builtin;
  // ACP is the only runtime with a native process pool to inspect; the others
  // report through the runtime-neutral summary alone.
  const hasPool = runtimeType === "acp";

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Requests" value={num(usage?.request_count).toLocaleString()} />
        <StatCard label="Turns" value={num(usage?.turn_count).toLocaleString()} />
        <StatCard label="Success" value={num(usage?.success_count).toLocaleString()} tone="text-emerald-300" />
        <StatCard label="Failures" value={num(usage?.failure_count).toLocaleString()} tone={num(usage?.failure_count) > 0 ? "text-rose-300" : "text-slate-100"} />
        <StatCard label="Avg Latency" value={`${num(usage?.avg_latency_ms).toLocaleString()} ms`} />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Runtime</CardTitle></CardHeader>
          <KV label="Type" value={runtimeType} />
          <KV
            label="State"
            value={
              summary ? (
                <Badge tone={runtimeStateTone(summary.state)}>{summary.state}</Badge>
              ) : (
                "—"
              )
            }
          />
          <KV label="Executable" value={summary ? (summary.executable ? "Yes" : "No") : "—"} />
          <KV label="Active runs" value={num(summary?.active_runs)} />
          <KV label="Sessions" value={num(summary?.session_count)} />
          <KV
            label="Last activity"
            value={summary?.last_activity_at ? new Date(summary.last_activity_at).toLocaleString() : "—"}
          />

          {runtimeType === "acp" && acp && (
            <div className="mt-3 border-t border-slate-700/50 pt-2">
              <KV label="Agent type" value={acp.agent_type} />
              <KV label="Permission mode" value={acp.permission_mode} />
              <KV label="Working directory" value={acp.cwd} mono />
              <KV label="Allowed roots" value={acp.allowed_roots?.length ? acp.allowed_roots.join(", ") : "—"} mono />
              <KV label="Default model" value={acp.default_model} mono />
              <KV label="Max instances" value={acp.max_instances} />
            </div>
          )}

          {runtimeType === "builtin" && builtin && (
            <div className="mt-3 border-t border-slate-700/50 pt-2">
              <KV label="Topology" value={builtin.definition.topology_kind} />
              <KV
                label="LLM route"
                value={
                  <Link href="/dashboard/llm/routes" className="text-blue-400 hover:underline">
                    {builtin.definition.llm_route_id}
                  </Link>
                }
              />
              <KV label="Model" value={builtin.definition.model} mono />
              <KV
                label="Tool services"
                value={builtin.definition.tool_service_ids?.length ? builtin.definition.tool_service_ids.join(", ") : "—"}
                mono
              />
              <KV label="Max concurrent turns" value={builtin.definition.max_concurrent_turns} />
              <KV label="Turn timeout" value={builtin.definition.turn_timeout_seconds ? `${builtin.definition.turn_timeout_seconds}s` : "—"} />
              <KV label="Summarization" value={builtin.definition.summarization_enabled ? "Enabled" : "Disabled"} />
            </div>
          )}

          {runtimeType === "http" && (
            <div className="mt-3 border-t border-slate-700/50 pt-2">
              <KV label="Endpoint" value={workspace.agent.runtime.http?.endpoint} mono />
              <KV label="Auth ref" value={workspace.agent.runtime.http?.auth_ref} mono />
              <p className="mt-2 text-[11px] leading-4 text-slate-500">
                This agent owns its own process lifecycle. The HTTP execution backend does not ship in v0.5.0, so
                there is no pooled instance, session, or permission flow here and a turn returns
                501 runtime_not_executable.
              </p>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader><CardTitle>Live Runtime</CardTitle></CardHeader>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">{hasPool ? "Pooled" : "Runs"}</p>
              <p className="text-lg font-semibold tabular-nums text-slate-100">
                {hasPool ? rv?.pooled_instances?.length ?? 0 : num(summary?.active_runs)}
              </p>
            </div>
            <div className="rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">In-flight</p>
              <p className="text-lg font-semibold tabular-nums text-slate-100">
                {hasPool ? num(rv?.in_flight_turns) : num(summary?.active_runs)}
              </p>
            </div>
            <Link
              href={hasPool ? "/dashboard/acp/runtime" : "/dashboard/agents/routes"}
              className="rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2 transition-colors hover:border-amber-500/40"
            >
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Pending</p>
              <p className={`text-lg font-semibold tabular-nums ${pendingCount(rv, summary) > 0 ? "text-amber-300" : "text-slate-100"}`}>
                {pendingCount(rv, summary)}
              </p>
            </Link>
          </div>
          {(rv?.pending_permissions?.length ?? 0) > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 text-[11px] uppercase tracking-wide text-amber-400/80">Pending Permissions</p>
              <PendingPermissions
                pending={rv!.pending_permissions!.map(normalizeACPPoolPermission)}
                onResolved={refresh}
              />
            </div>
          )}
          {workspace.agent_routes && workspace.agent_routes.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Agent Routes</p>
              <div className="flex flex-wrap gap-1.5">
                {workspace.agent_routes.map((r) => (
                  <Link key={r.id} href="/dashboard/agents/routes">
                    <Badge tone="teal" mono>{r.path_prefix ?? r.id}</Badge>
                  </Link>
                ))}
              </div>
            </div>
          )}
          {!workspace.agent_routes?.length && (
            <p className="mt-3 text-[11px] text-amber-400/90">
              No ingress route targets this agent yet, so nothing can call it.{" "}
              <Link href="/dashboard/agents/routes" className="text-blue-400 hover:underline">Create one →</Link>
            </p>
          )}
        </Card>
      </div>
      <p className="text-[11px] text-slate-600">Workspace is a summary/index — full session content is fetched on demand from the linked endpoints, never aggregated here. Agent: {id}</p>
    </div>
  );
}

// ── Runs ────────────────────────────────────────────────────────────────────

function runStateTone(state: AgentRunInfo["state"]): "green" | "amber" | "red" | "neutral" {
  if (state === "completed") return "green";
  if (state === "running") return "amber";
  if (state === "failed") return "red";
  return "neutral";
}

function formatRunTime(value?: string): string {
  if (!value || value.startsWith("0001-01-01")) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function RunsTab({
  id,
  capabilities,
  onChanged,
}: {
  id: string;
  capabilities: AgentCapabilities | undefined;
  onChanged: () => void;
}) {
  const { showToast } = useToast();
  const runs = useAdminSWR(["agent-runs", id], () => listAgentRuns(id), { live: true });
  const [pendingCancel, setPendingCancel] = useState<{ run: AgentRunInfo; mode: AgentCancelMode } | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const supportsForce = !!capabilities?.cancellation?.force;
  const supportsGraceful = !!capabilities?.cancellation?.graceful;

  const handleCancel = async () => {
    if (!pendingCancel) return;
    const { run, mode } = pendingCancel;
    setCancelling(run.run_id);
    try {
      await cancelAgentRun(id, run.run_id, mode);
      showToast(`Run cancellation requested (${mode})`, "success");
      await runs.mutate();
      onChanged();
    } catch (err) {
      const message = err instanceof ApiError
        ? err.errorType ? `${err.message} (${err.errorType})` : err.message
        : "Failed to cancel run";
      showToast(message, "error");
    } finally {
      setCancelling(null);
      setPendingCancel(null);
    }
  };

  if (runs.error && !runs.data) {
    return <Card className="p-8 text-center text-sm text-rose-300">{runs.error instanceof Error ? runs.error.message : "Failed to load runs"}</Card>;
  }
  if (runs.isLoading && !runs.data) {
    return <Card className="p-8 text-center text-sm text-slate-400">Loading runs…</Card>;
  }

  const items = runs.data ?? [];
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Runs</CardTitle>
              <p className="mt-1 text-xs text-slate-500">Live and recently completed executions reported by this agent runtime.</p>
            </div>
            <AutoRefreshControl
              lastUpdated={runs.lastUpdated}
              onRefresh={() => void runs.mutate()}
              refreshing={runs.isValidating}
            />
          </div>
        </CardHeader>

        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No runs reported.</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-[minmax(180px,1fr)_110px_minmax(140px,0.8fr)_170px_minmax(210px,auto)] border-b border-slate-700/70 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                <span>Run</span><span>Status</span><span>Session</span><span>Started</span><span className="text-right">Actions</span>
              </div>
              {items.map((run) => {
                const isRunning = run.state === "running";
                const busy = cancelling === run.run_id;
                return (
                  <div
                    key={run.run_id}
                    className="grid grid-cols-[minmax(180px,1fr)_110px_minmax(140px,0.8fr)_170px_minmax(210px,auto)] items-center border-b border-slate-700/50 px-3 py-2.5 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs text-slate-200" title={run.run_id}>{run.run_id}</p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">
                        {run.runtime_type}{run.stop_reason ? ` · ${run.stop_reason}` : run.state !== "running" && run.finished_at ? ` · ended ${formatRunTime(run.finished_at)}` : ""}
                      </p>
                    </div>
                    <div><Badge tone={runStateTone(run.state)}>{run.state}</Badge></div>
                    <span className="truncate font-mono text-xs text-slate-400" title={run.session_id}>{run.session_id ?? "—"}</span>
                    <span className="text-xs text-slate-400">{formatRunTime(run.started_at)}</span>
                    <div className="flex justify-end gap-1.5">
                      <Button
                        variant="secondary"
                        className="px-2.5 py-1 text-xs"
                        disabled={!isRunning || !supportsGraceful || busy}
                        title={!supportsGraceful ? "Graceful cancellation is not supported by this runtime" : undefined}
                        onClick={() => setPendingCancel({ run, mode: "graceful" })}
                      >
                        Graceful
                      </Button>
                      <Button
                        variant="danger"
                        className="px-2.5 py-1 text-xs"
                        disabled={!isRunning || !supportsForce || busy}
                        title={!supportsForce ? "Force cancellation is not supported by this runtime" : undefined}
                        onClick={() => setPendingCancel({ run, mode: "force" })}
                      >
                        {busy ? "Cancelling…" : "Force"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      <p className="text-[11px] text-slate-600">
        Graceful cancellation asks the runtime to stop cleanly; force cancellation terminates the run immediately. Unsupported modes stay disabled according to the agent&apos;s advertised capabilities.
      </p>

      <ConfirmDialog
        isOpen={!!pendingCancel}
        onClose={() => setPendingCancel(null)}
        onConfirm={() => void handleCancel()}
        title={`${pendingCancel?.mode === "force" ? "Force cancel" : "Gracefully cancel"} run?`}
        message={
          <span>
            Run <span className="font-mono">{pendingCancel?.run.run_id}</span> will receive a {pendingCancel?.mode} cancellation request.
          </span>
        }
        confirmLabel={pendingCancel?.mode === "force" ? "Force cancel" : "Cancel run"}
        variant={pendingCancel?.mode === "force" ? "danger" : "warning"}
      />
    </div>
  );
}

// ── Chat ────────────────────────────────────────────────────────────────────

function ChatTab({ workspace, loading }: { workspace: AgentWorkspace | undefined; loading: boolean }) {
  const agentId = workspace?.agent.id ?? "";
  const capabilities = workspace?.capabilities;
  // Chat is available whenever the backend can stream a turn — ACP and builtin
  // both can, so this must not be gated on runtime.type.
  const chattable = !!capabilities?.executable && capabilities.turn?.streaming !== false;

  // Fetch every agent route and scope to the ones targeting this agent; the
  // workspace's agent_routes list is a thin index without auth_policy.
  const { data: routes, isLoading: loadingRoutes } = useAdminSWR(
    chattable && agentId ? ["agent-routes", agentId] : null,
    () => listAgentRoutes(),
    {},
  );
  const scopedRoutes = useMemo(
    () => (routes ?? []).filter((r) => !r.disabled && r.agent_id === agentId),
    [routes, agentId],
  );

  if (loading || !workspace) return <Card className="p-8 text-center text-sm text-slate-400">Loading workspace…</Card>;
  if (!chattable) {
    return (
      <Card className="p-8 text-center text-sm text-slate-500">
        This agent&apos;s runtime does not advertise streaming turns, so there is nothing to drive interactively.
        {capabilities?.executable === false && " Its runtime backend reports as not executable."}
      </Card>
    );
  }
  if (!loadingRoutes && scopedRoutes.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-slate-500">
        No enabled agent route targets this agent, so there is no data-plane path to chat over.{" "}
        <Link href="/dashboard/agents/routes" className="text-blue-400 hover:underline">Create one →</Link>
      </Card>
    );
  }

  // The runtime decides how a turn must be shaped (only ACP takes a thread id /
  // cwd) and the capabilities decide which session affordances exist, so both
  // are handed down rather than re-derived inside the chat surface.
  return (
    <AcpChat
      routes={scopedRoutes}
      loadingRoutes={loadingRoutes && !routes}
      runtimeType={workspace.runtime_type || workspace.agent.runtime.type}
      capabilities={capabilities}
    />
  );
}

// ── Resources ────────────────────────────────────────────────────────────--

/** Extract the provider ids an LLM route can target (direct + per-model). */
function routeProviders(route: LLMRoute): string[] {
  const set = new Set<string>();
  const tp = route.target_policy;
  if (tp?.provider_id) set.add(tp.provider_id);
  if (tp?.provider_target?.provider_id) set.add(tp.provider_target.provider_id);
  for (const mt of tp?.model_targets ?? []) {
    for (const candidate of mt.candidates ?? []) {
      if (candidate.provider_id) set.add(candidate.provider_id);
    }
  }
  return [...set];
}

type RouteTarget = { kind: string; target: string; disabled: boolean };

/** Index every route id → its protocol + downstream target, for reachability resolution. */
function indexRoutes(llm: LLMRoute[], mcp: MCPRoute[], agentRoutes: AgentRoute[]): Map<string, RouteTarget> {
  const m = new Map<string, RouteTarget>();
  for (const r of llm) {
    const provs = routeProviders(r);
    m.set(r.id, { kind: "llm", target: provs.length ? provs.join(", ") : "no provider target", disabled: r.disabled });
  }
  for (const r of mcp) m.set(r.id, { kind: "mcp", target: r.service_id || "no service", disabled: r.disabled });
  // An agent route resolves to an agent, not a protocol service.
  for (const r of agentRoutes) m.set(r.id, { kind: "agent", target: r.agent_id || "no agent", disabled: r.disabled });
  return m;
}

/**
 * Agent-centric reachability: what this agent can reach through the virtual keys
 * it holds. Chain is Agent → Virtual Key → permitted route → target resource. A
 * key with no allowlist permits every route; an unresolvable id is dangling.
 */
function AgentReachability({ keyRefs }: { keyRefs?: AgentResourceRef[] }) {
  const vks = useAdminSWR("reach-vks", listVirtualKeys);
  const llm = useAdminSWR("reach-llm-routes", listLLMRoutes);
  const mcp = useAdminSWR("reach-mcp-routes", listMCPRoutes);
  const agentRoutes = useAdminSWR("reach-agent-routes", listAgentRoutes);

  const routeIndex = useMemo(
    () => indexRoutes(llm.data ?? [], mcp.data ?? [], agentRoutes.data ?? []),
    [llm.data, mcp.data, agentRoutes.data],
  );
  const allRouteIds = useMemo(() => [...routeIndex.keys()], [routeIndex]);
  const ready = !!(vks.data && llm.data && mcp.data && agentRoutes.data);

  if (!keyRefs || keyRefs.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Reachability</CardTitle></CardHeader>
        <p className="text-xs text-slate-500">
          This agent holds no virtual keys, so it has no key-gated outbound reach. Inbound exposure (how callers reach
          this agent) is configured on the Agent Routes page.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>Reachability</CardTitle></CardHeader>
      <p className="mb-3 text-[11px] text-slate-500">
        What this agent can reach through the virtual keys it holds: key → permitted route → target resource.
      </p>
      {!ready ? (
        <p className="text-xs text-slate-400">Resolving…</p>
      ) : (
        <div className="space-y-3">
          {keyRefs.map((ref) => {
            const k = (vks.data ?? []).find((x) => x.id === ref.id);
            if (!k) {
              return (
                <div key={ref.id} className="flex items-center justify-between gap-2 rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-2">
                  <span className="font-mono text-xs text-slate-200">{ref.id}</span>
                  <Badge tone="red">dangling</Badge>
                </div>
              );
            }
            const allowsAll = !k.allowed_route_ids || k.allowed_route_ids.length === 0;
            const routeIds = allowsAll ? allRouteIds : k.allowed_route_ids ?? [];
            return (
              <div key={ref.id} className="rounded-md border border-slate-700/60 bg-slate-900/40 p-2.5">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs text-slate-200">{k.id}</span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {k.disabled && <Badge tone="neutral">disabled</Badge>}
                    <Badge tone={allowsAll ? "amber" : "neutral"}>{allowsAll ? "all routes" : `${routeIds.length} routes`}</Badge>
                  </div>
                </div>
                {routeIds.length === 0 ? (
                  <p className="pl-3 text-[11px] text-slate-500">No routes reachable.</p>
                ) : (
                  <div className="space-y-1">
                    {routeIds.map((rid) => {
                      const t = routeIndex.get(rid);
                      return (
                        <div key={rid} className="flex items-center gap-2 pl-3 text-xs">
                          <span className="text-slate-600">→</span>
                          <span className="truncate font-mono text-slate-300">{rid}</span>
                          {t ? (
                            <>
                              <Badge tone={protocolTone(t.kind)}>{t.kind}</Badge>
                              {t.disabled && <Badge tone="neutral">disabled</Badge>}
                              <span className="ml-auto truncate font-mono text-[11px] text-slate-500">→ {t.target}</span>
                            </>
                          ) : (
                            <Badge tone="red">dangling</Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function ResourceGroup({ title, refs }: { title: string; refs?: AgentResourceRef[] }) {
  if (!refs || refs.length === 0) return null;
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <div className="space-y-1.5">
        {refs.map((r) => (
          <div key={r.id} className={`flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 ${r.exists ? "border-slate-700/60 bg-slate-900/40" : "border-rose-500/40 bg-rose-500/5"}`}>
            <div className="min-w-0">
              <span className="font-mono text-xs text-slate-200">{r.id}</span>
              {r.detail && <span className="ml-2 text-[11px] text-slate-500">{r.detail}</span>}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {r.kind && <Badge tone={protocolTone(r.kind)}>{r.kind}</Badge>}
              {r.disabled && <Badge tone="neutral">disabled</Badge>}
              {!r.exists && <Badge tone="red">dangling</Badge>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ResourcesTab({ id }: { id: string }) {
  const { data, error, isLoading } = useAdminSWR(["agent-resources", id], () => getAgentResources(id));
  if (error) return <Card className="p-8 text-center text-sm text-rose-300">{error instanceof Error ? error.message : "Failed to load resources"}</Card>;
  if (isLoading && !data) return <Card className="p-8 text-center text-sm text-slate-400">Loading resources…</Card>;
  const r = data?.resolved;
  const empty = !r || Object.values(r).every((v) => !v || v.length === 0);
  return (
    <div className="space-y-4">
      {empty ? (
        <Card className="p-8 text-center text-sm text-slate-500">No resources bound to this agent.</Card>
      ) : (
        <>
          <AgentReachability keyRefs={r?.virtual_keys} />
          <ResourceGroup title="Providers" refs={r?.providers} />
          <ResourceGroup title="MCP Services" refs={r?.mcp_services} />
          <ResourceGroup title="Virtual Keys" refs={r?.virtual_keys} />
          <ResourceGroup title="LLM Routes" refs={r?.llm_routes} />
          <ResourceGroup title="MCP Routes" refs={r?.mcp_routes} />
        </>
      )}
      <p className="text-[11px] text-slate-600">
        Resources are a management view of what the agent is allowed to use — the data plane is still gated by virtual-key + route policy, not by this list.
      </p>
    </div>
  );
}

// ── Health ──────────────────────────────────────────────────────────────────

function HealthTab({ id }: { id: string }) {
  const { data, error, isLoading } = useAdminSWR(["agent-health", id], () => getAgentHealth(id), { live: true });
  if (error) return <Card className="p-8 text-center text-sm text-rose-300">{error instanceof Error ? error.message : "Failed to load health"}</Card>;
  if (isLoading && !data) return <Card className="p-8 text-center text-sm text-slate-400">Loading health…</Card>;
  if (!data) return null;
  const rate = errorRate(data.recent_window - data.recent_failures, data.recent_failures);
  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Status" value={data.disabled ? "Disabled" : "Enabled"} tone={data.disabled ? "text-slate-400" : "text-emerald-300"} />
        <StatCard label="Pooled" value={data.pooled_instances} />
        <StatCard label="In-flight" value={data.in_flight_turns} />
        <StatCard label="Pending Perms" value={data.pending_permissions} tone={data.pending_permissions > 0 ? "text-amber-300" : "text-slate-100"} />
        <StatCard label="Recent Errors" value={`${data.recent_failures} / ${data.recent_window}`} sub={pct(rate)} tone={data.recent_failures > 0 ? "text-amber-300" : "text-slate-100"} />
      </StatGrid>
      {data.pipeline && (
        <Card>
          <CardHeader><CardTitle>Metrics Pipeline</CardTitle></CardHeader>
          <KV label="Dropped events" value={num(data.pipeline.dropped_events)} />
          <KV label="Write failures" value={num(data.pipeline.write_failures)} />
        </Card>
      )}
      <p className="text-[11px] text-slate-600">
        Shallow health only. Deep checks (upstream reachability, circuit-break, credential expiry) are not yet exposed by the gateway.
      </p>
    </div>
  );
}

// ── Configuration ───────────────────────────────────────────────────────────

function ConfigurationTab({ id, workspace }: { id: string; workspace: AgentWorkspace | undefined }) {
  const agent = workspace?.agent;
  if (!agent) return <Card className="p-8 text-center text-sm text-slate-400">Loading configuration…</Card>;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Identity</CardTitle></CardHeader>
        <KV label="ID" value={agent.id} mono />
        <KV label="Name" value={agent.name} />
        <KV label="Description" value={agent.description} />
        <KV label="Source" value={agent.source} />
        <KV label="Created" value={agent.created_at ? new Date(agent.created_at).toLocaleString() : "—"} />
        <KV label="Updated" value={agent.updated_at ? new Date(agent.updated_at).toLocaleString() : "—"} />
      </Card>
      <Card>
        <CardHeader><CardTitle>Runtime &amp; Policy</CardTitle></CardHeader>
        <KV label="Runtime type" value={agent.runtime.type} />
        {agent.runtime.acp && (
          <>
            <KV label="ACP agent type" value={agent.runtime.acp.agent_type} />
            <KV label="Working directory" value={agent.runtime.acp.cwd} mono />
          </>
        )}
        {agent.runtime.builtin && (
          <>
            <KV label="Builtin topology" value={agent.runtime.builtin.topology?.kind} />
            <KV label="Builtin LLM route" value={agent.runtime.builtin.model?.llm_route_id} mono />
          </>
        )}
        {agent.runtime.http && <KV label="HTTP endpoint" value={agent.runtime.http.endpoint} mono />}
        <KV label="Max agent depth" value={agent.policy.max_agent_depth} />
        <KV label="Max turns/day" value={agent.policy.budget?.max_turns_per_day} />
        <KV label="Max tokens/day" value={agent.policy.budget?.max_tokens_per_day} />
      </Card>
      <div className="flex justify-end">
        <Link href={`/dashboard/agents/${encodeURIComponent(id)}/edit`}><Button className="px-3 py-1.5 text-xs">Edit Configuration</Button></Link>
      </div>
    </div>
  );
}
