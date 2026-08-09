"use client";

import { useEffect, useState } from "react";
import { listAgents, type Agent } from "@/lib/api";
import { collectBuiltinReferences } from "@/lib/agent-bindings";

/**
 * Reverse attribution: which agents reference a given resource. Built once from
 * `GET /admin/agents` — every Agent object already carries its resource/route
 * references, so no per-agent resource fetch is needed. Lets resource list
 * pages answer "used by N agents?" and highlight orphaned resources, closing
 * the loop between the shared resource library and the agent-centric IA.
 *
 * Ingress routes are deliberately absent: an AgentRoute names its own agent_id,
 * so that direction is a direct lookup rather than a reverse map (see the Agent
 * Routes page, which links straight to the owning agent).
 */
export type AttributionKind =
  | "provider"
  | "mcpService"
  | "virtualKey"
  | "llmRoute"
  | "mcpRoute";

export type AttributionMap = Record<AttributionKind, Record<string, string[]>>;

function emptyMap(): AttributionMap {
  return { provider: {}, mcpService: {}, virtualKey: {}, llmRoute: {}, mcpRoute: {} };
}

function buildMap(agents: Agent[]): AttributionMap {
  const map = emptyMap();
  const add = (kind: AttributionKind, resId: string | undefined, agentId: string) => {
    if (!resId) return;
    const bucket = (map[kind][resId] ??= []);
    // A builtin definition can name the same route or service at several nodes;
    // count the agent once so the "used by N agents" chip stays truthful.
    if (!bucket.includes(agentId)) bucket.push(agentId);
  };

  for (const a of agents) {
    (a.resources.provider_ids ?? []).forEach((id) => add("provider", id, a.id));
    (a.resources.mcp_service_ids ?? []).forEach((id) => add("mcpService", id, a.id));
    (a.resources.virtual_key_ids ?? []).forEach((id) => add("virtualKey", id, a.id));
    (a.routes.llm_route_ids ?? []).forEach((id) => add("llmRoute", id, a.id));
    (a.routes.mcp_route_ids ?? []).forEach((id) => add("mcpRoute", id, a.id));
    const builtin = collectBuiltinReferences(a.runtime.builtin);
    builtin.llmRouteIDs.forEach((id) => add("llmRoute", id, a.id));
    builtin.mcpServiceIDs.forEach((id) => add("mcpService", id, a.id));
  }
  return map;
}

export function useAgentAttribution(): AttributionMap | null {
  const [map, setMap] = useState<AttributionMap | null>(null);
  useEffect(() => {
    let alive = true;
    listAgents()
      .then((agents) => { if (alive) setMap(buildMap(agents)); })
      .catch(() => { if (alive) setMap(emptyMap()); });
    return () => { alive = false; };
  }, []);
  return map;
}
