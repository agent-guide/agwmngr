import { canonicalSegments } from "./proxy-action";

export interface GatewayCutoverDecision {
  allowed: boolean;
  routeMutation: boolean;
  reason?: string;
}

function begins(segments: string[], prefix: string[]): boolean {
  return prefix.every((value, index) => segments[index] === value);
}

/**
 * Step 6E deny-before-forward allowlist for the legacy active-Gateway bridge.
 * Explicit Next.js handlers (credentials/providers/Virtual Keys/Caddy) take
 * precedence and are not classified here.
 */
export function gatewayCutoverDecision(method: string, proxyPath: string): GatewayCutoverDecision {
  const verb = method.toUpperCase();
  const segments = canonicalSegments(proxyPath);
  if (segments[0] !== "admin") return { allowed: false, routeMutation: false, reason: "invalid_path" };
  const path = segments.slice(1);

  if (begins(path, ["agents"]) || begins(path, ["acp", "chat"]) ||
    begins(path, ["acp", "runtime"]) || begins(path, ["builtin", "runtime"]) ||
    begins(path, ["mcp", "runtime"])) {
    return { allowed: false, routeMutation: false, reason: "scoped_replacement_required" };
  }

  if (verb === "GET" || verb === "HEAD") {
    const allowed = begins(path, ["llm", "provider_types"]) ||
      begins(path, ["llm", "api_handler_types"]) ||
      begins(path, ["llm", "models"]) ||
      begins(path, ["llm", "routes"]) ||
      begins(path, ["mcp", "services"]) ||
      begins(path, ["mcp", "routes"]) ||
      begins(path, ["metrics"]);
    return { allowed, routeMutation: false, ...(allowed ? {} : { reason: "not_allowlisted" }) };
  }

  if (begins(path, ["mcp", "services"]) &&
    (path.slice(-2).join("/") === "tools/call" || path.slice(-2).join("/") === "resources/read")) {
    return { allowed: false, routeMutation: false, reason: "runtime_execution_removed" };
  }
  if (begins(path, ["llm", "routes"]) || begins(path, ["mcp", "routes"])) {
    return { allowed: true, routeMutation: true };
  }
  const allowed = begins(path, ["llm", "models"]) || begins(path, ["mcp", "services"]);
  return { allowed, routeMutation: false, ...(allowed ? {} : { reason: "not_allowlisted" }) };
}
