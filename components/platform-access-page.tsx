"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCurrentUser } from "./current-user-context";
import { useI18n } from "./i18n-provider";
import { PlatformAgentTestPanel } from "./platform-agent-test-panel";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardHeader, CardTitle } from "./ui/card";
import { PageHeader } from "./ui/page-header";
import { Select } from "./ui/select";
import {
  listAgentDefinitions,
  listTenantAgentEndpoints,
  type AgentDeploymentEndpoint,
} from "@/lib/platform-api";
import { platformAgentHref } from "@/lib/platform-agent-ui";

export function PlatformAccessPage({ mode }: { mode: "endpoints" | "keys" }) {
  const { platformAccess } = useCurrentUser();
  const { t, locale } = useI18n();
  const tenants = platformAccess?.memberships ?? [];
  const [tenantId, setTenantId] = useState("");
  const [items, setItems] = useState<AgentDeploymentEndpoint[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTenant = tenants.some((item) => item.tenantId === tenantId)
    ? tenantId : tenants[0]?.tenantId ?? "";

  const load = useCallback(async () => {
    if (!selectedTenant) { setItems([]); return; }
    setLoading(true); setError(null);
    try {
      const [endpoints, definitions] = await Promise.all([
        listTenantAgentEndpoints(selectedTenant),
        listAgentDefinitions(selectedTenant),
      ]);
      setItems(endpoints);
      setNames(Object.fromEntries(definitions.map((item) => [item.id, item.draft.name])));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("platformAccess.agentLoadFailed")); }
    finally { setLoading(false); }
  }, [selectedTenant, t]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  const eligibleKeys = useMemo(() => items.flatMap((item) => item.keys.map((key) => ({
    ...key,
    deploymentId: item.deploymentId,
    definitionId: item.definitionId,
    gatewayId: item.gatewayId,
    routeId: item.gatewayRouteId,
    pathPrefix: item.pathPrefix,
  }))), [items]);

  return <div className="space-y-4">
    <PageHeader
      title={t(mode === "endpoints" ? "platformAccess.endpoints" : "platformAccess.keys")}
      description={t(mode === "endpoints" ? "platformAccess.endpointsDescription" : "platformAccess.keysDescription")}
      actions={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => void load()} disabled={loading}>{loading ? t("common.refreshing") : t("common.refresh")}</Button><Select name="access-tenant" value={selectedTenant} onChange={setTenantId}
        options={tenants.map((item) => ({ value: item.tenantId, label: item.tenant.name }))} /></div>}
    />
    {error && <Card className="border-rose-500/30 text-sm text-rose-300">{error}</Card>}
    {!selectedTenant ? <Card className="p-8 text-center text-sm text-slate-500">{t("platformAccess.noTenant")}</Card>
      : loading ? <Card className="p-8 text-center text-sm text-slate-400">{t("common.loading")}</Card>
        : mode === "keys" ? <div className="space-y-3">{eligibleKeys.length === 0
          ? <Card className="p-8 text-center text-sm text-slate-500">{t("platformAccess.noKeys")}</Card>
          : eligibleKeys.map((key) => <Card key={`${key.deploymentId}:${key.id}`}>
            <CardHeader><div><Link href={platformAgentHref(key.definitionId, "access")} className="font-medium text-slate-100 hover:text-blue-300">{names[key.definitionId] ?? key.definitionId}</Link><p className="mt-1 font-mono text-xs text-slate-500">{key.id}</p></div><div className="flex flex-wrap gap-2"><Badge tone={key.disabled ? "amber" : key.status === "stable" ? "green" : "red"}>{key.disabled ? t("common.disabled") : key.status}</Badge><Badge tone="blue">{t("platformAccess.explicitRoute")}</Badge></div></CardHeader>
            <dl className="grid gap-2 text-xs sm:grid-cols-3"><div><dt className="text-slate-500">Gateway</dt><dd className="font-mono text-slate-300">{key.gatewayId}</dd></div><div><dt className="text-slate-500">Route</dt><dd className="break-all font-mono text-slate-300">{key.routeId}</dd></div><div><dt className="text-slate-500">Expires</dt><dd className="text-slate-300">{key.expiresAt ? new Date(key.expiresAt).toLocaleString(locale) : "—"}</dd></div></dl>
            <p className="mt-3 text-[11px] text-slate-500">{t("platformAccess.bearerHidden")}</p>
          </Card>)}</div>
          : <div className="space-y-4">
            {items.length === 0 ? <Card className="p-8 text-center text-sm text-slate-500">{t("platformAccess.noEndpoints")}</Card>
              : <div className="grid gap-3 lg:grid-cols-2">{items.map((item) => <Card key={item.deploymentId}>
                <CardHeader><div><Link href={platformAgentHref(item.definitionId, "access")}><CardTitle>{names[item.definitionId] ?? item.definitionId}</CardTitle></Link><p className="mt-1 font-mono text-[11px] text-slate-500">{item.pathPrefix}</p></div><div className="flex flex-wrap gap-2"><Badge tone={item.protected ? "green" : "red"}>{item.protected ? t("platformAccess.protected") : t("platformAccess.unprotected")}</Badge><Badge tone={item.invocable ? "blue" : "amber"}>{item.invocable ? t("platformAccess.invocable") : t("platformAccess.notInvocable")}</Badge></div></CardHeader>
                <p className="text-xs text-slate-500">{item.gatewayId} · {item.keys.length} eligible keys</p>
              </Card>)}</div>}
            {items.some((item) => item.invocable && item.keys.length > 0) && <><h2 className="text-sm font-semibold text-slate-200">{t("platformAgents.test")}</h2><PlatformAgentTestPanel endpoints={items} /></>}
          </div>}
  </div>;
}
