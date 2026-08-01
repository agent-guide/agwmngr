import { stringify } from "yaml";
import type { Agent, AgentPayload } from "@/lib/api";

/**
 * Keep the exported shape aligned with POST /admin/agents. Gateway-managed
 * metadata (source, status and timestamps) is deliberately excluded so this
 * fragment can be pasted directly into a GatewayBundle and applied again.
 */
export function agentPayload(agent: Agent): AgentPayload {
  return {
    id: agent.id,
    name: agent.name,
    ...(agent.description !== undefined && { description: agent.description }),
    runtime: agent.runtime,
    routes: agent.routes,
    resources: agent.resources,
    policy: agent.policy,
    disabled: agent.disabled,
  };
}

/** Serialize one agent as a valid top-level GatewayBundle fragment. */
export function agentYamlFragment(agent: Agent): string {
  return stringify(
    { agents: [agentPayload(agent)] },
    {
      indent: 2,
      lineWidth: 0,
      defaultStringType: "PLAIN",
      defaultKeyType: "PLAIN",
    },
  );
}
