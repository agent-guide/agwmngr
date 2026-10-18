import { createHash } from "node:crypto";
import { getGatewayAuthority } from "./db";
import { getPlatformRuntime } from "./platform-identity";
import { PlatformCatalogService } from "@/packages/platform/services/catalog";
import { CatalogRegistry } from "@/packages/platform/services/catalog-registry";

const state = globalThis as typeof globalThis & {
  __platformCatalog?: Promise<PlatformCatalogService>;
};

export function getPlatformCatalog(): Promise<PlatformCatalogService> {
  if (!state.__platformCatalog) {
    state.__platformCatalog = (async () => {
      const { database, identity } = await getPlatformRuntime();
      return new PlatformCatalogService(
        new CatalogRegistry(database),
        identity,
        {
          async findGateway(id) {
            return getGatewayAuthority(id);
          },
        },
        {
          digest: (value) => createHash("sha256").update(value).digest("hex"),
          now: () => new Date().toISOString(),
        },
      );
    })().catch((error) => {
      delete state.__platformCatalog;
      throw error;
    });
  }
  return state.__platformCatalog;
}
