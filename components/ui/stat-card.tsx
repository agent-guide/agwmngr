import { cn } from "@/lib/utils";
import { type ReactNode } from "react";

/**
 * A single metric tile. `tone` colours the value; `sub` is an optional caption.
 * Body text stays >= 12px per the type scale.
 */
export function StatCard({
  label,
  value,
  sub,
  tone = "text-slate-100",
  loading = false,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: string;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("glass-card rounded-lg px-3 py-2.5", className)}>
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", tone)}>
        {loading ? <span className="inline-block h-6 w-10 animate-pulse rounded bg-slate-700/50" /> : value}
      </p>
      {sub != null && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

/** Responsive grid wrapper for a row of StatCards. */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2", className)}>
      {children}
    </section>
  );
}
