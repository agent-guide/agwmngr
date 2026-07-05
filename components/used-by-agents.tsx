"use client";

import Link from "next/link";
import { Tooltip } from "@/components/ui/tooltip";

/**
 * Compact "used by N agents" chip for resource list rows. Renders a muted
 * "unused" hint when no agent references the resource (an orphan signal), a
 * direct link to the sole owning agent when there is exactly one, and a
 * tooltip listing all owners otherwise.
 */
export function UsedByAgents({ agentIds, className }: { agentIds?: string[]; className?: string }) {
  const ids = agentIds ?? [];

  if (ids.length === 0) {
    return <span className={className ?? "text-[10px] uppercase tracking-wide text-slate-600"}>unused</span>;
  }

  const chip = (
    <span className="inline-flex items-center gap-1 rounded-md border border-blue-500/25 bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-300">
      {ids.length} agent{ids.length > 1 ? "s" : ""}
    </span>
  );

  if (ids.length === 1) {
    return (
      <Link href={`/dashboard/agents/${encodeURIComponent(ids[0])}`} className={className} title={`Used by ${ids[0]}`}>
        {chip}
      </Link>
    );
  }

  return (
    <Tooltip content={`Used by: ${ids.join(", ")}`} className={className}>
      {chip}
    </Tooltip>
  );
}
