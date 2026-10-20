import { createHash, randomUUID } from "node:crypto";
import { getPlatformAuthoredResources } from "./platform-authored-resources";
import { getPlatformCatalog } from "./platform-catalog";
import { getPlatformKnowledge } from "./platform-knowledge";
import { getPlatformModelDefinitions } from "./platform-model-definitions";
import { getPlatformRuntime } from "./platform-identity";
import { getPlatformToolDefinitions } from "./platform-tool-definitions";
import { AgentDefinitionRegistry } from "@/packages/platform/services/agent-definition-registry";
import { AgentDefinitionService } from "@/packages/platform/services/agent-definitions";
import { AgentReleaseRegistry } from "@/packages/platform/services/agent-release-registry";
import { AgentReleaseService } from "@/packages/platform/services/agent-releases";

const state = globalThis as typeof globalThis & {
  __platformAgentDefinitions?: Promise<AgentDefinitionService>;
  __platformAgentReleases?: Promise<AgentReleaseService>;
};

function contentRuntime() {
  return {
    id: () => randomUUID(),
    now: () => new Date().toISOString(),
    hash: (value: string) => createHash("sha256").update(value).digest("hex"),
    hashBytes: (value: Uint8Array) => createHash("sha256").update(value).digest("hex"),
    decodeBase64: (value: string) => Buffer.from(value, "base64"),
    encodeBase64: (value: Uint8Array) => Buffer.from(value).toString("base64"),
  };
}

export function getPlatformAgentDefinitions(): Promise<AgentDefinitionService> {
  if (!state.__platformAgentDefinitions) {
    state.__platformAgentDefinitions = (async () => {
      const { database, identity } = await getPlatformRuntime();
      return new AgentDefinitionService(
        new AgentDefinitionRegistry(database),
        identity,
        await getPlatformAuthoredResources(),
        await getPlatformKnowledge(),
        await getPlatformModelDefinitions(),
        await getPlatformToolDefinitions(),
        contentRuntime(),
      );
    })().catch((error) => {
      delete state.__platformAgentDefinitions;
      throw error;
    });
  }
  return state.__platformAgentDefinitions;
}

export function getPlatformAgentReleases(): Promise<AgentReleaseService> {
  if (!state.__platformAgentReleases) {
    state.__platformAgentReleases = (async () => {
      const { database, identity } = await getPlatformRuntime();
      return new AgentReleaseService(
        new AgentReleaseRegistry(database),
        identity,
        await getPlatformAgentDefinitions(),
        await getPlatformAuthoredResources(),
        await getPlatformModelDefinitions(),
        await getPlatformToolDefinitions(),
        await getPlatformCatalog(),
        contentRuntime(),
      );
    })().catch((error) => {
      delete state.__platformAgentReleases;
      throw error;
    });
  }
  return state.__platformAgentReleases;
}
