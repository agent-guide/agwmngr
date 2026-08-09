import { gatewayRequestJSON } from "./gateway-proxy";
import type { ResolvedGateway } from "./gateway-resolve";

// Server-side Virtual Key resolution for the Chat data plane
// (docs/resource-rbac-design.md §10.2).
//
// The browser used to hold the bearer: it read /admin/virtual_keys, kept the raw
// value in component state, and posted it back on every turn. Once the Virtual
// Key read path is redacted that is no longer possible — and it was the weaker
// design anyway. The browser now sends a key *ID*, which is input to resolution,
// not authority: the manager has already authorized the session for
// `runtime:chat` on this gateway, and the checks below confirm the selected key
// is actually usable on the resolved route before the bearer is injected
// server-to-server.
//
// This helper deliberately talks to the gateway Admin API directly rather than
// traversing the manager's own redacted HTTP handlers, and it is only ever
// called from server-side route handlers — the bearer must not become reachable
// from a browser-facing response.

export class VirtualKeyError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "VirtualKeyError";
  }
}

interface GatewayVirtualKey {
  key?: string;
  disabled?: boolean;
  allowed_route_ids?: string[];
  expires_at?: string;
}

function isExpired(expiresAt?: string): boolean {
  if (!expiresAt || expiresAt === "0001-01-01T00:00:00Z") return false;
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) && at <= Date.now();
}

/**
 * Resolve a Virtual Key ID to the bearer the data plane expects.
 *
 * `routeId` is the agent route the turn is about to hit; a key whose allowlist
 * does not cover it is rejected here with a clear message instead of becoming an
 * opaque 401 from the data plane. An empty allowlist means "all routes", which
 * matches the gateway's own semantics.
 */
export async function resolveVirtualKeySecret(
  keyId: string,
  routeId: string,
  gateway: ResolvedGateway,
): Promise<string> {
  const id = keyId.trim();
  if (!id) throw new VirtualKeyError(400, "virtual_key_id is required");

  let result: { status: number; body: unknown };
  try {
    result = await gatewayRequestJSON(
      "GET",
      `/admin/virtual_keys/${encodeURIComponent(id)}`,
      gateway,
    );
  } catch (e) {
    throw new VirtualKeyError(502, `failed to reach gateway: ${String(e)}`);
  }

  if (result.status === 404) throw new VirtualKeyError(404, `virtual key not found: ${id}`);
  if (result.status >= 400) {
    throw new VirtualKeyError(502, `failed to resolve virtual key ${id} (gateway ${result.status})`);
  }

  const vk = (result.body ?? {}) as GatewayVirtualKey;
  if (vk.disabled) throw new VirtualKeyError(403, `virtual key ${id} is disabled`);
  if (isExpired(vk.expires_at)) throw new VirtualKeyError(403, `virtual key ${id} has expired`);

  const allowed = vk.allowed_route_ids ?? [];
  if (allowed.length > 0 && !allowed.includes(routeId)) {
    throw new VirtualKeyError(403, `virtual key ${id} is not allowed on route ${routeId}`);
  }

  const key = vk.key;
  if (typeof key !== "string" || key.length === 0) {
    throw new VirtualKeyError(502, `virtual key ${id} has no stored value`);
  }
  return key;
}
