import { parseDocument, stringify } from "yaml";
import {
  createAgent,
  createAgentRoute,
  createLLMRoute,
  createMCPRoute,
  createMCPService,
  createManagedModel,
  createProvider,
  createVirtualKey,
  listAgentRoutes,
  listAgents,
  listCLIAuthAuthenticators,
  listLLMRoutes,
  listMCPRoutes,
  listMCPServices,
  listManagedModels,
  listProviders,
  listProviderTypes,
  listVirtualKeys,
  updateAgent,
  updateAgentRoute,
  updateCLIAuthAuthenticator,
  updateLLMRoute,
  updateMCPRoute,
  updateMCPService,
  updateManagedModel,
  updateProvider,
  updateVirtualKey,
  type Agent,
  type AgentPayload,
  type AgentRoute,
  type AgentRoutePayload,
  type AuthenticatorState,
  type LLMRoute,
  type LLMRoutePayload,
  type MCPRoute,
  type MCPRoutePayload,
  type MCPService,
  type MCPServicePayload,
  type ManagedConcreteModel,
  type ManagedModelPayload,
  type ProviderItem,
  type ProviderPayload,
  type ProviderTypeItem,
  type VirtualKeyItem,
  type VirtualKeyPayload,
} from "@/lib/api";
import { agentPayload } from "@/lib/agent-yaml";

export const GATEWAY_BUNDLE_API_VERSION = "gateway.agw/v1alpha1";
export const GATEWAY_BUNDLE_KIND = "GatewayBundle";

export const BUNDLE_FAMILIES = [
  "providers",
  "managedModels",
  "llmRoutes",
  "mcpServices",
  "mcpRoutes",
  "agents",
  "agentRoutes",
  "virtualKeys",
  "cliAuthAuthenticators",
] as const;

export type BundleFamily = (typeof BUNDLE_FAMILIES)[number];
export type BundleObject = Record<string, unknown>;

export interface GatewayBundle {
  apiVersion: typeof GATEWAY_BUNDLE_API_VERSION;
  kind: typeof GATEWAY_BUNDLE_KIND;
  providers?: BundleObject[];
  managedModels?: BundleObject[];
  llmRoutes?: BundleObject[];
  virtualKeys?: BundleObject[];
  cliAuthAuthenticators?: BundleObject[];
  mcpServices?: BundleObject[];
  mcpRoutes?: BundleObject[];
  agentRoutes?: BundleObject[];
  agents?: BundleObject[];
}

export interface BundleSnapshot {
  providerTypes: ProviderTypeItem[];
  providers: ProviderItem[];
  managedModels: ManagedConcreteModel[];
  llmRoutes: LLMRoute[];
  virtualKeys: VirtualKeyItem[];
  cliAuthAuthenticators: AuthenticatorState[];
  mcpServices: MCPService[];
  mcpRoutes: MCPRoute[];
  agentRoutes: AgentRoute[];
  agents: Agent[];
}

export type BundlePlanAction = "create" | "update" | "skip" | "conflict";

export interface BundlePlanItem {
  family: BundleFamily;
  id: string;
  action: BundlePlanAction;
  reason?: string;
  desired: BundleObject;
}

const TOP_LEVEL_KEYS = new Set(["apiVersion", "kind", ...BUNDLE_FAMILIES]);
const ENV_PLACEHOLDER_RE = /\$\{[A-Za-z_][A-Za-z0-9_]*\}/;

function isObject(value: unknown): value is BundleObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function requiredString(item: BundleObject, field: string, path: string): void {
  if (typeof item[field] !== "string" || !item[field].trim()) throw new Error(`${path}.${field} must be a non-empty string`);
}

function requiredMapping(item: BundleObject, field: string, path: string): void {
  if (!isObject(item[field])) throw new Error(`${path}.${field} must be a mapping`);
}

