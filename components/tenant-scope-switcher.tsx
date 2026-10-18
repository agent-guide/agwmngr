"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useCurrentUser } from "@/components/current-user-context";
import { useI18n } from "@/components/i18n-provider";
import { tenantEquivalentPath, tenantPathScope } from "@/lib/dashboard-scope";

export function TenantScopeSwitcher() {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const { platformAccess } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const scope = tenantPathScope(pathname);
  const memberships = (platformAccess?.memberships ?? []).filter(
    (membership) => membership.role === "admin",
  );
  const current = memberships.find((membership) => membership.tenantId === scope?.tenantId);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (!scope) return null;
  const label = current?.tenant.name ?? scope.tenantId;
  const navigate = (tenantId: string) => {
    setOpen(false);
    const destination = tenantEquivalentPath(pathname, tenantId);
    if (destination && destination !== pathname) router.push(destination);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => memberships.length > 1 && setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-md border border-slate-600/60 bg-slate-800/60 px-2.5 py-1.5 text-sm text-slate-200"
        aria-haspopup={memberships.length > 1 ? "listbox" : undefined}
        aria-expanded={memberships.length > 1 ? open : undefined}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("tenantScope.label")}</span>
        <span className="max-w-[12rem] truncate font-medium">{label}</span>
        <span className="font-mono text-[10px] text-slate-500">{scope.tenantId}</span>
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-50 mt-1 w-64 overflow-hidden rounded-md border border-slate-700/70 bg-slate-900/95 shadow-xl"
        >
          {memberships.map((membership) => (
            <button
              key={membership.tenantId}
              type="button"
              role="option"
              aria-selected={membership.tenantId === scope.tenantId}
              onClick={() => navigate(membership.tenantId)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-800/70"
            >
              <span className="truncate">{membership.tenant.name}</span>
              <span className="font-mono text-[10px] text-slate-500">{membership.tenantId}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
