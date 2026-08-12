import { withGatewayAccess } from "@/lib/access";
import { proxySecretResource } from "@/lib/secret-resource-proxy";

type Params = { params: Promise<{ id: string }> };

export const POST = withGatewayAccess("gateway:write", async (req, access, { params }: Params) => {
  const { id } = await params;
  return proxySecretResource(
    req,
    access.gateway,
    `/admin/llm/providers/${encodeURIComponent(id)}/disable`,
    "provider",
  );
});
