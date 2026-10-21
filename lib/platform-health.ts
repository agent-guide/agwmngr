function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const UNHEALTHY_STATES = new Set(["degraded", "unhealthy", "not_executable"]);
const HEALTHY_STATUSES = new Set(["ok", "healthy", "ready", "active"]);

/** Classify the raw Gateway Agent health document returned by /agents/{id}/health. */
export function isUnhealthyAgentHealth(value: unknown): boolean {
  const row = record(value);
  if (!row) return false;
  if (row.runtime_error !== undefined || row.runtime_health_error !== undefined) return true;
  if (row.healthy === false) return true;

  const runtime = record(row.runtime);
  const runtimeHealth = record(row.runtime_health);
  if (runtime?.healthy === false || runtimeHealth?.healthy === false) return true;
  for (const candidate of [runtime?.state, runtimeHealth?.state]) {
    if (typeof candidate === "string" && UNHEALTHY_STATES.has(candidate.toLowerCase())) return true;
  }

  return typeof row.status === "string" && !HEALTHY_STATUSES.has(row.status.toLowerCase());
}
