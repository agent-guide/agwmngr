"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCurrentUser } from "./current-user-context";
import { useI18n } from "./i18n-provider";
import { StructuredDataView } from "./structured-data-view";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardHeader, CardTitle } from "./ui/card";
import { PageHeader } from "./ui/page-header";
import { Select } from "./ui/select";
import {
  getTenantRuntimeAttention,
  listDeploymentObservations,
  type DeploymentObservation,
  type DeploymentObservationKind,
  type TenantRuntimeAttention,
} from "@/lib/platform-api";
import { platformAgentHref } from "@/lib/platform-agent-ui";

export type TenantObservabilityView = "overview" | "calls" | "usage";

function kindsFor(view: TenantObservabilityView): DeploymentObservationKind[] {
  if (view === "overview") return ["health", "activity"];
  if (view === "calls") return ["interactions"];
  return ["usage"];
}

function countItems(data: unknown): number {
  if (Array.isArray(data)) return data.length;
  if (!data || typeof data !== "object") return 0;
  const row = data as Record<string, unknown>;
  for (const key of ["items", "events", "rows", "calls"]) {
    if (Array.isArray(row[key])) return row[key].length;
  }
  return 1;
}

export function PlatformObservabilityPage({
  tenantId: fixedTenantId,
  view = "overview",
}: {
  tenantId?: string;
  view?: TenantObservabilityView;
}) {
  const { platformAccess } = useCurrentUser();
  const { t } = useI18n();
  const preferredTenantId = useSearchParams().get("tenant") ?? "";
  const tenants = useMemo(() => (platformAccess?.memberships ?? [])
    .filter((membership) => membership.role === "admin")
    .map((membership) => ({ value: membership.tenantId, label: membership.tenant.name })),
  [platformAccess?.memberships]);
  const [chosenTenant, setChosenTenant] = useState("");
  const tenantId = fixedTenantId ?? (tenants.some((item) => item.value === chosenTenant)
    ? chosenTenant : tenants.some((item) => item.value === preferredTenantId)
      ? preferredTenantId : tenants[0]?.value ?? "");
  const [items, setItems] = useState<DeploymentObservation[]>([]);
  const [attention, setAttention] = useState<TenantRuntimeAttention | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!tenantId) { setItems([]); setAttention(null); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const kinds = kindsFor(view);
      const [pages, nextAttention] = await Promise.all([
        Promise.all(kinds.map((kind) => listDeploymentObservations(tenantId, kind))),
        view === "overview" ? getTenantRuntimeAttention(tenantId) : Promise.resolve(null),
      ]);
      setItems(pages.flat());
      setAttention(nextAttention);
    } catch (cause) {
      setItems([]); setAttention(null);
      setError(cause instanceof Error ? cause.message : t("tenantObservability.loadFailed"));
    } finally { setLoading(false); }
  }, [tenantId, t, view]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  const healthCount = items.filter((item) => item.kind === "health").length;
  const rowCount = items.reduce((total, item) => total + countItems(item.data), 0);
  const pendingCount = attention?.managed.reduce((total, item) => total + item.pendingPermissions.length, 0) ?? 0;
  const runningCount = attention?.managed.reduce((total, item) => total + item.runningRuns.length, 0) ?? 0;
  const title = view === "overview" ? t("nav.overview")
    : view === "calls" ? t("tenantObservability.interactions") : t("nav.usage");

  return <div className="space-y-4">
    <PageHeader title={title} description={t("tenantObservability.description")}
      actions={!fixedTenantId && tenants.length > 0 ? <Select name="observability-tenant" value={tenantId}
        onChange={setChosenTenant} options={tenants} /> : undefined} />
    {!tenantId && <Card className="p-8 text-center text-sm text-amber-200">{t("platformAccess.noTenant")}</Card>}
    {error && <Card className="border-rose-500/30 text-sm text-rose-300">{error}</Card>}
    {tenantId && !error && <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card><p className="text-xs text-slate-500">{t("platformAgents.deployments")}</p><p className="mt-1 text-2xl font-semibold text-slate-100">{new Set(items.map((item) => item.deploymentId)).size}</p></Card>
        <Card><p className="text-xs text-slate-500">{view === "overview" ? t("tenantObservability.health") : title}</p><p className="mt-1 text-2xl font-semibold text-slate-100">{view === "overview" ? healthCount : rowCount}</p></Card>
        <Card><p className="text-xs text-slate-500">{t("platformAgents.permissions")}</p><p className="mt-1 text-2xl font-semibold text-slate-100">{pendingCount}</p></Card>
        <Card><p className="text-xs text-slate-500">{t("platformAgents.runs")}</p><p className="mt-1 text-2xl font-semibold text-slate-100">{runningCount}</p></Card>
      </div>
      {loading ? <Card className="p-8 text-center text-sm text-slate-400">{t("common.loading")}</Card>
        : items.length === 0 ? <Card className="p-8 text-center text-sm text-slate-500">{t("tenantObservability.empty")}</Card>
          : <div className="space-y-3">{items.map((item) => <Card key={`${item.deploymentId}:${item.kind}`}>
            <CardHeader><div><CardTitle>{item.definitionId}</CardTitle><p className="mt-1 font-mono text-[11px] text-slate-500">{item.deploymentId}</p></div>
              <div className="flex flex-wrap gap-2"><Badge tone="blue">{t(`tenantObservability.${item.kind}`)}</Badge><Badge tone="neutral">{item.gatewayId}</Badge><Link href={platformAgentHref(item.definitionId, "observability")}><Button variant="ghost" className="px-2 py-1 text-xs">{t("common.open")}</Button></Link></div></CardHeader>
            <StructuredDataView data={item.data} empty={t("tenantObservability.empty")} />
          </Card>)}</div>}
      {view === "overview" && attention && attention.managed.length > 0 && <Card><CardHeader><CardTitle>{t("workbench.attention")}</CardTitle><Badge tone={pendingCount || runningCount ? "amber" : "green"}>{pendingCount + runningCount}</Badge></CardHeader><div className="space-y-2">{attention.managed.map((item) => <div key={item.deploymentId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-700/60 p-3"><div><p className="font-mono text-xs text-slate-200">{item.deploymentId}</p><p className="mt-1 text-[11px] text-slate-500">{item.gatewayId}</p></div><div className="flex gap-2"><Badge tone="amber">{item.pendingPermissions.length} pending</Badge><Badge tone="blue">{item.runningRuns.length} running</Badge></div></div>)}</div></Card>}
    </>}
  </div>;
}
