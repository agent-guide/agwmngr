"use client";

import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/components/ui/toast";
import { useCurrentUser } from "@/components/current-user-context";
import { Button } from "@/components/ui/button";
import { listAuditLog, type AuditLogEntry } from "@/lib/api";
import { useI18n } from "@/components/i18n-provider";

function DecisionBadge({ decision }: { decision: "allow" | "deny" }) {
  const { t } = useI18n();
  return (
    <span
      className={
        decision === "allow"
          ? "inline-flex items-center rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30"
          : "inline-flex items-center rounded-md bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-300 ring-1 ring-inset ring-red-500/30"
      }
    >
      {decision === "allow" ? t("audit.allow") : t("audit.deny")}
    </span>
  );
}

type DecisionFilter = "all" | "allow" | "deny";

export default function AuditPage() {
  const { user: me } = useCurrentUser();
  const { showToast } = useToast();
  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [decision, setDecision] = useState<DecisionFilter>("all");
  const { locale, t } = useI18n();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listAuditLog({ decision: decision === "all" ? undefined : decision, limit: 300 }));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("audit.loadFailed"), "error");
    } finally {
      setLoading(false);
    }
  }, [decision, showToast, t]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  if (me && !me.is_platform_admin) {
    return (
      <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center text-sm text-slate-400">
        {t("audit.adminRequired")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">{t("audit.title")}</h1>
            <p className="mt-1 text-sm text-slate-400">
              {t("audit.description")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={decision}
              onChange={(e) => setDecision(e.target.value as DecisionFilter)}
              className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs text-slate-100"
            >
              <option value="all">{t("audit.all")}</option>
              <option value="allow">{t("audit.allowOnly")}</option>
              <option value="deny">{t("audit.denyOnly")}</option>
            </select>
            <Button variant="ghost" onClick={() => void load()} className="px-2.5 py-1 text-xs">{t("common.refresh")}</Button>
          </div>
        </div>
      </section>

      <section className="overflow-x-auto rounded-lg border border-slate-700/70 bg-slate-900/40">
        <div className="sticky top-0 z-10 grid grid-cols-[150px_90px_110px_minmax(0,1fr)_minmax(0,1.4fr)_110px_90px] border-b border-slate-700/70 bg-slate-900/95 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          <span>{t("audit.time")}</span><span>{t("audit.decision")}</span><span>{t("audit.actor")}</span><span>{t("audit.action")}</span><span>{t("audit.path")}</span><span>{t("audit.reason")}</span><span>{t("audit.status")}</span>
        </div>

        {loading ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">{t("audit.loading")}</div>
        ) : rows.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">{t("audit.empty")}</div>
        ) : (
          rows.map((r) => (
            <div
              key={r.id}
              className="grid grid-cols-[150px_90px_110px_minmax(0,1fr)_minmax(0,1.4fr)_110px_90px] items-center border-b border-slate-700/60 px-3 py-2 text-xs last:border-b-0"
            >
              <span className="text-slate-400">{new Date(r.ts).toLocaleString(locale)}</span>
              <span><DecisionBadge decision={r.decision} /></span>
              <span className="truncate text-slate-300">{r.username ?? (r.actor_user_id ? `#${r.actor_user_id}` : "—")}</span>
              <span className="truncate font-mono text-slate-400">{r.action ?? "—"}</span>
              <span className="truncate font-mono text-slate-500">
                <span className="text-slate-400">{r.method}</span> {r.path}
                {r.gateway_id && <span className="ml-1 text-[10px] text-slate-600">[{r.gateway_id}]</span>}
              </span>
              <span className="truncate text-amber-400/80">{r.failure_reason ?? ""}</span>
              <span className="text-slate-400">{r.http_status ?? "—"}</span>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