function validateBundleItem(family: BundleFamily, item: BundleObject, path: string): void {
  if (family === "providers") requiredString(item, "provider_type", path);
  if (family === "llmRoutes") {
    requiredMapping(item, "match_policy", path);
    requiredMapping(item, "target_policy", path);
    requiredMapping(item, "auth_policy", path);
  }
  if (family === "mcpServices") {
    requiredString(item, "name", path);
    requiredString(item, "transport", path);
  }
  if (family === "mcpRoutes") {
    requiredString(item, "service_id", path);
    requiredMapping(item, "match_policy", path);
    requiredMapping(item, "auth_policy", path);
  }
  if (family === "agents") {
    requiredString(item, "name", path);
    requiredMapping(item, "runtime", path);
    const runtime = item.runtime as BundleObject;
    requiredString(runtime, "type", `${path}.runtime`);
    const type = runtime.type as string;
    if (!(["acp", "builtin", "http"] as string[]).includes(type)) throw new Error(`${path}.runtime.type is unsupported: ${type}`);
    requiredMapping(runtime, type, `${path}.runtime`);
  }
  if (family === "agentRoutes") {
    requiredString(item, "agent_id", path);
    requiredMapping(item, "match_policy", path);
    requiredMapping(item, "auth_policy", path);
  }
  if (family === "cliAuthAuthenticators" && typeof item.enabled !== "boolean") throw new Error(`${path}.enabled must be a boolean`);
}

function containsEnvPlaceholder(value: unknown): boolean {
  if (typeof value === "string") return ENV_PLACEHOLDER_RE.test(value);
  if (Array.isArray(value)) return value.some(containsEnvPlaceholder);
  return isObject(value) && Object.values(value).some(containsEnvPlaceholder);
}

function copyWithout(value: BundleObject, keys: string[]): BundleObject {
  const out = { ...value };
  for (const key of keys) delete out[key];
  return out;
}

const VIEW_FIELDS = ["created_at", "updated_at", "source", "read_only"];

function providerConfig(item: ProviderItem | BundleObject): BundleObject {
  return copyWithout(item as BundleObject, VIEW_FIELDS);
}

function managedModelConfig(item: ManagedConcreteModel | BundleObject): BundleObject {
  const raw = item as BundleObject;
  return {
    provider_id: raw.provider_id,
    upstream_model: raw.upstream_model,
    ...(raw.credential_scope !== undefined && { credential_scope: raw.credential_scope }),
    ...(raw.enabled !== undefined && { enabled: raw.enabled }),
    ...(raw.capability_overrides !== undefined && { capability_overrides: raw.capability_overrides }),
  };
}

function routeConfig(item: LLMRoute | MCPRoute | AgentRoute | BundleObject): BundleObject {
  return copyWithout(item as BundleObject, VIEW_FIELDS);
}

function mcpServiceConfig(item: MCPService | BundleObject): BundleObject {
  return copyWithout(item as BundleObject, VIEW_FIELDS);
}

function virtualKeyConfig(item: VirtualKeyItem | BundleObject): BundleObject {
  return copyWithout(item as BundleObject, [...VIEW_FIELDS, "key"]);
}

function authenticatorConfig(item: AuthenticatorState | BundleObject): BundleObject {
  const raw = item as BundleObject;
  return {
    name: raw.name,
    enabled: raw.enabled,
    ...(raw.config !== undefined && { config: raw.config }),
  };
}

function agentConfig(item: Agent | BundleObject): BundleObject {
  if ("created_at" in item) return agentPayload(item as unknown as Agent) as unknown as BundleObject;
  return copyWithout(item as BundleObject, [...VIEW_FIELDS, "runtime_status", "capabilities"]);
}

const CONFIG_FOR: Record<BundleFamily, (item: never) => BundleObject> = {
  providers: providerConfig,
  managedModels: managedModelConfig,
  llmRoutes: routeConfig,
  mcpServices: mcpServiceConfig,
  mcpRoutes: routeConfig,
  agents: agentConfig,
  agentRoutes: routeConfig,
  virtualKeys: virtualKeyConfig,
  cliAuthAuthenticators: authenticatorConfig,
};

