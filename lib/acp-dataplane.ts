import { gatewayRequestJSON } from "./gateway-proxy";
import { getServerEnv } from "./server-env";

// The ACP data plane (turn/permission/sessions) is served on the runtime's
// public listener, NOT the gateway Admin API at GATEWAY_ADDR. It is reached
// through a configured ACP route's path prefix.
//
// Note the host matters: the dispatcher site is commonly bound to 127.0.0.1
// while the admin site is bound to localhost, so a request with the wrong Host
// header falls through to an empty Caddy 200 instead of reaching the dispatcher.
// Default to 127.0.0.1; dataplaneCandidates() flips the two as a fallback.
export function dataplaneAddr(): string {
  return (getServerEnv("GATEWAY_DATAPLANE_ADDR") || "http://127.0.0.1:8080").replace(/\/$/, "");
}

/**
 * Candidate data-plane base URLs to try in order. The Host header (derived from
 * the URL host) must match the dispatcher site's host matcher; since loopback
 * sites bind either localhost or 127.0.0.1, we try the configured host first and
 * the flipped variant as a fallback. Mirrors gateway-proxy's candidate logic.
 */
export function dataplaneCandidates(): string[] {
  const configured = dataplaneAddr();
  const out = [configured];
  try {
    const url = new URL(configured);
    if (url.hostname === "localhost") {
      url.hostname = "127.0.0.1";
      out.push(url.toString().replace(/\/$/, ""));
    } else if (url.hostname === "127.0.0.1") {
      url.hostname = "localhost";
      out.push(url.toString().replace(/\/$/, ""));
    }
  } catch {
    // Leave the single configured candidate; fetch will report the real error.
  }
  return [...new Set(out)];
}

export class ACPRouteError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ACPRouteError";
  }
}

export interface ACPRouteTarget {
  // Path prefix where the ACP route is mounted (e.g. "/acp/codex"), no trailing slash.
  pathPrefix: string;
  // Host constraint, if the route matches on host.
  host?: string;
  requireVirtualKey: boolean;
}

interface GatewayACPRoute {
  match_policy?: { path_prefix?: string; host?: string };
  auth_policy?: { require_virtual_key?: boolean };
}

/**
 * Resolve an ACP route's data-plane target by querying the gateway Admin API.
 * Resolving server-side (rather than trusting the client) keeps the path and
 * auth requirement authoritative.
 */
export async function resolveACPRouteTarget(routeId: string): Promise<ACPRouteTarget> {
  let result: { status: number; body: unknown };
  try {
    result = await gatewayRequestJSON("GET", `/admin/acp/routes/${encodeURIComponent(routeId)}`);
  } catch (e) {
    throw new ACPRouteError(502, `failed to reach gateway: ${String(e)}`);
  }

  if (result.status === 404) {
    throw new ACPRouteError(404, `ACP route not found: ${routeId}`);
  }
  if (result.status >= 400) {
    throw new ACPRouteError(502, `failed to resolve ACP route ${routeId} (gateway ${result.status})`);
  }

  const route = (result.body ?? {}) as GatewayACPRoute;
  const rawPrefix = route.match_policy?.path_prefix?.trim() ?? "";
  if (!rawPrefix) {
    throw new ACPRouteError(400, `ACP route ${routeId} has no path_prefix`);
  }
  const normalized = (rawPrefix.startsWith("/") ? rawPrefix : `/${rawPrefix}`).replace(/\/$/, "");

  return {
    pathPrefix: normalized,
    host: route.match_policy?.host?.trim() || undefined,
    requireVirtualKey: Boolean(route.auth_policy?.require_virtual_key),
  };
}
