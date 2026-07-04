"use client";

import { useMemo, useState } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Badge, protocolTone } from "@/components/ui/badge";
import { AutoRefreshControl } from "@/components/ui/auto-refresh-control";
import { useAdminSWR } from "@/hooks/use-admin-swr";
import { num } from "@/lib/metrics-util";
import { getInteractions, type InteractionEvent, type MetricsQuery } from "@/lib/api";

// ---------------------------------------------------------------------------
// Span tree model — reconstruct the real parent/child call chain from
// span_id / parent_span_id (the backend UNION exposes both). agent_depth is a
// coarse "which agent layer" counter and is NOT the tree depth, so we derive
// depth from the span links instead.
// ---------------------------------------------------------------------------

interface SpanNode {
  event: InteractionEvent;
  children: SpanNode[];
  depth: number; // tree depth (0 = root)
  start: number; // epoch ms
  end: number; // epoch ms
  errorInSubtree: boolean; // this node or any descendant failed
}

interface Trace {
  traceId: string;
  roots: SpanNode[];
  flat: SpanNode[]; // pre-order, ready to render
  startedAt: number; // trace wall-clock start (min start)
  endedAt: number; // trace wall-clock end (max end)
  duration: number; // wall-clock span, ms
  spanCount: number;
  errorCount: number;
  protocols: string[];
  ok: boolean;
  rootLabel: string;
}

function spanLabel(e: InteractionEvent): string {
  return (
    e.operation ||
    e.tool_name ||
    e.upstream_model ||
    e.method ||
    e.route_id ||
    e.span_id ||
    e.event_id
  );
}

