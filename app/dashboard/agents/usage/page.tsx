"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { Badge, protocolTone } from "@/components/ui/badge";
import { AutoRefreshControl } from "@/components/ui/auto-refresh-control";
import { TimeLineChart, DonutChart, CHART_COLORS } from "@/components/ui/charts";
import { useAdminSWR } from "@/hooks/use-admin-swr";
import {
  getLLMBreakdown,
  getLLMTimeseries,
  getLLMEvents,
  getMCPBreakdown,
  getMCPTimeseries,
  getMCPEvents,
  getACPBreakdown,
  getACPTimeseries,
  getACPEvents,
  type BreakdownItem,
  type InteractionEvent,
} from "@/lib/api";
import { TIME_RANGES, type TimeRange, rangeToQuery, num, pivotTimeseries, errorRate, pct } from "@/lib/metrics-util";

const PROTOCOLS = ["LLM", "MCP", "ACP"] as const;
type Protocol = (typeof PROTOCOLS)[number];

function fmt(n: number): string {
  return n.toLocaleString();
}

/** Donut slices from a breakdown: empty group values fold into a single
 *  `(none)` bucket with summed requests, then ranked desc and capped at 8. */
function shareData(items: BreakdownItem[], groupBy: string): { name: string; value: number }[] {
  const byName = new Map<string, number>();
  for (const it of items) {
    const raw = it[groupBy];
    const name = raw === undefined || raw === null || raw === "" ? "(none)" : String(raw);
    byName.set(name, (byName.get(name) ?? 0) + num(it.request_count));
  }
  return [...byName.entries()]
    .map(([name, value]) => ({ name, value }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}

/** Roll a breakdown into top-line totals shared by every protocol tab. */
function rollup(items: BreakdownItem[]) {
  let requests = 0, success = 0, failure = 0, tokens = 0, input = 0, output = 0, tools = 0, turns = 0, latWeighted = 0;
  for (const it of items) {
    const r = num(it.request_count);
    requests += r;
    success += num(it.success_count);
    failure += num(it.failure_count);
    tokens += num(it.total_tokens);
    input += num(it.input_tokens);
    output += num(it.output_tokens);
    tools += num(it.tools_call_count);
    turns += num(it.turn_count);
    latWeighted += num(it.avg_latency_ms) * r;
  }
  return { requests, success, failure, tokens, input, output, tools, turns, avgLatency: requests > 0 ? Math.round(latWeighted / requests) : 0 };
}

export default function UsagePage() {
  const [range, setRange] = useState<TimeRange>("7d");
  const [tab, setTab] = useState<Protocol>("LLM");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Usage Statistics"
        description="Live LLM, MCP, and ACP traffic across all agents. For a single agent, see its Usage tab."
      />

      <div className="flex flex-wrap gap-1 border-b border-slate-700/70">
        {PROTOCOLS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setTab(p)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === p ? "border-blue-500 text-slate-100" : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {tab === "LLM" && <LLMTab range={range} setRange={setRange} />}
      {tab === "MCP" && <MCPTab range={range} setRange={setRange} />}
      {tab === "ACP" && <ACPTab range={range} setRange={setRange} />}
    </div>
  );
}

type TabProps = { range: TimeRange; setRange: (r: TimeRange) => void };

/** Time-range buttons on the left, free-form controls (group-by, refresh) on the right. */
function ControlBar({ range, setRange, children }: TabProps & { children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-1">
        {TIME_RANGES.map((f) => (
          <Button
            key={f.key}
            variant={range === f.key ? "secondary" : "ghost"}
            onClick={() => setRange(f.key)}
            className="px-2.5 py-1 text-xs"
          >
            {f.label}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-400">{children}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// LLM tab
// ──────────────────────────────────────────────────────────────────────────

const LLM_GROUP_OPTIONS = [
  { value: "route_id", label: "Route" },
  { value: "virtual_key_id", label: "Virtual Key" },
  { value: "provider_id", label: "Provider" },
  { value: "upstream_model", label: "Model" },
  { value: "llm_api", label: "API" },
];

function LLMTab({ range, setRange }: TabProps) {
  const [groupBy, setGroupBy] = useState("route_id");
  const q = useMemo(() => rangeToQuery(range), [range]);

  const breakdown = useAdminSWR(
    ["llm-breakdown", range, groupBy],
    () => getLLMBreakdown({ from: q.from, to: q.to, group_by: groupBy, order_by: "request_count", limit: 50 }),
    { live: true },
  );
  const timeseries = useAdminSWR(
    ["llm-timeseries", range],
    () => getLLMTimeseries({ from: q.from, to: q.to, bucket: q.bucket, group_by: "route_id" }),
    { live: true },
  );
  const events = useAdminSWR(
    ["llm-events", range],
    () => getLLMEvents({ from: q.from, to: q.to, limit: 20 }),
    { live: true },
  );

  const items: BreakdownItem[] = useMemo(() => breakdown.data?.items ?? [], [breakdown.data]);
  const totals = useMemo(() => rollup(items), [items]);
  const lineData = useMemo(() => pivotTimeseries(timeseries.data?.items ?? []), [timeseries.data]);
  const donutData = useMemo(() => shareData(items, groupBy), [items, groupBy]);

  const loading = breakdown.isLoading && !breakdown.data;
  const groupLabel = LLM_GROUP_OPTIONS.find((g) => g.value === groupBy)?.label ?? groupBy;
  const refresh = () => {
    void breakdown.mutate();
    void timeseries.mutate();
    void events.mutate();
  };

  if (breakdown.error)
    return <Card className="p-6 text-center text-sm text-rose-300">{breakdown.error instanceof Error ? breakdown.error.message : "Failed to load metrics"}</Card>;

  return (
    <div className="space-y-4">
      <ControlBar range={range} setRange={setRange}>
        <span>Group by</span>
        <Select name="llm-group-by" value={groupBy} onChange={setGroupBy} options={LLM_GROUP_OPTIONS} />
        <AutoRefreshControl lastUpdated={breakdown.lastUpdated} onRefresh={refresh} refreshing={breakdown.isValidating} />
      </ControlBar>

      <StatGrid>
        <StatCard label="Requests" value={fmt(totals.requests)} loading={loading} />
        <StatCard label="Successful" value={fmt(totals.success)} tone="text-emerald-300" loading={loading} />
        <StatCard label="Failed" value={fmt(totals.failure)} tone="text-rose-300" loading={loading} />
        <StatCard label="Error Rate" value={pct(errorRate(totals.success, totals.failure))} tone={totals.failure > 0 ? "text-amber-300" : "text-slate-100"} loading={loading} />
        <StatCard label="Total Tokens" value={fmt(totals.tokens)} sub={`${fmt(totals.input)} in · ${fmt(totals.output)} out`} loading={loading} />
        <StatCard label="Avg Latency" value={`${fmt(totals.avgLatency)} ms`} loading={loading} />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TimeChartCard data={lineData} />
        </div>
        <ShareCard groupLabel={groupLabel} data={donutData} />
      </div>

      <BreakdownCard title={`Breakdown by ${groupLabel}`} items={items} groupBy={groupBy} tokens emptyText="No usage recorded in this range." />
      <EventsCard events={events.data?.items ?? []} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// MCP tab
// ──────────────────────────────────────────────────────────────────────────

const MCP_GROUP_OPTIONS = [
  { value: "tool_name", label: "Tool" },
  { value: "method", label: "Method" },
  { value: "route_id", label: "Route" },
  { value: "service_id", label: "Service" },
  { value: "virtual_key_id", label: "Virtual Key" },
];

function MCPTab({ range, setRange }: TabProps) {
  const [groupBy, setGroupBy] = useState("tool_name");
  const q = useMemo(() => rangeToQuery(range), [range]);

  const breakdown = useAdminSWR(
    ["mcp-breakdown", range, groupBy],
    () => getMCPBreakdown({ from: q.from, to: q.to, group_by: groupBy, order_by: "request_count", limit: 50 }),
    { live: true },
  );
  const timeseries = useAdminSWR(
    ["mcp-timeseries", range],
    () => getMCPTimeseries({ from: q.from, to: q.to, bucket: q.bucket, group_by: "route_id" }),
    { live: true },
  );
  const events = useAdminSWR(
    ["mcp-events", range],
    () => getMCPEvents({ from: q.from, to: q.to, limit: 20 }),
    { live: true },
  );

  const items: BreakdownItem[] = useMemo(() => breakdown.data?.items ?? [], [breakdown.data]);
  const totals = useMemo(() => rollup(items), [items]);
  const lineData = useMemo(() => pivotTimeseries(timeseries.data?.items ?? []), [timeseries.data]);
  const effectiveGroupBy = breakdown.data?.group_by ?? groupBy;
  const groupLabel = MCP_GROUP_OPTIONS.find((g) => g.value === effectiveGroupBy)?.label ?? effectiveGroupBy;
  const donutData = useMemo(() => shareData(items, effectiveGroupBy), [items, effectiveGroupBy]);
  const loading = breakdown.isLoading && !breakdown.data;

  if (breakdown.error)
    return <Card className="p-6 text-center text-sm text-rose-300">{breakdown.error instanceof Error ? breakdown.error.message : "Failed to load metrics"}</Card>;

  return (
    <div className="space-y-4">
      <ControlBar range={range} setRange={setRange}>
        <span>Group by</span>
        <Select name="mcp-group-by" value={groupBy} onChange={setGroupBy} options={MCP_GROUP_OPTIONS} />
        <AutoRefreshControl lastUpdated={breakdown.lastUpdated} onRefresh={() => { void breakdown.mutate(); void timeseries.mutate(); void events.mutate(); }} refreshing={breakdown.isValidating} />
      </ControlBar>

      <StatGrid>
        <StatCard label="Requests" value={fmt(totals.requests)} loading={loading} />
        <StatCard label="Successful" value={fmt(totals.success)} tone="text-emerald-300" loading={loading} />
        <StatCard label="Failed" value={fmt(totals.failure)} tone="text-rose-300" loading={loading} />
        <StatCard label="Error Rate" value={pct(errorRate(totals.success, totals.failure))} tone={totals.failure > 0 ? "text-amber-300" : "text-slate-100"} loading={loading} />
        <StatCard label="Tool Calls" value={fmt(totals.tools)} loading={loading} />
        <StatCard label="Avg Latency" value={`${fmt(totals.avgLatency)} ms`} loading={loading} />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TimeChartCard data={lineData} />
        </div>
        <ShareCard groupLabel={groupLabel} data={donutData} />
      </div>

      <BreakdownCard title={`Breakdown by ${groupLabel}`} items={items} groupBy={effectiveGroupBy} emptyText="No MCP usage recorded in this range." />
      <EventsCard events={events.data?.items ?? []} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// ACP tab
// ──────────────────────────────────────────────────────────────────────────

const ACP_GROUP_OPTIONS = [
  { value: "route_id", label: "Route" },
  { value: "service_id", label: "Service" },
  { value: "agent_type", label: "Agent Type" },
  { value: "operation", label: "Operation" },
];

// Source selector for the ACP tab. The manager's own Admin API polling of
// `/admin/acp` is recorded into the same usage table with route_protocol="admin"
// (data-plane turns carry route_protocol="acp"). Those audit spans would
// otherwise inflate every ACP stat, so default to data-plane only — mirrors the
// Interactions page Source filter, except here it must be applied server-side
// because the stat cards/timeseries are pre-aggregated by the gateway.
const ACP_SOURCE_OPTIONS = [
  { value: "data", label: "Data-plane" },
  { value: "admin", label: "Admin audit" },
  { value: "all", label: "All" },
];

function sourceProtocol(source: string): string | undefined {
  if (source === "data") return "acp";
  if (source === "admin") return "admin";
  return undefined;
}

function ACPTab({ range, setRange }: TabProps) {
  const [groupBy, setGroupBy] = useState("route_id");
  const [source, setSource] = useState("data");
  const q = useMemo(() => rangeToQuery(range), [range]);
  const routeProtocol = sourceProtocol(source);

  const breakdown = useAdminSWR(
    ["acp-breakdown", range, groupBy, source],
    () => getACPBreakdown({ from: q.from, to: q.to, group_by: groupBy, order_by: "request_count", limit: 50, route_protocol: routeProtocol }),
    { live: true },
  );
  const timeseries = useAdminSWR(
    ["acp-timeseries", range, source],
    () => getACPTimeseries({ from: q.from, to: q.to, bucket: q.bucket, group_by: "route_id", route_protocol: routeProtocol }),
    { live: true },
  );
  const events = useAdminSWR(
    ["acp-events", range, source],
    () => getACPEvents({ from: q.from, to: q.to, limit: 20, route_protocol: routeProtocol }),
    { live: true },
  );

  const items: BreakdownItem[] = useMemo(() => breakdown.data?.items ?? [], [breakdown.data]);
  const totals = useMemo(() => rollup(items), [items]);
  const lineData = useMemo(() => pivotTimeseries(timeseries.data?.items ?? []), [timeseries.data]);
  const effectiveGroupBy = breakdown.data?.group_by ?? groupBy;
  const groupLabel = ACP_GROUP_OPTIONS.find((g) => g.value === effectiveGroupBy)?.label ?? effectiveGroupBy;
  const donutData = useMemo(() => shareData(items, effectiveGroupBy), [items, effectiveGroupBy]);
  const loading = breakdown.isLoading && !breakdown.data;

  if (breakdown.error)
    return <Card className="p-6 text-center text-sm text-rose-300">{breakdown.error instanceof Error ? breakdown.error.message : "Failed to load metrics"}</Card>;

  return (
    <div className="space-y-4">
      <ControlBar range={range} setRange={setRange}>
        <span>Source</span>
        <Select name="acp-source" value={source} onChange={setSource} options={ACP_SOURCE_OPTIONS} />
        <span className="ml-2">Group by</span>
        <Select name="acp-group-by" value={groupBy} onChange={setGroupBy} options={ACP_GROUP_OPTIONS} />
        <AutoRefreshControl lastUpdated={breakdown.lastUpdated} onRefresh={() => { void breakdown.mutate(); void timeseries.mutate(); void events.mutate(); }} refreshing={breakdown.isValidating} />
      </ControlBar>

      <StatGrid>
        <StatCard label="Requests" value={fmt(totals.requests)} loading={loading} />
        <StatCard label="Successful" value={fmt(totals.success)} tone="text-emerald-300" loading={loading} />
        <StatCard label="Failed" value={fmt(totals.failure)} tone="text-rose-300" loading={loading} />
        <StatCard label="Error Rate" value={pct(errorRate(totals.success, totals.failure))} tone={totals.failure > 0 ? "text-amber-300" : "text-slate-100"} loading={loading} />
        <StatCard label="Turns" value={fmt(totals.turns)} loading={loading} />
        <StatCard label="Avg Latency" value={`${fmt(totals.avgLatency)} ms`} loading={loading} />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TimeChartCard data={lineData} />
        </div>
        <ShareCard groupLabel={groupLabel} data={donutData} />
      </div>

      <BreakdownCard title={`Breakdown by ${groupLabel}`} items={items} groupBy={effectiveGroupBy} emptyText="No ACP usage recorded in this range." />
      <EventsCard events={events.data?.items ?? []} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Shared presentational components
// ──────────────────────────────────────────────────────────────────────────

function TimeChartCard({ data }: { data: ReturnType<typeof pivotTimeseries> }) {
  return (
    <Card>
      <CardHeader><CardTitle>Requests Over Time</CardTitle></CardHeader>
      {data.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-500">No data in this range.</p>
      ) : (
        <TimeLineChart
          data={data}
          series={[
            { key: "success", label: "Success", color: "#22c55e" },
            { key: "failure", label: "Failure", color: "#ef4444" },
          ]}
        />
      )}
    </Card>
  );
}

function ShareCard({ groupLabel, data }: { groupLabel: string; data: { name: string; value: number }[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Share by {groupLabel}</CardTitle></CardHeader>
      {data.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-500">No data.</p>
      ) : (
        <>
          <DonutChart data={data} dataKey="value" nameKey="name" />
          <div className="mt-2 space-y-1">
            {data.slice(0, 5).map((d, i) => (
              <div key={`${d.name}-${i}`} className="flex items-center justify-between text-xs">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                  <span className="truncate font-mono text-slate-300">{d.name}</span>
                </span>
                <span className="tabular-nums text-slate-400">{fmt(d.value)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function BreakdownCard({ title, items, groupBy, tokens, emptyText }: { title: string; items: BreakdownItem[]; groupBy: string; tokens?: boolean; emptyText: string }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-slate-700/70 px-4 py-2.5">
        <CardTitle>{title}</CardTitle>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[640px] w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/70 bg-slate-900/50 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
              <th className="px-4 py-2">{groupBy}</th>
              <th className="px-4 py-2 text-right">Requests</th>
              <th className="px-4 py-2 text-right">Success</th>
              <th className="px-4 py-2 text-right">Failed</th>
              {tokens && <th className="px-4 py-2 text-right">Tokens</th>}
              <th className="px-4 py-2 text-right">Avg ms</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={tokens ? 6 : 5} className="px-4 py-8 text-center text-sm text-slate-500">{emptyText}</td></tr>
            ) : (
              items.map((it, i) => (
                <tr key={i} className="border-b border-slate-700/50 last:border-0 hover:bg-slate-800/30">
                  <td className="px-4 py-2 font-mono text-xs text-slate-200">{String(it[groupBy] ?? "—")}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-300">{fmt(num(it.request_count))}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-emerald-300">{fmt(num(it.success_count))}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-rose-300">{fmt(num(it.failure_count))}</td>
                  {tokens && <td className="px-4 py-2 text-right tabular-nums text-slate-300">{fmt(num(it.total_tokens))}</td>}
                  <td className="px-4 py-2 text-right tabular-nums text-slate-400">{fmt(num(it.avg_latency_ms))}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Best-effort primary label per protocol for the recent-events feed. */
function eventPrimary(e: InteractionEvent): string {
  if (e.route_kind === "mcp") return e.tool_name ?? e.method ?? e.route_id;
  if (e.route_kind === "acp") return e.operation ?? e.agent_type ?? e.route_id;
  return e.upstream_model ?? e.route_id;
}

function EventsCard({ events }: { events: InteractionEvent[] }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-slate-700/70 px-4 py-2.5">
        <CardTitle>Recent Requests</CardTitle>
      </div>
      <div className="divide-y divide-slate-700/50">
        {events.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">No recent events.</p>
        ) : (
          events.map((e) => (
            <div key={e.event_id} className="flex items-center gap-3 px-4 py-2 text-xs hover:bg-slate-800/30">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${e.success ? "bg-emerald-400" : "bg-rose-400"}`} />
              <Badge tone={protocolTone(e.route_kind)} className="shrink-0">{e.route_kind}</Badge>
              <span className="truncate font-mono text-slate-300">{eventPrimary(e)}</span>
              <span className="ml-auto shrink-0 tabular-nums text-slate-500">{num(e.total_tokens) > 0 ? `${fmt(num(e.total_tokens))} tok · ` : ""}{fmt(num(e.latency_ms))} ms</span>
              <span className="shrink-0 text-slate-500" suppressHydrationWarning>{new Date(e.started_at).toLocaleTimeString()}</span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
