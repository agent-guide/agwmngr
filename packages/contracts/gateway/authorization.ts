export type GatewayAction =
  | "gateway:read"
  | "gateway:write"
  | "gateway:platform_config"
  | "runtime:chat"
  | "runtime:permission_resolve"
  | "secrets:read-redacted"
  | "gateway:secrets_raw";

export type GatewayPrincipalRole = "admin" | "member";
