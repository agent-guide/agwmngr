import { withGatewayAccess } from "@/lib/access";
import { proxySecretResource } from "@/lib/secret-resource-proxy";

type Params = { params: Promise<{ id: string }> };

function path(id: string): string {
  return `/admin/credentials/${encodeURIComponent(id)}`;
}

export const GET = withGatewayAccess(
  "secrets:read-redacted",
  async (req, access, { params }: Params) => {
    const { id } = await params;
    return proxySecretResource(req, access.gateway, path(id), "credential", id);
  },
);

export const PUT = withGatewayAccess("gateway:write", async (req, access, { params }: Params) => {
  const { id } = await params;
  return proxySecretResource(req, access.gateway, path(id), "credential", id);
});

export const DELETE = withGatewayAccess("gateway:write", async (req, access, { params }: Params) => {
  const { id } = await params;
  return proxySecretResource(req, access.gateway, path(id), "credential", id);
});
