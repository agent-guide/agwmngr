import { Card } from "./ui/card";

function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function StructuredDataView({ data, empty = "No data" }: { data: unknown; empty?: string }) {
  const object = record(data);
  if (Array.isArray(data)) return <StructuredRows rows={data} empty={empty} />;
  if (!object) return <p className="text-sm text-slate-300">{display(data)}</p>;

  const scalarEntries = Object.entries(object).filter(([, value]) =>
    value === null || ["string", "number", "boolean", "undefined"].includes(typeof value));
  const nestedEntries = Object.entries(object).filter(([, value]) =>
    Array.isArray(value) || (value !== null && typeof value === "object"));
  if (scalarEntries.length === 0 && nestedEntries.length === 0) {
    return <p className="py-4 text-center text-sm text-slate-500">{empty}</p>;
  }
  return <div className="space-y-3">
    {scalarEntries.length > 0 && <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {scalarEntries.map(([key, value]) => <div key={key} className="rounded-md border border-slate-700/60 bg-slate-950/25 px-3 py-2">
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{humanize(key)}</dt>
        <dd className="mt-1 break-words text-sm text-slate-200">{display(value)}</dd>
      </div>)}
    </dl>}
    {nestedEntries.map(([key, value]) => <section key={key} className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{humanize(key)}</h4>
      {Array.isArray(value)
        ? <StructuredRows rows={value} empty={empty} />
        : <StructuredDataView data={value} empty={empty} />}
    </section>)}
  </div>;
}

export function StructuredRows({ rows, empty = "No data" }: { rows: unknown[]; empty?: string }) {
  if (rows.length === 0) return <p className="py-4 text-center text-sm text-slate-500">{empty}</p>;
  const objects = rows.map(record);
  if (objects.every(Boolean)) {
    const columns = [...new Set(objects.flatMap((item) => Object.keys(item!)))]
      .filter((key) => objects.some((item) => {
        const value = item![key];
        return value === null || value === undefined ||
          ["string", "number", "boolean"].includes(typeof value);
      }))
      .slice(0, 8);
    if (columns.length > 0) return <div className="overflow-x-auto rounded-md border border-slate-700/60">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-slate-900/80 text-[10px] uppercase tracking-wide text-slate-500">
          <tr>{columns.map((column) => <th key={column} className="px-3 py-2 font-semibold">{humanize(column)}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-800/80">
          {objects.map((item, index) => <tr key={index}>
            {columns.map((column) => <td key={column} className="max-w-72 break-words px-3 py-2 text-slate-300">{display(item![column])}</td>)}
          </tr>)}
        </tbody>
      </table>
    </div>;
  }
  return <div className="grid gap-2 sm:grid-cols-2">
    {rows.map((value, index) => <Card key={index} className="p-3"><StructuredDataView data={value} empty={empty} /></Card>)}
  </div>;
}
