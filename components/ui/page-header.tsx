import { cn } from "@/lib/utils";
import { type ReactNode } from "react";

/**
 * Standard page header: title + optional description, with a right-aligned
 * slot for status pills and action buttons. Replaces the per-page hand-written
 * `<section className="rounded-lg border ... p-4">` header block.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("glass-card rounded-lg p-4", className)}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">{title}</h1>
          {description && <div className="mt-1 text-sm text-slate-400">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
      </div>
    </section>
  );
}
