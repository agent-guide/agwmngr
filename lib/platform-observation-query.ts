const allowed = new Set([
  "from", "to", "bucket", "group_by", "order_by", "limit", "success",
  "trace_id", "parent_span_id", "agent_depth",
]);

export function platformObservationQuery(url: string): string {
  const source = new URL(url).searchParams;
  const target = new URLSearchParams();
  for (const [key, value] of source) {
    if (allowed.has(key)) target.set(key, value);
  }
  const query = target.toString();
  return query ? `?${query}` : "";
}
