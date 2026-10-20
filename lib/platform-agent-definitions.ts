import { createHash, randomUUID } from "node:crypto";
import { getPlatformAuthoredResources } from "./platform-authored-resources";
import { getPlatformKnowledge } from "./platform-knowledge";
import { getPlatformModelDefinitions } from "./platform-model-definitions";
import { getPlatformRuntime } from "./platform-identity";
import { getPlatformToolDefinitions } from "./platform-tool-definitions";
import { AgentDefinitionRegistry } from "@/packages/platform/services/agent-definition-registry";
import { AgentDefinitionService } from "@/packages/platform/services/agent-definitions";

const state = globalThis as typeof globalThis & {
  __platformAgentDefinitions?: Promise<AgentDefinitionService>;
};

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
      delete state.__platformAgentDefinitions;
      throw error;
    });
  }
  return state.__platformAgentDefinitions;
}
