import { cn } from "@/lib/utils";

export interface MultiOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

/**
 * Toggle-chip multi-selector. Each option is a button that highlights when
 * selected. Suitable for picking resources/routes from a known list.
 */
export function MultiSelect({
  options,
  selected,
  onChange,
  emptyText = "No options available.",
  className,
}: {
  options: MultiOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyText?: string;
  className?: string;
}) {
  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  if (options.length === 0) {
    return <p className="text-xs text-slate-500">{emptyText}</p>;
  }

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            disabled={o.disabled}
            onClick={() => toggle(o.value)}
            title={o.hint}
            className={cn(
              "rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              on
                ? "border-blue-500/50 bg-blue-500/15 text-blue-200"
                : "border-slate-700/70 bg-slate-900/40 text-slate-300 hover:border-slate-600 hover:text-slate-100",
            )}
          >
            <span className="font-mono">{o.label}</span>
            {o.hint && <span className="ml-1 text-[10px] text-slate-500">{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
