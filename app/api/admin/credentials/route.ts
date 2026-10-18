import { withGatewayCompatibilityAccess } from "@/lib/access";
import { proxySecretResource } from "@/lib/secret-resource-proxy";

export const GET = withGatewayCompatibilityAccess("secrets:read-redacted", (req, access) =>
  proxySecretResource(req, access.gateway, "/admin/credentials", "credential"),
);

export const POST = withGatewayCompatibilityAccess("gateway:write", (req, access) =>
  proxySecretResource(req, access.gateway, "/admin/credentials", "credential"),
);
