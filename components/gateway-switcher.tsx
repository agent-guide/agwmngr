"use client";

import { useEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/components/current-user-context";

function healthDot(health: string): string {
  if (health === "ok") return "bg-emerald-500";
  if (health === "credential_error") return "bg-red-500";
  return "bg-amber-500";
}

// Header dropdown to choose the active gateway. Lists the gateways the current
// user can reach; selecting one repoints the session and reloads (§6.1).
export function GatewaySwitcher() {
  const { gateways, activeGatewayId, activeGateway, switchGateway } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (gateways.length === 0) return null;

  const label = activeGateway?.name ?? "Select gateway";

  const handleSelect = async (id: string) => {
    setOpen(false);
    if (id === activeGatewayId) return;
    setSwitching(id);
    try {
      await switchGateway(id);
    } finally {
      setSwitching(null);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-slate-600/60 bg-slate-800/60 px-2.5 py-1.5 text-sm text-slate-200 transition-colors hover:border-blue-400/50 hover:text-white"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`h-2 w-2 rounded-full ${healthDot(activeGateway?.health_status ?? "ok")}`} />
        <span className="max-w-[12rem] truncate font-medium">{label}</span>
        {activeGateway?.status === "disabled" && (
          <span className="text-[10px] font-semibold uppercase text-amber-400">disabled</span>
        )}
        <svg className="h-3.5 w-3.5 text-slate-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-50 mt-1 w-64 overflow-hidden rounded-md border border-slate-700/70 bg-slate-900/95 shadow-xl backdrop-blur-sm"
        >
          <p className="border-b border-slate-700/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Active Gateway
          </p>
          {gateways.map((g) => (
            <button
              key={g.id}
              type="button"
              role="option"
              aria-selected={g.id === activeGatewayId}
              onClick={() => handleSelect(g.id)}
              disabled={switching !== null}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-800/70 ${
                g.id === activeGatewayId ? "bg-slate-800/50 text-white" : "text-slate-300"
              }`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${healthDot(g.health_status)}`} />
              <span className="min-w-0 flex-1 truncate">{g.name}</span>
              <span className="text-[10px] uppercase text-slate-500">{g.role}</span>
              {switching === g.id && (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              )}
              {g.id === activeGatewayId && switching === null && (
                <svg className="h-4 w-4 text-blue-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 111.42-1.42l2.79 2.79 6.79-6.79a1 1 0 011.42 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
