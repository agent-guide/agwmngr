"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  getCurrentUser,
  listSessionGateways,
  setActiveGateway as apiSetActiveGateway,
  type CurrentUser,
  type SessionGateway,
} from "@/lib/api";

interface CurrentUserContextValue {
  user: CurrentUser | null;
  loading: boolean;
  gateways: SessionGateway[];
  activeGatewayId: string | null;
  activeGateway: SessionGateway | null;
  switchGateway: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const CurrentUserContext = createContext<CurrentUserContextValue>({
  user: null,
  loading: true,
  gateways: [],
  activeGatewayId: null,
  activeGateway: null,
  switchGateway: async () => {},
  refresh: async () => {},
});

export function CurrentUserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [gateways, setGateways] = useState<SessionGateway[]>([]);
  const [activeGatewayId, setActiveGatewayId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [u, g] = await Promise.all([getCurrentUser(), listSessionGateways().catch(() => null)]);
      setUser(u);
      if (g) {
        setGateways(g.items);
        setActiveGatewayId(g.active_gateway_id);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(t);
  }, [refresh]);

  // Switching the active gateway changes what every proxied request resolves to
  // server-side. A full reload is the simplest way to guarantee no page (SWR or
  // legacy useState/useEffect) shows data from the previous gateway (§6.1).
  const switchGateway = useCallback(
    async (id: string) => {
      if (id === activeGatewayId) return;
      await apiSetActiveGateway(id);
      setActiveGatewayId(id);
      if (typeof window !== "undefined") window.location.reload();
    },
    [activeGatewayId],
  );

  const activeGateway = gateways.find((g) => g.id === activeGatewayId) ?? null;

  return (
    <CurrentUserContext.Provider
      value={{ user, loading, gateways, activeGatewayId, activeGateway, switchGateway, refresh }}
    >
      {children}
    </CurrentUserContext.Provider>
  );
}

export function useCurrentUser(): CurrentUserContextValue {
  return useContext(CurrentUserContext);
}
