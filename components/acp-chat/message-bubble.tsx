"use client";

import { Fragment, useState, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "./types";
import { ToolCallCard } from "./tool-call-card";
import { PlanList } from "./plan-list";
import { PermissionCard } from "./permission-card";

// Tailwind-styled element map so agent markdown (headings, bold, lists, code,
// tables, links) renders inside the dark bubble instead of showing raw `##` /
// `**` markers. Long tokens (e.g. attachment URLs) wrap instead of overflowing.
const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0 leading-relaxed">{children}</p>,
  h1: ({ children }) => <h1 className="mb-1.5 mt-3 text-base font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1.5 mt-3 text-[15px] font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-2.5 text-sm font-semibold first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h4>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed marker:text-slate-500">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-slate-50">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="break-all text-blue-300 underline decoration-blue-400/40 underline-offset-2 hover:text-blue-200"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-slate-600 pl-3 text-slate-400">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-slate-700/70" />,
  code({ className, children, ...props }: ComponentPropsWithoutRef<"code">) {
    const isBlock = /language-/.test(className ?? "") || String(children).includes("\n");
    if (isBlock) {
      return (
        <code className="font-mono text-xs leading-relaxed text-slate-200" {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded bg-slate-800/80 px-1 py-0.5 font-mono text-[0.85em] text-slate-100"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-auto rounded-md border border-slate-700/70 bg-slate-950/70 p-3">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-slate-700/70 px-2 py-1 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-slate-700/70 px-2 py-1 align-top">{children}</td>,
};

function RichText({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="break-words text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
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
