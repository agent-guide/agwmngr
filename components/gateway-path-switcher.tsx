"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useCurrentUser } from "@/components/current-user-context";
import { useI18n } from "@/components/i18n-provider";
import { gatewayEquivalentPath, gatewayPathScope } from "@/lib/dashboard-scope";

export function GatewayPathSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const { gateways } = useCurrentUser();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const scope = gatewayPathScope(pathname);
  const current = gateways.find((gateway) => gateway.id === scope?.gatewayId);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!scope) return null;
  const navigate = (gatewayId: string) => {
    setOpen(false);
    const destination = gatewayEquivalentPath(pathname, gatewayId);
    if (destination && destination !== pathname) router.push(destination);
  };

  if (gateways.length <= 1) {
    return (
      <div
        aria-label={t("gatewayScope.ariaLabel")}
        className="flex items-center gap-2 rounded-md border border-slate-700/60 bg-slate-900/30 px-2.5 py-1.5 text-sm text-slate-200"
      >
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {t("gatewayScope.label")}
        </span>
        <span className="max-w-[12rem] truncate font-medium">
          {current?.name ?? scope.gatewayId}
        </span>
        <span className="font-mono text-[10px] text-slate-500">{scope.gatewayId}</span>
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-md border border-slate-600/60 bg-slate-800/60 px-2.5 py-1.5 text-sm text-slate-200"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("gatewayScope.label")}</span>
        <span className="max-w-[12rem] truncate font-medium">{current?.name ?? scope.gatewayId}</span>
        <span className="font-mono text-[10px] text-slate-500">{scope.gatewayId}</span>
      </button>
      {open && (
        <div role="listbox" className="absolute right-0 z-50 mt-1 w-72 overflow-hidden rounded-md border border-slate-700/70 bg-slate-900/95 shadow-xl">
          {gateways.map((gateway) => (
            <button
              key={gateway.id}
              type="button"
              role="option"
              aria-selected={gateway.id === scope.gatewayId}
              onClick={() => navigate(gateway.id)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-800/70"
            >
              <span className={`h-2 w-2 rounded-full ${gateway.status === "active" ? "bg-emerald-500" : "bg-amber-500"}`} />
              <span className="min-w-0 flex-1 truncate">{gateway.name}</span>
              <span className="font-mono text-[10px] text-slate-500">{gateway.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
