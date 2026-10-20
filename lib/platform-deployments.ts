import { createHash, randomUUID } from "node:crypto";
import { getPlatformRuntime } from "./platform-identity";
import { AgentReleaseRegistry } from "@/packages/platform/services/agent-release-registry";
import { AgentDeploymentRegistry } from "@/packages/platform/services/deployment-registry";
import { AgentDeploymentService } from "@/packages/platform/services/deployments";
import { platformDeploymentGateway } from "./platform-deployment-gateway";

const state = globalThis as typeof globalThis & {
  __platformDeployments?: Promise<AgentDeploymentService>;
};

export function getPlatformDeployments(): Promise<AgentDeploymentService> {
  if (!state.__platformDeployments) {
    state.__platformDeployments = (async () => {
      const { database, identity } = await getPlatformRuntime();
      return new AgentDeploymentService(
        new AgentDeploymentRegistry(database),
        new AgentReleaseRegistry(database),
        identity,
        {
          id: () => randomUUID(),
          now: () => new Date().toISOString(),
          hash: (value) => createHash("sha256").update(value).digest("hex"),
          hashBytes: (value) => createHash("sha256").update(value).digest("hex"),
          decodeBase64: (value) => Buffer.from(value, "base64"),
          encodeBase64: (value) => Buffer.from(value).toString("base64"),
        },
        platformDeploymentGateway,
      );
    })().catch((error) => {
      delete state.__platformDeployments;
      throw error;
    });
  }
  return state.__platformDeployments;
}
