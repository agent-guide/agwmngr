import type { AgentPayload } from "../../contracts/gateway/agents";

export interface GatewayRouteMatchPolicy {
  host?: string;
  path_prefix?: string;
  methods?: string[];
}

export interface GatewayAgentRouteDocument {
  id: string;
  kind?: "agent";
  protocol: "agent" | "a2a";
  description?: string;
  disabled: boolean;
  match_policy: GatewayRouteMatchPolicy;
  auth_policy: { require_virtual_key: boolean };
  agent_id: string;
  created_at?: string;
  updated_at?: string;
}

export interface GatewayVirtualKeyPolicy {
  id: string;
  tag?: string;
  description?: string;
  disabled: boolean;
  allowed_route_ids: string[];
  rate_limits?: unknown;
  status_message?: string;
  expires_at?: string;
}

export interface GatewayDeploymentAdapter {
  readAgent(gatewayId: string, agentId: string): Promise<AgentPayload | null>;
  createAgent(gatewayId: string, value: AgentPayload): Promise<AgentPayload>;
  updateAgent(gatewayId: string, agentId: string, value: AgentPayload): Promise<AgentPayload>;
  deleteAgent(gatewayId: string, agentId: string): Promise<void>;
  readAgentRoute(gatewayId: string, routeId: string): Promise<GatewayAgentRouteDocument | null>;
  createAgentRoute(
    gatewayId: string,
    value: GatewayAgentRouteDocument,
  ): Promise<GatewayAgentRouteDocument>;
  updateAgentRoute(
    gatewayId: string,
    routeId: string,
    value: GatewayAgentRouteDocument,
  ): Promise<GatewayAgentRouteDocument>;
  deleteAgentRoute(gatewayId: string, routeId: string): Promise<void>;
  listAgentRoutes(gatewayId: string): Promise<GatewayAgentRouteDocument[]>;
  listLLMRoutes(gatewayId: string): Promise<unknown[]>;
  listMCPRoutes(gatewayId: string): Promise<unknown[]>;
  listVirtualKeys(gatewayId: string): Promise<GatewayVirtualKeyPolicy[]>;
  createVirtualKey(
    gatewayId: string,
    value: GatewayVirtualKeyPolicy,
  ): Promise<{ policy: GatewayVirtualKeyPolicy; bearer: string }>;
  readVirtualKey(gatewayId: string, keyId: string): Promise<GatewayVirtualKeyPolicy | null>;
  readVirtualKeySecret(
    gatewayId: string,
    keyId: string,
  ): Promise<{ policy: GatewayVirtualKeyPolicy; bearer: string } | null>;
  updateVirtualKey(
    gatewayId: string,
    keyId: string,
    value: GatewayVirtualKeyPolicy,
  ): Promise<GatewayVirtualKeyPolicy>;
  setVirtualKeyEnabled(
    gatewayId: string,
    keyId: string,
    enabled: boolean,
  ): Promise<GatewayVirtualKeyPolicy>;
  deleteVirtualKey(gatewayId: string, keyId: string): Promise<void>;
}
