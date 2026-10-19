import { createHash, randomUUID } from "node:crypto";
import { getPlatformRuntime } from "./platform-identity";
import { getPlatformCatalog } from "./platform-catalog";
import { offeringCapabilityDirectory } from "./offering-capabilities";
import { ToolDefinitionRegistry } from "@/packages/platform/services/tool-definition-registry";
import { TenantToolDefinitionService } from "@/packages/platform/services/tool-definitions";

const state = globalThis as typeof globalThis & { __platformToolDefinitions?: Promise<TenantToolDefinitionService> };

export function getPlatformToolDefinitions(): Promise<TenantToolDefinitionService> {
  if (!state.__platformToolDefinitions) {
    state.__platformToolDefinitions = (async () => {
      const { database, identity } = await getPlatformRuntime();
      return new TenantToolDefinitionService(
        new ToolDefinitionRegistry(database),
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
      delete state.__platformToolDefinitions;
      throw error;
    });
  }
  return state.__platformToolDefinitions;
}
