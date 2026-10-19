"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { REFRESH_OPTIONS, useAutoRefresh } from "@/components/auto-refresh-context";
import { useI18n } from "@/components/i18n-provider";

/**
 * Global "Auto-refresh: 5s ▾" control + last-updated stamp + manual refresh,
 * for live pages (runtime, usage, activity). The interval selection is shared
 * across the app via AutoRefreshProvider.
 */
export function AutoRefreshControl({
  lastUpdated,
  onRefresh,
  refreshing = false,
}: {
  lastUpdated?: number | null;
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  const { intervalMs, setIntervalMs } = useAutoRefresh();
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  const relativeTime = (ts: number): string => {
    const seconds = Math.max(0, Math.round((now - ts) / 1000));
    if (seconds < 5) return t("common.updatedJustNow");
    if (seconds < 60) return t("common.updatedSeconds", { count: seconds });
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return t("common.updatedMinutes", { count: minutes });
    return t("common.updatedHours", { count: Math.floor(minutes / 60) });
  };

  // Tick once a second so the relative timestamp stays fresh.
  useEffect(() => {
    if (lastUpdated == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [lastUpdated]);

  return (
    <div className="flex items-center gap-1.5">
      {lastUpdated != null && (
        <span className="text-xs text-slate-500" suppressHydrationWarning>
          {relativeTime(lastUpdated)}
        </span>
      )}
      <span className="flex items-center gap-1 text-xs text-slate-500">
        <span className={intervalMs > 0 ? "h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse-dot" : "h-1.5 w-1.5 rounded-full bg-slate-600"} />
        {t("common.auto")}
      </span>
      <Select
        name="auto-refresh"
        value={String(intervalMs)}
        onChange={(v) => setIntervalMs(Number(v))}
        options={REFRESH_OPTIONS.map((o) => ({
          value: String(o.value),
          label: o.value === 0 ? t("common.off") : o.label,
        }))}
      />
      <Button className="px-2.5 py-1 text-xs" onClick={onRefresh} disabled={refreshing}>
        {refreshing ? t("common.refreshing") : t("common.refresh")}
      </Button>
    </div>
  );
}