function identity(family: BundleFamily, item: BundleObject): string {
  if (family === "managedModels") {
    const provider = String(item.provider_id ?? "").trim();
    const model = String(item.upstream_model ?? "").trim();
    return provider && model ? `${provider}/${model}` : "";
  }
  if (family === "cliAuthAuthenticators") return String(item.name ?? "").trim();
  return String(item.id ?? "").trim();
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function comparableConfig(family: BundleFamily, value: BundleObject): BundleObject {
  if (family === "cliAuthAuthenticators" && value.enabled === false) return copyWithout(value, ["config"]);
  return value;
}

function isReadOnly(item: unknown): boolean {
  return isObject(item) && (item.read_only === true || item.source === "caddyfile");
}

export async function loadBundleSnapshot(): Promise<BundleSnapshot> {
  const [providerTypes, providers, managedModels, llmRoutes, virtualKeys, cliAuthAuthenticators, mcpServices, mcpRoutes, agentRoutes, agents] =
    await Promise.all([
      listProviderTypes(),
      listProviders(),
      listManagedModels(),
      listLLMRoutes(),
      listVirtualKeys(),
      listCLIAuthAuthenticators(),
      listMCPServices(),
      listMCPRoutes(),
      listAgentRoutes(),
      listAgents(),
    ]);
  return { providerTypes, providers, managedModels, llmRoutes, virtualKeys, cliAuthAuthenticators, mcpServices, mcpRoutes, agentRoutes, agents };
}

export function bundleFromSnapshot(snapshot: BundleSnapshot): GatewayBundle {
  const bundle: GatewayBundle = { apiVersion: GATEWAY_BUNDLE_API_VERSION, kind: GATEWAY_BUNDLE_KIND };
  for (const family of BUNDLE_FAMILIES) {
    const items = snapshot[family] as unknown[];
    if (!items.length) continue;
    bundle[family] = items
      .map((item) => CONFIG_FOR[family](item as never))
      .sort((a, b) => identity(family, a).localeCompare(identity(family, b)));
  }
  return bundle;
}

export function serializeGatewayBundle(bundle: GatewayBundle): string {
  return stringify(bundle, { indent: 2, lineWidth: 0, defaultStringType: "PLAIN", defaultKeyType: "PLAIN" });
}

export function parseGatewayBundle(text: string): GatewayBundle {
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length) throw new Error(doc.errors.map((error) => error.message).join("; "));
  const value = doc.toJS({ maxAliasCount: 100 }) as unknown;
  if (!isObject(value)) throw new Error("Bundle root must be a YAML mapping");
  const unknown = Object.keys(value).filter((key) => !TOP_LEVEL_KEYS.has(key));
  if (unknown.length) throw new Error(`Unsupported top-level field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`);
  if (value.apiVersion !== GATEWAY_BUNDLE_API_VERSION) throw new Error(`apiVersion must be ${GATEWAY_BUNDLE_API_VERSION}`);
  if (value.kind !== GATEWAY_BUNDLE_KIND) throw new Error(`kind must be ${GATEWAY_BUNDLE_KIND}`);

  for (const family of BUNDLE_FAMILIES) {
    const items = value[family];
    if (items === undefined) continue;
    if (!Array.isArray(items)) throw new Error(`${family} must be a list`);
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (!isObject(item)) throw new Error(`${family}[${index}] must be a mapping`);
      const id = identity(family, item);
      if (!id) throw new Error(`${family}[${index}] requires ${family === "managedModels" ? "provider_id and upstream_model" : family === "cliAuthAuthenticators" ? "name" : "id"}`);
      if (seen.has(id)) throw new Error(`${family} contains duplicate id ${id}`);
      seen.add(id);
      validateBundleItem(family, item, `${family}[${index}]`);
    });
  }
  if (containsEnvPlaceholder(value)) {
    throw new Error("Environment placeholders such as ${NAME} cannot be resolved by the browser; import concrete values or apply this bundle with agwctl");
  }
  return value as unknown as GatewayBundle;
}

