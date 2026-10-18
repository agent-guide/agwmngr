export interface TenantPathScope {
  tenantId: string;
  suffix: string;
}

export interface GatewayPathScope {
  gatewayId: string;
  suffix: string;
}

function decodePathSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function tenantPathScope(pathname: string): TenantPathScope | null {
  const match = /^\/dashboard\/tenant\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!match) return null;
  const tenantId = decodePathSegment(match[1]);
  return tenantId ? { tenantId, suffix: match[2] || "/members" } : null;
}

export function gatewayPathScope(pathname: string): GatewayPathScope | null {
  const match = /^\/dashboard\/platform\/gateways\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!match) return null;
  const gatewayId = decodePathSegment(match[1]);
  return gatewayId ? { gatewayId, suffix: match[2] || "" } : null;
}

export function tenantEquivalentPath(pathname: string, tenantId: string): string | null {
  const scope = tenantPathScope(pathname);
  return scope
    ? `/dashboard/tenant/${encodeURIComponent(tenantId)}${scope.suffix}`
    : null;
}

export function gatewayEquivalentPath(pathname: string, gatewayId: string): string | null {
  const scope = gatewayPathScope(pathname);
  return scope
    ? `/dashboard/platform/gateways/${encodeURIComponent(gatewayId)}${scope.suffix}`
    : null;
}
