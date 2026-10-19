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
import { useI18n } from "@/components/i18n-provider";
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

type Translate = ReturnType<typeof useI18n>["t"];

function unavailableLabel(status: SliceStatus | undefined, t: Translate): string {
  return status === "denied" ? t("overview.noAccess") : t("overview.unavailable");
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

function relTime(iso: string | undefined, t: Translate): string {
  if (!iso) return t("overview.never");
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "—";
  const s = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (s < 60) return t("overview.secondsAgo", { count: s });
  if (s < 3600) return t("overview.minutesAgo", { count: Math.round(s / 60) });
  if (s < 86400) return t("overview.hoursAgo", { count: Math.round(s / 3600) });
  return t("overview.daysAgo", { count: Math.round(s / 86400) });
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
  const { locale, t } = useI18n();
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
      if (a.disabled) { issues.push(t("overview.disabledIssue")); severity = 2; }
      if (st && !st.executable) { issues.push(t("overview.notExecutable")); severity = 2; }
      if (routesAvailable) {
        if (routes.length === 0) { issues.push(t("overview.noIngress")); severity = Math.max(severity, 2); }
        else if (routes.every((r) => r.disabled)) { issues.push(t("overview.allRoutesDisabled")); severity = Math.max(severity, 2); }
      }
      if (st?.state === "unhealthy") { issues.push(t("overview.unhealthy")); severity = 2; }
      else if (st?.state === "degraded") { issues.push(t("overview.degraded")); severity = Math.max(severity, 1); }
      if (num(st?.pending_permissions) > 0) { issues.push(t("overview.pendingIssue", { count: st?.pending_permissions ?? 0 })); severity = Math.max(severity, 1); }
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
  }, [agents, agentRoutes, agentsStatus, routesStatus, t]);

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
    ? t("overview.noAccess")
    : t("overview.unavailable");

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
    { key: "agent", label: t("overview.agentTurn") },
    { key: "cc", label: "Claude Code" },
    { key: "openai", label: "OpenAI" },
    { key: "anthropic", label: "Anthropic" },
    { key: "python", label: "Python" },
  ];

  const copySnippet = () => {
    if (snippetTab === "agent" && !primaryRoute) return;
    void navigator.clipboard.writeText(snippets[snippetTab]).then(() => {
      setCopied(true);
      showToast(t("overview.snippetCopied"), "success");
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  // ── Get started: two paths, because the gateway serves both ───────────────
  const vkeys = infra.data?.vkeys.value ?? [];
  const providers = infra.data?.providers.value ?? [];
  const llmRoutes = infra.data?.llmRoutes.value ?? [];

  const agentSteps = [
    { known: agentsStatus === "ok", done: agents.length > 0, text: t("overview.createAgent"), hint: t("overview.createAgentHint"), href: "/dashboard/agents/new" },
    { known: routesStatus === "ok", done: agentRoutes.length > 0, text: t("overview.exposeAgent"), hint: t("overview.exposeAgentHint"), href: "/dashboard/agents/routes" },
    { known: infra.data?.vkeys.status === "ok", done: vkeys.length > 0, text: t("overview.issueKey"), hint: t("overview.issueAgentKeyHint"), href: "/dashboard/general/virtual-keys" },
    { known: traffic.data?.agent.status === "ok", done: agentTraffic.requests > 0, text: t("overview.runTurn"), hint: t("overview.runTurnHint"), href: primaryAgent ? `/dashboard/agents/${encodeURIComponent(primaryAgent.id)}` : "/dashboard/agents" },
  ];
  const llmSteps = [
    { known: infra.data?.providers.status === "ok", done: providers.length > 0, text: t("overview.addProvider"), hint: t("overview.addProviderHint"), href: "/dashboard/llm/providers" },
    { known: infra.data?.llmRoutes.status === "ok", done: llmRoutes.length > 0, text: t("overview.createLlmRoute"), hint: t("overview.createLlmRouteHint"), href: "/dashboard/llm/routes" },
    { known: infra.data?.vkeys.status === "ok", done: vkeys.length > 0, text: t("overview.issueKey"), hint: t("overview.issueLlmKeyHint"), href: "/dashboard/general/virtual-keys" },
    { known: traffic.data?.llm.status === "ok", done: llmTraffic.requests > 0, text: t("overview.firstRequest"), hint: t("overview.firstRequestHint"), href: null as string | null },
  ];
  const steps = pathTab === "agent" ? agentSteps : llmSteps;
  const completed = steps.filter((s) => s.known && s.done).length;

  // ── Explore, grouped like the sidebar ─────────────────────────────────────
  const sections = [
    {
      title: t("overview.workspace"), items: [
        { label: t("nav.agents"), href: "/dashboard/agents", desc: t("overview.agentRuntimeDesc") },
        { label: t("nav.agentRoutes"), href: "/dashboard/agents/routes", desc: t("overview.agentRoutesDesc") },
        { label: t("nav.interactions"), href: "/dashboard/agents/interactions", desc: t("overview.interactionsDesc") },
        { label: t("nav.usage"), href: "/dashboard/agents/usage", desc: t("overview.usageDesc") },
        { label: t("nav.virtualKeys"), href: "/dashboard/general/virtual-keys", desc: t("overview.keysDesc") },
      ],
    },
    {
      title: "LLM", items: [
        { label: t("nav.providers"), href: "/dashboard/llm/providers", desc: t("overview.providersDesc") },
        { label: t("nav.models"), href: "/dashboard/llm/models", desc: t("overview.modelsDesc") },
        { label: t("nav.routes"), href: "/dashboard/llm/routes", desc: t("overview.routesDesc") },
        { label: t("nav.credentials"), href: "/dashboard/llm/credentials", desc: t("overview.credentialsDesc") },
      ],
    },
    {
      title: "MCP", items: [
        { label: t("nav.services"), href: "/dashboard/mcp/services", desc: t("overview.mcpServicesDesc") },
        { label: t("nav.routes"), href: "/dashboard/mcp/routes", desc: t("overview.mcpRoutesDesc") },
      ],
    },
    {
      title: t("overview.runtimeOps"), items: [
        { label: t("nav.acpRuntime"), href: ACP_RUNTIME_HREF, desc: t("overview.acpDesc") },
        { label: t("nav.builtinRuntime"), href: BUILTIN_RUNTIME_HREF, desc: t("overview.builtinDesc") },
        ...(user?.is_platform_admin
          ? [
              { label: t("nav.bundle"), href: "/dashboard/configuration/bundle", desc: t("overview.bundleDesc") },
              { label: t("nav.servers"), href: "/dashboard/configuration/servers", desc: t("overview.serversDesc") },
            ]
          : []),
      ],
    },
  ];

  const statusPill =
    status === "online" ? { dot: "bg-emerald-400", text: t("overview.online"), cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" }
    : status === "restricted" ? { dot: "bg-amber-400", text: t("overview.limited"), cls: "border-amber-500/30 bg-amber-500/10 text-amber-300" }
    : status === "unreachable" ? { dot: "bg-red-400", text: t("overview.unreachable"), cls: "border-red-500/30 bg-red-500/10 text-red-300" }
    : { dot: "bg-slate-400 animate-pulse", text: t("overview.checking"), cls: "border-slate-600/50 bg-slate-800/40 text-slate-300" };

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
        title={t("nav.overview")}
        description={t("overview.description", { gateway: activeGateway?.name ?? t("overview.thisGateway") })}
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
            {t("overview.unreachableHelp")}
          </p>
        </Card>
      )}

      {status !== "unreachable" && access.denied > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <p className="text-xs text-amber-300">
            {access.ok > 0
              ? t("overview.hiddenSections", { denied: access.denied, total: access.total })
              : t("overview.noContentAccess")}
          </p>
        </Card>
      )}

      {/* Agent fleet — the primary objects */}
      <StatGrid>
        <Link href="/dashboard/agents" className="block">
          <StatCard
            label={t("nav.agents")}
            value={agentsStatus === "ok" ? agents.length : unavailableLabel(agentsStatus, t)}
            loading={fleet.isLoading}
            sub={agentsStatus === "ok" ? t("overview.readyAttention", { ready: health.ready, attention: health.attention }) : t("overview.agentInventoryUnreadable")}
            tone={health.attention > 0 ? "text-amber-300" : "text-slate-100"}
            className="transition-colors hover:border-blue-500/40"
          />
        </Link>
        <Link href="/dashboard/agents/routes" className="block">
          <StatCard
            label={t("nav.agentRoutes")}
            value={routesStatus === "ok" ? agentRoutes.length : unavailableLabel(routesStatus, t)}
            loading={fleet.isLoading}
            sub={routesStatus === "ok" ? (health.danglingRoutes.length > 0 ? t("overview.dangling", { count: health.danglingRoutes.length }) : t("overview.publicEntryPoints")) : t("overview.routeInventoryUnreadable")}
            tone={health.danglingRoutes.length > 0 ? "text-rose-300" : "text-slate-100"}
            className="transition-colors hover:border-blue-500/40"
          />
        </Link>
        <StatCard
          label={t("overview.activeRuns")}
          value={agentsStatus === "ok" ? health.activeRuns : unavailableLabel(agentsStatus, t)}
          loading={fleet.isLoading}
          sub={runtimeComplete ? t("overview.inflight", { acp: acpInflight, builtin: builtinInflight }) : t("overview.runtimeDiagnostics", { status: runtimeUnavailable })}
        />
        <Link href={pendingHref} className="block">
          <StatCard
            label={t("overview.pendingPermissions")}
            value={pending ?? runtimeUnavailable}
            loading={runtime.isLoading}
            sub={runtimeComplete ? `acp ${acpPending} · builtin ${builtinPending}` : t("overview.runtimeViewsUnreadable")}
            tone={pending !== null && pending > 0 ? "text-amber-300" : "text-slate-100"}
            className="transition-colors hover:border-amber-500/40"
          />
        </Link>
      </StatGrid>

      {/* Traffic across all three data planes, last 24h */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <CardTitle>{t("overview.traffic")}</CardTitle>
          <span className="text-xs text-slate-500">{t("overview.last24h")}</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            { kind: "agent", label: "Agent", t: agentTraffic, slice: traffic.data?.agent, href: "/dashboard/agents/usage" },
            { kind: "llm", label: "LLM", t: llmTraffic, slice: traffic.data?.llm, href: "/dashboard/agents/usage" },
            { kind: "mcp", label: "MCP", t: mcpTraffic, slice: traffic.data?.mcp, href: "/dashboard/agents/usage" },
          ].map(({ kind, label, t: metric, slice: trafficSlice, href }) => (
            <Link
              key={kind}
              href={href}
              className="rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2 transition-colors hover:border-blue-500/40 hover:bg-blue-500/5"
            >
              <div className="flex items-center justify-between">
                <Badge tone={protocolTone(kind)} className="uppercase">{label}</Badge>
                <span className={`text-xs tabular-nums ${trafficSlice?.status === "ok" && metric.errRate > 0 ? "text-amber-300" : "text-slate-500"}`}>
                  {trafficSlice?.status === "ok" ? t("overview.errorRate", { value: pct(metric.errRate) }) : "—"}
                </span>
              </div>
              <p className="mt-1 text-xl font-semibold tabular-nums text-slate-100">
                {traffic.isLoading ? "…" : trafficSlice?.status === "ok" ? metric.requests.toLocaleString(locale) : unavailableLabel(trafficSlice?.status, t)}
              </p>
              <div className="mt-1"><Sparkline data={trafficSlice?.status === "ok" ? metric.spark : []} dataKey="requests" /></div>
            </Link>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {t("overview.deepHealth")}
        </p>
      </Card>

      {/* Agent fleet health */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <CardTitle>{t("overview.agentFleet")}</CardTitle>
          <Link href="/dashboard/agents" className="text-xs text-blue-300 hover:text-blue-200">
            {agentsStatus === "ok" ? t("overview.viewAll", { count: agents.length }) : t("overview.openAgents")}
          </Link>
        </div>

        {health.danglingRoutes.length > 0 && (
          <p className="mb-2 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
            {t("overview.danglingRoutes", { count: health.danglingRoutes.length })}
            <span className="font-mono">{health.danglingRoutes.slice(0, 3).map((r) => r.agent_id).join(", ")}</span>
          </p>
        )}

        {health.rows.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-500">
            {agentsStatus === "denied"
              ? t("overview.agentsDenied")
              : agentsStatus === "error"
                ? t("overview.agentsUnavailable")
                : t("overview.noAgents")}
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
                  {routesStatus === "ok" ? t("overview.routeCount", { count: routes.length }) : t("overview.routesStatus", { status: unavailableLabel(routesStatus, t) })}
                </span>
                <span className="text-xs tabular-nums text-slate-500">{t("overview.running", { count: num(agent.runtime_status?.active_runs) })}</span>
                <span className="w-20 text-right text-xs text-slate-600">{relTime(agent.runtime_status?.last_activity_at, t)}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* Recent orchestration */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <CardTitle>{t("overview.recentActivity")}</CardTitle>
          <Link href="/dashboard/agents/interactions" className="text-xs text-blue-300 hover:text-blue-200">{t("overview.allInteractions")}</Link>
        </div>
        {recent.isLoading ? (
          <p className="py-4 text-center text-xs text-slate-500">{t("overview.loadingActivity")}</p>
        ) : recentTraces.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-500">
            {recentFailed.length === 3
              ? recentFailed.every((s) => s.status === "denied") ? t("overview.interactionsDenied") : t("overview.activityUnavailable")
              : recentFailed.length > 0 ? t("overview.partialNoActivity") : t("overview.noTraffic")}
          </p>
        ) : (
          <div className="space-y-1.5">
            {recentFailed.length > 0 && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
                {t("overview.partialActivity", { count: recentFailed.length })}
              </p>
            )}
            {recentTraces.map((trace) => (
              <Link
                key={trace.traceId}
                href="/dashboard/agents/interactions"
                className="flex flex-wrap items-center gap-2 rounded-md border border-slate-700/60 bg-slate-900/30 px-3 py-2 transition-colors hover:border-blue-500/40 hover:bg-blue-500/5"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${trace.ok ? "bg-emerald-400" : "bg-rose-400"}`} />
                <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{trace.rootLabel}</span>
                {trace.protocols.map((p) => (
                  <Badge key={p} tone={protocolTone(p)} className="uppercase">{p}</Badge>
                ))}
                <span className="text-xs tabular-nums text-slate-500">{t("overview.spanCount", { count: trace.spanCount })}</span>
                <span className="w-16 text-right text-xs tabular-nums text-slate-400">{fmtMs(trace.duration)}</span>
                <span className="w-20 text-right text-xs text-slate-600" suppressHydrationWarning>
                  {new Date(trace.startedAt).toLocaleTimeString(locale)}
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
            <CardTitle>{t("overview.getStarted")}</CardTitle>
            <span className="text-xs text-slate-500">{t("overview.done", { done: completed, total: steps.length })}</span>
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {([{ key: "agent", label: t("overview.runAgent") }, { key: "llm", label: t("overview.proxyLlm") }] as const).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setPathTab(tab.key)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  pathTab === tab.key ? "bg-blue-600/20 text-blue-300" : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                }`}
              >
                {tab.label}
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
                    <span className="block text-xs text-slate-500">{step.known ? step.hint : t("overview.statusUnavailable")}</span>
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
            <CardTitle>{t("overview.integration")}</CardTitle>
            <button
              type="button"
              onClick={copySnippet}
              disabled={snippetTab === "agent" && !primaryRoute}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-600/70 bg-slate-800/60 px-2.5 py-1 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-700/70 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-slate-800/60"
            >
              <Icon path={copied ? P_CHECK : P_COPY} className="h-3 w-3" />
              {copied ? t("overview.copied") : t("overview.copy")}
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
            {t("overview.baseUrl")} <span className="font-mono text-slate-400">{baseUrl}</span>
            {publicBase === null && <span className="text-slate-500">{t("overview.assumedUrl")}</span>}
            {" · "}{t("overview.replaceKey")}
          </p>
          {snippetTab === "agent" && (
            <p className="mt-1 text-xs text-slate-500">
              {t("overview.runtimeOptions")}
              {!primaryRoute && t("overview.noPrimaryRoute")}
            </p>
          )}
        </Card>
      </div>

      {/* Explore */}
      <Card>
        <CardTitle className="mb-3">{t("overview.explore")}</CardTitle>
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
        <CardTitle className="mb-3">{t("overview.sharedInfra")}</CardTitle>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: t("nav.providers"), value: providers.length, sub: t("overview.llmBackends"), href: "/dashboard/llm/providers", status: infra.data?.providers.status },
            { label: t("nav.models"), value: (infra.data?.models.value ?? []).length, sub: t("overview.managed"), href: "/dashboard/llm/models", status: infra.data?.models.status },
            { label: "LLM Routes", value: llmRoutes.length, sub: t("overview.activeCount", { count: llmRoutes.filter((r) => !r.disabled).length }), href: "/dashboard/llm/routes", status: infra.data?.llmRoutes.status },
            { label: t("mcpServices.title"), value: (infra.data?.mcpServices.value ?? []).length, sub: infra.data?.mcpRoutes.status === "ok" ? t("overview.routesCount", { count: (infra.data?.mcpRoutes.value ?? []).length }) : t("overview.routesStatus", { status: unavailableLabel(infra.data?.mcpRoutes.status, t) }), href: "/dashboard/mcp/services", status: infra.data?.mcpServices.status },
            { label: t("nav.virtualKeys"), value: vkeys.length, sub: t("overview.activeCount", { count: vkeys.filter((k) => !k.disabled).length }), href: "/dashboard/general/virtual-keys", status: infra.data?.vkeys.status },
            { label: t("nav.credentials"), value: null, sub: t("overview.upstreamAuth"), href: "/dashboard/llm/credentials", status: "ok" as SliceStatus },
          ].map((s) => (
            <Link
              key={s.label}
              href={s.href}
              className="rounded-md border border-slate-700/60 bg-slate-900/30 px-3 py-2 transition-colors hover:border-blue-500/40 hover:bg-blue-500/5"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">{s.label}</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-100">
                {infra.isLoading ? <span className="inline-block h-5 w-8 animate-pulse rounded bg-slate-700/50" />
                  : s.status !== "ok" ? <span className="text-xs font-normal text-slate-500">{unavailableLabel(s.status, t)}</span>
                  : s.value === null ? <span className="text-xs font-normal text-slate-400">{t("overview.manage")}</span>
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
