import { createHash, randomUUID } from "node:crypto";
import { getPlatformRuntime } from "./platform-identity";
import { getPlatformCatalog } from "./platform-catalog";
import { offeringCapabilityDirectory } from "./offering-capabilities";
import { ModelDefinitionRegistry } from "@/packages/platform/services/model-definition-registry";
import { TenantModelDefinitionService } from "@/packages/platform/services/model-definitions";

const state = globalThis as typeof globalThis & { __platformModelDefinitions?: Promise<TenantModelDefinitionService> };

export function getPlatformModelDefinitions(): Promise<TenantModelDefinitionService> {
  if (!state.__platformModelDefinitions) {
    state.__platformModelDefinitions = (async () => {
      const { database, identity } = await getPlatformRuntime();
      return new TenantModelDefinitionService(
        new ModelDefinitionRegistry(database),
        identity,
        await getPlatformCatalog(),
        offeringCapabilityDirectory,
        {
          id: () => randomUUID(),
          now: () => new Date().toISOString(),
          hash: (value) => createHash("sha256").update(value).digest("hex"),
          hashBytes: (value) => createHash("sha256").update(value).digest("hex"),
          decodeBase64: (value) => Buffer.from(value, "base64"),
          encodeBase64: (value) => Buffer.from(value).toString("base64"),
        },
      );
    })().catch((error) => {
      delete state.__platformModelDefinitions;
      throw error;
    });
  }
  return state.__platformModelDefinitions;
}
