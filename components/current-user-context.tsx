"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  getCurrentUser,
  listSessionGateways,
  setActiveGateway as apiSetActiveGateway,
  type CurrentUser,
  type SessionGateway,
} from "@/lib/api";
import { getPlatformAccess, type PlatformAccessProjection } from "@/lib/platform-api";
import { useI18n } from "@/components/i18n-provider";

interface CurrentUserContextValue {
  user: CurrentUser | null;
  loading: boolean;
  gateways: SessionGateway[];
  activeGatewayId: string | null;
  activeGateway: SessionGateway | null;
  platformAccess: PlatformAccessProjection | null;
  platformAccessError: string | null;
  switchGateway: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const CurrentUserContext = createContext<CurrentUserContextValue>({
  user: null,
  loading: true,
  gateways: [],
  activeGatewayId: null,
  activeGateway: null,
  platformAccess: null,
  platformAccessError: null,
  switchGateway: async () => {},
  refresh: async () => {},
});

export function CurrentUserProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [gateways, setGateways] = useState<SessionGateway[]>([]);
  const [activeGatewayId, setActiveGatewayId] = useState<string | null>(null);
  const [platformAccess, setPlatformAccess] = useState<PlatformAccessProjection | null>(null);
  const [platformAccessError, setPlatformAccessError] = useState<string | null>(null);
  const refreshGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    try {
      const [u, g, accessResult] = await Promise.all([
        getCurrentUser(),
        listSessionGateways().catch(() => null),
        getPlatformAccess().then(
          (access) => ({ access, error: null }),
          (error: unknown) => ({
            access: null,
            error: error instanceof Error ? error.message : t("platformAccess.loadFailed"),
          }),
        ),
      ]);
      if (generation !== refreshGeneration.current) return;
      setUser(u);
      setPlatformAccess(accessResult.access);
      setPlatformAccessError(accessResult.error);
      if (g) {
        setGateways(g.items);
        setActiveGatewayId(g.active_gateway_id);
      }
    } catch (error) {
      if (generation !== refreshGeneration.current) return;
      setUser(null);
      setPlatformAccess(null);
      setPlatformAccessError(
        error instanceof Error ? error.message : t("platformAccess.userLoadFailed"),
      );
    } finally {
      if (generation === refreshGeneration.current) setLoading(false);
    }
  }, [t]);

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
      value={{
        user,
        loading,
        gateways,
        activeGatewayId,
        activeGateway,
        platformAccess,
        platformAccessError,
        switchGateway,
        refresh,
      }}
    >
      {children}
    </CurrentUserContext.Provider>
  );
}

export function useCurrentUser(): CurrentUserContextValue {
  return useContext(CurrentUserContext);
}
