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
  deleteAgent,
  getAgentWorkspace,
  getAgentResources,
  getAgentHealth,
  listACPRoutes,
  listLLMRoutes,
  listMCPRoutes,
  listVirtualKeys,
  type AgentResourceRef,
  type AgentWorkspace,
  type LLMRoute,
  type MCPRoute,
  type ACPRoute,
} from "@/lib/api";
import { AcpChat } from "@/components/acp-chat/acp-chat";
import { PendingPermissions } from "@/components/acp-pending-permissions";

const TABS = ["Overview", "Chat", "Resources", "Health", "Configuration"] as const;
type Tab = (typeof TABS)[number];

export default function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>("Overview");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const ws = useAdminSWR(["agent-ws", id], () => getAgentWorkspace(id), { live: true });
  const agent = ws.data?.agent;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await deleteAgent(id);
      showToast(`Agent deleted${res.unbound?.acp_service_id ? ` (service ${res.unbound.acp_service_id} left intact)` : ""}`, "success");
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
          <div className="flex flex-wrap gap-1 border-b border-slate-700/70">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  tab === t ? "border-blue-500 text-slate-100" : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "Overview" && <OverviewTab id={id} workspace={ws.data} loading={ws.isLoading && !ws.data} refresh={() => void ws.mutate()} />}
          {tab === "Chat" && <ChatTab workspace={ws.data} loading={ws.isLoading && !ws.data} />}
          {tab === "Resources" && <ResourcesTab id={id} />}
          {tab === "Health" && <HealthTab id={id} />}
          {tab === "Configuration" && <ConfigurationTab id={id} workspace={ws.data} />}
        </>
      )}

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
        title="Delete agent?"
        message={
          <span>
            This unbinds the agent. The backing ACP service and routes are <strong>left intact</strong> (non-cascading).
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

function OverviewTab({ id, workspace, loading, refresh }: { id: string; workspace: AgentWorkspace | undefined; loading: boolean; refresh: () => void }) {
  if (loading || !workspace) return <Card className="p-8 text-center text-sm text-slate-400">Loading workspace…</Card>;

  const svc = workspace.acp_service;
  const rv = workspace.runtime_view;
  const usage = workspace.usage;
  const isHttp = workspace.runtime !== "acp";

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Requests" value={num(usage?.request_count).toLocaleString()} />
        <StatCard label="Turns" value={num(usage?.turn_count).toLocaleString()} />
        <StatCard label="Success" value={num(usage?.success_count).toLocaleString()} tone="text-emerald-300" />
        <StatCard label="Failures" value={num(usage?.failure_count).toLocaleString()} tone={num(usage?.failure_count) > 0 ? "text-rose-300" : "text-slate-100"} />
        <StatCard label="Avg Latency" value={`${num(usage?.avg_latency_ms).toLocaleString()} ms`} />
      </StatGrid>

      {isHttp ? (
        <Card>
          <CardHeader><CardTitle>HTTP Runtime</CardTitle></CardHeader>
          <p className="text-xs text-slate-400">
            This agent owns its own process lifecycle. The gateway hands it tasks and observes results — there is no pooled instance, session, or permission flow to manage here.
          </p>
          <div className="mt-2">
            <KV label="Endpoint" value={workspace.agent.runtime.http?.endpoint} mono />
            <KV label="Auth ref" value={workspace.agent.runtime.http?.auth_ref} mono />
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Backing ACP Service</CardTitle></CardHeader>
            {svc ? (
              <div>
                <KV label="Service" value={<Link href="/dashboard/acp/services" className="text-blue-400 hover:underline">{svc.id}</Link>} />
                <KV label="Agent type" value={svc.agent_type} />
                <KV label="Permission mode" value={svc.permission_mode} />
                <KV label="Default cwd" value={svc.default_cwd ?? svc.cwd} mono />
                <KV label="Max instances" value={svc.max_instances} />
                <KV label="Allowed roots" value={svc.allowed_roots?.length ? svc.allowed_roots.join(", ") : "—"} mono />
                <p className="mt-2 text-[11px] text-slate-500">Policy is owned by the service — edit it on the ACP Services page.</p>
              </div>
            ) : (
              <p className="text-xs text-slate-500">Backing service unavailable.</p>
            )}
          </Card>

          <Card>
            <CardHeader><CardTitle>Live Runtime</CardTitle></CardHeader>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Pooled</p>
                <p className="text-lg font-semibold tabular-nums text-slate-100">{rv?.pooled_instances?.length ?? 0}</p>
              </div>
              <div className="rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">In-flight</p>
                <p className="text-lg font-semibold tabular-nums text-slate-100">{num(rv?.in_flight_turns)}</p>
              </div>
              <Link href="/dashboard/acp/runtime" className="rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2 transition-colors hover:border-amber-500/40">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Pending</p>
                <p className={`text-lg font-semibold tabular-nums ${(rv?.pending_permissions?.length ?? 0) > 0 ? "text-amber-300" : "text-slate-100"}`}>{rv?.pending_permissions?.length ?? 0}</p>
              </Link>
            </div>
            {(rv?.pending_permissions?.length ?? 0) > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-[11px] uppercase tracking-wide text-amber-400/80">Pending Permissions</p>
                <PendingPermissions pending={rv!.pending_permissions!} onResolved={refresh} />
              </div>
            )}
            {workspace.acp_routes && workspace.acp_routes.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">ACP Routes</p>
                <div className="flex flex-wrap gap-1.5">
                  {workspace.acp_routes.map((r) => (
                    <Badge key={r.id} tone="teal" mono>{r.path_prefix ?? r.id}</Badge>
                  ))}
                </div>
              </div>
            )}
            {workspace.links && (
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {workspace.links.admin_sessions && <Link href="/dashboard/acp/services" className="text-blue-400 hover:underline">Sessions →</Link>}
                {workspace.links.admin_runtime && <Link href="/dashboard/acp/runtime" className="text-blue-400 hover:underline">Runtime →</Link>}
              </div>
            )}
          </Card>
        </div>
      )}
      <p className="text-[11px] text-slate-600">Workspace is a summary/index — full session content is fetched on demand from the linked endpoints, never aggregated here. Agent: {id}</p>
    </div>
  );
}

