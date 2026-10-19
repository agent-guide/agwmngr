"use client";

import { useI18n } from "@/components/i18n-provider";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function LanguageSelect({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className={cn("inline-flex items-center gap-2", className)}>
      <span className="sr-only">{t("language.label")}</span>
      <select
        aria-label={t("language.label")}
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
        className="glass-input rounded-md px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-400/30"
      >
        <option value="en-US">{t("language.english")}</option>
        <option value="zh-CN">{t("language.chinese")}</option>
      </select>
    </label>
  );
}
