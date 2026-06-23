import { gatewayRequestJSON } from "./gateway-proxy";
import type { ResolvedGateway } from "./gateway-resolve";

export interface ConnectivityResult {
  ok: boolean;
  reason?: "unreachable" | "unauthorized" | "gateway_error";
  status?: number;
  message?: string;
}

// A cheap authenticated GET used to verify reachability + credentials before
// persisting a gateway (§10). provider_types is a stable, side-effect-free
// admin endpoint the manager already depends on.
const PROBE_PATH = "/admin/llm/provider_types";

export async function pingGateway(
  adminAddr: string,
  adminUser: string,
  adminPassword: string,
): Promise<ConnectivityResult> {
  const probe: ResolvedGateway = {
    id: `test:${adminAddr}`,
    name: "connectivity-test",
    adminAddr: adminAddr.replace(/\/$/, ""),
    adminUser,
    adminPassword,
    caddyAdminAddr: null,
    dataplaneAddr: null,
    readonlyServerIds: [],
    status: "active",
  };

  let result: { status: number; body: unknown };
  try {
    result = await gatewayRequestJSON("GET", PROBE_PATH, probe);
  } catch (e) {
    return { ok: false, reason: "unreachable", message: String(e) };
  }

  if (result.status === 401) {
    return { ok: false, reason: "unauthorized", status: 401, message: "invalid admin credentials" };
  }
  if (result.status >= 500) {
    return { ok: false, reason: "gateway_error", status: result.status, message: `gateway returned ${result.status}` };
  }
  // Any non-5xx, non-401 response means the gateway is reachable and the
  // credentials were accepted (even a 404 implies it answered the request).
  return { ok: true, status: result.status };
}
