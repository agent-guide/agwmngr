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
import {
  getTenantRuntimeAttention,
  listAgentDefinitions,
  listAgentDeployments,
  listAgentReleases,
  listDeploymentObservations,
  type AgentDefinition,
  type AgentDeployment,
  type AgentRelease,
  type DeploymentObservation,
  type TenantRuntimeAttention,
} from "@/lib/platform-api";
import { platformAgentHref } from "@/lib/platform-agent-ui";
import { isUnhealthyAgentHealth } from "@/lib/platform-health";

export function WorkbenchPage() {
  const { user, platformAccess, platformAccessError } = useCurrentUser();
  const { t, locale } = useI18n();
  const options = useMemo(() => (platformAccess?.memberships ?? []).map((membership) => ({
    value: membership.tenantId,
    label: membership.tenant.name,
  })), [platformAccess?.memberships]);
  const [chosen, setChosen] = useState("");
  const tenantId = options.some((item) => item.value === chosen) ? chosen : options[0]?.value ?? "";
  const membership = platformAccess?.memberships.find((item) => item.tenantId === tenantId);
  const [definitions, setDefinitions] = useState<AgentDefinition[]>([]);
  const [releases, setReleases] = useState<AgentRelease[]>([]);
  const [deployments, setDeployments] = useState<AgentDeployment[]>([]);
  const [health, setHealth] = useState<DeploymentObservation[]>([]);
  const [attention, setAttention] = useState<TenantRuntimeAttention>({ ownInvocations: [], managed: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const gatewayAllowed = Boolean(user?.is_platform_admin);
  const isTenantAdmin = membership?.role === "admin";

  const load = useCallback(async () => {
    if (!tenantId) {
      setDefinitions([]); setReleases([]); setDeployments([]); setHealth([]);
      setAttention({ ownInvocations: [], managed: [] }); setLoading(false); return;
    }
    setLoading(true); setError(null);
    try {
      const [nextDefinitions, nextAttention] = await Promise.all([
        listAgentDefinitions(tenantId),
        getTenantRuntimeAttention(tenantId),
      ]);
      const [nextReleases, nextDeployments, healthRows] = await Promise.all([
        Promise.all(nextDefinitions.map((item) => listAgentReleases(tenantId, item.id))).then((items) => items.flat()),
        isTenantAdmin ? listAgentDeployments(tenantId) : Promise.resolve([]),
        isTenantAdmin ? listDeploymentObservations(tenantId, "health") : Promise.resolve([]),
      ]);
      setDefinitions([...nextDefinitions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5));
      setReleases([...nextReleases].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5));
      setDeployments(nextDeployments);
      setHealth(healthRows);
      setAttention(nextAttention);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("workbench.loadFailed"));
    } finally { setLoading(false); }
  }, [isTenantAdmin, t, tenantId]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const deploymentById = new Map(deployments.map((item) => [item.id, item]));
  const unhealthy = health.filter((item) =>
    deploymentById.get(item.deploymentId)?.lifecycleState !== "offline" &&
    isUnhealthyAgentHealth(item.data));
  const failed = deployments.filter((item) => item.lifecycleState === "partial_failure" || item.operationState === "reconciliation_required");
  const managedAttention = attention.managed.filter((item) =>
    item.pendingPermissions.length > 0 || item.runningRuns.length > 0);
  const pendingCount = attention.managed.reduce((total, item) => total + item.pendingPermissions.length, 0);
  const runningCount = attention.managed.reduce((total, item) => total + item.runningRuns.length, 0);

  return <div className="space-y-4">
    <PageHeader title={t("workbench.title")} description={t("workbench.description")} actions={<>
      {options.length > 0 && <Select name="workbench-tenant" value={tenantId} onChange={setChosen} options={options} />}
      {options.length > 0 && <Link href="/dashboard/agents/new"><Button>{t("agents.new")}</Button></Link>}
    </>} />
    {platformAccessError && <Card className="border-amber-500/30 text-sm text-amber-200">{platformAccessError}</Card>}
    <div className="grid gap-4 md:grid-cols-3">
      <Link href="/dashboard/agents" className="glass-card rounded-lg p-4 hover:border-blue-500/40"><p className="text-xs text-slate-500">{t("workbench.manage")}</p><h2 className="mt-1 text-base font-semibold text-slate-100">{t("nav.agents")}</h2><p className="mt-2 text-xs text-slate-400">{t("workbench.agentsHelp")}</p></Link>
      <Link href="/dashboard/resources/models" className="glass-card rounded-lg p-4 hover:border-blue-500/40"><p className="text-xs text-slate-500">{t("workbench.compose")}</p><h2 className="mt-1 text-base font-semibold text-slate-100">{t("nav.resources")}</h2><p className="mt-2 text-xs text-slate-400">{t("workbench.resourcesHelp")}</p></Link>
      {gatewayAllowed ? <Link href="/dashboard/platform/gateways" className="glass-card rounded-lg p-4 hover:border-teal-500/40"><p className="text-xs text-slate-500">{t("workbench.operate")}</p><h2 className="mt-1 text-base font-semibold text-slate-100">Gateway</h2><p className="mt-2 text-xs text-slate-400">{t("workbench.gatewayHelp")}</p></Link> : <Card><p className="text-xs text-slate-500">{t("workbench.operate")}</p><h2 className="mt-1 text-base font-semibold text-slate-100">Gateway</h2><p className="mt-2 text-xs text-slate-400">{t("workbench.gatewayUnavailable")}</p></Card>}
    </div>
    {loading ? <Card className="p-8 text-center text-sm text-slate-500">{t("common.loading")}</Card>
      : error ? <Card className="border-rose-500/30 p-8 text-center text-sm text-rose-200">{error}</Card>
        : options.length === 0 ? <Card className="p-8 text-center text-sm text-amber-200">{t("authored.membershipRequired")}</Card>
          : <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Card><p className="text-xs text-slate-500">{t("workbench.ownInvocations")}</p><p className="mt-2 text-2xl font-semibold text-slate-100">{attention.ownInvocations.length}</p></Card>
              <Card><p className="text-xs text-slate-500">{t("workbench.visibleDeployments")}</p><p className="mt-2 text-2xl font-semibold text-slate-100">{deployments.length}</p></Card>
              <Card><p className="text-xs text-slate-500">{t("workbench.failedDeployments")}</p><p className="mt-2 text-2xl font-semibold text-rose-300">{failed.length}</p></Card>
              <Card><p className="text-xs text-slate-500">{t("workbench.unhealthyDeployments")}</p><p className="mt-2 text-2xl font-semibold text-amber-300">{unhealthy.length}</p></Card>
              <Card><p className="text-xs text-slate-500">{t("workbench.pendingRuntime")}</p><p className="mt-2 text-2xl font-semibold text-slate-100">{pendingCount + runningCount}</p></Card>
            </div>
            {(failed.length > 0 || unhealthy.length > 0 || managedAttention.length > 0 || attention.ownInvocations.length > 0) && <Card>
              <CardHeader><CardTitle>{t("workbench.attention")}</CardTitle><Badge tone="amber">{failed.length + unhealthy.length + pendingCount + runningCount}</Badge></CardHeader>
              <div className="space-y-2">
                {failed.map((item) => <Link key={`failed:${item.id}`} href={platformAgentHref(item.definitionId, "releases")} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rose-500/30 bg-rose-500/5 p-3"><div><p className="text-sm font-medium text-rose-100">{t("workbench.deploymentNeedsRecovery")}</p><p className="font-mono text-[11px] text-slate-500">{item.id}</p></div><Badge tone="red">{item.failureCode ?? item.operationState}</Badge></Link>)}
                {unhealthy.map((item) => <Link key={`health:${item.deploymentId}`} href={platformAgentHref(item.definitionId, "observability")} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3"><div><p className="text-sm font-medium text-amber-100">{t("workbench.unhealthyDeployment")}</p><p className="font-mono text-[11px] text-slate-500">{item.deploymentId}</p></div><Badge tone="amber">{item.gatewayId}</Badge></Link>)}
                {managedAttention.map((item) => { const deployment = deploymentById.get(item.deploymentId); return <Link key={`runtime:${item.deploymentId}`} href={deployment ? platformAgentHref(deployment.definitionId, "observability") : "/dashboard/observability/overview"} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-700/60 p-3"><div><p className="text-sm font-medium text-slate-100">{t("workbench.runtimeAttention")}</p><p className="font-mono text-[11px] text-slate-500">{item.deploymentId}</p></div><div className="flex gap-2"><Badge tone="amber">{item.pendingPermissions.length} pending</Badge><Badge tone="blue">{item.runningRuns.length} running</Badge></div></Link>; })}
                {attention.ownInvocations.map((item) => <Link key={`context:${item.contextId}`} href="/dashboard/access/endpoints" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-blue-500/20 p-3"><div><p className="text-sm font-medium text-slate-100">{t("workbench.ownContext")}</p><p className="font-mono text-[11px] text-slate-500">{item.contextId}</p></div><Badge tone={item.completedAt ? "neutral" : "blue"}>{item.completedAt ? t("workbench.completed") : t("workbench.live")}</Badge></Link>)}
              </div>
            </Card>}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card><CardHeader><CardTitle>{t("workbench.recentDefinitions")}</CardTitle></CardHeader>{definitions.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">{t("platformAgents.noDefinitions")}</p> : <div className="space-y-2">{definitions.map((item) => <Link key={item.id} href={platformAgentHref(item.id)} className="flex items-center gap-3 rounded-md border border-slate-700/70 p-3 hover:bg-slate-800/40"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-100">{item.draft.name}</p><p className="text-[11px] text-slate-500">{new Date(item.updatedAt).toLocaleString(locale)} · draft v{item.version}</p></div><Badge tone={protocolTone(item.draft.runtime.type)}>{item.draft.runtime.type}</Badge></Link>)}</div>}</Card>
              <Card><CardHeader><CardTitle>{t("workbench.recentReleases")}</CardTitle></CardHeader>{releases.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">{t("platformAgents.noReleases")}</p> : <div className="space-y-2">{releases.map((item) => <Link key={item.id} href={platformAgentHref(item.definitionId, "releases")} className="flex items-center gap-3 rounded-md border border-slate-700/70 p-3 hover:bg-slate-800/40"><div className="min-w-0 flex-1"><p className="truncate font-mono text-xs text-slate-200">{item.definitionId}</p><p className="text-[11px] text-slate-500">{new Date(item.createdAt).toLocaleString(locale)}</p></div><Badge tone="violet">Release {item.number}</Badge></Link>)}</div>}</Card>
            </div>
          </>}
  </div>;
}
