"use client";

import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { AutoRefreshControl } from "@/components/ui/auto-refresh-control";
import { useAdminSWR } from "@/hooks/use-admin-swr";
import { groupTraces, TraceList } from "@/components/interaction-traces";
import { getInteractions, listAgents, type MetricsQuery } from "@/lib/api";

// useSearchParams must be under a Suspense boundary (Next static-render rule).
export default function InteractionsPage() {
  return (
    <Suspense fallback={<Card className="p-8 text-center text-sm text-slate-400">Loading interactions…</Card>}>
      <InteractionsView />
    </Suspense>
  );
}

function InteractionsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  // Agent is deep-linkable (?agent=<id>) so the agent workspace can jump here.
  const [agent, setAgentState] = useState(searchParams.get("agent") ?? "all");
  const setAgent = (v: string) => {
    setAgentState(v);
    const params = new URLSearchParams(searchParams.toString());
    if (v === "all") params.delete("agent");
    else params.set("agent", v);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };
  // Admin-plane audit spans (the manager's own Admin API polling — route_protocol
  // "admin", route_kind "acp") are not real orchestration traffic. They accumulate
  // continuously and, being the newest rows, will fill the entire `limit` window and
  // starve out real data-plane traffic. So the source filter is pushed to the SERVER
  // (via route_kind / route_protocol) — filtering client-side after `limit` would go
  // blank the moment admin polling out-numbers the window. Data-plane is the default.
  const [source, setSource] = useState("data");

  // Agent options for the filter. The interactions endpoint resolves agent_id to
  // the agent's full attribution server-side (durable tag OR its owned routes —
  // same selector as the Usage page and /admin/agents/{id}/*), so narrowing to one
  // agent stays complete even for untagged-but-mappable spans.
  const { data: agents } = useAdminSWR("agents-for-interactions", listAgents, {});

  const { data, error, isLoading, mutate, isValidating, lastUpdated } = useAdminSWR(
    ["interactions", kind, status, source, agent],
    async () => {
      const base: MetricsQuery = {
        limit: 500,
        ...(status !== "all" ? { success: status === "ok" } : {}),
        ...(agent !== "all" ? { agent_id: agent } : {}),
      };
      // Each query is one server-side slice. Admin audit spans only ever carry
      // route_kind=acp + route_protocol=admin, so route_kind=llm/mcp/agent are
      // inherently admin-free; agent ingress is additionally pinned to
      // route_protocol=agent so a future admin span cannot leak in.
      const queries: MetricsQuery[] = [];
      const dataAgent = { route_kind: "agent", route_protocol: "agent" };
      if (source === "admin") {
        // Admin audit is the manager's own ACP-runtime polling, not per-protocol
        // traffic, so the Protocol selector does not partition it — constraining
        // by route_kind here would return an empty list for every choice but acp.
        queries.push({ ...base, route_protocol: "admin" });
      } else if (source === "data") {
        if (kind === "agent") queries.push({ ...base, ...dataAgent });
        else if (kind !== "all") queries.push({ ...base, route_kind: kind });
        else queries.push({ ...base, route_kind: "llm" }, { ...base, route_kind: "mcp" }, { ...base, ...dataAgent });
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
        <span>Agent</span>
        <Select
          name="agent"
          value={agent}
          onChange={setAgent}
          options={[{ value: "all", label: "All agents" }, ...(agents ?? []).map((a) => ({ value: a.id, label: a.name || a.id }))]}
        />
        <span className="ml-2">Protocol</span>
        <Select name="kind" value={kind} onChange={setKind} options={[{ value: "all", label: "All" }, { value: "llm", label: "LLM" }, { value: "mcp", label: "MCP" }, { value: "agent", label: "Agent" }]} />
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
        <TraceList traces={traces} />
      )}
    </div>
  );
}
