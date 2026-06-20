"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

const STORAGE_KEY = "agw.autoRefreshMs";

/** Selectable auto-refresh intervals. `0` means off. */
export const REFRESH_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Off" },
  { value: 5000, label: "5s" },
  { value: 10000, label: "10s" },
  { value: 30000, label: "30s" },
];

interface AutoRefreshState {
  /** Global refresh interval in ms; 0 = off. */
  intervalMs: number;
  setIntervalMs: (ms: number) => void;
}

const AutoRefreshContext = createContext<AutoRefreshState | null>(null);

export function AutoRefreshProvider({ children }: { children: ReactNode }) {
  // Lazily read the persisted interval (guarded for SSR).
  const [intervalMs, setIntervalMsState] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : 0;
  });

  const setIntervalMs = useCallback((ms: number) => {
    setIntervalMsState(ms);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, String(ms));
  }, []);

  const value = useMemo(() => ({ intervalMs, setIntervalMs }), [intervalMs, setIntervalMs]);
  return <AutoRefreshContext.Provider value={value}>{children}</AutoRefreshContext.Provider>;
}

export function useAutoRefresh(): AutoRefreshState {
  const ctx = useContext(AutoRefreshContext);
  if (!ctx) return { intervalMs: 0, setIntervalMs: () => {} };
  return ctx;
}
