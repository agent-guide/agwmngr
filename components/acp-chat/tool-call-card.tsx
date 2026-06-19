"use client";

import { useState } from "react";
import type { ChatToolCall } from "./types";

function statusTone(status?: string): string {
  switch ((status ?? "").toLowerCase()) {
    case "completed":
    case "success":
      return "text-emerald-300";
    case "failed":
    case "error":
      return "text-rose-300";
    case "in_progress":
    case "running":
      return "text-blue-300";
    default:
      return "text-slate-400";
  }
}

export function ToolCallCard({ toolCall }: { toolCall: ChatToolCall }) {
  const [open, setOpen] = useState(false);
  const title = toolCall.title || toolCall.kind || toolCall.id || "Tool call";

  return (
    <div className="mt-2 rounded-md border border-slate-700/70 bg-slate-900/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${open ? "rotate-90" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M7 5l6 5-6 5V5z" />
        </svg>
        <span className="truncate text-xs font-medium text-slate-200">{title}</span>
        {toolCall.kind && toolCall.kind !== title && (
          <span className="rounded bg-slate-800/80 px-1.5 py-0.5 text-[10px] text-slate-400">{toolCall.kind}</span>
        )}
        {toolCall.status && (
          <span className={`ml-auto text-[10px] font-medium ${statusTone(toolCall.status)}`}>{toolCall.status}</span>
        )}
      </button>
      {open && (
        <pre className="max-h-60 overflow-auto border-t border-slate-700/70 px-3 py-2 font-mono text-[10px] leading-relaxed text-slate-400">
          {JSON.stringify(toolCall.raw, null, 2)}
        </pre>
      )}
    </div>
  );
}
