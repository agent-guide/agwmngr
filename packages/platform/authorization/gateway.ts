import type {
  GatewayAction,
  GatewayPrincipalRole,
} from "../../contracts/gateway/authorization";

// Step 6E retires stored Gateway membership as user-facing authority. Retained
// Gateway compatibility is now an infrastructure-only Platform Admin bridge;
// Tenant authority is evaluated exclusively by /api/platform/v1 services.
export const GATEWAY_COMPATIBILITY_AUTHORITY = "platform_admin_gateway_compatibility" as const;

/**
 * Evaluate retained Gateway-root compatibility authority without consulting
 * storage. Platform resource/deployment services must use Tenant authorization
 * and never call this evaluator.
 *
 * Platform Admin is an actor property, not a stored Gateway role. The stored
 * role remains readable for migration history but grants no action here.
 */
export function canPerformGatewayCompatibilityAction(
  role: GatewayPrincipalRole,
  isPlatformAdmin: boolean,
  action: GatewayAction,
): boolean {
  void role;
  void action;
  return isPlatformAdmin;
}
