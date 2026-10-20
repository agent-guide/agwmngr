export function platformAgentTenantId(id: string): string | null {
  const match = /^agent:([^:]+):[^:]+$/.exec(id);
  return match?.[1] ?? null;
}
