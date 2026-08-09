"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AutoRefreshControl } from "@/components/ui/auto-refresh-control";
import { Badge, protocolTone } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { Sparkline } from "@/components/ui/charts";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { useToast } from "@/components/ui/toast";
import { useCurrentUser } from "@/components/current-user-context";
import { groupTraces } from "@/components/interaction-traces";
import { useAdminSWR } from "@/hooks/use-admin-swr";
import { errorRate, num, pct, pivotTimeseries } from "@/lib/metrics-util";
import {
  ApiError,
  adminFetch,
  getACPRuntime,
  getACPTimeseries,
  getBuiltinRuntime,
  getInteractions,
  getLLMTimeseries,
  getMCPTimeseries,
  listAgentRoutes,
  listAgents,
  listLLMRoutes,
  listMCPRoutes,
  listMCPServices,
  listManagedModels,
  listProviders,
  listVirtualKeys,
  type Agent,
  type AgentRoute,
  type InteractionEvent,
  type MetricsQuery,
  type TimeseriesResponse,
} from "@/lib/api";

// ── Access-aware slices ─────────────────────────────────────────────────────
//
// The overview reads across the whole gateway, and RBAC denies a lot of it to a
// Member (no implicit content access) or to a non-platform-admin on Caddy. A
// rejected slice must NOT read the same as an empty one: "you cannot see this"
// and "there is nothing here" are different answers, and collapsing them makes
// the landing page report an empty gateway to anyone with a narrow role.

type SliceStatus = "ok" | "denied" | "error";
interface Slice<T> {
  value?: T;
  status: SliceStatus;
}

function slice<T>(r: PromiseSettledResult<T>): Slice<T> {
  if (r.status === "fulfilled") return { value: r.value, status: "ok" };
  const denied = r.reason instanceof ApiError && r.reason.status === 403;
  return { status: denied ? "denied" : "error" };
}

function unavailableLabel(status?: SliceStatus): string {
  return status === "denied" ? "no access" : "unavailable";
}

const ACP_RUNTIME_HREF = "/dashboard/acp/runtime";
const BUILTIN_RUNTIME_HREF = "/dashboard/agents/runtimes/builtin";

// ── Small presentational helpers ────────────────────────────────────────────

