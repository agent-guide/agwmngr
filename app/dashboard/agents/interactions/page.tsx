"use client";

import { useMemo, useState } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Badge, protocolTone } from "@/components/ui/badge";
import { AutoRefreshControl } from "@/components/ui/auto-refresh-control";
import { useAdminSWR } from "@/hooks/use-admin-swr";
import { num } from "@/lib/metrics-util";
import { getInteractions, type InteractionEvent } from "@/lib/api";

interface Trace {
  traceId: string;
  events: InteractionEvent[];
  startedAt: number;
  maxDepth: number;
  ok: boolean;
  totalLatency: number;
}

function groupTraces(events: InteractionEvent[]): Trace[] {
  const byTrace = new Map<string, InteractionEvent[]>();
  for (const e of events) {
    const t = e.trace_id || e.event_id;
    const arr = byTrace.get(t) ?? [];
    arr.push(e);
    byTrace.set(t, arr);
  }
  const traces: Trace[] = [];
  for (const [traceId, evs] of byTrace) {
    evs.sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
    traces.push({
      traceId,
      events: evs,
      startedAt: new Date(evs[0]?.started_at ?? 0).getTime(),
      maxDepth: evs.reduce((m, e) => Math.max(m, e.agent_depth ?? 0), 0),
      ok: evs.every((e) => e.success),
      totalLatency: evs.reduce((s, e) => s + num(e.latency_ms), 0),
    });
  }
  return traces.sort((a, b) => b.startedAt - a.startedAt);
}

function SpanRow({ e }: { e: InteractionEvent }) {
  const depth = Math.max(0, e.agent_depth ?? 0);
  return (
    <div className="flex items-center gap-2 py-1 text-xs" style={{ paddingLeft: depth * 18 }}>
      {depth > 0 && <span className="text-slate-600">└─</span>}
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${e.success ? "bg-emerald-400" : "bg-rose-400"}`} />
      <Badge tone={protocolTone(e.route_kind)} className="shrink-0">{e.route_protocol ?? e.route_kind}</Badge>
      <span className="truncate font-mono text-slate-300">{e.operation ?? e.tool_name ?? e.upstream_model ?? e.route_id}</span>
      {e.agent_id && <Badge tone="blue" mono className="shrink-0">{e.agent_id}</Badge>}
      <span className="ml-auto shrink-0 tabular-nums text-slate-500">{num(e.latency_ms)} ms</span>
    </div>
  );
}

export default function InteractionsPage() {
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  // Admin-plane audit spans (the manager's own Admin API polling — route_protocol
  // "admin", e.g. route_id "/admin/acp") are not real orchestration traffic and would
  // otherwise dominate the view. Hide them by default; "all" brings them back.
  const [source, setSource] = useState("data");

  const q = useMemo(
    () => ({
      limit: 500,
      ...(kind !== "all" ? { route_kind: kind } : {}),
      ...(status !== "all" ? { success: status === "ok" } : {}),
    }),
    [kind, status],
  );

  const { data, error, isLoading, mutate, isValidating, lastUpdated } = useAdminSWR(
    ["interactions", kind, status],
    () => getInteractions(q),
    { live: true },
  );

  const events = useMemo(() => {
    const items = data?.items ?? [];
    if (source === "all") return items;
    const isAdmin = (e: InteractionEvent) => e.route_protocol === "admin";
    return source === "admin" ? items.filter(isAdmin) : items.filter((e) => !isAdmin(e));
  }, [data, source]);

  const traces = useMemo(() => groupTraces(events), [events]);
  const multiSpan = traces.filter((t) => t.events.length > 1);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Interactions"
        description="Cross-protocol call chains reconstructed from trace/span attribution — the orchestration view of how a request fans out across agents, LLMs, and tools."
        actions={<AutoRefreshControl lastUpdated={lastUpdated} onRefresh={() => void mutate()} refreshing={isValidating} />}
      />

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span>Protocol</span>
        <Select name="kind" value={kind} onChange={setKind} options={[{ value: "all", label: "All" }, { value: "llm", label: "LLM" }, { value: "mcp", label: "MCP" }, { value: "acp", label: "ACP" }]} />
        <span className="ml-2">Status</span>
        <Select name="status" value={status} onChange={setStatus} options={[{ value: "all", label: "All" }, { value: "ok", label: "Success" }, { value: "err", label: "Failure" }]} />
        <span className="ml-2">Source</span>
        <Select name="source" value={source} onChange={setSource} options={[{ value: "data", label: "Data-plane" }, { value: "admin", label: "Admin audit" }, { value: "all", label: "All" }]} />
        <span className="ml-auto text-slate-500">{traces.length} traces · {multiSpan.length} multi-span</span>
      </div>

      {error ? (
        <Card className="p-8 text-center text-sm text-rose-300">{error instanceof Error ? error.message : "Failed to load interactions"}</Card>
      ) : isLoading && !data ? (
        <Card className="p-8 text-center text-sm text-slate-400">Loading interactions…</Card>
      ) : traces.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">No interactions recorded.</Card>
      ) : (
        <div className="space-y-2">
          {traces.map((t) => (
            <TraceCard key={t.traceId} trace={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function TraceCard({ trace }: { trace: Trace }) {
  const [open, setOpen] = useState(trace.events.length > 1);
  return (
    <Card className="p-0">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
        <span className={`h-2 w-2 shrink-0 rounded-full ${trace.ok ? "bg-emerald-400" : "bg-rose-400"}`} />
        <CardTitle className="truncate">{trace.traceId}</CardTitle>
        {trace.maxDepth > 0 && <Badge tone="violet" className="shrink-0">depth {trace.maxDepth}</Badge>}
        <Badge tone="neutral" className="shrink-0">{trace.events.length} span{trace.events.length === 1 ? "" : "s"}</Badge>
        <span className="ml-auto shrink-0 text-xs tabular-nums text-slate-500">{trace.totalLatency} ms</span>
        <span className="shrink-0 text-xs text-slate-600" suppressHydrationWarning>{new Date(trace.startedAt).toLocaleTimeString()}</span>
        <span className="shrink-0 text-slate-500">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="border-t border-slate-700/60 px-4 py-2">
          {trace.events.map((e) => (
            <SpanRow key={e.event_id} e={e} />
          ))}
        </div>
      )}
    </Card>
  );
}
