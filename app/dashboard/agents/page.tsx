"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCurrentUser } from "@/components/current-user-context";
import { useI18n } from "@/components/i18n-provider";
import { Badge, protocolTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import {
  listAgentDefinitions,
  listAgentReleases,
  listPlatformGatewayAgents,
  type AgentDefinition,
} from "@/lib/platform-api";
import { platformAgentHref } from "@/lib/platform-agent-ui";

type PlatformRow = { definition: AgentDefinition; releaseCount: number };
type GatewayRow = { id: string; name?: string; disabled?: boolean; runtime?: { type?: string } };

function countResources(agent: AgentDefinition): number {
  const resources = agent.draft.resources;
  return resources.toolDefinitionIds.length + resources.skillRevisionIds.length +
    resources.instructionRevisionIds.length + resources.knowledgeBaseIds.length +
    (resources.modelDefinitionId ? 1 : 0);
}

export default function AgentsListPage() {
  const { user, gateways, platformAccess, platformAccessError } = useCurrentUser();
  const { t } = useI18n();
  const tenantOptions = useMemo(() => (platformAccess?.memberships ?? []).map((membership) => ({
    value: membership.tenantId, label: membership.tenant.name,
  })), [platformAccess?.memberships]);
  const gatewayOptions = useMemo(() => gateways.map((gateway) => ({
    value: gateway.id, label: gateway.name,
  })), [gateways]);
  const [chosenTenant, setChosenTenant] = useState("");
  const [chosenGateway, setChosenGateway] = useState("");
  const tenantId = tenantOptions.some((item) => item.value === chosenTenant)
    ? chosenTenant : tenantOptions[0]?.value ?? "";
  const gatewayId = gatewayOptions.some((item) => item.value === chosenGateway)
    ? chosenGateway : gatewayOptions[0]?.value ?? "";
  const [platformRows, setPlatformRows] = useState<PlatformRow[]>([]);
  const [gatewayRows, setGatewayRows] = useState<GatewayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [runtimeFilter, setRuntimeFilter] = useState("all");
  const generation = useRef(0);
  const isPlatformAdmin = Boolean(user?.is_platform_admin);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError(null);
    try {
      const [definitions, gatewayAgents] = await Promise.all([
        tenantId ? listAgentDefinitions(tenantId) : Promise.resolve([]),
        isPlatformAdmin && gatewayId
          ? listPlatformGatewayAgents(gatewayId)
          : Promise.resolve([]),
      ]);
      const rows = await Promise.all(definitions.map(async (definition) => ({
        definition,
        releaseCount: (await listAgentReleases(tenantId, definition.id)).length,
      })));
      if (current === generation.current) {
        setPlatformRows(rows);
        setGatewayRows(gatewayAgents as GatewayRow[]);
      }
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : t("agents.loadFailed"));
    } finally { if (current === generation.current) setLoading(false); }
  }, [gatewayId, isPlatformAdmin, t, tenantId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => { window.clearTimeout(timer); generation.current += 1; };
  }, [load]);

  const normalizedSearch = search.trim().toLowerCase();
  const visiblePlatform = platformRows.filter(({ definition }) =>
    (runtimeFilter === "all" || definition.draft.runtime.type === runtimeFilter) &&
    (!normalizedSearch || `${definition.id} ${definition.draft.name} ${definition.draft.description}`.toLowerCase().includes(normalizedSearch)));
  const visibleGateway = gatewayRows.filter((agent) =>
    (runtimeFilter === "all" || agent.runtime?.type === runtimeFilter) &&
    (!normalizedSearch || `${agent.id} ${agent.name ?? ""}`.toLowerCase().includes(normalizedSearch)));

  return <div className="space-y-4">
    <PageHeader title={t("agents.title")} description={t("platformAgents.inventoryHelp")} actions={<>
      <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => void load()} disabled={loading}>{loading ? t("common.refreshing") : t("common.refresh")}</Button>
      {tenantOptions.length > 0 && <Link href="/dashboard/agents/new"><Button className="px-2.5 py-1 text-xs">{t("agents.new")}</Button></Link>}
      {isPlatformAdmin && gatewayId && <Link href={`/dashboard/platform/gateways/${encodeURIComponent(gatewayId)}/agents/new`}><Button variant="secondary" className="px-2.5 py-1 text-xs">{t("platformAgents.gatewayCreate")}</Button></Link>}
    </>} />
    <div className="flex flex-wrap items-center gap-2">
      {tenantOptions.length > 0 && <Select name="agents-tenant" value={tenantId} onChange={setChosenTenant} options={tenantOptions} />}
      {isPlatformAdmin && gatewayOptions.length > 0 && <Select name="agents-gateway" value={gatewayId} onChange={setChosenGateway} options={gatewayOptions} />}
      <div className="w-full sm:max-w-xs"><Input name="search" value={search} onChange={setSearch} placeholder={t("agents.search")} /></div>
      <Select name="runtime-filter" value={runtimeFilter} onChange={setRuntimeFilter} options={[{ value: "all", label: t("agents.allRuntimes") }, { value: "builtin", label: "builtin" }, { value: "acp", label: "acp" }, { value: "http", label: "http" }]} />
    </div>
    {platformAccessError && <Card className="border-amber-500/30 text-sm text-amber-200">{platformAccessError}</Card>}
    {error ? <Card className="p-8 text-center text-sm text-rose-300">{error}</Card>
      : loading ? <Card className="p-8 text-center text-sm text-slate-400">{t("agents.loading")}</Card>
        : <>
          {tenantOptions.length > 0 && <section className="space-y-2">
            <div className="flex items-center gap-2"><h2 className="text-sm font-semibold text-slate-200">{t("platformAgents.platformManaged")}</h2><Badge tone="blue">Tenant</Badge></div>
            {visiblePlatform.length === 0 ? <Card className="p-8 text-center text-sm text-slate-500">{t("platformAgents.noDefinitions")}</Card>
              : <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{visiblePlatform.map(({ definition, releaseCount }) => <Link key={definition.id} href={platformAgentHref(definition.id)} className="glass-card group rounded-lg p-4 transition-colors hover:border-blue-500/40 hover:bg-blue-500/5"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-100">{definition.draft.name}</p><p className="truncate font-mono text-xs text-slate-500">{definition.id}</p></div><Badge tone={protocolTone(definition.draft.runtime.type)}>{definition.draft.runtime.type}</Badge></div><p className="mt-2 line-clamp-2 min-h-8 text-xs text-slate-400">{definition.draft.description || "—"}</p><div className="mt-3 flex flex-wrap gap-1.5"><Badge tone={definition.status === "active" ? "green" : "neutral"}>{definition.status}</Badge><Badge tone="neutral">draft v{definition.version}</Badge><Badge tone={releaseCount ? "violet" : "amber"}>{t("platformAgents.releaseCount", { count: releaseCount })}</Badge><span className="text-[11px] text-slate-500">{t("platformAgents.resourceCount", { count: countResources(definition) })}</span></div></Link>)}</div>}
          </section>}
          {isPlatformAdmin && gatewayId && <section className="space-y-2">
            <div className="flex items-center gap-2"><h2 className="text-sm font-semibold text-slate-200">{t("platformAgents.gatewayManaged")}</h2><Badge tone="teal">{gatewayId}</Badge></div>
            {visibleGateway.length === 0 ? <Card className="p-8 text-center text-sm text-slate-500">{t("platformAgents.noGatewayAgents")}</Card>
              : <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{visibleGateway.map((agent) => <Link key={agent.id} href={`/dashboard/platform/gateways/${encodeURIComponent(gatewayId)}/agents/${encodeURIComponent(agent.id)}`} className="glass-card rounded-lg p-4 transition-colors hover:border-teal-500/40"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-100">{agent.name ?? agent.id}</p><p className="truncate font-mono text-xs text-slate-500">{agent.id}</p></div><Badge tone={protocolTone(agent.runtime?.type)}>{agent.runtime?.type ?? "unknown"}</Badge></div><div className="mt-3"><Badge tone={agent.disabled ? "neutral" : "green"}>{agent.disabled ? t("common.disabled") : t("common.enabled")}</Badge></div></Link>)}</div>}
          </section>}
          {!tenantOptions.length && !isPlatformAdmin && <Card className="p-8 text-center text-sm text-amber-200">{t("platformAgents.noAccess")}</Card>}
        </>}
  </div>;
}
