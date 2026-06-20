import type { TimeseriesPoint } from "./api";

export type TimeRange = "today" | "7d" | "30d" | "all";

export const TIME_RANGES: { key: TimeRange; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 Days" },
  { key: "30d", label: "30 Days" },
  { key: "all", label: "All Time" },
];

/** Coerce an unknown metric field to a finite number (0 fallback). */
export function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Map a UI time range to { from, to, bucket } query params. */
export function rangeToQuery(range: TimeRange): { from?: string; to?: string; bucket: string } {
  const now = new Date();
  switch (range) {
    case "today": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { from: start.toISOString(), to: now.toISOString(), bucket: "30m" };
    }
    case "7d": {
      const start = new Date(now.getTime() - 7 * 86400_000);
      return { from: start.toISOString(), to: now.toISOString(), bucket: "3h" };
    }
    case "30d": {
      const start = new Date(now.getTime() - 30 * 86400_000);
      return { from: start.toISOString(), to: now.toISOString(), bucket: "1d" };
    }
    case "all":
    default:
      return { bucket: "1d" };
  }
}

/**
 * Collapse a grouped timeseries (possibly many rows per timestamp) into a single
 * series keyed by timestamp, summing request/success/failure/token counts. Returns
 * rows sorted by time with a short `label` for the x-axis.
 */
export function pivotTimeseries(points: TimeseriesPoint[]): {
  label: string;
  ts: number;
  requests: number;
  success: number;
  failure: number;
  tokens: number;
}[] {
  const byTs = new Map<string, { requests: number; success: number; failure: number; tokens: number }>();
  for (const p of points) {
    const ts = p.timestamp;
    const cur = byTs.get(ts) ?? { requests: 0, success: 0, failure: 0, tokens: 0 };
    cur.requests += num(p.request_count);
    cur.success += num(p.success_count);
    cur.failure += num(p.failure_count);
    cur.tokens += num(p.total_tokens);
    byTs.set(ts, cur);
  }
  return [...byTs.entries()]
    .map(([ts, v]) => ({ ...v, ts: new Date(ts).getTime(), label: formatTick(ts) }))
    .sort((a, b) => a.ts - b.ts);
}

function formatTick(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** error rate as a fraction 0..1 from success/failure counts. */
export function errorRate(success: number, failure: number): number {
  const total = success + failure;
  return total === 0 ? 0 : failure / total;
}

export function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}
