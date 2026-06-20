import { cn } from "@/lib/utils";
import { type ReactNode } from "react";

export type BadgeTone =
  | "neutral"
  | "blue"
  | "green"
  | "amber"
  | "red"
  | "violet"
  | "cyan"
  | "teal";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-slate-500/15 text-slate-300 border-slate-500/25",
  blue: "bg-blue-500/15 text-blue-300 border-blue-500/25",
  green: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  amber: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  red: "bg-rose-500/15 text-rose-300 border-rose-500/25",
  violet: "bg-violet-500/15 text-violet-300 border-violet-500/25",
  cyan: "bg-cyan-500/15 text-cyan-300 border-cyan-500/25",
  teal: "bg-teal-500/15 text-teal-300 border-teal-500/25",
};

/** Small status/label chip. Use `mono` for ids. */
export function Badge({
  children,
  tone = "neutral",
  mono = false,
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  mono?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
        mono && "font-mono",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Maps a route/runtime protocol to a consistent accent colour (§4.11). */
export function protocolTone(kind?: string): BadgeTone {
  switch ((kind ?? "").toLowerCase()) {
    case "llm":
      return "blue";
    case "mcp":
      return "violet";
    case "acp":
      return "teal";
    case "http":
      return "cyan";
    default:
      return "neutral";
  }
}
