"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useI18n } from "@/components/i18n-provider";
import { Badge, protocolTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { listPlatformGatewayAgents } from "@/lib/platform-api";

interface AgentRow { id: string; name?: string; disabled?: boolean; runtime?: { type?: string } }

export default function GatewayAgentsPage() {
  const { gatewayId } = useParams<{ gatewayId: string }>();
  const { t } = useI18n();
  const [items, setItems] = useState<AgentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try { setItems(await listPlatformGatewayAgents(gatewayId) as AgentRow[]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("gatewayAgents.loadFailed")); }
  }, [gatewayId, t]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  return <div className="space-y-4"><PageHeader title={t("gatewayAgents.title")}
    description={t("gatewayAgents.description", { gateway: gatewayId })}
    actions={<div className="flex items-center gap-3"><Link href={`/dashboard/platform/gateways/${encodeURIComponent(gatewayId)}/agents/new`}><Button className="px-2.5 py-1 text-xs">{t("agents.new")}</Button></Link><Link href="/dashboard/platform/gateways" className="text-sm text-blue-400 hover:underline">{t("deploymentKeys.back")}</Link></div>} />
    {error && <Card className="border-rose-500/30 text-sm text-rose-300">{error}</Card>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.length === 0 ? <Card className="p-8 text-center text-sm text-slate-500">{t("gatewayAgents.empty")}</Card>
      : items.map((item) => <Card key={item.id}><div className="flex items-start justify-between gap-2"><div><Link className="text-sm font-semibold text-slate-100 hover:text-blue-300" href={`/dashboard/platform/gateways/${encodeURIComponent(gatewayId)}/agents/${encodeURIComponent(item.id)}`}>{item.name ?? item.id}</Link><p className="font-mono text-[11px] text-slate-500">{item.id}</p></div><Badge tone={protocolTone(item.runtime?.type)}>{item.runtime?.type ?? "unknown"}</Badge></div><Badge className="mt-3" tone={item.disabled ? "neutral" : "green"}>{item.disabled ? t("common.disabled") : t("common.enabled")}</Badge></Card>)}</div>
  </div>;
}
