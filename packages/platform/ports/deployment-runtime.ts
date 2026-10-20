import type { AgentCapabilities } from "../../contracts/gateway/agents";

export interface GatewayDeploymentRuntimeAdapter {
  readAgentResource(
    gatewayId: string,
    agentId: string,
    resource: "activity" | "usage" | "interactions" | "health" |
      "sessions" | "runs" | "permissions",
    query?: string,
  ): Promise<unknown>;
  readAgentCapabilities(gatewayId: string, agentId: string): Promise<AgentCapabilities>;
  resolveAgentPermission(
    gatewayId: string,
    agentId: string,
    requestId: string,
    decision: unknown,
  ): Promise<unknown>;
  cancelAgentRun(
    gatewayId: string,
    agentId: string,
    runId: string,
    mode: "force" | "graceful",
  ): Promise<unknown>;
}
