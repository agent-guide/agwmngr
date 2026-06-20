"use client";

import { useState } from "react";
import useSWR, { type SWRConfiguration, type SWRResponse } from "swr";
import { useAutoRefresh } from "@/components/auto-refresh-context";

/**
 * SWR wrapper for the admin API. `key` doubles as the cache key (pass `null` to
 * disable the request). When `live` is set, the request auto-refreshes at the
 * global interval chosen via the AutoRefreshControl; otherwise it only revalidates
 * on focus/reconnect. Replaces the per-page useState/useEffect/loading boilerplate.
 *
 * Returns the standard SWR response plus `lastUpdated` (ms epoch of the most
 * recent successful fetch) for "updated Ns ago" UI.
 */
export function useAdminSWR<T>(
  key: string | readonly unknown[] | null,
  fetcher: () => Promise<T>,
  opts?: { live?: boolean } & SWRConfiguration<T>,
): SWRResponse<T> & { lastUpdated: number | null } {
  const { intervalMs } = useAutoRefresh();
  const { live, onSuccess, ...swrOpts } = opts ?? {};
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const res = useSWR<T>(key, fetcher, {
    revalidateOnFocus: true,
    keepPreviousData: true,
    refreshInterval: live ? intervalMs : 0,
    onSuccess: (data, k, config) => {
      setLastUpdated(Date.now());
      onSuccess?.(data, k, config);
    },
    ...swrOpts,
  });

  return { ...res, lastUpdated };
}
