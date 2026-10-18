import { getGateway, type GatewayRow } from "./db";
import { resolveGateway } from "./gateway-resolve";
import type { ResolvedGateway } from "@/packages/contracts/gateway/connection";

export type PlatformGatewayScopeResult =
  | { ok: true; gateway: ResolvedGateway }
  | { ok: false; response: Response };

/**
 * Resolve canonical Platform Gateway scope from the route parameter only.
 * Session active-Gateway state and X-Gateway-Id are deliberately not inputs.
 */
export function resolvePlatformGatewayScope(
  gatewayId: string,
  lookup: (id: string) => GatewayRow | null = getGateway,
  decrypt: (row: GatewayRow) => ResolvedGateway = resolveGateway,
): PlatformGatewayScopeResult {
  const row = lookup(gatewayId);
  if (!row) {
    return { ok: false, response: Response.json({ error: "gateway not found" }, { status: 404 }) };
  }
  if (row.status === "disabled") {
    return {
      ok: false,
      response: Response.json({ error: "gateway is disabled" }, { status: 403 }),
    };
  }
  try {
    return { ok: true, gateway: decrypt(row) };
  } catch {
    return {
      ok: false,
      response: Response.json(
        { error: "gateway credentials could not be decrypted (re-enter the password)" },
        { status: 503 },
      ),
    };
  }
}
