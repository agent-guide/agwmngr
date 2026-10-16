// A Gateway record with its admin password decrypted in memory, ready for a
// server-side forward. It is an internal connection contract, never a public DTO.
export interface ResolvedGateway {
  id: string;
  name: string;
  adminAddr: string;
  adminUser: string;
  adminPassword: string;
  caddyAdminAddr: string | null;
  dataplaneAddr: string | null;
  readonlyServerIds: string[];
  status: "active" | "disabled";
}
