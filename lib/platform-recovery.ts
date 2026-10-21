import { getPlatformDeploymentAccess } from "./platform-deployment-access";

export interface PlatformRecoveryReport {
  recovered: string[];
  failed: Array<{ deploymentId: string; error: string }>;
}

const state = globalThis as typeof globalThis & {
  __platformRecovery?: Promise<PlatformRecoveryReport>;
};

export function ensurePlatformRecovery(): Promise<PlatformRecoveryReport> {
  if (!state.__platformRecovery) {
    state.__platformRecovery = getPlatformDeploymentAccess()
      .then(async (service) => {
        const lifecycle = await service.recoverInterruptedOperations();
        const decommission = await service.recoverDecommissions();
        return {
          recovered: [...new Set([...lifecycle.recovered, ...decommission.recovered])],
          failed: [...lifecycle.failed, ...decommission.failed],
        };
      })
      .catch((error) => {
        delete state.__platformRecovery;
        throw error;
      });
  }
  return state.__platformRecovery;
}

export function retryPlatformRecovery(gatewayId: string): Promise<PlatformRecoveryReport> {
  return getPlatformDeploymentAccess().then((service) => service.recoverDecommissions(gatewayId));
}
