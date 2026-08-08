import { withGatewayAccess } from "@/lib/access";
import { proxySecretResource } from "@/lib/secret-resource-proxy";

export const GET = withGatewayAccess("secrets:read-redacted", (req, access) =>
  proxySecretResource(req, access.gateway, "/admin/credentials", "credential"),
);

export const POST = withGatewayAccess("gateway:write", (req, access) =>
  proxySecretResource(req, access.gateway, "/admin/credentials", "credential"),
);
