import type { ManagerGatewayIdentity } from "./identity";

export interface CatalogSourceDirectory {
  findGateway(id: string): Promise<ManagerGatewayIdentity | null>;
}

export interface CatalogRuntime {
  digest(value: string): string;
  now(): string;
}
