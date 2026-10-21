const READ = new Set(["GET"]);
const READ_WRITE_COLLECTION = new Set(["GET", "POST"]);
const READ_WRITE_ITEM = new Set(["GET", "PUT", "DELETE"]);

function allowed(method: string, methods: Set<string>): boolean {
  return methods.has(method.toUpperCase());
}

/**
 * Strictly map the canonical Platform Admin Gateway workspace to the retained
 * Gateway Admin families. This is intentionally not a generic proxy: every
 * path shape and method must be reviewed here before the request can leave the
 * manager.
 */
export function platformGatewayInfrastructureTarget(
  method: string,
  path: string[],
): string | null {
  if (path.some((segment) => !segment || segment === "." || segment === "..")) return null;
  const verb = method.toUpperCase();
  const [area, family, ...rest] = path;
  let accepted = false;

  if (area === "llm" && (family === "provider_types" || family === "api_handler_types")) {
    accepted = rest.length === 0 && allowed(verb, READ);
  } else if (area === "llm" && family === "providers") {
    accepted = (rest.length === 0 && allowed(verb, READ_WRITE_COLLECTION)) ||
      (rest.length === 1 && allowed(verb, READ_WRITE_ITEM)) ||
      (rest.length === 2 && ["enable", "disable"].includes(rest[1]) && verb === "POST");
  } else if (area === "llm" && family === "routes") {
    accepted = (rest.length === 0 && allowed(verb, READ_WRITE_COLLECTION)) ||
      (rest.length === 1 && allowed(verb, READ_WRITE_ITEM)) ||
      (rest.length === 2 && ["enable", "disable"].includes(rest[1]) && verb === "POST");
  } else if (area === "llm" && family === "models") {
    accepted = (rest.length === 1 && rest[0] === "managed" && allowed(verb, READ_WRITE_COLLECTION)) ||
      (rest.length === 3 && rest[0] === "managed" && allowed(verb, READ_WRITE_ITEM)) ||
      (rest.length === 3 && rest[0] === "providers" && rest[2] === "discovered" && verb === "GET") ||
      (rest.length === 3 && rest[0] === "providers" && rest[2] === "refresh" && verb === "POST");
  } else if (area === "mcp" && family === "routes") {
    accepted = (rest.length === 0 && allowed(verb, READ_WRITE_COLLECTION)) ||
      (rest.length === 1 && allowed(verb, READ_WRITE_ITEM));
  } else if (area === "mcp" && family === "services") {
    accepted = (rest.length === 0 && allowed(verb, READ_WRITE_COLLECTION)) ||
      (rest.length === 1 && allowed(verb, READ_WRITE_ITEM)) ||
      (rest.length === 2 && ["capabilities", "sessions", "tools", "resources", "resource-templates", "prompts"].includes(rest[1]) && verb === "GET");
  }
  return accepted ? `/admin/${path.map(encodeURIComponent).join("/")}` : null;
}

/**
 * Route writes must enter the same lease/conflict barrier as the retained
 * compatibility proxy. Keep this predicate coupled to the strict allowlist so
 * an unreviewed path can never acquire mutation authority merely by matching a
 * broad family prefix.
 */
export function isPlatformGatewayInfrastructureRouteMutation(
  method: string,
  path: string[],
): boolean {
  const [area, family] = path;
  return (area === "llm" || area === "mcp") && family === "routes" &&
    platformGatewayInfrastructureTarget(method, path) !== null &&
    !["GET", "HEAD"].includes(method.toUpperCase());
}
