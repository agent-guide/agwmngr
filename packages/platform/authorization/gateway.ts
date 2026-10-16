import type {
  GatewayAction,
  GatewayPrincipalRole,
} from "../../contracts/gateway/authorization";

const PLATFORM_ONLY_ACTIONS = new Set<GatewayAction>([
  "gateway:platform_config",
  "gateway:secrets_raw",
]);

/**
 * Evaluate current Gateway-root authority without consulting storage.
 *
 * Platform Admin is an actor property, not a stored Gateway role. Gateway Admin
 * receives ordinary Gateway content/runtime actions; Member receives no
 * implicit content authority until the corresponding migration replaces it.
 */
export function canPerformGatewayAction(
  role: GatewayPrincipalRole,
  isPlatformAdmin: boolean,
  action: GatewayAction,
): boolean {
  if (PLATFORM_ONLY_ACTIONS.has(action)) return isPlatformAdmin;
  return isPlatformAdmin || role === "admin";
}
