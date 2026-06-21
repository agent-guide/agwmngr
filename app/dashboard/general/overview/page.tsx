"use client";

import Link from "next/link";
import { useMemo, useState, useEffect, useCallback } from "react";
import { useToast } from "@/components/ui/toast";
import { Sparkline } from "@/components/ui/charts";
import { useAdminSWR } from "@/hooks/use-admin-swr";
import { num, errorRate, pct } from "@/lib/metrics-util";
import {
  adminFetch,
  listProviders,
  listManagedModels,
  listLLMRoutes,
  listMCPServices,
  listMCPRoutes,
  listACPServices,
  listACPRoutes,
  getACPRuntime,
  getCLIAuthRefresherStatus,
  getLLMTimeseries,
} from "@/lib/api";

// ── Types ───────────────────────────────────────────────────────────────────

interface Counts {
  providers: number;
  models: number;
  llmRoutes: number;
  llmRoutesActive: number;
  vkeys: number;
  vkeysActive: number;
  mcpServices: number;
  mcpRoutes: number;
  acpServices: number;
  acpRoutes: number;
}

const EMPTY_COUNTS: Counts = {
  providers: 0, models: 0, llmRoutes: 0, llmRoutesActive: 0, vkeys: 0, vkeysActive: 0,
  mcpServices: 0, mcpRoutes: 0, acpServices: 0, acpRoutes: 0,
};

type Status = "checking" | "online" | "unreachable";

// ── Icons ─────────────────────────────────────────────────────────────────--

