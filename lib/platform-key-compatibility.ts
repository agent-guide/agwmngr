import { getPlatformRuntime } from "./platform-identity";
import type { PlatformDatabase } from "@/packages/platform/ports/database";

export async function platformClaimsGatewayKeyPolicy(
  database: PlatformDatabase,
  gatewayId: string,
): Promise<boolean> {
  const [row] = await database.query<{ n: number }>(
    `SELECT
      (SELECT COUNT(*) FROM platform_deployment_route_reservations WHERE gateway_id = ?) +
      (SELECT COUNT(*) FROM platform_deployment_pair_fences WHERE gateway_id = ?) +
      (SELECT COUNT(*) FROM platform_gateway_virtual_key_policies WHERE gateway_id = ?) AS n`,
    [gatewayId, gatewayId, gatewayId],
  );
  return Number(row.n) > 0;
}

/**
 * Legacy active-Gateway Virtual-Key writers do not participate in the platform
 * key-policy lease. Once a Gateway has any platform route reservation, pair
 * fence, or manager-owned key-policy record, fail those writers closed and
 * direct operators to the path-scoped
 * Platform Admin surface, whose mutations are journaled and lease-protected.
 */
export async function legacyVirtualKeyMutationBlock(gatewayId: string): Promise<Response | null> {
  const { database } = await getPlatformRuntime();
  return await platformClaimsGatewayKeyPolicy(database, gatewayId)
    ? Response.json({
      error: "Virtual Key mutations for this Gateway must use its Platform Admin page while platform deployment claims exist",
      code: "platform_key_policy_managed",
    }, { status: 409 })
    : null;
}
