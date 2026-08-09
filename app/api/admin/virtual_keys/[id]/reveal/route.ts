import { withGatewayAccess } from "@/lib/access";
import { gatewayRequestJSON } from "@/lib/gateway-proxy";

type Params = { params: Promise<{ id: string }> };

/**
 * Recover the bearer of an existing Virtual Key.
 *
 * Every other Virtual Key response is redacted, so this is the single audited
 * escape hatch for an administrator who has lost a key value. It is guarded by
 * `gateway:secrets_raw`, which `lib/gateway-role.ts` grants on the *actor* flag
 * rather than the gateway role — Platform Admin only, never Gateway Admin.
 *
 * POST rather than GET: it is a deliberate, one-off disclosure, and the verb
 * keeps it out of anything that prefetches or replays reads.
 */
export const POST = withGatewayAccess(
  "gateway:secrets_raw",
  async (_req, access, { params }: Params) => {
    const { id } = await params;

    let result: { status: number; body: unknown };
    try {
      result = await gatewayRequestJSON(
        "GET",
        `/admin/virtual_keys/${encodeURIComponent(id)}`,
        access.gateway,
      );
    } catch (error) {
      return Response.json(
        { error: `gateway request failed: ${error instanceof Error ? error.message : String(error)}` },
        { status: 502 },
      );
    }

    if (result.status === 404) {
      return Response.json({ error: `virtual key not found: ${id}` }, { status: 404 });
    }
    if (result.status >= 400) {
      return Response.json(
        { error: `failed to read virtual key ${id} (gateway ${result.status})` },
        { status: result.status },
      );
    }

    const key = (result.body as { key?: unknown } | null)?.key;
    if (typeof key !== "string" || key.length === 0) {
      return Response.json({ error: `virtual key ${id} has no stored value` }, { status: 404 });
    }

    // Deliberately narrow: only the value, never the surrounding object, so this
    // response can never become a second unredacted read path.
    return Response.json({ id, key });
  },
);
