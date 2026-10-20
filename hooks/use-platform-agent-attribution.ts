"use client";

import { useEffect, useMemo, useState } from "react";
import { listAgentDefinitions } from "@/lib/platform-api";

export type PlatformAttributionMap = {
  modelDefinition: Record<string, string[] | null>;
  toolDefinition: Record<string, string[] | null>;
  skillRevision: Record<string, string[] | null>;
  instructionRevision: Record<string, string[] | null>;
  knowledgeBase: Record<string, string[] | null>;
};

function emptyMap(): PlatformAttributionMap {
  return { modelDefinition: {}, toolDefinition: {}, skillRevision: {}, instructionRevision: {}, knowledgeBase: {} };
}

const unknownRecord = new Proxy<Record<string, string[] | null>>({}, {
  get: () => null,
});
const unknownMap: PlatformAttributionMap = {
  modelDefinition: unknownRecord,
  toolDefinition: unknownRecord,
  skillRevision: unknownRecord,
  instructionRevision: unknownRecord,
  knowledgeBase: unknownRecord,
};

export function usePlatformAgentAttribution(tenantIds: string[]): PlatformAttributionMap | null {
  const key = useMemo(() => [...new Set(tenantIds)].sort().join("\0"), [tenantIds]);
  const [result, setResult] = useState<{
    key: string;
    map: PlatformAttributionMap | null;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    const ids = key ? key.split("\0") : [];
    Promise.all(ids.map((tenantId) => listAgentDefinitions(tenantId)))
      .then((groups) => {
        const next = emptyMap();
        const add = (kind: keyof PlatformAttributionMap, resourceId: string | null, agentId: string) => {
          if (!resourceId) return;
          const agents = (next[kind][resourceId] ??= []);
          if (!agents.includes(agentId)) agents.push(agentId);
        };
        for (const agent of groups.flat()) {
          const resources = agent.draft.resources;
          add("modelDefinition", resources.modelDefinitionId, agent.id);
          resources.toolDefinitionIds.forEach((id) => add("toolDefinition", id, agent.id));
          resources.skillRevisionIds.forEach((id) => add("skillRevision", id, agent.id));
          resources.instructionRevisionIds.forEach((id) => add("instructionRevision", id, agent.id));
          resources.knowledgeBaseIds.forEach((id) => add("knowledgeBase", id, agent.id));
        }
        if (alive) setResult({ key, map: next });
      })
      .catch(() => { if (alive) setResult({ key, map: null }); });
    return () => { alive = false; };
  }, [key]);
  return result?.key === key ? result.map ?? unknownMap : unknownMap;
}
