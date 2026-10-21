"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useI18n } from "@/components/i18n-provider";
import { groupTraces, TraceList } from "@/components/interaction-traces";
import { StructuredDataView } from "@/components/structured-data-view";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import type { InteractionEvent } from "@/lib/api";
import { getPlatformGatewayObservability } from "@/lib/platform-api";

type View = "overview" | "calls" | "usage";

function interactionItems(value: unknown): InteractionEvent[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const items = (value as { items?: unknown }).items;
  return Array.isArray(items) ? items as InteractionEvent[] : [];
}

export default function GatewayObservabilityPage() {
  const { gatewayId } = useParams<{ gatewayId: string }>();
  const { t } = useI18n();
  const [view, setView] = useState<View>("overview");
  const [data, setData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      if (view === "overview") {
        const [summary, recent] = await Promise.all([
          getPlatformGatewayObservability(gatewayId),
          getPlatformGatewayObservability(gatewayId, "/interactions?limit=10"),
        ]);
        setData({ summary, recent });
      } else if (view === "calls") {
        setData({ calls: await getPlatformGatewayObservability(gatewayId, "/interactions?limit=100") });
      } else {
        const from = encodeURIComponent(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
        const query = `?from=${from}&bucket=1h`;
        const [llm, mcp, acp] = await Promise.all([
          getPlatformGatewayObservability(gatewayId, `/llm/timeseries${query}`),
          getPlatformGatewayObservability(gatewayId, `/mcp/timeseries${query}`),
          getPlatformGatewayObservability(gatewayId, `/acp/timeseries${query}`),
        ]);
        setData({ llm, mcp, agent: acp });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("gatewayObservability.loadFailed")); }
    finally { setLoading(false); }
  }, [gatewayId, t, view]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  const calls = interactionItems(view === "calls" ? data.calls : data.recent);
  return <div className="space-y-4">
    <PageHeader title={t("gatewayObservability.title")}
      description={t("gatewayObservability.description", { gateway: gatewayId })} />
    <nav className="flex gap-1 border-b border-slate-700/70">
      {(["overview", "calls", "usage"] as View[]).map((item) => <button key={item} type="button" onClick={() => setView(item)} className={`px-3 py-2 text-sm ${view === item ? "border-b-2 border-blue-400 text-blue-200" : "text-slate-400"}`}>{t(item === "overview" ? "nav.overview" : item === "calls" ? "nav.calls" : "nav.usage")}</button>)}
    </nav>
    {error && <Card className="border-rose-500/30 text-sm text-rose-300">{error}</Card>}
    {loading ? <Card className="p-8 text-center text-sm text-slate-400">{t("common.loading")}</Card> : !error && <>
      {view === "overview" && <Card><CardHeader><CardTitle>{t("nav.overview")}</CardTitle></CardHeader><StructuredDataView data={data.summary} /></Card>}
      {(view === "overview" || view === "calls") && <Card><CardHeader><CardTitle>{t("nav.calls")}</CardTitle></CardHeader>{calls.length > 0 ? <TraceList traces={groupTraces(calls)} /> : <StructuredDataView data={view === "calls" ? data.calls : data.recent} />}</Card>}
      {view === "usage" && <div className="grid gap-4 xl:grid-cols-3">{Object.entries(data).map(([protocol, value]) => <Card key={protocol}><CardHeader><CardTitle>{protocol.toUpperCase()}</CardTitle></CardHeader><StructuredDataView data={value} /></Card>)}</div>}
    </>}
  </div>;
}
