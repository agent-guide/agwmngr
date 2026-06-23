import { withPlatformAccess } from "@/lib/access";
import { getGateway } from "@/lib/db";
import { resolveGateway } from "@/lib/gateway-resolve";
import { pingGateway } from "@/lib/gateway-test";

type Params = { params: Promise<{ id: string }> };

// Connectivity check against a stored gateway using its decrypted credentials.
export const POST = withPlatformAccess(async (_req, _access, { params }: Params) => {
  const { id } = await params;
  const row = getGateway(id);
  if (!row) return Response.json({ error: "gateway not found" }, { status: 404 });

  let resolved;
  try {
    resolved = resolveGateway(row);
  } catch {
    return Response.json(
      { ok: false, reason: "gateway_error", message: "stored credentials could not be decrypted" },
      { status: 200 },
    );
  }

  const result = await pingGateway(resolved.adminAddr, resolved.adminUser, resolved.adminPassword);
  return Response.json(result);
});
