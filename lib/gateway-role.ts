import type { GatewayAction } from "./proxy-action";

export type GatewayPrincipalRole = "admin" | "member";

const PLATFORM_ONLY_ACTIONS = new Set<GatewayAction>([
  "gateway:platform_config",
  "gateway:secrets_raw",
]);

/**
 * Evaluate Gateway-root authority without consulting storage.
 *
 * Platform Admin is an actor property, not a stored Gateway role. Gateway Admin
 * receives ordinary gateway content/runtime actions; Member receives no
 * implicit content authority until domain/resource grants are implemented.
 */
export function canPerformGatewayAction(
  role: GatewayPrincipalRole,
  isPlatformAdmin: boolean,
  action: GatewayAction,
): boolean {
  if (PLATFORM_ONLY_ACTIONS.has(action)) return isPlatformAdmin;
  return isPlatformAdmin || role === "admin";
}
