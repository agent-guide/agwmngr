export function platformAgentTenantId(id: string): string | null {
  const match = /^agent:([^:]+):[^:]+$/.exec(id);
  return match?.[1] ?? null;
}

export const platformAgentTabs = [
  "overview",
  "configuration",
  "releases",
  "access",
  "observability",
  "test",
] as const;

export type PlatformAgentTab = (typeof platformAgentTabs)[number];

export function platformAgentTab(value: string): PlatformAgentTab | null {
  return platformAgentTabs.includes(value as PlatformAgentTab)
    ? value as PlatformAgentTab
    : null;
}

export function platformAgentHref(id: string, tab: PlatformAgentTab = "overview"): string {
  return `/dashboard/agents/${encodeURIComponent(id)}/${tab}`;
}
