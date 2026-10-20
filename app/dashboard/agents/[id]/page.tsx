"use client";

import { isCommonAgentRoute, supportsAgentChat } from "@/lib/agent-http";

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
import { num, errorRate, pct, rollupUsage } from "@/lib/metrics-util";
import { agentYamlFragment } from "@/lib/agent-yaml";
import {
  ApiError,
  cancelAgentRun,
  deleteAgent,
  getAgentWorkspace,
  getAgentResources,
  getAgentHealth,
  getInteractionsSummary,
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
import { useI18n } from "@/components/i18n-provider";

const TABS = ["Overview", "Chat", "Runs", "Resources", "Health", "Configuration"] as const;
type Tab = (typeof TABS)[number];

/**
 * Tab visibility is capability-driven, not runtime.type-driven: the backend's
 * capabilities object is authoritative about what an agent actually supports, so
 * a builtin agent that streams turns gets a Chat tab and an ACP agent whose
 * backend is down does not (docs/plans/archive/gateway-v0.5-alignment-plan.md D4).
 */
function visibleTabs(capabilities: AgentCapabilities | undefined): Tab[] {
  const chattable = supportsAgentChat(capabilities);
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
  const { t } = useI18n();
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
      showToast(t("agentDetail.deleted"), "success");
      router.push("/dashboard/agents");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : t("agentDetail.deleteFailed"), "error");
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
            {agent?.disabled && <Badge tone="neutral">{t("common.disabled")}</Badge>}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/dashboard/agents" className="text-blue-400 hover:underline">{t("agentDetail.back")}</Link>
            <span className="font-mono text-xs text-slate-500">{id}</span>
          </span>
        }
        actions={
          <>
            <AutoRefreshControl lastUpdated={ws.lastUpdated} onRefresh={() => void ws.mutate()} refreshing={ws.isValidating} />
            <Link href={`/dashboard/agents/usage?agent=${encodeURIComponent(id)}`}><Button variant="secondary" className="px-2.5 py-1 text-xs">{t("nav.usage")}</Button></Link>
            <Link href={`/dashboard/agents/interactions?agent=${encodeURIComponent(id)}`}><Button variant="secondary" className="px-2.5 py-1 text-xs">{t("nav.interactions")}</Button></Link>
            <Link href={`/dashboard/agents/${encodeURIComponent(id)}/edit`}><Button variant="secondary" className="px-2.5 py-1 text-xs">{t("common.edit")}</Button></Link>
            <Button variant="danger" className="px-2.5 py-1 text-xs" onClick={() => setConfirmDelete(true)}>{t("common.delete")}</Button>
          </>
        }
      />

      {ws.error && !ws.data ? (
        <Card className="p-8 text-center text-sm text-rose-300">{ws.error instanceof Error ? ws.error.message : t("agentDetail.loadFailed")}</Card>
      ) : (
        <>
          {ws.data?.capabilities?.executable === false && !agent?.disabled && (
            <div className="rounded-lg border-2 border-rose-500/70 bg-rose-500/10 p-4 shadow-[0_0_24px_rgba(244,63,94,0.12)]" role="alert">
              <p className="text-sm font-semibold text-rose-200">{t("agentDetail.notExecutableTitle")}</p>
              <p className="mt-1 text-xs leading-5 text-rose-300/90">
                {t("agentDetail.notExecutableBody")}
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-1 border-b border-slate-700/70">
            {tabs.map((tabItem) => (
              <button
                key={tabItem}
                type="button"
                onClick={() => setTab(tabItem)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === tabItem ? "border-blue-500 text-slate-100" : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                {tabItem === "Overview" ? t("agentDetail.tabOverview")
                  : tabItem === "Chat" ? t("agentDetail.tabChat")
                    : tabItem === "Runs" ? t("agentDetail.tabRuns")
                      : tabItem === "Resources" ? t("agentDetail.tabResources")
                        : tabItem === "Health" ? t("agentDetail.tabHealth")
                          : t("agentDetail.tabConfiguration")}
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
        title={t("agentDetail.deleteTitle")}
        message={
          <span>
            {t("agentDetail.deleteMessage")}
            {deleting && ` ${t("common.deleting")}`}
          </span>
        }
        confirmLabel={t("common.delete")}
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
  const { locale, t } = useI18n();
  // The workspace payload is a summary/index and carries no usage rollup, so the
  // top-line traffic is read from the interactions store instead. Three pins
  // matter here:
  //  - route_kind=agent keeps this to *ingress* (turns against the agent's own
  //    routes), not the LLM/MCP calls the agent makes downstream, which are
  //    attributed to the same agent and would double-count it.
  //  - route_protocol=agent excludes admin control-plane spans (run cancel,
  //    permission resolve, thread close) — those are recorded against the agent
  //    id too, so without the pin the counter climbs from managing the agent.
  //  - the interactions store unions every runtime table, so this is correct for
  //    builtin agents as well; /metrics/acp/* alone would read empty for them.
  const traffic = useAdminSWR(
    ["agent-ingress-24h", id],
    () =>
      getInteractionsSummary({
        from: new Date(Date.now() - 86400_000).toISOString(),
        group_by: "runtime_type",
        route_kind: "agent",
        route_protocol: "agent",
        agent_id: id,
        limit: 50,
      }),
    { live: true },
  );
  const totals = useMemo(() => rollupUsage(traffic.data?.items ?? []), [traffic.data]);
  // A failed metrics read must not render as zero traffic: "0 requests" and "we
  // could not ask" are opposite diagnoses on an agent that looks idle.
  const trafficUnknown = !!traffic.error;
  const trafficLoading = traffic.isLoading && !traffic.data;
  const stat = (n: number) => (trafficUnknown ? "—" : n.toLocaleString(locale));

  if (loading || !workspace) return <Card className="p-8 text-center text-sm text-slate-400">{t("agentDetail.loadingWorkspace")}</Card>;

  const rv = workspace.runtime_view;
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
        <StatCard label={t("usage.requests")} value={stat(totals.requests)} sub={t("agentDetail.ingress24h")} loading={trafficLoading} />
        <StatCard label={t("usage.success")} value={stat(totals.success)} tone="text-emerald-300" loading={trafficLoading} />
        <StatCard label={t("agentDetail.failures")} value={stat(totals.failure)} tone={totals.failure > 0 && !trafficUnknown ? "text-rose-300" : "text-slate-100"} loading={trafficLoading} />
        <StatCard
          label={t("usage.errorRate")}
          value={trafficUnknown ? "—" : pct(errorRate(totals.success, totals.failure))}
          tone={totals.failure > 0 && !trafficUnknown ? "text-amber-300" : "text-slate-100"}
          loading={trafficLoading}
        />
        <StatCard label={t("usage.avgLatency")} value={trafficUnknown ? "—" : `${totals.avgLatency.toLocaleString(locale)} ms`} loading={trafficLoading} />
      </StatGrid>
      {trafficUnknown ? (
        <p className="text-[11px] text-amber-400/90">
          {t("agentDetail.metricsUnavailable", { detail: traffic.error instanceof Error ? traffic.error.message : t("agentDetail.gatewayNoAnswer") })}
        </p>
      ) : (
        <p className="text-[11px] text-slate-600">
          {t("agentDetail.trafficHelpBefore")} {" "}
          <Link href={`/dashboard/agents/usage?agent=${encodeURIComponent(id)}`} className="text-blue-400 hover:underline">{t("nav.usage")}</Link> {t("agentDetail.trafficHelpAfter")}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("agentDetail.runtime")}</CardTitle></CardHeader>
          <KV label={t("agentDetail.type")} value={runtimeType} />
          <KV
            label={t("agentDetail.state")}
            value={
              summary ? (
                <Badge tone={runtimeStateTone(summary.state)}>{summary.state}</Badge>
              ) : (
                "—"
              )
            }
          />
          <KV label={t("agentDetail.executable")} value={summary ? (summary.executable ? t("agentDetail.yes") : t("agentDetail.no")) : "—"} />
          <KV label={t("agentDetail.activeRuns")} value={num(summary?.active_runs)} />
          <KV label={t("agentDetail.sessions")} value={num(summary?.session_count)} />
          <KV
            label={t("agentDetail.lastActivity")}
            value={summary?.last_activity_at ? new Date(summary.last_activity_at).toLocaleString(locale) : "—"}
          />

          {runtimeType === "acp" && acp && (
            <div className="mt-3 border-t border-slate-700/50 pt-2">
              <KV label={t("agentDetail.agentType")} value={acp.agent_type} />
              <KV label={t("agentDetail.permissionMode")} value={acp.permission_mode} />
              <KV label={t("agentDetail.workingDirectory")} value={acp.cwd} mono />
              <KV label={t("agentDetail.allowedRoots")} value={acp.allowed_roots?.length ? acp.allowed_roots.join(", ") : "—"} mono />
              <KV label={t("agentDetail.defaultModel")} value={acp.default_model} mono />
              <KV label={t("agentDetail.maxInstances")} value={acp.max_instances} />
            </div>
          )}

          {runtimeType === "builtin" && builtin && (
            <div className="mt-3 border-t border-slate-700/50 pt-2">
              <KV label={t("agentDetail.topology")} value={builtin.definition.topology_kind} />
              <KV
                label={t("agentDetail.llmRoute")}
                value={
                  <Link href="/dashboard/llm/routes" className="text-blue-400 hover:underline">
                    {builtin.definition.llm_route_id}
                  </Link>
                }
              />
              <KV label={t("agentDetail.model")} value={builtin.definition.model} mono />
              <KV
                label={t("agentDetail.toolServices")}
                value={builtin.definition.tool_service_ids?.length ? builtin.definition.tool_service_ids.join(", ") : "—"}
                mono
              />
              <KV label={t("agentDetail.maxConcurrentTurns")} value={builtin.definition.max_concurrent_turns} />
              <KV label={t("agentDetail.turnTimeout")} value={builtin.definition.turn_timeout_seconds ? `${builtin.definition.turn_timeout_seconds}s` : "—"} />
              <KV label={t("agentDetail.summarization")} value={builtin.definition.summarization_enabled ? t("common.enabledTitle") : t("common.disabledTitle")} />
            </div>
          )}

          {runtimeType === "http" && (
            <div className="mt-3 border-t border-slate-700/50 pt-2">
              <KV label={t("agentDetail.agentCardUrl")} value={workspace.agent.runtime.http?.card_url} mono />
              <KV label={t("agentDetail.protocol")} value={workspace.agent.runtime.http?.protocol} />
              <KV label={t("agentDetail.timeout")} value={workspace.agent.runtime.http?.timeout_seconds ? `${workspace.agent.runtime.http.timeout_seconds}s` : t("agentDetail.defaultTimeout")} />
              <KV label={t("agentDetail.authRef")} value={workspace.agent.runtime.http?.auth_ref} mono />
              <p className="mt-2 text-[11px] leading-4 text-slate-500">
                {t("agentDetail.httpHelp")}
              </p>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader><CardTitle>{t("agentDetail.liveRuntime")}</CardTitle></CardHeader>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">{hasPool ? t("agentDetail.pooled") : t("agentDetail.runs")}</p>
              <p className="text-lg font-semibold tabular-nums text-slate-100">
                {hasPool ? rv?.pooled_instances?.length ?? 0 : num(summary?.active_runs)}
              </p>
            </div>
            <div className="rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">{t("agentDetail.inFlight")}</p>
              <p className="text-lg font-semibold tabular-nums text-slate-100">
                {hasPool ? num(rv?.in_flight_turns) : num(summary?.active_runs)}
              </p>
            </div>
            <Link
              href={hasPool ? "/dashboard/acp/runtime" : "/dashboard/agents/routes"}
              className="rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2 transition-colors hover:border-amber-500/40"
            >
              <p className="text-[11px] uppercase tracking-wide text-slate-500">{t("agentDetail.pending")}</p>
              <p className={`text-lg font-semibold tabular-nums ${pendingCount(rv, summary) > 0 ? "text-amber-300" : "text-slate-100"}`}>
                {pendingCount(rv, summary)}
              </p>
            </Link>
          </div>
          {(rv?.pending_permissions?.length ?? 0) > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 text-[11px] uppercase tracking-wide text-amber-400/80">{t("agentDetail.pendingPermissions")}</p>
              <PendingPermissions
                pending={rv!.pending_permissions!.map(normalizeACPPoolPermission)}
                onResolved={refresh}
              />
            </div>
          )}
          {workspace.agent_routes && workspace.agent_routes.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">{t("agentDetail.agentRoutes")}</p>
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
              {t("agentDetail.noIngressBefore")} {" "}
              <Link href="/dashboard/agents/routes" className="text-blue-400 hover:underline">{t("agentDetail.createOne")}</Link>
            </p>
          )}
        </Card>
      </div>
      <p className="text-[11px] text-slate-600">{t("agentDetail.workspaceHelp", { id })}</p>
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

function formatRunTime(value: string | undefined, locale: string): string {
  if (!value || value.startsWith("0001-01-01")) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale);
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
  const { locale, t } = useI18n();
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
      showToast(t("agentDetail.cancelRequested", { mode }), "success");
      await runs.mutate();
      onChanged();
    } catch (err) {
      const message = err instanceof ApiError
        ? err.errorType ? `${err.message} (${err.errorType})` : err.message
        : t("agentDetail.cancelFailed");
      showToast(message, "error");
    } finally {
      setCancelling(null);
      setPendingCancel(null);
    }
  };

  if (runs.error && !runs.data) {
    return <Card className="p-8 text-center text-sm text-rose-300">{runs.error instanceof Error ? runs.error.message : t("agentDetail.loadRunsFailed")}</Card>;
  }
  if (runs.isLoading && !runs.data) {
    return <Card className="p-8 text-center text-sm text-slate-400">{t("agentDetail.loadingRuns")}</Card>;
  }

  const items = runs.data ?? [];
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>{t("agentDetail.runs")}</CardTitle>
              <p className="mt-1 text-xs text-slate-500">{t("agentDetail.runsDescription")}</p>
            </div>
            <AutoRefreshControl
              lastUpdated={runs.lastUpdated}
              onRefresh={() => void runs.mutate()}
              refreshing={runs.isValidating}
            />
          </div>
        </CardHeader>

        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">{t("agentDetail.noRuns")}</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-[minmax(180px,1fr)_110px_minmax(140px,0.8fr)_170px_minmax(210px,auto)] border-b border-slate-700/70 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                <span>{t("agentDetail.run")}</span><span>{t("agentDetail.status")}</span><span>{t("agentDetail.session")}</span><span>{t("agentDetail.started")}</span><span className="text-right">{t("common.actions")}</span>
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
                        {run.runtime_type}{run.stop_reason ? ` · ${run.stop_reason}` : run.state !== "running" && run.finished_at ? ` · ${t("agentDetail.ended", { time: formatRunTime(run.finished_at, locale) })}` : ""}
                      </p>
                    </div>
                    <div><Badge tone={runStateTone(run.state)}>{run.state}</Badge></div>
                    <span className="truncate font-mono text-xs text-slate-400" title={run.session_id}>{run.session_id ?? "—"}</span>
                    <span className="text-xs text-slate-400">{formatRunTime(run.started_at, locale)}</span>
                    <div className="flex justify-end gap-1.5">
                      <Button
                        variant="secondary"
                        className="px-2.5 py-1 text-xs"
                        disabled={!isRunning || !supportsGraceful || busy}
                        title={!supportsGraceful ? t("agentDetail.gracefulUnsupported") : undefined}
                        onClick={() => setPendingCancel({ run, mode: "graceful" })}
                      >
                        {t("agentDetail.graceful")}
                      </Button>
                      <Button
                        variant="danger"
                        className="px-2.5 py-1 text-xs"
                        disabled={!isRunning || !supportsForce || busy}
                        title={!supportsForce ? t("agentDetail.forceUnsupported") : undefined}
                        onClick={() => setPendingCancel({ run, mode: "force" })}
                      >
                        {busy ? t("agentDetail.cancelling") : t("agentDetail.force")}
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
        {t("agentDetail.cancelHelp")}
      </p>

      <ConfirmDialog
        isOpen={!!pendingCancel}
        onClose={() => setPendingCancel(null)}
        onConfirm={() => void handleCancel()}
        title={pendingCancel?.mode === "force" ? t("agentDetail.forceCancelTitle") : t("agentDetail.gracefulCancelTitle")}
        message={
          <span>
            {t("agentDetail.cancelMessage", { id: pendingCancel?.run.run_id ?? "", mode: pendingCancel?.mode ?? "" })}
          </span>
        }
        confirmLabel={pendingCancel?.mode === "force" ? t("agentDetail.forceCancel") : t("agentDetail.cancelRun")}
        variant={pendingCancel?.mode === "force" ? "danger" : "warning"}
      />
    </div>
  );
}

// ── Chat ────────────────────────────────────────────────────────────────────

function ChatTab({ workspace, loading }: { workspace: AgentWorkspace | undefined; loading: boolean }) {
  const { t } = useI18n();
  const agentId = workspace?.agent.id ?? "";
  const capabilities = workspace?.capabilities;
  // Chat is available whenever the backend can stream a turn — ACP and builtin
  // both can, so this must not be gated on runtime.type.
  const chattable = supportsAgentChat(capabilities);

  // Fetch every agent route and scope to the ones targeting this agent; the
  // workspace's agent_routes list is a thin index without auth_policy.
  const { data: routes, isLoading: loadingRoutes } = useAdminSWR(
    chattable && agentId ? ["agent-routes", agentId] : null,
    () => listAgentRoutes(),
    {},
  );
  const scopedRoutes = useMemo(
    () => (routes ?? []).filter((r) => !r.disabled && r.agent_id === agentId && isCommonAgentRoute(r.protocol)),
    [routes, agentId],
  );

  if (loading || !workspace) return <Card className="p-8 text-center text-sm text-slate-400">{t("agentDetail.loadingWorkspace")}</Card>;
  if (!chattable) {
    return (
      <Card className="p-8 text-center text-sm text-slate-500">
        {t("agentDetail.noStreaming")}
        {capabilities?.executable === false && t("agentDetail.backendNotExecutable")}
      </Card>
    );
  }
  if (!loadingRoutes && scopedRoutes.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-slate-500">
        {t("agentDetail.noChatRoute")} {" "}
        <Link href="/dashboard/agents/routes" className="text-blue-400 hover:underline">{t("agentDetail.createOne")}</Link>
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
  const { t } = useI18n();
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
        <CardHeader><CardTitle>{t("agentDetail.reachability")}</CardTitle></CardHeader>
        <p className="text-xs text-slate-500">
          {t("agentDetail.noKeysReachability")}
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>{t("agentDetail.reachability")}</CardTitle></CardHeader>
      <p className="mb-3 text-[11px] text-slate-500">
        {t("agentDetail.reachabilityHelp")}
      </p>
      {!ready ? (
        <p className="text-xs text-slate-400">{t("agentDetail.resolving")}</p>
      ) : (
        <div className="space-y-3">
          {keyRefs.map((ref) => {
            const k = (vks.data ?? []).find((x) => x.id === ref.id);
            if (!k) {
              return (
                <div key={ref.id} className="flex items-center justify-between gap-2 rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-2">
                  <span className="font-mono text-xs text-slate-200">{ref.id}</span>
                  <Badge tone="red">{t("agentDetail.dangling")}</Badge>
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
                    {k.disabled && <Badge tone="neutral">{t("common.disabled")}</Badge>}
                    <Badge tone={allowsAll ? "amber" : "neutral"}>{allowsAll ? t("agentDetail.allRoutes") : t("agentDetail.routeCount", { count: routeIds.length })}</Badge>
                  </div>
                </div>
                {routeIds.length === 0 ? (
                  <p className="pl-3 text-[11px] text-slate-500">{t("agentDetail.noReachableRoutes")}</p>
                ) : (
                  <div className="space-y-1">
                    {routeIds.map((rid) => {
                      const targetRoute = routeIndex.get(rid);
                      return (
                        <div key={rid} className="flex items-center gap-2 pl-3 text-xs">
                          <span className="text-slate-600">→</span>
                          <span className="truncate font-mono text-slate-300">{rid}</span>
                          {targetRoute ? (
                            <>
                              <Badge tone={protocolTone(targetRoute.kind)}>{targetRoute.kind}</Badge>
                              {targetRoute.disabled && <Badge tone="neutral">{t("common.disabled")}</Badge>}
                              <span className="ml-auto truncate font-mono text-[11px] text-slate-500">→ {targetRoute.target}</span>
                            </>
                          ) : (
                            <Badge tone="red">{t("agentDetail.dangling")}</Badge>
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
  const { t } = useI18n();
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
              {r.disabled && <Badge tone="neutral">{t("common.disabled")}</Badge>}
              {!r.exists && <Badge tone="red">{t("agentDetail.dangling")}</Badge>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ResourcesTab({ id }: { id: string }) {
  const { t } = useI18n();
  const { data, error, isLoading } = useAdminSWR(["agent-resources", id], () => getAgentResources(id));
  if (error) return <Card className="p-8 text-center text-sm text-rose-300">{error instanceof Error ? error.message : t("agentDetail.resourcesLoadFailed")}</Card>;
  if (isLoading && !data) return <Card className="p-8 text-center text-sm text-slate-400">{t("agentDetail.loadingResources")}</Card>;
  const r = data?.resolved;
  const empty = !r || Object.values(r).every((v) => !v || v.length === 0);
  return (
    <div className="space-y-4">
      {empty ? (
        <Card className="p-8 text-center text-sm text-slate-500">{t("agentDetail.noResources")}</Card>
      ) : (
        <>
          <AgentReachability keyRefs={r?.virtual_keys} />
          <ResourceGroup title={t("agentDetail.providers")} refs={r?.providers} />
          <ResourceGroup title={t("agentDetail.mcpServices")} refs={r?.mcp_services} />
          <ResourceGroup title={t("agentDetail.virtualKeys")} refs={r?.virtual_keys} />
          <ResourceGroup title={t("agentDetail.llmRoutes")} refs={r?.llm_routes} />
          <ResourceGroup title={t("agentDetail.mcpRoutes")} refs={r?.mcp_routes} />
        </>
      )}
      <p className="text-[11px] text-slate-600">
        {t("agentDetail.resourcesHelp")}
      </p>
    </div>
  );
}

// ── Health ──────────────────────────────────────────────────────────────────

function HealthTab({ id }: { id: string }) {
  const { t } = useI18n();
  const { data, error, isLoading } = useAdminSWR(["agent-health", id], () => getAgentHealth(id), { live: true });
  if (error) return <Card className="p-8 text-center text-sm text-rose-300">{error instanceof Error ? error.message : t("agentDetail.healthLoadFailed")}</Card>;
  if (isLoading && !data) return <Card className="p-8 text-center text-sm text-slate-400">{t("agentDetail.loadingHealth")}</Card>;
  if (!data) return null;
  const rate = errorRate(data.recent_window - data.recent_failures, data.recent_failures);
  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label={t("agentDetail.status")} value={data.disabled ? t("common.disabledTitle") : t("common.enabledTitle")} tone={data.disabled ? "text-slate-400" : "text-emerald-300"} />
        <StatCard label={t("agentDetail.pooled")} value={data.pooled_instances} />
        <StatCard label={t("agentDetail.inFlight")} value={data.in_flight_turns} />
        <StatCard label={t("agentDetail.pendingPerms")} value={data.pending_permissions} tone={data.pending_permissions > 0 ? "text-amber-300" : "text-slate-100"} />
        <StatCard label={t("agentDetail.recentErrors")} value={`${data.recent_failures} / ${data.recent_window}`} sub={pct(rate)} tone={data.recent_failures > 0 ? "text-amber-300" : "text-slate-100"} />
      </StatGrid>
      {data.pipeline && (
        <Card>
          <CardHeader><CardTitle>{t("agentDetail.metricsPipeline")}</CardTitle></CardHeader>
          <KV label={t("agentDetail.droppedEvents")} value={num(data.pipeline.dropped_events)} />
          <KV label={t("agentDetail.writeFailures")} value={num(data.pipeline.write_failures)} />
        </Card>
      )}
      <p className="text-[11px] text-slate-600">
        {t("agentDetail.healthHelp")}
      </p>
    </div>
  );
}

// ── Configuration ───────────────────────────────────────────────────────────

function ConfigurationTab({ id, workspace }: { id: string; workspace: AgentWorkspace | undefined }) {
  const { showToast } = useToast();
  const { locale, t } = useI18n();
  const [copied, setCopied] = useState(false);
  const agent = workspace?.agent;
  if (!agent) return <Card className="p-8 text-center text-sm text-slate-400">{t("agentDetail.loadingConfiguration")}</Card>;
  const yaml = agentYamlFragment(agent);

  const copyYaml = async () => {
    try {
      await navigator.clipboard.writeText(yaml);
      setCopied(true);
      showToast(t("agentDetail.yamlCopied"), "success");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast(t("agentDetail.yamlCopyFailed"), "error");
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>{t("agentDetail.identity")}</CardTitle></CardHeader>
        <KV label="ID" value={agent.id} mono />
        <KV label={t("common.name")} value={agent.name} />
        <KV label={t("common.description")} value={agent.description} />
        <KV label={t("agentDetail.source")} value={agent.source} />
        <KV label={t("common.created")} value={agent.created_at ? new Date(agent.created_at).toLocaleString(locale) : "—"} />
        <KV label={t("agentDetail.updated")} value={agent.updated_at ? new Date(agent.updated_at).toLocaleString(locale) : "—"} />
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("agentDetail.runtimePolicy")}</CardTitle></CardHeader>
        <KV label={t("agentDetail.runtimeType")} value={agent.runtime.type} />
        {agent.runtime.acp && (
          <>
            <KV label={t("agentDetail.acpAgentType")} value={agent.runtime.acp.agent_type} />
            <KV label={t("agentDetail.workingDirectory")} value={agent.runtime.acp.cwd} mono />
          </>
        )}
        {agent.runtime.builtin && (
          <>
            <KV label={t("agentDetail.builtinTopology")} value={agent.runtime.builtin.topology?.kind} />
            <KV label={t("agentDetail.builtinLlmRoute")} value={agent.runtime.builtin.model?.llm_route_id} mono />
          </>
        )}
        {agent.runtime.http && <KV label={t("agentDetail.agentCardUrl")} value={agent.runtime.http.card_url} mono />}
        <KV label={t("agentDetail.maxAgentDepth")} value={agent.policy.max_agent_depth} />
        <KV label={t("agentDetail.maxTurnsDay")} value={agent.policy.budget?.max_turns_per_day} />
        <KV label={t("agentDetail.maxTokensDay")} value={agent.policy.budget?.max_tokens_per_day} />
      </Card>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{t("agentDetail.yaml")}</CardTitle>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {t("agentDetail.yamlHelp")}
              </p>
            </div>
            <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => void copyYaml()}>
              {copied ? t("agentDetail.copied") : t("agentDetail.copyYaml")}
            </Button>
          </div>
        </CardHeader>
        <pre
          className="max-h-[32rem] overflow-auto rounded-md border border-slate-700/70 bg-slate-950/70 p-4 font-mono text-[11px] leading-5 text-slate-300"
          aria-label={t("agentDetail.yamlAria")}
          tabIndex={0}
        >
          {yaml}
        </pre>
        <p className="mt-2 text-[11px] leading-4 text-slate-600">
          {t("agentDetail.yamlFootnote")}
        </p>
      </Card>
      <div className="flex justify-end">
        <Link href={`/dashboard/agents/${encodeURIComponent(id)}/edit`}><Button className="px-3 py-1.5 text-xs">{t("agentDetail.editConfiguration")}</Button></Link>
      </div>
    </div>
  );
}
