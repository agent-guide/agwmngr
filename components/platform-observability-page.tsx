"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "./i18n-provider";
import { Badge } from "./ui/badge";
import { Card, CardHeader, CardTitle } from "./ui/card";
import { PageHeader } from "./ui/page-header";
import { Select } from "./ui/select";
import {
  listDeploymentObservations,
  type DeploymentObservation,
  type DeploymentObservationKind,
} from "@/lib/platform-api";

const kinds: DeploymentObservationKind[] = ["health", "activity", "interactions", "usage"];

export function PlatformObservabilityPage({ tenantId }: { tenantId: string }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<DeploymentObservationKind>("health");
  const [items, setItems] = useState<DeploymentObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setItems(await listDeploymentObservations(tenantId, kind)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("tenantObservability.loadFailed")); }
    finally { setLoading(false); }
  }, [kind, tenantId, t]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  return <div className="space-y-4">
    <PageHeader title={t("tenantObservability.title")} description={t("tenantObservability.description")}
      actions={<Select name="observation-kind" value={kind} onChange={(value) => setKind(value as DeploymentObservationKind)}
        options={kinds.map((value) => ({ value, label: t(`tenantObservability.${value}`) }))} />} />
    {error && <Card className="border-rose-500/30 text-sm text-rose-300">{error}</Card>}
    {loading ? <Card className="p-8 text-center text-sm text-slate-400">{t("common.loading")}</Card>
      : items.length === 0 ? <Card className="p-8 text-center text-sm text-slate-500">{t("tenantObservability.empty")}</Card>
        : items.map((item) => <Card key={item.deploymentId}>
          <CardHeader><div><CardTitle>{item.definitionId}</CardTitle><p className="mt-1 font-mono text-[11px] text-slate-500">{item.deploymentId}</p></div>
            <div className="flex gap-2"><Badge tone="blue">{item.kind}</Badge><Badge tone="neutral">{item.gatewayId}</Badge></div></CardHeader>
          <pre className="max-h-80 overflow-auto rounded-md border border-slate-700/70 bg-slate-950/50 p-3 text-[11px] text-slate-300">{JSON.stringify(item.data, null, 2)}</pre>
        </Card>)}
  </div>;
}
