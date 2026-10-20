"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useI18n } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { listTenantAudit, type TenantAuditEntry } from "@/lib/platform-api";

export default function TenantAuditPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const { t, locale } = useI18n();
  const [items, setItems] = useState<TenantAuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try { setItems(await listTenantAudit(tenantId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("tenantAudit.loadFailed")); }
  }, [tenantId, t]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  return <div className="space-y-4"><PageHeader title={t("tenantAudit.title")} description={t("tenantAudit.description")} />
    {error && <Card className="border-rose-500/30 text-sm text-rose-300">{error}</Card>}
    <Card><CardHeader><CardTitle>{t("tenantAudit.recent")}</CardTitle></CardHeader>
      <div className="space-y-2">{items.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">{t("tenantAudit.empty")}</p>
        : items.map((item) => <div key={item.id} className="grid gap-2 rounded-md border border-slate-700/70 p-3 text-xs md:grid-cols-[160px_90px_1fr_1fr_70px]">
          <span className="text-slate-500">{new Date(item.ts).toLocaleString(locale)}</span>
          <Badge tone={item.decision === "allow" ? "green" : "red"}>{item.decision}</Badge>
          <span className="font-mono text-slate-300">{item.action ?? "—"}</span>
          <span className="truncate text-slate-400">{item.target_kind ?? "—"} · {item.target_id ?? "—"}</span>
          <span className="text-slate-500">{item.http_status ?? "—"}</span>
        </div>)}</div>
    </Card>
  </div>;
}