// The *_names fields arrive as JSON-encoded string arrays (e.g. '["exec_command"]').
function parseNames(json?: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function spanStart(e: InteractionEvent): number {
  return new Date(e.started_at).getTime();
}

function spanEnd(e: InteractionEvent): number {
  if (e.finished_at) {
    const f = new Date(e.finished_at).getTime();
    if (Number.isFinite(f)) return f;
  }
  return spanStart(e) + num(e.latency_ms);
}

function buildTrace(traceId: string, events: InteractionEvent[]): Trace {
  const nodes = new Map<string, SpanNode>();
  for (const e of events) {
    nodes.set(e.span_id || e.event_id, {
      event: e,
      children: [],
      depth: 0,
      start: spanStart(e),
      end: spanEnd(e),
      errorInSubtree: !e.success,
    });
  }

  // Wire up parent/child. A span whose parent is absent from this trace (or has
  // no parent) becomes a root — this keeps orphaned/legacy rows visible.
  const roots: SpanNode[] = [];
  for (const node of nodes.values()) {
    const pid = node.event.parent_span_id;
    const parent = pid ? nodes.get(pid) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  const byStart = (a: SpanNode, b: SpanNode) => a.start - b.start;
  roots.sort(byStart);

  // Pre-order flatten, assigning tree depth and propagating subtree errors up.
  const flat: SpanNode[] = [];
  const visit = (node: SpanNode, depth: number): boolean => {
    node.depth = depth;
    node.children.sort(byStart);
    flat.push(node);
    let err = !node.event.success;
    for (const child of node.children) err = visit(child, depth + 1) || err;
    node.errorInSubtree = err;
    return err;
  };
  for (const r of roots) visit(r, 0);

  const starts = flat.map((n) => n.start);
  const ends = flat.map((n) => n.end);
  const startedAt = Math.min(...starts);
  const endedAt = Math.max(...ends);
  const protocols = Array.from(
    new Set(flat.map((n) => n.event.route_protocol || n.event.route_kind).filter(Boolean)),
  ) as string[];

  return {
    traceId,
    roots,
    flat,
    startedAt,
    endedAt,
    duration: Math.max(0, endedAt - startedAt),
    spanCount: flat.length,
    errorCount: flat.filter((n) => !n.event.success).length,
    protocols,
    ok: flat.every((n) => n.event.success),
    rootLabel: roots[0] ? spanLabel(roots[0].event) : traceId,
  };
}

function groupTraces(events: InteractionEvent[]): Trace[] {
  const byTrace = new Map<string, InteractionEvent[]>();
  for (const e of events) {
    const t = e.trace_id || e.event_id;
    const arr = byTrace.get(t) ?? [];
    arr.push(e);
    byTrace.set(t, arr);
  }
  const traces = Array.from(byTrace, ([id, evs]) => buildTrace(id, evs));
  return traces.sort((a, b) => b.startedAt - a.startedAt);
}

// Bar fill per protocol; failed spans always render red.
const BAR_TONE: Record<string, string> = {
  llm: "bg-blue-500",
  mcp: "bg-violet-500",
  acp: "bg-teal-500",
  http: "bg-cyan-500",
};
function barClass(e: InteractionEvent): string {
  if (!e.success) return "bg-rose-500";
  return BAR_TONE[(e.route_kind ?? "").toLowerCase()] ?? "bg-slate-500";
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function InteractionsPage() {
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  // Admin-plane audit spans (the manager's own Admin API polling — route_protocol
  // "admin", route_kind "acp") are not real orchestration traffic. They accumulate
  // continuously and, being the newest rows, will fill the entire `limit` window and
  // starve out real data-plane traffic. So the source filter is pushed to the SERVER
  // (via route_kind / route_protocol) — filtering client-side after `limit` would go
  // blank the moment admin polling out-numbers the window. Data-plane is the default.
  const [source, setSource] = useState("data");

  const { data, error, isLoading, mutate, isValidating, lastUpdated } = useAdminSWR(
    ["interactions", kind, status, source],
    async () => {
      const base: MetricsQuery = {
        limit: 500,
        ...(status !== "all" ? { success: status === "ok" } : {}),
      };
      // Each query is one server-side slice; admin can only appear under route_kind=acp,
      // so route_kind=llm/mcp are inherently admin-free and acp is pinned to a data-plane
      // route_protocol (openai/anthropic/cc/mcp/acp) to exclude the "admin" polls.
      const queries: MetricsQuery[] = [];
      const dataAcp = { route_kind: "acp", route_protocol: "acp" };
      if (source === "admin") {
        queries.push({ ...base, route_protocol: "admin", ...(kind !== "all" ? { route_kind: kind } : {}) });
      } else if (source === "data") {
        if (kind === "acp") queries.push({ ...base, ...dataAcp });
        else if (kind !== "all") queries.push({ ...base, route_kind: kind });
        else queries.push({ ...base, route_kind: "llm" }, { ...base, route_kind: "mcp" }, { ...base, ...dataAcp });
      } else {
        // "all" — no source constraint; honour the Protocol selector only.
        queries.push({ ...base, ...(kind !== "all" ? { route_kind: kind } : {}) });
      }
      const results = await Promise.all(queries.map((query) => getInteractions(query)));
      return { items: results.flatMap((r) => r.items ?? []) };
    },
    { live: true },
  );

  const events = useMemo(() => data?.items ?? [], [data]);

  const traces = useMemo(() => groupTraces(events), [events]);
  const multiSpan = traces.filter((t) => t.spanCount > 1);

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

function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function TraceCard({ trace }: { trace: Trace }) {
  const [open, setOpen] = useState(trace.spanCount > 1 || !trace.ok);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <Card className="p-0">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
        <span className={`h-2 w-2 shrink-0 rounded-full ${trace.ok ? "bg-emerald-400" : "bg-rose-400"}`} />
        <CardTitle className="truncate">{trace.rootLabel}</CardTitle>
        {trace.protocols.map((p) => (
          <Badge key={p} tone={protocolTone(p)} className="shrink-0 uppercase">{p}</Badge>
        ))}
        {!trace.ok && <Badge tone="red" className="shrink-0">{trace.errorCount} error{trace.errorCount === 1 ? "" : "s"}</Badge>}
        <Badge tone="neutral" className="shrink-0">{trace.spanCount} span{trace.spanCount === 1 ? "" : "s"}</Badge>
        <span className="ml-auto shrink-0 text-xs tabular-nums text-slate-400">{fmtMs(trace.duration)}</span>
        <span className="shrink-0 text-xs text-slate-600" suppressHydrationWarning>{new Date(trace.startedAt).toLocaleTimeString()}</span>
        <span className="shrink-0 text-slate-500">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="border-t border-slate-700/60">
          {/* Timeline axis */}
          <div className="flex items-center gap-2 px-4 pt-2 text-[10px] tabular-nums text-slate-600">
            <span className="font-mono">{trace.traceId}</span>
            <span className="ml-auto">0</span>
            <span className="flex-1" />
            <span>{fmtMs(trace.duration)}</span>
          </div>

          <div className="px-2 py-1.5">
            {trace.flat.map((n) => (
              <WaterfallRow
                key={n.event.event_id}
                node={n}
                trace={trace}
                selected={selected === n.event.event_id}
                onSelect={() => setSelected((s) => (s === n.event.event_id ? null : n.event.event_id))}
              />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function WaterfallRow({ node, trace, selected, onSelect }: { node: SpanNode; trace: Trace; selected: boolean; onSelect: () => void }) {
  const e = node.event;
  const dur = trace.duration || 1;
  const leftPct = ((node.start - trace.startedAt) / dur) * 100;
  const widthPct = Math.max(((node.end - node.start) / dur) * 100, 1.5);
  const offsetPct = Math.min(leftPct, 99);

  return (
    <div>
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-slate-800/50 ${selected ? "bg-slate-800/60" : ""}`}
      >
        {/* Label column — indentation reflects real tree depth */}
        <div className="flex min-w-0 items-center gap-1.5" style={{ width: "46%", paddingLeft: node.depth * 14 }}>
          {node.depth > 0 && <span className="shrink-0 text-slate-600">└</span>}
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              !e.success ? "bg-rose-400" : node.errorInSubtree ? "bg-amber-400" : "bg-emerald-400"
            }`}
            title={!e.success ? "failed" : node.errorInSubtree ? "error downstream" : "ok"}
          />
          <Badge tone={protocolTone(e.route_kind)} className="shrink-0">{e.route_protocol ?? e.route_kind}</Badge>
          <span className="truncate font-mono text-slate-300">{spanLabel(e)}</span>
          {num(e.tool_call_count) > 0 && (
            <Badge tone="violet" mono className="shrink-0">
              {`🔧 ${parseNames(e.tool_names).join(", ") || e.tool_call_count}`}
            </Badge>
          )}
          {e.agent_id && <Badge tone="blue" mono className="shrink-0">{e.agent_id}</Badge>}
        </div>

        {/* Timeline column */}
        <div className="relative h-3.5 flex-1">
          <div
            className={`absolute top-0.5 h-2.5 rounded-sm ${barClass(e)} ${e.success ? "opacity-80" : ""}`}
            style={{ left: `${offsetPct}%`, width: `${widthPct}%` }}
            title={`${spanLabel(e)} · ${fmtMs(num(e.latency_ms))}`}
          />
        </div>

        <span className="w-14 shrink-0 text-right tabular-nums text-slate-500">{fmtMs(num(e.latency_ms))}</span>
      </button>

      {selected && <SpanDetail event={e} />}
    </div>
  );
}

function SpanDetail({ event: e }: { event: InteractionEvent }) {
  const offered = parseNames(e.request_tool_names);
  const called = parseNames(e.tool_names);
  const rows: [string, string | number | undefined | null][] = [
    ["route_kind", e.route_kind],
    ["route_protocol", e.route_protocol],
    ["route_id", e.route_id],
    ["operation", e.operation],
    ["method", e.method],
    ["tool_name", e.tool_name],
    // LLM tool-use: what the model was offered vs what it actually invoked.
    ["tools_offered", offered.length ? `${offered.length} · ${offered.join(", ")}` : e.request_tool_count],
    ["tools_called", called.length ? `${called.length} · ${called.join(", ")}` : e.tool_call_count],
    ["upstream_model", e.upstream_model],
    ["logical_model", e.logical_model],
    ["provider_id", e.provider_id],
    ["service_id", e.service_id],
    ["agent_type", e.agent_type],
    ["agent_id", e.agent_id],
    ["thread_id", e.thread_id],
    ["session_id", e.session_id],
    ["virtual_key_id", e.virtual_key_id],
    ["status_code", e.status_code],
    ["error_type", e.error_type],
    ["latency_ms", e.latency_ms],
    ["input_tokens", e.input_tokens],
    ["output_tokens", e.output_tokens],
    ["total_tokens", e.total_tokens],
    ["agent_depth", e.agent_depth],
    ["span_id", e.span_id],
    ["parent_span_id", e.parent_span_id],
    ["event_id", e.event_id],
    ["started_at", e.started_at],
    ["finished_at", e.finished_at],
  ];
  const shown = rows.filter(([, v]) => v !== undefined && v !== null && v !== "");

  return (
    <div className="mx-2 mb-1.5 rounded-md border border-slate-700/60 bg-slate-900/60 p-3">
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map(([k, v]) => (
          <div key={k} className="flex gap-2 text-[11px]">
            <span className="w-28 shrink-0 text-slate-500">{k}</span>
            <span className={`truncate font-mono ${k === "error_type" ? "text-rose-300" : "text-slate-300"}`} title={String(v)}>{String(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
