"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCurrentUser } from "./current-user-context";
import { useI18n } from "./i18n-provider";
import { Badge, protocolTone } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardHeader, CardTitle } from "./ui/card";
import { PageHeader } from "./ui/page-header";
import { Select } from "./ui/select";
import { listAgentDefinitions, listAgentReleases, type AgentDefinition, type AgentRelease } from "@/lib/platform-api";

export function WorkbenchPage() {
  const { user, activeGateway, platformAccess, platformAccessError } = useCurrentUser();
  const { t, locale } = useI18n();
  const options = useMemo(() => (platformAccess?.memberships ?? []).map((membership) => ({ value: membership.tenantId, label: membership.tenant.name })), [platformAccess?.memberships]);
  const [chosen, setChosen] = useState("");
  const tenantId = options.some((item) => item.value === chosen) ? chosen : options[0]?.value ?? "";
  const [definitions, setDefinitions] = useState<AgentDefinition[]>([]);
  const [releases, setReleases] = useState<AgentRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const gatewayAllowed = Boolean(user?.is_platform_admin || activeGateway?.role === "admin");
  const load = useCallback(async () => {
    if (!tenantId) { setDefinitions([]); setReleases([]); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const nextDefinitions = await listAgentDefinitions(tenantId);
      const nextReleases = (await Promise.all(nextDefinitions.map((item) => listAgentReleases(tenantId, item.id)))).flat();
      setDefinitions([...nextDefinitions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5));
      setReleases([...nextReleases].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("workbench.loadFailed")); }
    finally { setLoading(false); }
  }, [t, tenantId]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  return <div className="space-y-4"><PageHeader title={t("workbench.title")} description={t("workbench.description")} actions={<>{options.length > 0 && <Select name="workbench-tenant" value={tenantId} onChange={setChosen} options={options} />}{options.length > 0 && <Link href="/dashboard/agents/new"><Button>{t("agents.new")}</Button></Link>}</>} />
    {platformAccessError && <Card className="border-amber-500/30 text-sm text-amber-200">{platformAccessError}</Card>}
    <div className="grid gap-4 md:grid-cols-3"><Link href="/dashboard/agents" className="glass-card rounded-lg p-4 hover:border-blue-500/40"><p className="text-xs text-slate-500">{t("workbench.manage")}</p><h2 className="mt-1 text-base font-semibold text-slate-100">{t("nav.agents")}</h2><p className="mt-2 text-xs text-slate-400">{t("workbench.agentsHelp")}</p></Link><Link href="/dashboard/resources/models" className="glass-card rounded-lg p-4 hover:border-blue-500/40"><p className="text-xs text-slate-500">{t("workbench.compose")}</p><h2 className="mt-1 text-base font-semibold text-slate-100">{t("nav.resources")}</h2><p className="mt-2 text-xs text-slate-400">{t("workbench.resourcesHelp")}</p></Link>{gatewayAllowed ? <Link href="/dashboard/general/overview" className="glass-card rounded-lg p-4 hover:border-teal-500/40"><p className="text-xs text-slate-500">{t("workbench.operate")}</p><h2 className="mt-1 text-base font-semibold text-slate-100">Gateway</h2><p className="mt-2 text-xs text-slate-400">{t("workbench.gatewayHelp")}</p></Link> : <Card><p className="text-xs text-slate-500">{t("workbench.operate")}</p><h2 className="mt-1 text-base font-semibold text-slate-100">Gateway</h2><p className="mt-2 text-xs text-slate-400">{t("workbench.gatewayUnavailable")}</p></Card>}</div>
    {loading ? <Card className="p-8 text-center text-sm text-slate-500">{t("common.loading")}</Card> : error ? <Card className="border-rose-500/30 p-8 text-center text-sm text-rose-200">{error}</Card> : options.length === 0 ? <Card className="p-8 text-center text-sm text-amber-200">{t("authored.membershipRequired")}</Card> : <div className="grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle>{t("workbench.recentDefinitions")}</CardTitle></CardHeader>{definitions.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">{t("platformAgents.noDefinitions")}</p> : <div className="space-y-2">{definitions.map((item) => <Link key={item.id} href={`/dashboard/agents/${encodeURIComponent(item.id)}`} className="flex items-center gap-3 rounded-md border border-slate-700/70 p-3 hover:bg-slate-800/40"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-100">{item.draft.name}</p><p className="text-[11px] text-slate-500">{new Date(item.updatedAt).toLocaleString(locale)} · draft v{item.version}</p></div><Badge tone={protocolTone(item.draft.runtime.type)}>{item.draft.runtime.type}</Badge></Link>)}</div>}</Card><Card><CardHeader><CardTitle>{t("workbench.recentReleases")}</CardTitle></CardHeader>{releases.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">{t("platformAgents.noReleases")}</p> : <div className="space-y-2">{releases.map((item) => <Link key={item.id} href={`/dashboard/agents/${encodeURIComponent(item.definitionId)}`} className="flex items-center gap-3 rounded-md border border-slate-700/70 p-3 hover:bg-slate-800/40"><div className="min-w-0 flex-1"><p className="truncate font-mono text-xs text-slate-200">{item.definitionId}</p><p className="text-[11px] text-slate-500">{new Date(item.createdAt).toLocaleString(locale)}</p></div><Badge tone="violet">Release {item.number}</Badge></Link>)}</div>}</Card></div>}
  </div>;
}
