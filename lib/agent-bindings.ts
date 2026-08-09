import type { AgentPayload, AgentRuntimeBuiltin } from "@/lib/api";

export interface BuiltinReferences {
  llmRouteIDs: string[];
  mcpServiceIDs: string[];
}

export interface BuiltinDependencyAvailability {
  llmRouteIDs: Iterable<string>;
  mcpServiceIDs: Iterable<string>;
}

export interface BuiltinDependencyDiagnostics extends BuiltinReferences {
  missingLlmRouteIDs: string[];
  missingMcpServiceIDs: string[];
}

function collectNamedStrings(
  value: unknown,
  key: string,
  out = new Set<string>(),
  seen = new WeakSet<object>(),
): Set<string> {
  // The recursive walk is safe because these names are schema-specific today:
  // llm_route_id only appears on model nodes and mcp_service_id only on tool
  // selections. If the upstream schema reuses either name for metadata, narrow
  // this traversal to those nodes. See agent-gateway/pkg/agent/builtin_types.go
  // (BuiltinModel and BuiltinToolSelection, currently lines 83 and 118).
  if (!value || typeof value !== "object") return out;
  if (seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectNamedStrings(item, key, out, seen);
    return out;
  }
  for (const [name, item] of Object.entries(value)) {
    if (name === key && typeof item === "string" && item.trim()) out.add(item.trim());
    else collectNamedStrings(item, key, out, seen);
  }
  return out;
}

function mergeIDs(current: string[] | undefined, required: Iterable<string>): string[] | undefined {
  const merged = new Set((current ?? []).map((id) => id.trim()).filter(Boolean));
  for (const id of required) merged.add(id);
  return merged.size ? [...merged] : undefined;
}

function removeIDs(current: string[] | undefined, derived: Iterable<string>): string[] | undefined {
  const excluded = new Set(derived);
  const manual = (current ?? []).map((id) => id.trim()).filter((id) => id && !excluded.has(id));
  return manual.length ? [...new Set(manual)] : undefined;
}

/** Collect every executable dependency, including plan-execute roles and
 * recursively nested sub-agents. Keep this traversal shared with attribution
 * so the editor and resource orphan indicators cannot disagree. */
export function collectBuiltinReferences(builtin: AgentRuntimeBuiltin | undefined): BuiltinReferences {
  if (!builtin) return { llmRouteIDs: [], mcpServiceIDs: [] };
  return {
    llmRouteIDs: [...collectNamedStrings(builtin, "llm_route_id")],
    mcpServiceIDs: [...collectNamedStrings(builtin, "mcp_service_id")],
  };
}

/** Compare a payload's executable builtin references with a successfully
 * loaded resource catalog. Loading/error state stays with the caller so an
 * unavailable catalog cannot accidentally be interpreted as an empty one. */
export function diagnoseBuiltinDependencies(
  payload: AgentPayload,
  available: BuiltinDependencyAvailability,
): BuiltinDependencyDiagnostics {
  const references = collectBuiltinReferences(
    payload.runtime.type === "builtin" ? payload.runtime.builtin : undefined,
  );
  const llmRoutes = new Set(available.llmRouteIDs);
  const mcpServices = new Set(available.mcpServiceIDs);
  return {
    ...references,
    missingLlmRouteIDs: references.llmRouteIDs.filter((id) => !llmRoutes.has(id)),
    missingMcpServiceIDs: references.mcpServiceIDs.filter((id) => !mcpServices.has(id)),
  };
}

/** Find exclusive LLM bindings that the YAML editor previously derived from
 * builtin references but that the current definition no longer uses. They are
 * not removed automatically because the persisted payload cannot distinguish
 * a derived binding from one the user deliberately retained. */
export function findStaleBuiltinLlmBindings(
  payload: AgentPayload,
  previouslyDerived: Iterable<string>,
): string[] {
  if (payload.runtime.type !== "builtin") return [];
  const current = new Set(collectBuiltinReferences(payload.runtime.builtin).llmRouteIDs);
  const bound = new Set(payload.routes.llm_route_ids ?? []);
  return [...new Set(previouslyDerived)].filter((id) => bound.has(id) && !current.has(id));
}

/**
 * A builtin definition's model and tool references are executable dependencies.
 * The gateway requires them to also be declared in the Agent's route/resource
 * bindings, so the guided editor keeps both representations in sync at submit.
 */
export function bindBuiltinDependencies(payload: AgentPayload): AgentPayload {
  const builtin = payload.runtime.type === "builtin" ? payload.runtime.builtin : undefined;
  if (!builtin) return payload;
  const references = collectBuiltinReferences(builtin);

  return {
    ...payload,
    routes: {
      ...payload.routes,
      llm_route_ids: mergeIDs(payload.routes.llm_route_ids, references.llmRouteIDs),
    },
    resources: {
      ...payload.resources,
      mcp_service_ids: mergeIDs(payload.resources.mcp_service_ids, references.mcpServiceIDs),
    },
  };
}

/**
 * Return the form's source-of-truth payload: explicit selections only. Gateway
 * responses and Form -> YAML output contain the derived builtin dependencies,
 * so every hydration path must remove them before the user edits the builtin.
 */
export function stripBuiltinDependencies(payload: AgentPayload): AgentPayload {
  const builtin = payload.runtime.type === "builtin" ? payload.runtime.builtin : undefined;
  if (!builtin) return payload;
  const references = collectBuiltinReferences(builtin);

  return {
    ...payload,
    routes: {
      ...payload.routes,
      llm_route_ids: removeIDs(payload.routes.llm_route_ids, references.llmRouteIDs),
    },
    resources: {
      ...payload.resources,
      mcp_service_ids: removeIDs(payload.resources.mcp_service_ids, references.mcpServiceIDs),
    },
  };
}
