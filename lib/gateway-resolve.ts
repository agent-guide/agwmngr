import { decryptSecret } from "./crypto";
import type { GatewayRow } from "./db";

import type { ResolvedGateway } from "@/packages/contracts/gateway/connection";

export type { ResolvedGateway } from "@/packages/contracts/gateway/connection";

function parseCsv(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Decrypt a gateway row into a ResolvedGateway. Throws if the admin password
 * envelope cannot be decrypted (wrong/rotated key) — callers map that to a
 * 503 credential_undecryptable deny, never a plaintext fallback.
 */
export function resolveGateway(row: GatewayRow): ResolvedGateway {
  const adminPassword = decryptSecret(row.admin_password_enc);
  return {
    id: row.id,
    name: row.name,
    adminAddr: row.admin_addr,
    adminUser: row.admin_user,
    adminPassword,
    caddyAdminAddr: row.caddy_admin_addr,
    dataplaneAddr: row.dataplane_addr,
    readonlyServerIds: parseCsv(row.readonly_server_ids),
    status: row.status,
  };
}
