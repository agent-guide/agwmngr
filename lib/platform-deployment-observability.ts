import { getPlatformRuntime } from "./platform-identity";
import { getPlatformDeployments } from "./platform-deployments";
import { platformDeploymentGateway } from "./platform-deployment-gateway";
import { DeploymentAccessRegistry } from "@/packages/platform/services/deployment-access-registry";
import { DeploymentObservabilityService } from "@/packages/platform/services/deployment-observability";

const state = globalThis as typeof globalThis & {
  __platformDeploymentObservability?: Promise<DeploymentObservabilityService>;
};

export function getPlatformDeploymentObservability(): Promise<DeploymentObservabilityService> {
  if (!state.__platformDeploymentObservability) {
    state.__platformDeploymentObservability = (async () => {
      const { database, identity } = await getPlatformRuntime();
      return new DeploymentObservabilityService(
        await getPlatformDeployments(),
        new DeploymentAccessRegistry(database),
        identity,
        platformDeploymentGateway,
      );
    })().catch((error) => {
      delete state.__platformDeploymentObservability;
      throw error;
    });
  }
  return state.__platformDeploymentObservability;
}
