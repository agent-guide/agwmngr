"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge, protocolTone } from "@/components/ui/badge";
import { useAdminSWR } from "@/hooks/use-admin-swr";
import { listAgents } from "@/lib/api";

function countResources(...lists: (string[] | undefined)[]): number {
  return lists.reduce((sum, l) => sum + (l?.length ?? 0), 0);
}

export default function AgentsListPage() {
  const { data, error, isLoading, mutate, isValidating } = useAdminSWR("agents-list", listAgents);
  const [search, setSearch] = useState("");
  const [runtimeFilter, setRuntimeFilter] = useState("all");

  const agents = useMemo(() => {
    let list = data ?? [];
    if (runtimeFilter !== "all") list = list.filter((a) => a.runtime.type === runtimeFilter);
    const s = search.trim().toLowerCase();
    if (s) list = list.filter((a) => a.id.toLowerCase().includes(s) || a.name.toLowerCase().includes(s) || (a.description ?? "").toLowerCase().includes(s));
    return list;
  }, [data, runtimeFilter, search]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Agents"
        description="First-class agents orchestrating LLM, MCP, and ACP resources. Create, observe, and operate them here."
        actions={
          <>
            <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => void mutate()} disabled={isValidating}>
              {isValidating ? "Refreshing…" : "Refresh"}
            </Button>
            <Link href="/dashboard/agents/new">
              <Button className="px-2.5 py-1 text-xs">+ New Agent</Button>
            </Link>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:max-w-xs">
          <Input name="search" value={search} onChange={setSearch} placeholder="Search agents…" />
        </div>
        <Select
          name="runtime-filter"
          value={runtimeFilter}
          onChange={setRuntimeFilter}
          options={[{ value: "all", label: "All runtimes" }, { value: "acp", label: "acp" }, { value: "http", label: "http" }]}
        />
      </div>

      {error ? (
        <Card className="p-8 text-center text-sm text-rose-300">{error instanceof Error ? error.message : "Failed to load agents"}</Card>
      ) : isLoading && !data ? (
        <Card className="p-8 text-center text-sm text-slate-400">Loading agents…</Card>
      ) : agents.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm text-slate-400">
            {data && data.length > 0 ? "No agents match your filter." : "No agents yet."}
          </p>
          {(!data || data.length === 0) && (
            <>
              <p className="max-w-md text-xs text-slate-500">
                An agent binds a runtime (an ACP service or an HTTP endpoint) plus the resources it may use. Create one to start observing and operating it.
              </p>
              <Link href="/dashboard/agents/new"><Button className="px-3 py-1.5 text-xs">+ Create your first agent</Button></Link>
            </>
          )}
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((a) => (
            <Link
              key={a.id}
              href={`/dashboard/agents/${encodeURIComponent(a.id)}`}
              className="glass-card group rounded-lg p-4 transition-colors hover:border-blue-500/40 hover:bg-blue-500/5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-100">{a.name}</p>
                  <p className="truncate font-mono text-xs text-slate-500">{a.id}</p>
                </div>
                <Badge tone={protocolTone(a.runtime.type)}>{a.runtime.type}</Badge>
              </div>
              {a.description && <p className="mt-2 line-clamp-2 text-xs text-slate-400">{a.description}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {a.disabled ? <Badge tone="neutral">disabled</Badge> : <Badge tone="green">enabled</Badge>}
                {a.runtime.acp?.service_id && <Badge tone="teal" mono>{a.runtime.acp.service_id}</Badge>}
                <span className="text-[11px] text-slate-500">
                  {countResources(a.routes.acp_route_ids, a.routes.llm_route_ids, a.routes.mcp_route_ids)} routes ·{" "}
                  {countResources(a.resources.provider_ids, a.resources.mcp_service_ids, a.resources.virtual_key_ids)} resources
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
