"use client";

import { useEffect, useState } from "react";
import { listAgents, type Agent } from "@/lib/api";

/**
 * Reverse attribution: which agents reference a given resource. Built once from
 * `GET /admin/agents` — every Agent object already carries its resource/route
 * references, so no per-agent resource fetch is needed. Lets resource list
 * pages answer "used by N agents?" and highlight orphaned resources, closing
 * the loop between the shared resource library and the agent-centric IA.
 */
export type AttributionKind =
  | "provider"
  | "mcpService"
  | "virtualKey"
  | "llmRoute"
  | "mcpRoute"
  | "acpRoute"
  | "acpService";

export type AttributionMap = Record<AttributionKind, Record<string, string[]>>;

function emptyMap(): AttributionMap {
  return { provider: {}, mcpService: {}, virtualKey: {}, llmRoute: {}, mcpRoute: {}, acpRoute: {}, acpService: {} };
}

function buildMap(agents: Agent[]): AttributionMap {
  const map = emptyMap();
  const add = (kind: AttributionKind, resId: string | undefined, agentId: string) => {
    if (!resId) return;
    (map[kind][resId] ??= []).push(agentId);
  };
  for (const a of agents) {
    (a.resources.provider_ids ?? []).forEach((id) => add("provider", id, a.id));
    (a.resources.mcp_service_ids ?? []).forEach((id) => add("mcpService", id, a.id));
    (a.resources.virtual_key_ids ?? []).forEach((id) => add("virtualKey", id, a.id));
    (a.routes.llm_route_ids ?? []).forEach((id) => add("llmRoute", id, a.id));
    (a.routes.mcp_route_ids ?? []).forEach((id) => add("mcpRoute", id, a.id));
    (a.routes.acp_route_ids ?? []).forEach((id) => add("acpRoute", id, a.id));
    add("acpService", a.runtime.acp?.service_id, a.id);
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
