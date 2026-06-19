"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ACPPermissionOption, ChatPermission } from "./types";

interface PermissionCardProps {
  permission: ChatPermission;
  onResolve: (requestId: string, outcome: "selected" | "cancelled", optionId?: string) => Promise<void>;
}

function optionId(opt: ACPPermissionOption): string {
  return (opt.optionId ?? opt.option_id ?? opt.id ?? "").trim();
}

function optionLabel(opt: ACPPermissionOption): string {
  return (opt.name ?? opt.label ?? optionId(opt) ?? "Option").trim() || "Option";
}

// "allow"-style options get the primary button; anything reject/deny-shaped
// gets the danger button.
function optionTone(opt: ACPPermissionOption): "primary" | "danger" | "secondary" {
  const kind = (opt.kind ?? "").toLowerCase();
  const id = optionId(opt).toLowerCase();
  if (kind.includes("reject") || kind.includes("deny") || id.includes("deny") || id.includes("reject")) {
    return "danger";
  }
  if (kind.includes("allow") || id.includes("allow") || id.includes("approve")) {
    return "primary";
  }
  return "secondary";
}

function extractOptions(data: unknown): ACPPermissionOption[] {
  if (data && typeof data === "object" && Array.isArray((data as { options?: unknown }).options)) {
    return (data as { options: ACPPermissionOption[] }).options;
  }
  return [];
}

export function PermissionCard({ permission, onResolve }: PermissionCardProps) {
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => extractOptions(permission.data), [permission.data]);
  const resolved = permission.resolved;

  const resolve = async (outcome: "selected" | "cancelled", id?: string) => {
    setBusy(true);
    try {
      await onResolve(permission.request_id, outcome, id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2">
        <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
          Permission
        </span>
        <span className="font-mono text-[11px] text-amber-200/80">{permission.request_id}</span>
      </div>

      {permission.data != null && (
        <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-950/70 p-2 font-mono text-[10px] leading-relaxed text-slate-400">
          {JSON.stringify(permission.data, null, 2)}
        </pre>
      )}

      {resolved ? (
        <p className="mt-2 text-[11px] font-medium text-slate-300">
          {resolved === "selected"
            ? `Approved${permission.optionId ? ` (${permission.optionId})` : ""}`
            : "Rejected"}
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {options.map((opt) => (
            <Button
              key={optionId(opt) || optionLabel(opt)}
              variant={optionTone(opt)}
              disabled={busy}
              className="px-2.5 py-1 text-xs"
              onClick={() => void resolve("selected", optionId(opt) || undefined)}
            >
              {optionLabel(opt)}
            </Button>
          ))}
          {/* Always offer an explicit cancel/deny as a fallback. */}
          <Button
            variant="danger"
            disabled={busy}
            className="px-2.5 py-1 text-xs"
            onClick={() => void resolve("cancelled")}
          >
            {busy ? "Resolving…" : "Reject"}
          </Button>
        </div>
      )}
    </div>
  );
}