export function planGatewayBundle(bundle: GatewayBundle, snapshot: BundleSnapshot): BundlePlanItem[] {
  const plan: BundlePlanItem[] = [];
  for (const family of BUNDLE_FAMILIES) {
    const currentItems = snapshot[family] as unknown[];
    const current = new Map(currentItems.map((item) => [identity(family, item as BundleObject), item]));
    for (const raw of bundle[family] ?? []) {
      const id = identity(family, raw);
      const desired = CONFIG_FOR[family](raw as never);
      const existing = current.get(id);
      if (isReadOnly(raw)) {
        plan.push({ family, id, action: "skip", reason: "Bundle object is marked read-only or Caddyfile-owned", desired });
      } else if (!existing) {
        plan.push({
          family,
          id,
          action: family === "cliAuthAuthenticators" ? "conflict" : "create",
          reason: family === "cliAuthAuthenticators" ? "Authenticator is not registered by this gateway runtime" : undefined,
          desired,
        });
      } else if (canonical(comparableConfig(family, CONFIG_FOR[family](existing as never))) === canonical(comparableConfig(family, desired))) {
        plan.push({ family, id, action: "skip", reason: "Unchanged", desired });
      } else if (isReadOnly(existing)) {
        plan.push({ family, id, action: "skip", reason: "Existing object is read-only or Caddyfile-owned", desired });
      } else {
        plan.push({ family, id, action: "update", desired });
      }
    }
  }
  return applyReferenceConflicts(plan, bundle, snapshot);
}

type ReferenceSets = Record<"providers" | "llmRoutes" | "mcpServices" | "mcpRoutes" | "virtualKeys" | "agents" | "allRoutes", Set<string>>;

function availableReferences(bundle: GatewayBundle, snapshot: BundleSnapshot): ReferenceSets {
  const ids = (family: BundleFamily) => new Set([
    ...(snapshot[family] as unknown[]).map((item) => identity(family, item as BundleObject)),
    ...(bundle[family] ?? []).map((item) => identity(family, item)),
  ]);
  const llmRoutes = ids("llmRoutes");
  const mcpRoutes = ids("mcpRoutes");
  const agentRoutes = ids("agentRoutes");
  return {
    providers: ids("providers"),
    llmRoutes,
    mcpServices: ids("mcpServices"),
    mcpRoutes,
    virtualKeys: ids("virtualKeys"),
    agents: ids("agents"),
    allRoutes: new Set([...llmRoutes, ...mcpRoutes, ...agentRoutes]),
  };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && !!item.trim()) : [];
}

function collectNamedStrings(value: unknown, keyName: string, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectNamedStrings(item, keyName, out);
  } else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (key === keyName && typeof item === "string" && item.trim()) out.add(item.trim());
      else collectNamedStrings(item, keyName, out);
    }
  }
  return out;
}

function missingFrom(values: Iterable<string>, available: Set<string>, label: string): string[] {
  return [...values].filter((id) => !available.has(id)).map((id) => `${label} ${id}`);
}

