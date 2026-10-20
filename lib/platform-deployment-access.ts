import { createHash, randomUUID } from "node:crypto";
import { getPlatformRuntime } from "./platform-identity";
import { platformDeploymentGateway } from "./platform-deployment-gateway";
import { AgentDeploymentRegistry } from "@/packages/platform/services/deployment-registry";
import { DeploymentAccessRegistry } from "@/packages/platform/services/deployment-access-registry";
import { DeploymentAccessService } from "@/packages/platform/services/deployment-access";

const state = globalThis as typeof globalThis & {
  __platformDeploymentAccess?: Promise<DeploymentAccessService>;
};

export function getPlatformDeploymentAccess(): Promise<DeploymentAccessService> {
  if (!state.__platformDeploymentAccess) {
    state.__platformDeploymentAccess = (async () => {
      const { database, identity } = await getPlatformRuntime();
      const runtime = {
        id: () => randomUUID(),
        now: () => new Date().toISOString(),
        hash: (value: string) => createHash("sha256").update(value).digest("hex"),
        hashBytes: (value: Uint8Array) => createHash("sha256").update(value).digest("hex"),
        decodeBase64: (value: string) => Buffer.from(value, "base64"),
        encodeBase64: (value: Uint8Array) => Buffer.from(value).toString("base64"),
      };
      return new DeploymentAccessService(
        new DeploymentAccessRegistry(database),
        new AgentDeploymentRegistry(database),
        identity,
        runtime,
        platformDeploymentGateway,
      );
    })().catch((error) => {
      delete state.__platformDeploymentAccess;
      throw error;
    });
  }
  return state.__platformDeploymentAccess;
}
