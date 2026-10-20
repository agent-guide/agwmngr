"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "@/components/i18n-provider";
import type { Locale, MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const LANGUAGE_OPTIONS: ReadonlyArray<{
  locale: Locale;
  labelKey: MessageKey;
  shortLabel: string;
}> = [
  { locale: "en-US", labelKey: "language.english", shortLabel: "EN" },
  { locale: "zh-CN", labelKey: "language.chinese", shortLabel: "中文" },
];

export function LanguageSelect({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Partial<Record<Locale, HTMLButtonElement | null>>>({});
  const listboxId = useId();
  const current = LANGUAGE_OPTIONS.find((option) => option.locale === locale) ?? LANGUAGE_OPTIONS[0];
  const currentLabel = t(current.labelKey);

  useEffect(() => {
    if (!open) return;

    optionRefs.current[locale]?.focus();

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [locale, open]);

  const selectLocale = (nextLocale: Locale) => {
    setOpen(false);
    if (nextLocale !== locale) setLocale(nextLocale);
    triggerRef.current?.focus();
  };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    if (event.key === "ArrowDown") nextIndex = (index + 1) % LANGUAGE_OPTIONS.length;
    if (event.key === "ArrowUp") nextIndex = (index - 1 + LANGUAGE_OPTIONS.length) % LANGUAGE_OPTIONS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = LANGUAGE_OPTIONS.length - 1;
    if (nextIndex === undefined) return;

    event.preventDefault();
    optionRefs.current[LANGUAGE_OPTIONS[nextIndex].locale]?.focus();
  };

  return (
    <div ref={rootRef} className={cn("relative inline-flex", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${t("language.label")}: ${currentLabel}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        title={`${t("language.label")}: ${currentLabel}`}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          setOpen(true);
        }}
        className={cn(
          "group flex h-9 items-center gap-2 rounded-full border px-3 text-slate-300",
          "border-slate-600/50 bg-slate-800/60 shadow-sm backdrop-blur-sm",
          "transition-[border-color,background-color,color,box-shadow] hover:border-blue-400/50 hover:bg-slate-800/80 hover:text-slate-50",
          open && "border-blue-400/50 bg-slate-800/80 text-slate-50 shadow-[0_0_0_3px_rgba(59,130,246,0.08)]",
        )}
      >
        <svg
          className="h-4 w-4 shrink-0 text-slate-400 transition-colors group-hover:text-blue-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.2 2.45 3.3 5.45 3.3 9S14.2 18.55 12 21c-2.2-2.45-3.3-5.45-3.3-9S9.8 5.45 12 3Z" />
        </svg>
        <span className="min-w-6 text-center text-xs font-semibold tracking-wide">{current.shortLabel}</span>
        <svg
          className={cn("h-3.5 w-3.5 text-slate-500 transition-transform", open && "rotate-180")}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={t("language.label")}
          className="absolute right-0 top-full z-50 mt-2 w-44 overflow-hidden rounded-xl border border-slate-700/70 bg-slate-900/95 p-1.5 shadow-2xl shadow-black/25 backdrop-blur-xl"
        >
          {LANGUAGE_OPTIONS.map((option, index) => {
            const selected = option.locale === locale;
            return (
              <button
                key={option.locale}
                ref={(element) => { optionRefs.current[option.locale] = element; }}
                type="button"
                role="option"
                aria-selected={selected}
                lang={option.locale}
                tabIndex={selected ? 0 : -1}
                onClick={() => selectLocale(option.locale)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                  selected
                    ? "bg-blue-500/15 font-medium text-blue-300"
                    : "text-slate-300 hover:bg-slate-800/80 hover:text-slate-50",
                )}
              >
                <span className="flex h-6 w-7 shrink-0 items-center justify-center rounded-md border border-slate-700/70 bg-slate-800/70 text-[10px] font-bold tracking-wide text-slate-400">
                  {option.shortLabel}
                </span>
                <span className="min-w-0 flex-1">{t(option.labelKey)}</span>
                {selected && (
                  <svg className="h-4 w-4 shrink-0 text-blue-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 111.42-1.42l2.79 2.79 6.79-6.79a1 1 0 011.42 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
