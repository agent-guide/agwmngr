"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useI18n } from "@/components/i18n-provider";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getPlatformGatewayObservability } from "@/lib/platform-api";

export default function GatewayObservabilityPage() {
  const { gatewayId } = useParams<{ gatewayId: string }>();
  const { t } = useI18n();
  const [summary, setSummary] = useState<unknown>();
  const [interactions, setInteractions] = useState<unknown>();
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextSummary, nextInteractions] = await Promise.all([
        getPlatformGatewayObservability(gatewayId),
        getPlatformGatewayObservability(gatewayId, "/interactions?limit=50"),
      ]);
      setSummary(nextSummary); setInteractions(nextInteractions);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("gatewayObservability.loadFailed")); }
  }, [gatewayId, t]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  return <div className="space-y-4"><PageHeader title={t("gatewayObservability.title")}
    description={t("gatewayObservability.description", { gateway: gatewayId })}
    actions={<Link href="/dashboard/platform/gateways" className="text-sm text-blue-400 hover:underline">{t("deploymentKeys.back")}</Link>} />
    {error && <Card className="border-rose-500/30 text-sm text-rose-300">{error}</Card>}
    <Card><CardHeader><CardTitle>{t("nav.overview")}</CardTitle></CardHeader><pre className="max-h-80 overflow-auto rounded-md bg-slate-950/50 p-3 text-[11px] text-slate-300">{summary ? JSON.stringify(summary, null, 2) : t("common.loading")}</pre></Card>
    <Card><CardHeader><CardTitle>{t("nav.interactions")}</CardTitle></CardHeader><pre className="max-h-96 overflow-auto rounded-md bg-slate-950/50 p-3 text-[11px] text-slate-300">{interactions ? JSON.stringify(interactions, null, 2) : t("common.loading")}</pre></Card>
  </div>;
}
