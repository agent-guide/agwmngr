import { gatewayRequestJSON } from "./gateway-proxy";
import type { ResolvedGateway } from "./gateway-resolve";

// The agent data plane (turn/permission/sessions) is served on the runtime's
// public listener, NOT the gateway Admin API. It is reached through a configured
// AgentRoute's path prefix, on the gateway record's dataplane_addr.
//
// Note the host matters: the dispatcher site is commonly bound to 127.0.0.1
// while the admin site is bound to localhost, so a request with the wrong Host
// header falls through to an empty Caddy 200 instead of reaching the dispatcher.
// Default to 127.0.0.1; dataplaneCandidates() flips the two as a fallback.
export function dataplaneAddr(gateway: ResolvedGateway): string {
  return (gateway.dataplaneAddr || "http://127.0.0.1:8080").replace(/\/$/, "");
}

/**
 * Candidate data-plane base URLs to try in order. The Host header (derived from
 * the URL host) must match the dispatcher site's host matcher; since loopback
 * sites bind either localhost or 127.0.0.1, we try the configured host first and
 * the flipped variant as a fallback. Mirrors gateway-proxy's candidate logic.
 */
export function dataplaneCandidates(gateway: ResolvedGateway): string[] {
  const configured = dataplaneAddr(gateway);
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

export class AgentRouteError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AgentRouteError";
  }
}

export interface AgentRouteTarget {
  // Path prefix where the agent route is mounted (e.g. "/agents/codex"), no trailing slash.
  pathPrefix: string;
  // Host constraint, if the route matches on host.
  host?: string;
  requireVirtualKey: boolean;
  // Agent the route targets. Needed to shape the turn's runtime options, which
  // are backend-specific (see resolveAgentRuntimeType).
  agentId: string;
}

interface GatewayAgentRoute {
  match_policy?: { path_prefix?: string; host?: string };
  auth_policy?: { require_virtual_key?: boolean };
  agent_id?: string;
}

/**
 * Resolve an AgentRoute's data-plane target by querying the gateway Admin API.
 * Resolving server-side (rather than trusting the client) keeps the path and
 * auth requirement authoritative.
 *
 * v0.5.0 unified ingress: routes live at /admin/agents/routes and target an
 * agent_id, so the same resolution serves ACP and builtin agents alike.
 */
export async function resolveAgentRouteTarget(
  routeId: string,
  gateway: ResolvedGateway,
): Promise<AgentRouteTarget> {
  let result: { status: number; body: unknown };
  try {
    result = await gatewayRequestJSON(
      "GET",
      `/admin/agents/routes/${encodeURIComponent(routeId)}`,
      gateway,
    );
  } catch (e) {
    throw new AgentRouteError(502, `failed to reach gateway: ${String(e)}`);
  }

  if (result.status === 404) {
    throw new AgentRouteError(404, `agent route not found: ${routeId}`);
  }
  if (result.status >= 400) {
    throw new AgentRouteError(502, `failed to resolve agent route ${routeId} (gateway ${result.status})`);
  }

  const route = (result.body ?? {}) as GatewayAgentRoute;
  const rawPrefix = route.match_policy?.path_prefix?.trim() ?? "";
  if (!rawPrefix) {
    throw new AgentRouteError(400, `agent route ${routeId} has no path_prefix`);
  }
  const normalized = (rawPrefix.startsWith("/") ? rawPrefix : `/${rawPrefix}`).replace(/\/$/, "");

  return {
    pathPrefix: normalized,
    host: route.match_policy?.host?.trim() || undefined,
    requireVirtualKey: Boolean(route.auth_policy?.require_virtual_key),
    agentId: route.agent_id?.trim() ?? "",
  };
}

interface GatewayAgent {
  runtime?: { type?: string };
}

/**
 * Resolve an agent's runtime type (`acp` | `builtin` | `http`).
 *
 * The turn envelope's `options.runtime` object is decoded by the selected
 * backend with DisallowUnknownFields, so its accepted keys differ per backend:
 * ACP requires `thread_id`, while builtin decodes into an empty struct and
 * rejects *every* key with `unsupported_option`. The caller therefore has to
 * know which backend it is addressing before it can build the request, and the
 * AgentRoute view does not carry the runtime type — only the agent id.
 *
 * Resolved server-side rather than taken from the client so the envelope stays
 * correct for any caller, not just a UI that happens to track the runtime.
 */
export async function resolveAgentRuntimeType(
  agentId: string,
  gateway: ResolvedGateway,
): Promise<string> {
  const id = agentId.trim();
  if (!id) throw new AgentRouteError(400, "agent route has no agent_id");

  let result: { status: number; body: unknown };
  try {
    result = await gatewayRequestJSON("GET", `/admin/agents/${encodeURIComponent(id)}`, gateway);
  } catch (e) {
    throw new AgentRouteError(502, `failed to reach gateway: ${String(e)}`);
  }

  if (result.status === 404) {
    // A route naming a non-existent agent is dangling; the turn would 404 too.
    throw new AgentRouteError(404, `agent not found: ${id}`);
  }
  if (result.status >= 400) {
    throw new AgentRouteError(502, `failed to resolve agent ${id} (gateway ${result.status})`);
  }

  const runtimeType = ((result.body ?? {}) as GatewayAgent).runtime?.type?.trim() ?? "";
  if (!runtimeType) {
    throw new AgentRouteError(502, `agent ${id} reports no runtime type`);
  }
  return runtimeType;
}