// ── Chat ────────────────────────────────────────────────────────────────────

function ChatTab({ workspace, loading }: { workspace: AgentWorkspace | undefined; loading: boolean }) {
  const serviceId = workspace?.acp_service?.id ?? "";
  const isAcp = workspace?.runtime === "acp";

  // The workspace's acp_routes are a thin index; fetch the full routes to get
  // auth_policy/service_id, then scope to this agent's backing service.
  const { data: routes, isLoading: loadingRoutes } = useAdminSWR(
    isAcp && serviceId ? ["agent-acp-routes", serviceId] : null,
    () => listACPRoutes(),
    {},
  );
  const scopedRoutes = useMemo(
    () => (routes ?? []).filter((r) => !r.disabled && r.service_id === serviceId),
    [routes, serviceId],
  );

  if (loading || !workspace) return <Card className="p-8 text-center text-sm text-slate-400">Loading workspace…</Card>;
  if (!isAcp) {
    return (
      <Card className="p-8 text-center text-sm text-slate-500">
        Interactive chat is only available for ACP-runtime agents. This agent owns its own process lifecycle and is driven
        by the gateway, not by a data-plane turn endpoint.
      </Card>
    );
  }

  return <AcpChat routes={scopedRoutes} loadingRoutes={loadingRoutes && !routes} />;
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
function indexRoutes(llm: LLMRoute[], mcp: MCPRoute[], acp: ACPRoute[]): Map<string, RouteTarget> {
  const m = new Map<string, RouteTarget>();
  for (const r of llm) {
    const provs = routeProviders(r);
    m.set(r.id, { kind: "llm", target: provs.length ? provs.join(", ") : "no provider target", disabled: r.disabled });
  }
  for (const r of mcp) m.set(r.id, { kind: "mcp", target: r.service_id || "no service", disabled: r.disabled });
  for (const r of acp) m.set(r.id, { kind: "acp", target: r.service_id || "no service", disabled: r.disabled });
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
  const acp = useAdminSWR("reach-acp-routes", listACPRoutes);

  const routeIndex = useMemo(
    () => indexRoutes(llm.data ?? [], mcp.data ?? [], acp.data ?? []),
    [llm.data, mcp.data, acp.data],
  );
  const allRouteIds = useMemo(() => [...routeIndex.keys()], [routeIndex]);
  const ready = !!(vks.data && llm.data && mcp.data && acp.data);

  if (!keyRefs || keyRefs.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Reachability</CardTitle></CardHeader>
        <p className="text-xs text-slate-500">
          This agent holds no virtual keys, so it has no key-gated outbound reach. Inbound exposure (how callers reach this
          agent) is listed under ACP Routes below.
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
          <ResourceGroup title="ACP Routes" refs={r?.acp_routes} />
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
        {agent.runtime.acp && <KV label="ACP service" value={agent.runtime.acp.service_id} mono />}
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
