import { parseDocument, stringify } from "yaml";
import {
  type Agent,
  type AgentPayload,
  type AgentRuntimeBuiltin,
  type AgentRuntimeType,
} from "@/lib/api";

type Mapping = Record<string, unknown>;

const AGENT_FIELDS = new Set(["id", "name", "description", "runtime", "routes", "resources", "policy", "disabled"]);
const RUNTIME_TYPES = new Set<AgentRuntimeType>(["acp", "builtin", "http"]);
const BUILTIN_TOPOLOGIES = new Set(["single", "sequential", "parallel", "loop", "supervisor", "planexecute", "deep", "custom"]);

function isMapping(value: unknown): value is Mapping {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function rejectCircularAliases(value: unknown, ancestors = new WeakSet<object>()): void {
  if (!value || typeof value !== "object") return;
  if (ancestors.has(value)) {
    throw new Error("Agent YAML contains a circular alias, which cannot be represented by the Admin API JSON payload");
  }
  ancestors.add(value);
  for (const item of Array.isArray(value) ? value : Object.values(value)) {
    rejectCircularAliases(item, ancestors);
  }
  ancestors.delete(value);
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${path} must be a string`);
  return value;
}

function mapping(value: unknown, path: string): Mapping {
  if (!isMapping(value)) throw new Error(`${path} must be a mapping`);
  return value;
}

function knownFields(value: Mapping, allowed: string[], path: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknown.length) throw new Error(`Unsupported ${path} field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`);
}

function optionalStringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${path} must be a list of non-empty strings`);
  }
  return value as string[];
}

function validateBuiltin(value: Mapping): AgentRuntimeBuiltin {
  const model = mapping(value.model, "runtime.builtin.model");
  nonEmptyString(model.llm_route_id, "runtime.builtin.model.llm_route_id");
  const topology = mapping(value.topology, "runtime.builtin.topology");
  const kind = nonEmptyString(topology.kind, "runtime.builtin.topology.kind");
  if (!BUILTIN_TOPOLOGIES.has(kind)) throw new Error(`runtime.builtin.topology.kind is unsupported: ${kind}`);
  return value as unknown as AgentRuntimeBuiltin;
}

/**
 * Parse the advanced editor shape. A direct Admin API payload is canonical, but
 * accepting an `agents:` fragment (and therefore a one-agent GatewayBundle)
 * makes detail-page exports and `agwctl gateway export` directly pasteable.
 */
export function parseAgentPayloadYaml(text: string): AgentPayload {
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length) throw new Error(doc.errors.map((error) => error.message).join("; "));
  let value = doc.toJS({ maxAliasCount: 100 }) as unknown;
  rejectCircularAliases(value);
  if (!isMapping(value)) throw new Error("Agent YAML must be a mapping");

  if ("agents" in value) {
    if (!Array.isArray(value.agents) || value.agents.length !== 1) {
      throw new Error("agents must contain exactly one agent");
    }
    value = value.agents[0];
  }
  if (!isMapping(value)) throw new Error("Agent entry must be a mapping");

  const unknown = Object.keys(value).filter((key) => !AGENT_FIELDS.has(key));
  if (unknown.length) throw new Error(`Unsupported agent field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`);

  const id = nonEmptyString(value.id, "id");
  const name = nonEmptyString(value.name, "name");
  const description = optionalString(value.description, "description");
  const runtime = mapping(value.runtime, "runtime");
  knownFields(runtime, ["type", "acp", "builtin", "http"], "runtime");
  const runtimeType = nonEmptyString(runtime.type, "runtime.type") as AgentRuntimeType;
  if (!RUNTIME_TYPES.has(runtimeType)) throw new Error(`runtime.type is unsupported: ${runtimeType}`);
  const runtimeConfig = mapping(runtime[runtimeType], `runtime.${runtimeType}`);
  const extraRuntime = ["acp", "builtin", "http"].filter((key) => key !== runtimeType && runtime[key] !== undefined);
  if (extraRuntime.length) throw new Error(`runtime.${extraRuntime[0]} does not match runtime.type ${runtimeType}`);

  if (runtimeType === "acp") {
    knownFields(runtimeConfig, [
      "agent_type", "cwd", "allowed_roots", "default_model", "env", "config_overrides",
      "idle_ttl", "max_instances", "permission_mode", "codex",
    ], "runtime.acp");
    nonEmptyString(runtimeConfig.agent_type, "runtime.acp.agent_type");
    nonEmptyString(runtimeConfig.cwd, "runtime.acp.cwd");
    optionalStringArray(runtimeConfig.allowed_roots, "runtime.acp.allowed_roots");
  } else if (runtimeType === "builtin") {
    validateBuiltin(runtimeConfig);
  } else {
    knownFields(runtimeConfig, ["endpoint", "auth_ref"], "runtime.http");
    nonEmptyString(runtimeConfig.endpoint, "runtime.http.endpoint");
    optionalString(runtimeConfig.auth_ref, "runtime.http.auth_ref");
  }

  const routes = value.routes === undefined ? {} : mapping(value.routes, "routes");
  const resources = value.resources === undefined ? {} : mapping(value.resources, "resources");
  const policy = value.policy === undefined ? {} : mapping(value.policy, "policy");
  knownFields(routes, ["llm_route_ids", "mcp_route_ids"], "routes");
  knownFields(resources, ["provider_ids", "mcp_service_ids", "virtual_key_ids"], "resources");
  knownFields(policy, ["max_agent_depth", "budget"], "policy");
  optionalStringArray(routes.llm_route_ids, "routes.llm_route_ids");
  optionalStringArray(routes.mcp_route_ids, "routes.mcp_route_ids");
  optionalStringArray(resources.provider_ids, "resources.provider_ids");
  optionalStringArray(resources.mcp_service_ids, "resources.mcp_service_ids");
  optionalStringArray(resources.virtual_key_ids, "resources.virtual_key_ids");
  if (policy.budget !== undefined) {
    const budget = mapping(policy.budget, "policy.budget");
    knownFields(budget, ["max_turns_per_day", "max_tokens_per_day"], "policy.budget");
  }
  if (value.disabled !== undefined && typeof value.disabled !== "boolean") throw new Error("disabled must be a boolean");

  return {
    id,
    name,
    ...(description !== undefined && { description }),
    runtime: runtime as unknown as AgentPayload["runtime"],
    routes: routes as unknown as AgentPayload["routes"],
    resources: resources as unknown as AgentPayload["resources"],
    policy: policy as unknown as AgentPayload["policy"],
    disabled: value.disabled === true,
  };
}

/** Serialize the exact Admin API payload used by the advanced editor. */
export function agentPayloadYaml(payload: AgentPayload): string {
  return stringify(payload, { indent: 2, lineWidth: 0, defaultStringType: "PLAIN", defaultKeyType: "PLAIN" });
}

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