function Icon({ path, className }: { path: string; className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}
const P_COPY = "M8 4v12a2 2 0 002 2h8M16 4h2a2 2 0 012 2v12M8 4a2 2 0 00-2 2v0M8 4h6l4 4";
const P_CHECK = "M5 13l4 4L19 7";

function runtimeStateTone(state?: string): "green" | "amber" | "red" | "neutral" {
  if (state === "ready") return "green";
  if (state === "starting" || state === "degraded") return "amber";
  if (state === "unhealthy" || state === "not_executable") return "red";
  return "neutral";
}

function relTime(iso?: string): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

/** Collapse a grouped timeseries into totals + a sparkline series. */
function summarize(ts?: TimeseriesResponse): { requests: number; errRate: number; spark: { requests: number }[] } {
  const rows = pivotTimeseries(ts?.items ?? []);
  let requests = 0, success = 0, failure = 0;
  for (const r of rows) {
    requests += r.requests;
    success += r.success;
    failure += r.failure;
  }
  return { requests, errRate: errorRate(success, failure), spark: rows.map((r) => ({ requests: r.requests })) };
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const { user, activeGateway } = useCurrentUser();
  const { showToast } = useToast();
  const [snippetTab, setSnippetTab] = useState<"agent" | "cc" | "openai" | "anthropic" | "python">("agent");
  const [pathTab, setPathTab] = useState<"agent" | "llm">("agent");
  const [copied, setCopied] = useState(false);

  // Agents + their ingress routes: the primary objects this console manages.
  const fleet = useAdminSWR(
    "ov-fleet",
    async () => {
      const [agents, routes] = await Promise.allSettled([listAgents(), listAgentRoutes()]);
      return { agents: slice(agents), routes: slice(routes) };
    },
    { live: true },
  );

  // Shared infrastructure behind the agents. Static enough to skip live refresh.
  const infra = useAdminSWR("ov-infra", async () => {
    const [providers, models, llmRoutes, vkeys, mcpServices, mcpRoutes] = await Promise.allSettled([
      listProviders(),
      listManagedModels(),
      listLLMRoutes(),
      listVirtualKeys(),
      listMCPServices(),
      listMCPRoutes(),
    ]);
    return {
      providers: slice(providers),
      models: slice(models),
      llmRoutes: slice(llmRoutes),
      vkeys: slice(vkeys),
      mcpServices: slice(mcpServices),
      mcpRoutes: slice(mcpRoutes),
    };
  });

  // Both runtimes, not just ACP: a builtin agent's in-flight turns and suspended
  // tool permissions live in an entirely separate host-wide view, so reading only
  // /acp/runtime silently reports 0 pending for every builtin agent.
  const runtime = useAdminSWR(
    "ov-runtime",
    async () => {
      const [acp, builtin] = await Promise.allSettled([getACPRuntime(), getBuiltinRuntime()]);
      return { acp: slice(acp), builtin: slice(builtin) };
    },
    { live: true },
  );

  // Traffic across all three data planes. Agent ingress records route_kind=agent
  // / route_protocol=agent into the ACP metrics store, while the manager's own
  // /admin/acp polling records route_protocol=admin — pin both dimensions so the
  // admin audit spans cannot inflate the agent figure.
  const traffic = useAdminSWR(
    "ov-traffic",
    async () => {
      const base: MetricsQuery = {
        from: new Date(Date.now() - 86400_000).toISOString(),
        bucket: "1h",
        group_by: "route_id",
      };
      const [llm, mcp, agent] = await Promise.allSettled([
        getLLMTimeseries(base),
        getMCPTimeseries(base),
        getACPTimeseries({ ...base, route_kind: "agent", route_protocol: "agent" }),
      ]);
      return { llm: slice(llm), mcp: slice(mcp), agent: slice(agent) };
    },
    { live: true },
  );

  // Recent cross-protocol call chains — the orchestration capability, which had
  // no presence at all on the landing page.
  const recent = useAdminSWR(
    "ov-traces",
    async () => {
      const base: MetricsQuery = { limit: 40 };
      const results = await Promise.allSettled([
        getInteractions({ ...base, route_kind: "agent", route_protocol: "agent" }),
        getInteractions({ ...base, route_kind: "llm" }),
        getInteractions({ ...base, route_kind: "mcp" }),
      ]);
      const slices = results.map(slice);
      return {
        events: slices.flatMap((r) => r.value?.items ?? []) as InteractionEvent[],
        slices,
      };
    },
    { live: true },
  );

  // The public base URL is read off the Caddy servers, which are Platform Admin
  // only — asking as anyone else guarantees a 403, so do not ask.
  const caddy = useAdminSWR(user?.is_platform_admin ? "ov-caddy" : null, () =>
    adminFetch<{ items: { public_url?: string; routes?: unknown[] }[] }>("/admin/caddy/servers"),
  );

  const agents: Agent[] = useMemo(() => fleet.data?.agents.value ?? [], [fleet.data]);
  const agentRoutes: AgentRoute[] = useMemo(() => fleet.data?.routes.value ?? [], [fleet.data]);
  const agentsStatus = fleet.data?.agents.status;
  const routesStatus = fleet.data?.routes.status;

  // ── Connectivity vs. authorization ────────────────────────────────────────
  const access = useMemo(() => {
    const all: Slice<unknown>[] = [];
    if (fleet.data) all.push(fleet.data.agents, fleet.data.routes);
    if (infra.data) all.push(...Object.values(infra.data));
    if (runtime.data) all.push(runtime.data.acp, runtime.data.builtin);
    return {
      total: all.length,
      ok: all.filter((s) => s.status === "ok").length,
      denied: all.filter((s) => s.status === "denied").length,
      errored: all.filter((s) => s.status === "error").length,
    };
  }, [fleet.data, infra.data, runtime.data]);

  const status: "checking" | "online" | "restricted" | "unreachable" =
    access.total === 0 ? "checking"
    : access.ok > 0 ? "online"
    : access.errored === 0 ? "restricted"
    : "unreachable";
  // ── Agent fleet health ────────────────────────────────────────────────────
  const health = useMemo(() => {
    const routesAvailable = routesStatus === "ok";
    const agentsAvailable = agentsStatus === "ok";
    const byAgent = new Map<string, AgentRoute[]>();
    for (const r of routesAvailable ? agentRoutes : []) {
      byAgent.set(r.agent_id, [...(byAgent.get(r.agent_id) ?? []), r]);
    }
    const known = new Set(agents.map((a) => a.id));
    const danglingRoutes = agentsAvailable && routesAvailable
      ? agentRoutes.filter((r) => !known.has(r.agent_id))
      : [];

    const rows = agents.map((a) => {
      const st = a.runtime_status;
      const routes = byAgent.get(a.id) ?? [];
      const issues: string[] = [];
      let severity = 0;
      if (a.disabled) { issues.push("disabled"); severity = 2; }
      if (st && !st.executable) { issues.push("not executable"); severity = 2; }
      if (routesAvailable) {
        if (routes.length === 0) { issues.push("no ingress route"); severity = Math.max(severity, 2); }
        else if (routes.every((r) => r.disabled)) { issues.push("all routes disabled"); severity = Math.max(severity, 2); }
      }
      if (st?.state === "unhealthy") { issues.push("unhealthy"); severity = 2; }
      else if (st?.state === "degraded") { issues.push("degraded"); severity = Math.max(severity, 1); }
      if (num(st?.pending_permissions) > 0) { issues.push(`${st?.pending_permissions} pending permission(s)`); severity = Math.max(severity, 1); }
      return { agent: a, routes, issues, severity };
    });

    rows.sort((a, b) => {
      if (b.severity !== a.severity) return b.severity - a.severity;
      const at = new Date(a.agent.runtime_status?.last_activity_at ?? 0).getTime();
      const bt = new Date(b.agent.runtime_status?.last_activity_at ?? 0).getTime();
      return bt - at;
    });

    return {
      rows,
      ready: rows.filter((r) => r.agent.runtime_status?.state === "ready").length,
      attention: rows.filter((r) => r.severity > 0).length,
      activeRuns: agents.reduce((n, a) => n + num(a.runtime_status?.active_runs), 0),
      danglingRoutes,
    };
  }, [agents, agentRoutes, agentsStatus, routesStatus]);

  const acp = runtime.data?.acp.value;
  const builtin = runtime.data?.builtin.value;
  const acpPending = acp?.pending_permissions?.length ?? 0;
  const builtinPending = builtin?.pending_permissions?.length ?? 0;
  const runtimeComplete = runtime.data?.acp.status === "ok" && runtime.data?.builtin.status === "ok";
  const pending = runtimeComplete ? acpPending + builtinPending : null;
  // Route the click at the runtime that actually holds the request; the old
  // page always sent builtin permissions to the ACP pool page.
  const pendingHref = acpPending === 0 && builtinPending > 0 ? BUILTIN_RUNTIME_HREF : ACP_RUNTIME_HREF;
  const acpInflight = acp?.in_flight?.length ?? 0;
  const builtinInflight = builtin?.in_flight?.length ?? 0;
  const runtimeUnavailable = runtime.data?.acp.status === "denied" || runtime.data?.builtin.status === "denied"
    ? "no access"
    : "unavailable";

  const llmTraffic = summarize(traffic.data?.llm.value);
  const mcpTraffic = summarize(traffic.data?.mcp.value);
  const agentTraffic = summarize(traffic.data?.agent.value);

  const recentTraces = useMemo(() => groupTraces(recent.data?.events ?? []).slice(0, 6), [recent.data]);
  const recentFailed = recent.data?.slices.filter((s) => s.status !== "ok") ?? [];

  // ── Integration base URL + primary agent route ────────────────────────────
  const publicBase = useMemo(() => {
    const items = caddy.data?.items ?? [];
    const withUrl = items.filter((s) => s.public_url);
    // Prefer a data-plane server (one that has routes) over the admin server.
    const best = withUrl.find((s) => (s.routes?.length ?? 0) > 0) ?? withUrl[0];
    return best?.public_url?.replace(/\/$/, "") ?? null;
  }, [caddy.data]);
  const baseUrl = publicBase ?? "http://localhost:8080";

  const primaryRoute = agentsStatus === "ok" && routesStatus === "ok"
    ? agentRoutes.find((route) => {
        const target = agents.find((agent) => agent.id === route.agent_id);
        return !route.disabled && !!route.match_policy?.path_prefix && !!target && !target.disabled && target.runtime_status?.executable === true;
      })
    : undefined;
  const primaryAgent = agents.find((agent) => agent.id === primaryRoute?.agent_id);
  const prefix = (primaryRoute?.match_policy?.path_prefix ?? "/agents/my-agent").replace(/\/$/, "");
  // `options.runtime` is decoded by the SELECTED backend with DisallowUnknownFields:
  // ACP requires a non-empty thread_id, builtin rejects every key. So the snippet
  // has to branch instead of always emitting the ACP shape.
  const isACP = primaryAgent?.runtime?.type === "acp";
  const turnBody = isACP
    ? `{"input":"hello","options":{"version":"v1","runtime":{"thread_id":"demo-thread"}}}`
    : `{"input":"hello","options":{"version":"v1"}}`;

  const snippets: Record<typeof snippetTab, string> = {
    agent: `# Drive the agent${primaryAgent ? ` "${primaryAgent.id}"` : ""} over its ingress route (SSE stream)\ncurl -N ${baseUrl}${prefix}/turn \\\n  -H "Authorization: Bearer $AGW_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${turnBody}'`,
    cc: `# Drive Claude Code through the gateway\nexport ANTHROPIC_BASE_URL=${baseUrl}\nexport ANTHROPIC_AUTH_TOKEN=$AGW_API_KEY\nclaude`,
    openai: `curl ${baseUrl}/v1/chat/completions \\\n  -H "Authorization: Bearer $AGW_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"gpt-4.1","messages":[{"role":"user","content":"hello"}]}'`,
    anthropic: `curl ${baseUrl}/v1/messages \\\n  -H "x-api-key: $AGW_API_KEY" \\\n  -H "anthropic-version: 2023-06-01" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"claude-sonnet-4-6","max_tokens":1024,"messages":[{"role":"user","content":"hello"}]}'`,
    python: `from openai import OpenAI\n\nclient = OpenAI(\n    base_url="${baseUrl}/v1",\n    api_key="AGW_API_KEY",\n)\nresp = client.chat.completions.create(\n    model="gpt-4.1",\n    messages=[{"role": "user", "content": "hello"}],\n)\nprint(resp.choices[0].message.content)`,
  };
  const snippetTabs: { key: typeof snippetTab; label: string }[] = [
    { key: "agent", label: "Agent turn" },
    { key: "cc", label: "Claude Code" },
    { key: "openai", label: "OpenAI" },
    { key: "anthropic", label: "Anthropic" },
    { key: "python", label: "Python" },
  ];

  const copySnippet = () => {
    if (snippetTab === "agent" && !primaryRoute) return;
    void navigator.clipboard.writeText(snippets[snippetTab]).then(() => {
      setCopied(true);
      showToast("Snippet copied", "success");
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  // ── Get started: two paths, because the gateway serves both ───────────────
  const vkeys = infra.data?.vkeys.value ?? [];
  const providers = infra.data?.providers.value ?? [];
  const llmRoutes = infra.data?.llmRoutes.value ?? [];

  const agentSteps = [
    { known: agentsStatus === "ok", done: agents.length > 0, text: "Create an agent", hint: "Pick a runtime: pooled ACP process, in-process builtin, or HTTP.", href: "/dashboard/agents/new" },
    { known: routesStatus === "ok", done: agentRoutes.length > 0, text: "Expose an agent route", hint: "Bind a public path prefix to the agent.", href: "/dashboard/agents/routes" },
    { known: infra.data?.vkeys.status === "ok", done: vkeys.length > 0, text: "Issue a virtual key", hint: "Callers authenticate with it; scope it to the agent route.", href: "/dashboard/general/virtual-keys" },
    { known: traffic.data?.agent.status === "ok", done: agentTraffic.requests > 0, text: "Run a turn", hint: "Use the snippet on the right, or the agent's Chat tab.", href: primaryAgent ? `/dashboard/agents/${encodeURIComponent(primaryAgent.id)}` : "/dashboard/agents" },
  ];
  const llmSteps = [
    { known: infra.data?.providers.status === "ok", done: providers.length > 0, text: "Add an LLM provider", hint: "Connect OpenAI, Anthropic, or another backend.", href: "/dashboard/llm/providers" },
    { known: infra.data?.llmRoutes.status === "ok", done: llmRoutes.length > 0, text: "Create an LLM route", hint: "Map incoming requests to a provider or logical model.", href: "/dashboard/llm/routes" },
    { known: infra.data?.vkeys.status === "ok", done: vkeys.length > 0, text: "Issue a virtual key", hint: "Generate an auth token for callers.", href: "/dashboard/general/virtual-keys" },
    { known: traffic.data?.llm.status === "ok", done: llmTraffic.requests > 0, text: "Send your first request", hint: "Use an OpenAI/Anthropic-compatible snippet.", href: null as string | null },
  ];
  const steps = pathTab === "agent" ? agentSteps : llmSteps;
  const completed = steps.filter((s) => s.known && s.done).length;

  // ── Explore, grouped like the sidebar ─────────────────────────────────────
  const sections = [
    {
      title: "Workspace", items: [
        { label: "Agents", href: "/dashboard/agents", desc: "ACP / builtin / HTTP runtimes" },
        { label: "Agent Routes", href: "/dashboard/agents/routes", desc: "Public paths that reach an agent" },
        { label: "Interactions", href: "/dashboard/agents/interactions", desc: "Cross-protocol call chains" },
        { label: "Usage", href: "/dashboard/agents/usage", desc: "LLM / MCP / Agent metrics" },
        { label: "Virtual Keys", href: "/dashboard/general/virtual-keys", desc: "Caller auth tokens" },
      ],
    },
    {
      title: "LLM", items: [
        { label: "Providers", href: "/dashboard/llm/providers", desc: "Upstream LLM backends" },
        { label: "Models", href: "/dashboard/llm/models", desc: "Managed model catalog" },
        { label: "Routes", href: "/dashboard/llm/routes", desc: "Request routing rules" },
        { label: "Credentials", href: "/dashboard/llm/credentials", desc: "Shared upstream authentication" },
      ],
    },
    {
      title: "MCP", items: [
        { label: "Services", href: "/dashboard/mcp/services", desc: "MCP servers & tools" },
        { label: "Routes", href: "/dashboard/mcp/routes", desc: "Expose MCP over paths" },
      ],
    },
    {
      title: "Runtimes & Operations", items: [
        { label: "ACP Runtime", href: ACP_RUNTIME_HREF, desc: "Pooled process diagnostics" },
        { label: "Builtin Runtime", href: BUILTIN_RUNTIME_HREF, desc: "Host-wide materialization state" },
        ...(user?.is_platform_admin
          ? [
              { label: "Bundle", href: "/dashboard/configuration/bundle", desc: "Import / export gateway config" },
              { label: "Servers", href: "/dashboard/configuration/servers", desc: "HTTP listeners & TLS" },
            ]
          : []),
      ],
    },
  ];

  const statusPill =
    status === "online" ? { dot: "bg-emerald-400", text: "Gateway online", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" }
    : status === "restricted" ? { dot: "bg-amber-400", text: "Limited access", cls: "border-amber-500/30 bg-amber-500/10 text-amber-300" }
    : status === "unreachable" ? { dot: "bg-red-400", text: "Gateway unreachable", cls: "border-red-500/30 bg-red-500/10 text-red-300" }
    : { dot: "bg-slate-400 animate-pulse", text: "Checking…", cls: "border-slate-600/50 bg-slate-800/40 text-slate-300" };

  const refreshAll = () => {
    void fleet.mutate();
    void infra.mutate();
    void runtime.mutate();
    void traffic.mutate();
    void recent.mutate();
    if (user?.is_platform_admin) void caddy.mutate();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Overview"
        description={
          <>
            Operate agents on <span className="font-semibold text-slate-300">{activeGateway?.name ?? "this gateway"}</span> — every
            agent runs on one runtime backend, is reached through its own ingress route, and draws on the shared LLM and MCP
            infrastructure below.
          </>
        }
        actions={
          <>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${statusPill.cls}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${statusPill.dot}`} />
              {statusPill.text}
            </span>
            <AutoRefreshControl lastUpdated={fleet.lastUpdated} onRefresh={refreshAll} refreshing={fleet.isValidating} />
          </>
        }
      />

      {status === "unreachable" && (
        <Card className="border-red-500/30 bg-red-500/5">
          <p className="text-xs text-red-300">
            Could not reach the active gateway&apos;s Admin API. Connection details live in the manager database, not the
            environment — check the gateway is running, then re-test it under Platform → Gateways.
          </p>
        </Card>
      )}

      {status !== "unreachable" && access.denied > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <p className="text-xs text-amber-300">
            {access.ok > 0
              ? `Your role on this gateway hides ${access.denied} of ${access.total} sections; the figures below cover only what you may read.`
              : "Your role on this gateway grants no content access yet. Ask a platform admin for a Gateway Admin membership."}
          </p>
        </Card>
      )}

      {/* Agent fleet — the primary objects */}
      <StatGrid>
        <Link href="/dashboard/agents" className="block">
          <StatCard
            label="Agents"
            value={agentsStatus === "ok" ? agents.length : unavailableLabel(agentsStatus)}
            loading={fleet.isLoading}
            sub={agentsStatus === "ok" ? `${health.ready} ready · ${health.attention} need attention` : "agent inventory could not be read"}
            tone={health.attention > 0 ? "text-amber-300" : "text-slate-100"}
            className="transition-colors hover:border-blue-500/40"
          />
        </Link>
        <Link href="/dashboard/agents/routes" className="block">
          <StatCard
            label="Agent Routes"
            value={routesStatus === "ok" ? agentRoutes.length : unavailableLabel(routesStatus)}
            loading={fleet.isLoading}
            sub={routesStatus === "ok" ? (health.danglingRoutes.length > 0 ? `${health.danglingRoutes.length} dangling` : "public entry points") : "route inventory could not be read"}
            tone={health.danglingRoutes.length > 0 ? "text-rose-300" : "text-slate-100"}
            className="transition-colors hover:border-blue-500/40"
          />
        </Link>
        <StatCard
          label="Active Runs"
          value={agentsStatus === "ok" ? health.activeRuns : unavailableLabel(agentsStatus)}
          loading={fleet.isLoading}
          sub={runtimeComplete ? `acp ${acpInflight} · builtin ${builtinInflight} in-flight` : `runtime diagnostics ${runtimeUnavailable}`}
        />
        <Link href={pendingHref} className="block">
          <StatCard
            label="Pending Permissions"
            value={pending ?? runtimeUnavailable}
            loading={runtime.isLoading}
            sub={runtimeComplete ? `acp ${acpPending} · builtin ${builtinPending}` : "one or more runtime views could not be read"}
            tone={pending !== null && pending > 0 ? "text-amber-300" : "text-slate-100"}
            className="transition-colors hover:border-amber-500/40"
          />
        </Link>
      </StatGrid>

      {/* Traffic across all three data planes, last 24h */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <CardTitle>Traffic</CardTitle>
          <span className="text-xs text-slate-500">last 24h</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            { kind: "agent", label: "Agent", t: agentTraffic, slice: traffic.data?.agent, href: "/dashboard/agents/usage" },
            { kind: "llm", label: "LLM", t: llmTraffic, slice: traffic.data?.llm, href: "/dashboard/agents/usage" },
            { kind: "mcp", label: "MCP", t: mcpTraffic, slice: traffic.data?.mcp, href: "/dashboard/agents/usage" },
          ].map(({ kind, label, t, slice: trafficSlice, href }) => (
            <Link
              key={kind}
              href={href}
              className="rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2 transition-colors hover:border-blue-500/40 hover:bg-blue-500/5"
            >
              <div className="flex items-center justify-between">
                <Badge tone={protocolTone(kind)} className="uppercase">{label}</Badge>
                <span className={`text-xs tabular-nums ${trafficSlice?.status === "ok" && t.errRate > 0 ? "text-amber-300" : "text-slate-500"}`}>
                  {trafficSlice?.status === "ok" ? `${pct(t.errRate)} err` : "—"}
                </span>
              </div>
              <p className="mt-1 text-xl font-semibold tabular-nums text-slate-100">
                {traffic.isLoading ? "…" : trafficSlice?.status === "ok" ? t.requests.toLocaleString() : unavailableLabel(trafficSlice?.status)}
              </p>
              <div className="mt-1"><Sparkline data={trafficSlice?.status === "ok" ? t.spark : []} dataKey="requests" /></div>
            </Link>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Deep health (upstream reachability, circuit-break, credential expiry) is not exposed by the gateway yet.
        </p>
      </Card>

      {/* Agent fleet health */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <CardTitle>Agent Fleet</CardTitle>
          <Link href="/dashboard/agents" className="text-xs text-blue-300 hover:text-blue-200">
            {agentsStatus === "ok" ? `View all ${agents.length} →` : "Open Agents →"}
          </Link>
        </div>

        {health.danglingRoutes.length > 0 && (
          <p className="mb-2 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
            {health.danglingRoutes.length} agent route(s) target an agent that no longer exists:{" "}
            <span className="font-mono">{health.danglingRoutes.slice(0, 3).map((r) => r.agent_id).join(", ")}</span>
          </p>
        )}

        {health.rows.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-500">
            {agentsStatus === "denied"
              ? "You do not have access to this gateway's agents."
              : agentsStatus === "error"
                ? "Agent inventory is unavailable. Refresh to try again."
                : "No agents yet — create one to get started."}
          </p>
        ) : (
          <div className="space-y-1.5">
            {health.rows.slice(0, 6).map(({ agent, routes, issues }) => (
              <Link
                key={agent.id}
                href={`/dashboard/agents/${encodeURIComponent(agent.id)}`}
                className="flex flex-wrap items-center gap-2 rounded-md border border-slate-700/60 bg-slate-900/30 px-3 py-2 transition-colors hover:border-blue-500/40 hover:bg-blue-500/5"
              >
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-200">{agent.name || agent.id}</span>
                <Badge tone={protocolTone(agent.runtime?.type)} className="uppercase">{agent.runtime?.type ?? "?"}</Badge>
                <Badge tone={runtimeStateTone(agent.runtime_status?.state)}>{agent.runtime_status?.state ?? "unknown"}</Badge>
                {issues.length > 0 && <Badge tone="amber">{issues[0]}</Badge>}
                <span className="text-xs tabular-nums text-slate-500">
                  {routesStatus === "ok" ? `${routes.length} route${routes.length === 1 ? "" : "s"}` : `routes ${unavailableLabel(routesStatus)}`}
                </span>
                <span className="text-xs tabular-nums text-slate-500">{num(agent.runtime_status?.active_runs)} running</span>
                <span className="w-20 text-right text-xs text-slate-600">{relTime(agent.runtime_status?.last_activity_at)}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* Recent orchestration */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <CardTitle>Recent Activity</CardTitle>
          <Link href="/dashboard/agents/interactions" className="text-xs text-blue-300 hover:text-blue-200">All interactions →</Link>
        </div>
        {recent.isLoading ? (
          <p className="py-4 text-center text-xs text-slate-500">Loading recent activity…</p>
        ) : recentTraces.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-500">
            {recentFailed.length === 3
              ? recentFailed.every((s) => s.status === "denied") ? "You do not have access to interaction data." : "Recent activity is unavailable. Refresh to try again."
              : recentFailed.length > 0 ? "Some interaction data is unavailable; no activity was returned by the remaining sources." : "No data-plane traffic recorded yet."}
          </p>
        ) : (
          <div className="space-y-1.5">
            {recentFailed.length > 0 && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
                Showing partial activity; {recentFailed.length} of 3 protocol sources are unavailable.
              </p>
            )}
            {recentTraces.map((t) => (
              <Link
                key={t.traceId}
                href="/dashboard/agents/interactions"
                className="flex flex-wrap items-center gap-2 rounded-md border border-slate-700/60 bg-slate-900/30 px-3 py-2 transition-colors hover:border-blue-500/40 hover:bg-blue-500/5"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${t.ok ? "bg-emerald-400" : "bg-rose-400"}`} />
                <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{t.rootLabel}</span>
                {t.protocols.map((p) => (
                  <Badge key={p} tone={protocolTone(p)} className="uppercase">{p}</Badge>
                ))}
                <span className="text-xs tabular-nums text-slate-500">{t.spanCount} span{t.spanCount === 1 ? "" : "s"}</span>
                <span className="w-16 text-right text-xs tabular-nums text-slate-400">{fmtMs(t.duration)}</span>
                <span className="w-20 text-right text-xs text-slate-600" suppressHydrationWarning>
                  {new Date(t.startedAt).toLocaleTimeString()}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* Get started (two paths) + integration */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between gap-2">
            <CardTitle>Get Started</CardTitle>
            <span className="text-xs text-slate-500">{completed}/{steps.length} done</span>
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {([{ key: "agent", label: "Run an agent" }, { key: "llm", label: "Proxy an LLM" }] as const).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setPathTab(t.key)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  pathTab === t.key ? "bg-blue-600/20 text-blue-300" : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {steps.map((step, i) => {
              const inner = (
                <>
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    !step.known ? "bg-slate-700/50 text-slate-400" : step.done ? "bg-emerald-500/20 text-emerald-300" : "bg-blue-500/20 text-blue-300"
                  }`}>
                    {!step.known ? "—" : step.done ? <Icon path={P_CHECK} className="h-3 w-3" /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-xs font-medium ${step.known && step.done ? "text-slate-400 line-through" : "text-slate-200"}`}>{step.text}</span>
                    <span className="block text-xs text-slate-500">{step.known ? step.hint : "Status unavailable; refresh to try again."}</span>
                  </span>
                </>
              );
              const cls = "flex items-start gap-3 rounded-md border border-slate-700/50 bg-slate-900/30 p-3 transition-colors hover:border-slate-600/70 hover:bg-slate-800/40";
              return step.href ? (
                <Link key={i} href={step.href} className={cls}>{inner}</Link>
              ) : (
                <div key={i} className={cls}>{inner}</div>
              );
            })}
          </div>
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between gap-2">
            <CardTitle>Integration</CardTitle>
            <button
              type="button"
              onClick={copySnippet}
              disabled={snippetTab === "agent" && !primaryRoute}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-600/70 bg-slate-800/60 px-2.5 py-1 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-700/70 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-slate-800/60"
            >
              <Icon path={copied ? P_CHECK : P_COPY} className="h-3 w-3" />
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {snippetTabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setSnippetTab(t.key)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  snippetTab === t.key ? "bg-blue-600/20 text-blue-300" : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <pre className="overflow-auto rounded-md border border-slate-700/70 bg-slate-950/60 p-3 font-mono text-xs leading-relaxed text-slate-300">{snippets[snippetTab]}</pre>
          <p className="mt-2 text-xs text-slate-500">
            Base URL <span className="font-mono text-slate-400">{baseUrl}</span>
            {publicBase === null && <span className="text-slate-500"> (assumed — the public listener is only readable by a platform admin)</span>}
            {" · "}replace <span className="font-mono text-slate-400">$AGW_API_KEY</span> with a virtual key.
          </p>
          {snippetTab === "agent" && (
            <p className="mt-1 text-xs text-slate-500">
              <span className="font-mono">options.version</span> is required, and{" "}
              <span className="font-mono">options.runtime</span> is decoded by the selected backend: ACP requires a non-empty{" "}
              <span className="font-mono">thread_id</span>, builtin rejects every key.
              {!primaryRoute && " No enabled route targeting an executable agent is available — the path above is a placeholder and copying is disabled."}
            </p>
          )}
        </Card>
      </div>

      {/* Explore */}
      <Card>
        <CardTitle className="mb-3">Explore</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {sections.map((sec) => (
            <div key={sec.title}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{sec.title}</p>
              <div className="space-y-1.5">
                {sec.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="block rounded-md border border-slate-700/60 bg-slate-900/30 p-2.5 transition-colors hover:border-blue-500/40 hover:bg-blue-500/5"
                  >
                    <div className="text-xs font-semibold text-slate-200">{item.label}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{item.desc}</div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Shared infrastructure — secondary to the agents above */}
      <Card>
        <CardTitle className="mb-3">Shared Infrastructure</CardTitle>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Providers", value: providers.length, sub: "LLM backends", href: "/dashboard/llm/providers", status: infra.data?.providers.status },
            { label: "Models", value: (infra.data?.models.value ?? []).length, sub: "managed", href: "/dashboard/llm/models", status: infra.data?.models.status },
            { label: "LLM Routes", value: llmRoutes.length, sub: `${llmRoutes.filter((r) => !r.disabled).length} active`, href: "/dashboard/llm/routes", status: infra.data?.llmRoutes.status },
            { label: "MCP Services", value: (infra.data?.mcpServices.value ?? []).length, sub: infra.data?.mcpRoutes.status === "ok" ? `${(infra.data?.mcpRoutes.value ?? []).length} routes` : `routes ${unavailableLabel(infra.data?.mcpRoutes.status)}`, href: "/dashboard/mcp/services", status: infra.data?.mcpServices.status },
            { label: "Virtual Keys", value: vkeys.length, sub: `${vkeys.filter((k) => !k.disabled).length} active`, href: "/dashboard/general/virtual-keys", status: infra.data?.vkeys.status },
            { label: "Credentials", value: null, sub: "upstream auth", href: "/dashboard/llm/credentials", status: "ok" as SliceStatus },
          ].map((s) => (
            <Link
              key={s.label}
              href={s.href}
              className="rounded-md border border-slate-700/60 bg-slate-900/30 px-3 py-2 transition-colors hover:border-blue-500/40 hover:bg-blue-500/5"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">{s.label}</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-100">
                {infra.isLoading ? <span className="inline-block h-5 w-8 animate-pulse rounded bg-slate-700/50" />
                  : s.status !== "ok" ? <span className="text-xs font-normal text-slate-500">{unavailableLabel(s.status)}</span>
                  : s.value === null ? <span className="text-xs font-normal text-slate-400">manage →</span>
                  : s.value}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">{s.sub}</p>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
