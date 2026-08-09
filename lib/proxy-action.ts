// Pure mapping from a proxied Admin API request (method + path) to the RBAC
// action it requires (§2.1 of docs/multi-tenant-design.md). Deliberately kept
// free of any db/session imports so it can be unit-tested in isolation and
// reasoned about as the security-critical override table.

export type GatewayAction =
  | "gateway:read"
  | "gateway:write"
  | "gateway:platform_config"
  | "runtime:chat"
  | "runtime:permission_resolve"
  | "secrets:read-redacted"
  | "gateway:secrets_raw";

/**
 * Normalize a proxy path into canonical, non-empty path segments.
 *
 * The catch-all builds proxyPath as `"/admin/" + params.path.join("/")`, and the
 * Next.js router has ALREADY percent-decoded those params. So decoding happens
 * exactly once, at the router boundary, and we MUST NOT decode again here — a
 * second decode would let an encoded separator (e.g. `%252e`) smuggle a segment
 * past normalization. We therefore only strip a query/fragment, split on "/",
 * and drop empty and "." segments. All matching below is per-segment, so a
 * prefix like ["admin","credentials"] cannot be spoofed by a sibling resource
 * such as "/admin/credentials-extra".
 */
export function canonicalSegments(proxyPath: string): string[] {
  const path = proxyPath.split("#")[0].split("?")[0];
  return path.split("/").filter((s) => s.length > 0 && s !== ".");
}

function startsWith(segments: string[], prefix: string[]): boolean {
  if (prefix.length > segments.length) return false;
  return prefix.every((s, i) => segments[i] === s);
}

function endsWith(segments: string[], suffix: string[]): boolean {
  if (suffix.length > segments.length) return false;
  const offset = segments.length - suffix.length;
  return suffix.every((s, i) => segments[offset + i] === s);
}

/**
 * Derive the action for a proxied catch-all request from its method and the
 * canonical proxyPath ("/admin/..."). Method gives the default; a small
 * path-segment override table handles known exceptions (§2.1). The table is a
 * deny-by-default allowlist widened deliberately as upstream behaviour is
 * verified per endpoint.
 */
export function actionForProxyPath(method: string, proxyPath: string): GatewayAction {
  const m = method.toUpperCase();
  const segments = canonicalSegments(proxyPath);

  // Read-like POSTs that actually execute (spend tokens / run tools) — must not
  // be treated as a plain read, because they trigger side effects and spend.
  if (
    m === "POST" &&
    (endsWith(segments, ["tools", "call"]) || endsWith(segments, ["resources", "read"]))
  ) {
    return "runtime:chat";
  }

  // Resolving a pending agent permission releases a suspended turn, so it is a
  // runtime decision rather than a config write. v0.5.0 moved this off
  // /admin/acp/runtime/permissions/{id} onto the owning agent
  // (unified-agent-runtime.md §6.7). Guard the shape precisely — 5 segments,
  // "routes" excluded because it is the reserved ingress collection, never an
  // agent id (see the same reservation in lib/api.ts).
  if (
    m === "POST" &&
    segments.length === 5 &&
    startsWith(segments, ["admin", "agents"]) &&
    segments[2] !== "routes" &&
    segments[3] === "permissions"
  ) {
    return "runtime:permission_resolve";
  }

  // Config endpoints that carry secret fields. Labelled as redacted reads on the
  // assumption the upstream/manager redacts secret values in these responses; if
  // a given endpoint can return unredacted secrets it must be moved to
  // gateway:secrets_raw (platform-admin only).
  if (
    m === "GET" &&
    (startsWith(segments, ["admin", "credentials"]) ||
      startsWith(segments, ["admin", "llm", "providers"]))
  ) {
    return "secrets:read-redacted";
  }

  // Virtual Key reads and mutation responses contain bearer values upstream.
  // The collection, the per-key detail path, and the reveal action now have
  // explicit redacting handlers under app/api/admin/virtual_keys/, so they never
  // reach this classifier. Anything else in the family — a subpath the manager
  // has not audited for key material — stays on the Platform-Admin-only
  // raw-secret path as the deny-by-default backstop.
  if (startsWith(segments, ["admin", "virtual_keys"])) {
    return "gateway:secrets_raw";
  }

  return m === "GET" || m === "HEAD" ? "gateway:read" : "gateway:write";
}
