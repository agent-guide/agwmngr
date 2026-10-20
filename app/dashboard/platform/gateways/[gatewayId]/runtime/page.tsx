"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useI18n } from "@/components/i18n-provider";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getPlatformGatewayRuntime } from "@/lib/platform-api";

export default function PlatformGatewayRuntimePage() {
  const { gatewayId } = useParams<{ gatewayId: string }>();
  const { t } = useI18n();
  const [data, setData] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      const [acp, builtin, mcp] = await Promise.all([
        getPlatformGatewayRuntime(gatewayId, "acp"),
        getPlatformGatewayRuntime(gatewayId, "builtin"),
        getPlatformGatewayRuntime(gatewayId, "mcp"),
      ]);
      setData({ acp, builtin, mcp });
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("gatewayRuntime.loadFailed")); }
  }, [gatewayId, t]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  return <div className="space-y-4"><PageHeader title={t("gatewayRuntime.title")} description={t("gatewayRuntime.description", { gateway: gatewayId })}
    actions={<Link className="text-sm text-blue-400 hover:underline" href="/dashboard/platform/gateways">{t("deploymentKeys.back")}</Link>} />
    {error && <Card className="border-rose-500/30 text-sm text-rose-300">{error}</Card>}
    {(["acp", "builtin", "mcp"] as const).map((runtime) => <Card key={runtime}><CardHeader><CardTitle>{runtime.toUpperCase()}</CardTitle></CardHeader>
      <pre className="max-h-96 overflow-auto rounded-md border border-slate-700/70 bg-slate-950/50 p-3 text-[11px] text-slate-300">{data[runtime] ? JSON.stringify(data[runtime], null, 2) : t("common.loading")}</pre>
    </Card>)}
  </div>;
}
