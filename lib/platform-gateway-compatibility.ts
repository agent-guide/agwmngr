import { getPlatformRuntime } from "./platform-identity";
import { platformDeploymentGateway } from "./platform-deployment-gateway";
import { GatewayAgentCompatibilityService } from "./platform-gateway-agent-compatibility";
import { DeploymentAccessRegistry } from "@/packages/platform/services/deployment-access-registry";
import { AgentDeploymentRegistry } from "@/packages/platform/services/deployment-registry";
import { GatewayCompatibilityRegistry } from "@/packages/platform/services/gateway-compatibility-registry";

export async function getPlatformGatewayCompatibility(): Promise<GatewayAgentCompatibilityService> {
  const { database, identity } = await getPlatformRuntime();
  return new GatewayAgentCompatibilityService(
    new AgentDeploymentRegistry(database),
    new GatewayCompatibilityRegistry(database),
    new DeploymentAccessRegistry(database),
    identity,
    platformDeploymentGateway,
  );
}