function missingReferences(item: BundlePlanItem, refs: ReferenceSets, snapshot: BundleSnapshot): string[] {
  const value = item.desired;
  if (item.family === "providers") {
    const type = String(value.provider_type ?? "").toLowerCase();
    const providerType = snapshot.providerTypes.find((candidate) => candidate.provider_type.toLowerCase() === type);
    if (!providerType) return [`provider type ${type || "(empty)"}`];
    if (!providerType.enabled) return [`disabled provider type ${type}`];
  }
  if (item.family === "managedModels") return missingFrom([String(value.provider_id ?? "")], refs.providers, "provider");
  if (item.family === "mcpRoutes") return missingFrom([String(value.service_id ?? "")], refs.mcpServices, "MCP service");
  if (item.family === "agentRoutes") return missingFrom([String(value.agent_id ?? "")], refs.agents, "agent");
  if (item.family === "virtualKeys") return missingFrom(strings(value.allowed_route_ids), refs.allRoutes, "route");
  if (item.family === "llmRoutes") return missingFrom(collectNamedStrings(value.target_policy, "provider_id"), refs.providers, "provider");
  if (item.family === "agents") {
    const resources = isObject(value.resources) ? value.resources : {};
    const routes = isObject(value.routes) ? value.routes : {};
    return [
      ...missingFrom(strings(resources.provider_ids), refs.providers, "provider"),
      ...missingFrom(strings(resources.mcp_service_ids), refs.mcpServices, "MCP service"),
      ...missingFrom(strings(resources.virtual_key_ids), refs.virtualKeys, "Virtual Key"),
      ...missingFrom(strings(routes.llm_route_ids), refs.llmRoutes, "LLM route"),
      ...missingFrom(strings(routes.mcp_route_ids), refs.mcpRoutes, "MCP route"),
      ...missingFrom(collectNamedStrings(value.runtime, "llm_route_id"), refs.llmRoutes, "LLM route"),
      ...missingFrom(collectNamedStrings(value.runtime, "mcp_service_id"), refs.mcpServices, "MCP service"),
    ];
  }
  return [];
}

function applyReferenceConflicts(plan: BundlePlanItem[], bundle: GatewayBundle, snapshot: BundleSnapshot): BundlePlanItem[] {
  const refs = availableReferences(bundle, snapshot);
  return plan.map((item) => {
    if (item.action === "skip") return item;
    const missing = [...new Set(missingReferences(item, refs, snapshot))];
    return missing.length ? { ...item, action: "conflict", reason: `Missing or unavailable: ${missing.join(", ")}` } : item;
  });
}

export async function applyBundlePlanItem(item: BundlePlanItem): Promise<void> {
  const desired = item.desired;
  if (item.action !== "create" && item.action !== "update") return;
  switch (item.family) {
    case "providers": {
      const payload = desired as unknown as ProviderPayload;
      if (item.action === "create") await createProvider(payload);
      else {
        const update = { ...payload };
        delete (update as Partial<ProviderPayload>).id;
        await updateProvider(item.id, update);
      }
      return;
    }
    case "managedModels": {
      const payload = desired as unknown as ManagedModelPayload;
      if (item.action === "create") await createManagedModel(payload);
      else await updateManagedModel(payload.provider_id, payload.upstream_model, payload);
      return;
    }
    case "llmRoutes":
      if (item.action === "create") await createLLMRoute(desired as unknown as LLMRoutePayload);
      else await updateLLMRoute(item.id, desired as unknown as LLMRoutePayload);
      return;
    case "mcpServices":
      if (item.action === "create") await createMCPService(desired as unknown as MCPServicePayload);
      else await updateMCPService(item.id, desired as unknown as MCPServicePayload);
      return;
    case "mcpRoutes":
      if (item.action === "create") await createMCPRoute(desired as unknown as MCPRoutePayload);
      else await updateMCPRoute(item.id, desired as unknown as MCPRoutePayload);
      return;
    case "agents":
      if (item.action === "create") await createAgent(desired as unknown as AgentPayload);
      else await updateAgent(item.id, desired as unknown as AgentPayload);
      return;
    case "agentRoutes":
      if (item.action === "create") await createAgentRoute(desired as unknown as AgentRoutePayload);
      else await updateAgentRoute(item.id, desired as unknown as AgentRoutePayload);
      return;
    case "virtualKeys":
      if (item.action === "create") await createVirtualKey(desired as unknown as VirtualKeyPayload);
      else await updateVirtualKey(item.id, desired as unknown as VirtualKeyPayload);
      return;
    case "cliAuthAuthenticators":
      await updateCLIAuthAuthenticator(item.id, {
        enabled: desired.enabled as boolean,
        ...(desired.enabled === true && { config: desired.config as AuthenticatorState["config"] }),
      });
  }
}
