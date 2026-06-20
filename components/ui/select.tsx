import { cn } from "@/lib/utils";

/** Native select styled to match `glass-input`. */
export function Select({
  name,
  value,
  onChange,
  options,
  disabled = false,
  className,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  className?: string;
}) {
  return (
    <select
      name={name}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "glass-input rounded-md px-2.5 py-1.5 text-xs text-slate-200 disabled:opacity-50",
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
