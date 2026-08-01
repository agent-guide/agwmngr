"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { getACPRuntime, listAgentPermissions, type ACPRuntimePermissionView } from "@/lib/api";
import {
  PendingPermissions,
  normalizeACPRuntimePermission,
  normalizeBrokerPermission,
} from "@/components/acp-pending-permissions";

const EMPTY_PENDING: ACPRuntimePermissionView[] = [];

/**
 * Global alert promoting pending ACP permission requests into a banner instead
 * of burying them in the Runtime tab. Polls independently of the page-level
 * auto-refresh setting so it stays current everywhere. Hidden on the runtime
 * page itself (where the requests are already actionable inline).
 */
export function PermissionBanner() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const { data, mutate: mutateRuntime } = useSWR("global-acp-pending", getACPRuntime, {
    refreshInterval: 20000,
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  });

  const runtimePending = data?.pending_permissions ?? EMPTY_PENDING;
  const agentIds = useMemo(
    () => [...new Set(runtimePending.map((permission) => permission.agent_id))].sort(),
    [runtimePending],
  );
  const { data: brokerPermissions, mutate: mutateBroker } = useSWR(
    agentIds.length ? ["global-agent-permissions", ...agentIds] : null,
    async () => (await Promise.all(agentIds.map(listAgentPermissions))).flat(),
    { refreshInterval: 20000, revalidateOnFocus: true, shouldRetryOnError: false },
  );
  const pending = useMemo(() => {
    const brokerById = new Map((brokerPermissions ?? []).map((permission) => [permission.request_id, permission]));
    return runtimePending.map((permission) => {
      const broker = brokerById.get(permission.request_id);
      return broker ? normalizeBrokerPermission(broker) : normalizeACPRuntimePermission(permission);
    });
  }, [brokerPermissions, runtimePending]);

  if (pending.length === 0) return null;
  if (pathname === "/dashboard/acp/runtime") return null;

  return (
    <section className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10" aria-label="Pending agent permissions">
      <div className="flex items-center gap-2.5 px-4 py-2.5">
        <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400 animate-pulse-dot" />
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-center text-left text-sm font-medium text-amber-200"
          aria-expanded={expanded}
        >
          {pending.length} permission request{pending.length === 1 ? "" : "s"} awaiting a decision
          <span className="ml-auto text-xs font-semibold text-amber-300">{expanded ? "Hide" : "Resolve here"}</span>
        </button>
        <Link href="/dashboard/acp/runtime" className="text-xs text-amber-300 hover:underline">Runtime ↗</Link>
      </div>
      {expanded && (
        <div className="border-t border-amber-500/30 p-3">
          <PendingPermissions
            pending={pending}
            onResolved={() => {
              void mutateRuntime();
              void mutateBroker();
            }}
          />
        </div>
      )}
    </section>
  );
}