function Icon({ path, className }: { path: string; className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d={path} /></svg>;
}
const P_LAYERS = "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5";
const P_BRAIN = "M9.5 2A2.5 2.5 0 0112 4.5v15a2.5 2.5 0 01-4.96-.46 2.5 2.5 0 01-2.96-3.08 3 3 0 01-.34-5.58 2.5 2.5 0 011.32-4.24 2.5 2.5 0 011.98-3A2.5 2.5 0 019.5 2Z";
const P_ROUTE = "M6 19a2 2 0 100-4 2 2 0 000 4zM18 9a2 2 0 100-4 2 2 0 000 4zM6 17V9a6 6 0 016-6h1M18 7v8a6 6 0 01-6 6h-1";
const P_KEY = "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3";
const P_PLUG = "M12 22v-5M9 8V2M15 8V2M18 8v3a6 6 0 01-6 6 6 6 0 01-6-6V8z";
const P_BOT = "M3 11h18v10H3zM12 3v4M8 16h.01M16 16h.01";
const P_COPY = "M8 4v12a2 2 0 002 2h8M16 4h2a2 2 0 012 2v12M8 4a2 2 0 00-2 2v0M8 4h6l4 4";
const P_CHECK = "M5 13l4 4L19 7";

// ── Page ─────────────────────────────────────────────────────────────────--

export default function OverviewPage() {
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [status, setStatus] = useState<Status>("checking");
  const [loading, setLoading] = useState(true);
  const [baseUrl, setBaseUrl] = useState("http://localhost:8080");
  const [snippetTab, setSnippetTab] = useState<"cc" | "openai" | "anthropic" | "python">("cc");
  const [copied, setCopied] = useState(false);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      listProviders(),
      listManagedModels(),
      listLLMRoutes(),
      adminFetch<{ items: { disabled?: boolean }[] }>("/admin/virtual_keys"),
      listMCPServices(),
      listMCPRoutes(),
      listACPServices(),
      listACPRoutes(),
      adminFetch<{ items: { public_url?: string; routes?: unknown[] }[] }>("/admin/caddy/servers"),
    ]);

    const [providers, models, llmRoutes, vkeys, mcpServices, mcpRoutes, acpServices, acpRoutes, servers] = results;
    const ok = (r: PromiseSettledResult<unknown>) => r.status === "fulfilled";
    const anyOk = results.some(ok);

    const next: Counts = { ...EMPTY_COUNTS };
    if (providers.status === "fulfilled") next.providers = providers.value.length;
    if (models.status === "fulfilled") next.models = models.value.length;
    if (llmRoutes.status === "fulfilled") {
      next.llmRoutes = llmRoutes.value.length;
      next.llmRoutesActive = llmRoutes.value.filter((r) => !r.disabled).length;
    }
    if (vkeys.status === "fulfilled") {
      const items = vkeys.value.items ?? [];
      next.vkeys = items.length;
      next.vkeysActive = items.filter((k) => !k.disabled).length;
    }
    if (mcpServices.status === "fulfilled") next.mcpServices = mcpServices.value.length;
    if (mcpRoutes.status === "fulfilled") next.mcpRoutes = mcpRoutes.value.length;
    if (acpServices.status === "fulfilled") next.acpServices = acpServices.value.length;
    if (acpRoutes.status === "fulfilled") next.acpRoutes = acpRoutes.value.length;

    if (servers.status === "fulfilled") {
      const withUrl = (servers.value.items ?? []).filter((s) => s.public_url);
      // Prefer a data-plane server (one that has routes) over the admin server.
      const best = withUrl.find((s) => (s.routes?.length ?? 0) > 0) ?? withUrl[0];
      if (best?.public_url) setBaseUrl(best.public_url.replace(/\/$/, ""));
    }

    setCounts(next);
    setStatus(anyOk ? "online" : "unreachable");
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // ── Live health data (24h window) ────────────────────────────────────────
  const runtime = useAdminSWR("ov-acp-runtime", getACPRuntime, { live: true });
  const refresher = useAdminSWR("ov-refresher", getCLIAuthRefresherStatus);
  const series24h = useAdminSWR(
    "ov-llm-24h",
    // Compute the window inside the fetcher (runs at fetch time, not during render).
    () => getLLMTimeseries({ from: new Date(Date.now() - 86400_000).toISOString(), bucket: "1h", group_by: "route_id" }),
    { live: true },
  );

  const health = useMemo(() => {
    const points = series24h.data?.items ?? [];
    const byTs = new Map<string, number>();
    let success = 0, failure = 0, requests = 0;
    for (const p of points) {
      requests += num(p.request_count);
      success += num(p.success_count);
      failure += num(p.failure_count);
      byTs.set(p.timestamp, (byTs.get(p.timestamp) ?? 0) + num(p.request_count));
    }
    const spark = [...byTs.entries()]
      .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
      .map(([, v]) => ({ requests: v }));
    return {
      requests,
      errRate: errorRate(success, failure),
      spark,
      pending: runtime.data?.pending_permissions?.length ?? 0,
      instances: runtime.data?.instances?.length ?? 0,
      inflight: runtime.data?.in_flight?.length ?? 0,
      refresherOn: refresher.data?.enabled ?? null,
    };
  }, [series24h.data, runtime.data, refresher.data]);

  // ── Setup checklist ──────────────────────────────────────────────────────
  const steps = [
    { done: counts.providers > 0, text: "Add an LLM provider", hint: "Connect OpenAI, Anthropic, or another backend.", href: "/dashboard/llm/providers" },
    { done: counts.llmRoutes > 0, text: "Create a route", hint: "Map incoming requests to a provider or model.", href: "/dashboard/llm/routes" },
    { done: counts.vkeys > 0, text: "Issue a virtual key", hint: "Generate an auth token for callers.", href: "/dashboard/general/virtual-keys" },
    { done: false, text: "Send your first request", hint: "Use a snippet on the right to call the gateway.", href: null as string | null },
  ];
  const completed = steps.filter((s) => s.done).length;

  // ── Stat cards ─────────────────────────────────────────────────────────────
  const stats = [
    { label: "Providers", value: counts.providers, sub: "LLM backends", href: "/dashboard/llm/providers", icon: P_LAYERS, accent: "text-blue-300" },
    { label: "Models", value: counts.models, sub: "managed", href: "/dashboard/llm/models", icon: P_BRAIN, accent: "text-cyan-300" },
    { label: "LLM Routes", value: counts.llmRoutes, sub: `${counts.llmRoutesActive} active`, href: "/dashboard/llm/routes", icon: P_ROUTE, accent: "text-indigo-300" },
    { label: "Virtual Keys", value: counts.vkeys, sub: `${counts.vkeysActive} active`, href: "/dashboard/general/virtual-keys", icon: P_KEY, accent: "text-amber-300" },
    { label: "MCP Services", value: counts.mcpServices, sub: `${counts.mcpRoutes} routes`, href: "/dashboard/mcp/services", icon: P_PLUG, accent: "text-violet-300" },
    { label: "ACP Services", value: counts.acpServices, sub: `${counts.acpRoutes} routes`, href: "/dashboard/acp/services", icon: P_BOT, accent: "text-teal-300" },
  ];

  // ── Snippets ───────────────────────────────────────────────────────────────
  const snippets: Record<typeof snippetTab, string> = {
    cc: `# Drive Claude Code through the gateway\nexport ANTHROPIC_BASE_URL=${baseUrl}\nexport ANTHROPIC_AUTH_TOKEN=$AGW_API_KEY\nclaude`,
    openai: `curl ${baseUrl}/v1/chat/completions \\\n  -H "Authorization: Bearer $AGW_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"gpt-4.1","messages":[{"role":"user","content":"hello"}]}'`,
    anthropic: `curl ${baseUrl}/v1/messages \\\n  -H "x-api-key: $AGW_API_KEY" \\\n  -H "anthropic-version: 2023-06-01" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"claude-sonnet-4-6","max_tokens":1024,"messages":[{"role":"user","content":"hello"}]}'`,
    python: `from openai import OpenAI\n\nclient = OpenAI(\n    base_url="${baseUrl}/v1",\n    api_key="AGW_API_KEY",\n)\nresp = client.chat.completions.create(\n    model="gpt-4.1",\n    messages=[{"role": "user", "content": "hello"}],\n)\nprint(resp.choices[0].message.content)`,
  };
  const snippetTabs: { key: typeof snippetTab; label: string }[] = [
    { key: "cc", label: "Claude Code" },
    { key: "openai", label: "OpenAI" },
    { key: "anthropic", label: "Anthropic" },
    { key: "python", label: "Python" },
  ];

  const copySnippet = () => {
    void navigator.clipboard.writeText(snippets[snippetTab]).then(() => {
      setCopied(true);
      showToast("Snippet copied", "success");
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  // ── Capability map ─────────────────────────────────────────────────────────
  const sections = [
    {
      title: "LLM", items: [
        { label: "Providers", href: "/dashboard/llm/providers", desc: "Upstream LLM backends" },
        { label: "Models", href: "/dashboard/llm/models", desc: "Managed model catalog" },
        { label: "Credentials", href: "/dashboard/llm/credentials", desc: "API keys & CLI auth" },
        { label: "Routes", href: "/dashboard/llm/routes", desc: "Request routing rules" },
      ],
    },
    {
      title: "MCP", items: [
        { label: "Services", href: "/dashboard/mcp/services", desc: "MCP servers & tools" },
        { label: "Routes", href: "/dashboard/mcp/routes", desc: "Expose MCP over paths" },
      ],
    },
    {
      title: "ACP", items: [
        { label: "Services", href: "/dashboard/acp/services", desc: "Codex / OpenCode agents" },
        { label: "Routes", href: "/dashboard/acp/routes", desc: "Expose agents over paths" },
        { label: "Runtime", href: "/dashboard/acp/runtime", desc: "Instances & permissions" },
      ],
    },
    {
      title: "General & Config", items: [
        { label: "Virtual Keys", href: "/dashboard/general/virtual-keys", desc: "Caller auth tokens" },
        { label: "Usage", href: "/dashboard/agents/usage", desc: "Traffic statistics" },
        { label: "CLI Authenticators", href: "/dashboard/configuration/cliauth", desc: "CLI authenticators & refresh" },
        { label: "Servers", href: "/dashboard/configuration/servers", desc: "HTTP listeners & TLS" },
      ],
    },
  ];

  const statusPill =
    status === "online" ? { dot: "bg-emerald-400", text: "Gateway online", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" }
    : status === "unreachable" ? { dot: "bg-red-400", text: "Gateway unreachable", cls: "border-red-500/30 bg-red-500/10 text-red-300" }
    : { dot: "bg-slate-400 animate-pulse", text: "Checking…", cls: "border-slate-600/50 bg-slate-800/40 text-slate-300" };

  return (
    <div className="space-y-4">
      {/* Header */}
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">Overview</h1>
            <p className="mt-1 text-sm text-slate-400">Monitor and operate your agent gateway — LLM, MCP, and ACP — from one place.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusPill.cls}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${statusPill.dot}`} />
              {statusPill.text}
            </span>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded-md border border-slate-600/80 bg-slate-800/70 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-700/80 disabled:opacity-50"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
      </section>

      {/* Stat cards */}
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="glass-card group rounded-md border border-slate-700/70 px-3 py-2.5 transition-colors hover:border-blue-500/40 hover:bg-blue-500/5"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{s.label}</span>
              <Icon path={s.icon} className={`h-3.5 w-3.5 ${s.accent}`} />
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-100">
              {loading ? <span className="inline-block h-6 w-8 animate-pulse rounded bg-slate-700/50" /> : s.value}
            </div>
            <div className="mt-0.5 text-[10px] text-slate-500">{s.sub}</div>
          </Link>
        ))}
      </section>

      {/* System health */}
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">System Health</h2>
          <span className="text-[11px] text-slate-500">last 24h</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Requests</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-100">{health.requests.toLocaleString()}</p>
            <div className="mt-1"><Sparkline data={health.spark} dataKey="requests" /></div>
          </div>
          <div className="rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Error Rate</p>
            <p className={`mt-0.5 text-lg font-semibold tabular-nums ${health.errRate > 0 ? "text-amber-300" : "text-emerald-300"}`}>{pct(health.errRate)}</p>
            <p className="mt-1 text-[11px] text-slate-500">across LLM routes</p>
          </div>
          <Link href="/dashboard/acp/runtime" className="rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2 transition-colors hover:border-amber-500/40 hover:bg-amber-500/5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Pending Permissions</p>
            <p className={`mt-0.5 text-lg font-semibold tabular-nums ${health.pending > 0 ? "text-amber-300" : "text-slate-100"}`}>{health.pending}</p>
            <p className="mt-1 text-[11px] text-slate-500">{health.pending > 0 ? "needs attention →" : "all resolved"}</p>
          </Link>
          <Link href="/dashboard/acp/runtime" className="rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2 transition-colors hover:border-blue-500/40 hover:bg-blue-500/5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">ACP Runtime</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-100">{health.instances}</p>
            <p className="mt-1 text-[11px] text-slate-500">{health.inflight} in-flight · pooled</p>
          </Link>
          <div className="rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">CLI Refresher</p>
            <p className={`mt-0.5 text-lg font-semibold ${health.refresherOn == null ? "text-slate-400" : health.refresherOn ? "text-emerald-300" : "text-slate-400"}`}>
              {health.refresherOn == null ? "—" : health.refresherOn ? "Running" : "Stopped"}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">token auto-refresh</p>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-600">
          Deep health (upstream reachability, circuit-break, credential expiry) is not yet exposed by the gateway.
        </p>
      </section>

      {status === "unreachable" && !loading && (
        <section className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
          <p className="text-xs text-red-300">
            Could not reach the gateway Admin API. Check that the gateway is running and the manager&apos;s <span className="font-mono">GATEWAY_ADDR</span> is correct, then Refresh.
          </p>
        </section>
      )}

      {/* Setup checklist + Integration snippets */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">Get Started</h2>
            <span className="text-[11px] text-slate-500">{completed}/{steps.length} done</span>
          </div>
          <div className="space-y-2">
            {steps.map((step, i) => {
              const inner = (
                <>
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    step.done ? "bg-emerald-500/20 text-emerald-300" : "bg-blue-500/20 text-blue-300"
                  }`}>
                    {step.done ? <Icon path={P_CHECK} className="h-3 w-3" /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-xs font-medium ${step.done ? "text-slate-400 line-through" : "text-slate-200"}`}>{step.text}</span>
                    <span className="block text-[11px] text-slate-500">{step.hint}</span>
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
        </section>

        <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-100">Integration</h2>
            <button
              type="button"
              onClick={copySnippet}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-600/70 bg-slate-800/60 px-2.5 py-1 text-[11px] font-semibold text-slate-300 transition-colors hover:bg-slate-700/70"
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
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  snippetTab === t.key ? "bg-blue-600/20 text-blue-300" : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <pre className="overflow-auto rounded-md border border-slate-700/70 bg-slate-950/60 p-3 font-mono text-[11px] leading-relaxed text-slate-300">{snippets[snippetTab]}</pre>
          <p className="mt-2 text-[11px] text-slate-500">
            Base URL <span className="font-mono text-slate-400">{baseUrl}</span> · replace <span className="font-mono text-slate-400">$AGW_API_KEY</span> with a virtual key.
          </p>
        </section>
      </div>

      {/* Capability map */}
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-100">Explore</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {sections.map((sec) => (
            <div key={sec.title}>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{sec.title}</p>
              <div className="space-y-1.5">
                {sec.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="block rounded-md border border-slate-700/60 bg-slate-900/30 p-2.5 transition-colors hover:border-blue-500/40 hover:bg-blue-500/5"
                  >
                    <div className="text-xs font-semibold text-slate-200">{item.label}</div>
                    <div className="mt-0.5 text-[10px] text-slate-500">{item.desc}</div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
