import { withGatewayAccess } from "@/lib/access";
import { proxySecretResource } from "@/lib/secret-resource-proxy";

type Params = { params: Promise<{ id: string }> };

function path(id: string): string {
  return `/admin/virtual_keys/${encodeURIComponent(id)}`;
}

// Detail reads and writes are redacted the same way as the collection: no
// response on this path ever carries the bearer. Recovering the value of an
// existing key is a separate, Platform-Admin-only action (./reveal).

export const GET = withGatewayAccess(
  "secrets:read-redacted",
  async (req, access, { params }: Params) => {
    const { id } = await params;
    return proxySecretResource(req, access.gateway, path(id), "virtualKey", id);
  },
);

export const PUT = withGatewayAccess("gateway:write", async (req, access, { params }: Params) => {
  const { id } = await params;
  return proxySecretResource(req, access.gateway, path(id), "virtualKey", id);
});

export const DELETE = withGatewayAccess("gateway:write", async (req, access, { params }: Params) => {
  const { id } = await params;
  return proxySecretResource(req, access.gateway, path(id), "virtualKey", id);
});
