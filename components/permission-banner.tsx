"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { getACPRuntime } from "@/lib/api";

/**
 * Global alert promoting pending ACP permission requests into a banner instead
 * of burying them in the Runtime tab. Polls independently of the page-level
 * auto-refresh setting so it stays current everywhere. Hidden on the runtime
 * page itself (where the requests are already actionable inline).
 */
export function PermissionBanner() {
  const pathname = usePathname();
  const { data } = useSWR("global-acp-pending", getACPRuntime, {
    refreshInterval: 20000,
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  });

  const pending = data?.pending_permissions?.length ?? 0;
  if (pending === 0) return null;
  if (pathname === "/dashboard/acp/runtime") return null;

  return (
    <Link
      href="/dashboard/acp/runtime"
      className="mb-4 flex items-center gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 transition-colors hover:bg-amber-500/15"
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400 animate-pulse-dot" />
      <span className="text-sm font-medium text-amber-200">
        {pending} permission request{pending === 1 ? "" : "s"} awaiting a decision
      </span>
      <span className="ml-auto text-xs font-semibold text-amber-300">Resolve →</span>
    </Link>
  );
}
