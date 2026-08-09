import { withGatewayAccess } from "@/lib/access";
import { gatewayRequestJSON } from "@/lib/gateway-proxy";
import { proxySecretResource } from "@/lib/secret-resource-proxy";
import { redactVirtualKeyResponse } from "@/lib/secret-resource";

// Explicit Virtual Key handlers. Before these existed the whole family fell to
// the catch-all, which maps it to the Platform-Admin-only `gateway:secrets_raw`
// because upstream list/get responses embed the bearer verbatim — so a Gateway
// Admin could not open the page at all. With the response redacted here, reads
// drop to `secrets:read-redacted` and writes to `gateway:write`, both of which a
// Gateway Admin holds. See docs/resource-rbac-design.md §10.
//
// The catch-all keeps the raw-secret mapping as the deny-by-default backstop for
// any Virtual Key subpath that has no explicit handler yet.

export const GET = withGatewayAccess("secrets:read-redacted", (req, access) =>
  proxySecretResource(req, access.gateway, "/admin/virtual_keys", "virtualKey"),
);

/**
 * Create — the one place an ordinary write response still carries key material.
 *
 * The bearer is generated upstream and is the only way the caller can hand the
 * key to a client, so it is delivered exactly once, in this response, and never
 * again by a list or get. The rest of the object is redacted as usual, keeping
 * `key_set`/`key_preview` consistent with every other Virtual Key response.
 */
export const POST = withGatewayAccess("gateway:write", async (req, access) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  let result: { status: number; body: unknown };
  try {
    result = await gatewayRequestJSON("POST", "/admin/virtual_keys", access.gateway, body);
  } catch (error) {
    return Response.json(
      { error: `gateway request failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 502 },
    );
  }

  const redacted = redactVirtualKeyResponse(result.body);
  if (result.status >= 400) return Response.json(redacted ?? {}, { status: result.status });

  const created = result.body as { key?: unknown } | null;
  const oneTimeKey = typeof created?.key === "string" ? created.key : "";
  return Response.json(
    oneTimeKey && typeof redacted === "object" && redacted !== null
      ? { ...(redacted as Record<string, unknown>), key: oneTimeKey }
      : (redacted ?? {}),
    { status: result.status },
  );
});
