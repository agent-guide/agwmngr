import type {
  GatewayAction,
  GatewayPrincipalRole,
} from "../../contracts/gateway/authorization";

const PLATFORM_ONLY_ACTIONS = new Set<GatewayAction>([
  "gateway:platform_config",
  "gateway:secrets_raw",
]);

// This is the pre-platform Gateway-root authority retained for existing
// /api/admin screens. It is intentionally not a Tenant authority and must not
// be consumed by /api/platform/v1 resource or deployment services.
export const GATEWAY_COMPATIBILITY_AUTHORITY = "gateway_membership_compatibility" as const;

/**
 * Evaluate retained Gateway-root compatibility authority without consulting
 * storage. Platform resource/deployment services must use Tenant authorization
 * and never call this evaluator.
 *
 * Platform Admin is an actor property, not a stored Gateway role. Gateway Admin
 * receives ordinary Gateway content/runtime actions; Member receives no
 * implicit content authority until the corresponding migration replaces it.
 */
export function canPerformGatewayCompatibilityAction(
  role: GatewayPrincipalRole,
  isPlatformAdmin: boolean,
  action: GatewayAction,
): boolean {
  if (PLATFORM_ONLY_ACTIONS.has(action)) return isPlatformAdmin;
  return isPlatformAdmin || role === "admin";
}
