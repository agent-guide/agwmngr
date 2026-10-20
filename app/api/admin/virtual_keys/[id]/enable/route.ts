import { withGatewayCompatibilityAccess } from "@/lib/access";
import { legacyVirtualKeyMutationBlock } from "@/lib/platform-key-compatibility";
import { gatewayRequestJSON } from "@/packages/gateway-client/admin";
import { redactVirtualKeyResponse } from "@/lib/secret-resource";

type Params = { params: Promise<{ id: string }> };

export const POST = withGatewayCompatibilityAccess(
  "gateway:write",
  async (_request, access, { params }: Params) => {
    const blocked = await legacyVirtualKeyMutationBlock(access.gateway.id);
    if (blocked) return blocked;
    const { id } = await params;
    const result = await gatewayRequestJSON(
      "POST",
      `/admin/virtual_keys/${encodeURIComponent(id)}/enable`,
      access.gateway,
    );
    return Response.json(redactVirtualKeyResponse(result.body) ?? {}, { status: result.status });
  },
);
