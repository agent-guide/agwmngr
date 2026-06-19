"use client";

interface PlanEntry {
  content?: string;
  title?: string;
  text?: string;
  status?: string;
  priority?: string;
}

function extractEntries(plan: unknown): PlanEntry[] {
  if (Array.isArray(plan)) return plan as PlanEntry[];
  if (plan && typeof plan === "object") {
    const entries = (plan as { entries?: unknown }).entries;
    if (Array.isArray(entries)) return entries as PlanEntry[];
  }
  return [];
}

function statusMark(status?: string): string {
  switch ((status ?? "").toLowerCase()) {
    case "completed":
    case "done":
      return "✓";
    case "in_progress":
    case "running":
      return "▸";
    default:
      return "○";
  }
}

function statusTone(status?: string): string {
  switch ((status ?? "").toLowerCase()) {
    case "completed":
    case "done":
      return "text-emerald-300";
    case "in_progress":
    case "running":
      return "text-blue-300";
    default:
      return "text-slate-500";
  }
}

export function PlanList({ plan }: { plan: unknown }) {
  const entries = extractEntries(plan);
  if (entries.length === 0) return null;

  return (
    <div className="mt-2 rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Plan</p>
      <ul className="space-y-1">
        {entries.map((entry, idx) => (
          <li key={idx} className="flex items-start gap-2 text-xs text-slate-300">
            <span className={`mt-0.5 shrink-0 ${statusTone(entry.status)}`}>{statusMark(entry.status)}</span>
            <span>{entry.content || entry.title || entry.text || JSON.stringify(entry)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
