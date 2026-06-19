"use client";

import { Fragment, useState } from "react";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "./types";
import { ToolCallCard } from "./tool-call-card";
import { PlanList } from "./plan-list";
import { PermissionCard } from "./permission-card";

// Lightweight rendering: split on ``` fenced code blocks; everything else is
// shown as pre-wrapped text. Heavier markdown (marked + highlight.js) can be
// layered in later without changing this contract.
function RichText({ text }: { text: string }) {
  if (!text) return null;
  const segments = text.split(/```/);
  return (
    <>
      {segments.map((seg, idx) => {
        const isCode = idx % 2 === 1;
        if (isCode) {
          // Drop an optional language hint on the first line.
          const newline = seg.indexOf("\n");
          const code = newline >= 0 && !seg.slice(0, newline).includes(" ") ? seg.slice(newline + 1) : seg;
          return (
            <pre
              key={idx}
              className="my-2 overflow-auto rounded-md border border-slate-700/70 bg-slate-950/70 p-3 font-mono text-xs leading-relaxed text-slate-200"
            >
              {code.replace(/\n$/, "")}
            </pre>
          );
        }
        return (
          <span key={idx} className="whitespace-pre-wrap break-words">
            {seg}
          </span>
        );
      })}
    </>
  );
}

function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className="mt-2 rounded-md border border-slate-700/60 bg-slate-900/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-medium text-slate-400 hover:text-slate-200"
      >
        <svg
          className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-90")}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M7 5l6 5-6 5V5z" />
        </svg>
        Reasoning
      </button>
      {open && (
        <p className="whitespace-pre-wrap break-words border-t border-slate-700/60 px-3 py-2 text-xs italic text-slate-400">
          {text}
        </p>
      )}
    </div>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  onResolvePermission: (
    messageId: string,
    requestId: string,
    outcome: "selected" | "cancelled",
    optionId?: string,
  ) => Promise<void>;
}

export function MessageBubble({ message, onResolvePermission }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isError = message.role === "error";

  const hasBody =
    message.text.trim() ||
    message.reasoning.trim() ||
    message.toolCalls.length > 0 ||
    message.permissions.length > 0 ||
    (message.plan != null);

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg border px-3.5 py-2.5 text-sm",
          isUser && "border-blue-500/40 bg-blue-500/10 text-slate-100",
          !isUser && !isError && "border-slate-700/70 bg-slate-900/60 text-slate-200",
          isError && "border-rose-500/40 bg-rose-500/10 text-rose-200",
        )}
      >
        {message.plan != null && <PlanList plan={message.plan} />}

        <Reasoning text={message.reasoning} />

        {message.toolCalls.map((tc) => (
          <ToolCallCard key={tc.id} toolCall={tc} />
        ))}

        {message.text.trim() && (
          <div className={cn(message.toolCalls.length > 0 || message.plan != null ? "mt-2" : undefined)}>
            <RichText text={message.text} />
          </div>
        )}

        {message.permissions.map((perm) => (
          <PermissionCard
            key={perm.request_id}
            permission={perm}
            onResolve={(requestId, outcome, optionId) =>
              onResolvePermission(message.id, requestId, outcome, optionId)
            }
          />
        ))}

        {message.status === "streaming" && !hasBody && (
          <span className="inline-flex items-center gap-1 text-slate-500">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-500" />
            <span className="text-xs">Thinking…</span>
          </span>
        )}

        {(message.status === "done" || message.status === "cancelled") &&
          (message.stopReason || message.usage != null) && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
              {message.status === "cancelled" && <span>cancelled</span>}
              {message.stopReason && message.stopReason !== "end_turn" && (
                <span>{message.stopReason}</span>
              )}
              {message.usage != null && <UsageBadge usage={message.usage} />}
            </div>
          )}
      </div>
    </div>
  );
}

function UsageBadge({ usage }: { usage: unknown }) {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const parts: string[] = [];
  const num = (k: string): number | undefined => (typeof u[k] === "number" ? (u[k] as number) : undefined);
  const input = num("input_tokens") ?? num("inputTokens");
  const output = num("output_tokens") ?? num("outputTokens");
  const total = num("total_tokens") ?? num("totalTokens");
  if (input != null || output != null) {
    parts.push(`${input ?? 0} in / ${output ?? 0} out`);
  } else if (total != null) {
    parts.push(`${total} tokens`);
  }
  const cost = num("cost_amount") ?? num("costAmount");
  if (cost != null) parts.push(`$${cost.toFixed(4)}`);
  if (parts.length === 0) return null;
  return <Fragment>{parts.map((p, i) => <span key={i}>{p}</span>)}</Fragment>;
}
