import type {
  ACPAgentAdvancedConfiguration,
  AgentDefinition,
  AgentDefinitionDependency,
  AgentDefinitionDraft,
  AgentDefinitionResourceSelection,
  BuiltinAgentAdvancedConfiguration,
  HTTPAgentAdvancedConfiguration,
  PlatformAgentPolicy,
  PlatformAgentRuntime,
  SaveAgentDefinitionInput,
} from "../../contracts/platform/agents";
import type { PlatformActorReference } from "../../contracts/platform/identity";
import type { ContentRuntime } from "../ports/content";
import type { AuthoredResourceService } from "./authored-resources";
import {
  AgentDefinitionRegistry,
  type StoredAgentDefinition,
} from "./agent-definition-registry";
import { IdentityError, type PlatformIdentityService } from "./identity";
import type { KnowledgeService } from "./knowledge";
import type { TenantModelDefinitionService } from "./model-definitions";
import type { TenantToolDefinitionService } from "./tool-definitions";

const builtinTopologies = new Set([
  "single", "sequential", "parallel", "loop", "supervisor", "planexecute", "deep", "custom",
]);
const acpAgentTypes = new Set(["codex", "opencode"]);
const acpPermissionModes = new Set(["deny", "auto_approve", "interactive"]);
const secretSegments = new Set(["secret", "password", "token", "credential"]);

function invalid(message: string): never {
  throw new IdentityError("invalid_input", message);
}

function exactObject(
  value: unknown,
  label: string,
  fields: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !fields.includes(key))) {
    return invalid(`${label} contains unsupported fields`);
  }
  return record;
}

function rejectSecrets(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) rejectSecrets(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
    const segments = normalized.split(/[_-]/);
    if (segments.some((segment) => secretSegments.has(segment)) ||
      normalized.includes("private_key") || normalized.includes("api_key") ||
      normalized.includes("auth_ref")) {
      invalid("secret-bearing fields are not allowed in Agent definitions");
    }
    rejectSecrets(item);
  }
}

function text(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string") return invalid(`${label} must be text`);
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > maximum) {
    return invalid(`${label} must be ${allowEmpty ? `at most ${maximum}` : `between 1 and ${maximum}`} characters`);
  }
  return normalized;
}

function optionalInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    return invalid(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
}

function optionalNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    return invalid(`${label} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function stringList(value: unknown, label: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum || value.some((item) =>
    typeof item !== "string" || !item.trim() || item.length > 240
  )) return invalid(`${label} must contain at most ${maximum} non-empty IDs`);
  const normalized = value.map((item) => item.trim());
  if (new Set(normalized).size !== normalized.length) return invalid(`${label} contains duplicate IDs`);
  return normalized.sort();
}

function builtinAdvanced(value: unknown): BuiltinAgentAdvancedConfiguration {
  const input = exactObject(value, "builtin advanced configuration", ["topology", "generation", "permissions"]);
  const topology = exactObject(input.topology, "builtin topology", ["kind", "maxIterations"]);
  if (typeof topology.kind !== "string" || !builtinTopologies.has(topology.kind)) {
    return invalid("unsupported builtin topology");
  }
  const result: BuiltinAgentAdvancedConfiguration = {
    topology: {
      kind: topology.kind as BuiltinAgentAdvancedConfiguration["topology"]["kind"],
      ...optionalInteger(topology.maxIterations, "topology.maxIterations", 1, 100) === undefined
        ? {}
        : { maxIterations: optionalInteger(topology.maxIterations, "topology.maxIterations", 1, 100) },
    },
  };
  if (input.generation !== undefined) {
    const generation = exactObject(input.generation, "builtin generation", ["maxTokens", "temperature", "topP"]);
    result.generation = {
      ...optionalInteger(generation.maxTokens, "generation.maxTokens", 1, 1_000_000) === undefined
        ? {}
        : { maxTokens: optionalInteger(generation.maxTokens, "generation.maxTokens", 1, 1_000_000) },
      ...optionalNumber(generation.temperature, "generation.temperature", 0, 2) === undefined
        ? {}
        : { temperature: optionalNumber(generation.temperature, "generation.temperature", 0, 2) },
      ...optionalNumber(generation.topP, "generation.topP", 0, 1) === undefined
        ? {}
        : { topP: optionalNumber(generation.topP, "generation.topP", 0, 1) },
    };
  }
  if (input.permissions !== undefined) {
    const permissions = exactObject(input.permissions, "builtin permissions", ["mode", "timeoutSeconds", "maxPending"]);
    if (permissions.mode !== undefined && permissions.mode !== "auto_approve" && permissions.mode !== "interactive") {
      return invalid("unsupported builtin permission mode");
    }
    result.permissions = {
      ...(permissions.mode === undefined ? {} : { mode: permissions.mode }),
      ...optionalInteger(permissions.timeoutSeconds, "permissions.timeoutSeconds", 1, 86_400) === undefined
        ? {}
        : { timeoutSeconds: optionalInteger(permissions.timeoutSeconds, "permissions.timeoutSeconds", 1, 86_400) },
      ...optionalInteger(permissions.maxPending, "permissions.maxPending", 1, 1_000) === undefined
        ? {}
        : { maxPending: optionalInteger(permissions.maxPending, "permissions.maxPending", 1, 1_000) },
    };
  }
  return result;
}

function absolutePath(value: unknown, label: string): string {
  const path = text(value, label, 4_096);
  if (!/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(path)) return invalid(`${label} must be absolute`);
  return path;
}

function acpAdvanced(value: unknown): ACPAgentAdvancedConfiguration {
  const input = exactObject(value, "ACP advanced configuration", [
    "agentType", "cwd", "allowedRoots", "permissionMode", "idleTtlSeconds", "maxInstances",
  ]);
  if (typeof input.agentType !== "string" || !acpAgentTypes.has(input.agentType)) {
    return invalid("unsupported ACP agent type");
  }
  if (input.permissionMode !== undefined && (
    typeof input.permissionMode !== "string" || !acpPermissionModes.has(input.permissionMode)
  )) return invalid("unsupported ACP permission mode");
  const allowedRoots = input.allowedRoots === undefined
    ? undefined
    : stringList(input.allowedRoots, "allowedRoots", 100).map((root) => absolutePath(root, "allowed root"));
  return {
    agentType: input.agentType as ACPAgentAdvancedConfiguration["agentType"],
    cwd: absolutePath(input.cwd, "cwd"),
    ...(allowedRoots === undefined ? {} : { allowedRoots }),
    ...(input.permissionMode === undefined ? {} : {
      permissionMode: input.permissionMode as ACPAgentAdvancedConfiguration["permissionMode"],
    }),
    ...optionalInteger(input.idleTtlSeconds, "idleTtlSeconds", 1, 86_400) === undefined
      ? {}
      : { idleTtlSeconds: optionalInteger(input.idleTtlSeconds, "idleTtlSeconds", 1, 86_400) },
    ...optionalInteger(input.maxInstances, "maxInstances", 1, 1_000) === undefined
      ? {}
      : { maxInstances: optionalInteger(input.maxInstances, "maxInstances", 1, 1_000) },
  };
}

function httpAdvanced(value: unknown): HTTPAgentAdvancedConfiguration {
  const input = exactObject(value, "HTTP advanced configuration", ["cardUrl", "timeoutSeconds"]);
  const cardUrl = text(input.cardUrl, "cardUrl", 2_048);
  let parsed: URL;
  try {
    parsed = new URL(cardUrl);
  } catch {
    return invalid("cardUrl must be an absolute HTTP(S) URL");
  }
  const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
  if ((parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) || parsed.username || parsed.password || parsed.hash) {
    return invalid("cardUrl must use HTTPS except for loopback HTTP and cannot contain userinfo or a fragment");
  }
  return {
    cardUrl: parsed.toString(),
    ...optionalInteger(input.timeoutSeconds, "timeoutSeconds", 1, 3_600) === undefined
      ? {}
      : { timeoutSeconds: optionalInteger(input.timeoutSeconds, "timeoutSeconds", 1, 3_600) },
  };
}

function runtime(value: unknown): PlatformAgentRuntime {
  const input = exactObject(value, "runtime", ["type", "advanced"]);
  if (input.type === "builtin") return { type: "builtin", advanced: builtinAdvanced(input.advanced) };
  if (input.type === "acp") return { type: "acp", advanced: acpAdvanced(input.advanced) };
  if (input.type === "http") return { type: "http", advanced: httpAdvanced(input.advanced) };
  return invalid("runtime.type must be builtin, acp or http");
}

function resources(value: unknown): AgentDefinitionResourceSelection {
  const input = exactObject(value, "resources", [
    "modelDefinitionId", "toolDefinitionIds", "skillRevisionIds", "instructionRevisionIds", "knowledgeBaseIds",
  ]);
  if (input.modelDefinitionId !== null && typeof input.modelDefinitionId !== "string") {
    return invalid("modelDefinitionId must be an ID or null");
  }
  return {
    modelDefinitionId: input.modelDefinitionId === null ? null : text(input.modelDefinitionId, "modelDefinitionId", 240),
    toolDefinitionIds: stringList(input.toolDefinitionIds, "toolDefinitionIds", 50),
    skillRevisionIds: stringList(input.skillRevisionIds, "skillRevisionIds", 50),
    instructionRevisionIds: stringList(input.instructionRevisionIds, "instructionRevisionIds", 50),
    knowledgeBaseIds: stringList(input.knowledgeBaseIds, "knowledgeBaseIds", 20),
  };
}

function policy(value: unknown): PlatformAgentPolicy {
  const input = exactObject(value, "policy", ["maxAgentDepth", "budget"]);
  const result: PlatformAgentPolicy = {};
  const maxAgentDepth = optionalInteger(input.maxAgentDepth, "maxAgentDepth", 1, 100);
  if (maxAgentDepth !== undefined) result.maxAgentDepth = maxAgentDepth;
  if (input.budget !== undefined) {
    const budget = exactObject(input.budget, "budget", ["maxTurnsPerDay", "maxTokensPerDay"]);
    result.budget = {};
    const maxTurns = optionalInteger(budget.maxTurnsPerDay, "budget.maxTurnsPerDay", 1, 1_000_000);
    const maxTokens = optionalInteger(budget.maxTokensPerDay, "budget.maxTokensPerDay", 1, 1_000_000_000);
    if (maxTurns !== undefined) result.budget.maxTurnsPerDay = maxTurns;
    if (maxTokens !== undefined) result.budget.maxTokensPerDay = maxTokens;
  }
  return result;
}

export function canonicalAgentValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalAgentValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalAgentValue(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export class AgentDefinitionService {
  constructor(
    private readonly registry: AgentDefinitionRegistry,
    private readonly identity: PlatformIdentityService,
    private readonly authored: AuthoredResourceService,
    private readonly knowledge: KnowledgeService,
    private readonly models: TenantModelDefinitionService,
    private readonly tools: TenantToolDefinitionService,
    private readonly content: ContentRuntime,
  ) {}

  private validateSlug(value: unknown): string {
    if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) {
      return invalid("Agent ID must be a lowercase slug up to 64 characters");
    }
    return value;
  }

  private validateDraft(value: unknown): AgentDefinitionDraft {
    rejectSecrets(value);
    const input = exactObject(value, "draft", ["name", "description", "systemPrompt", "runtime", "resources", "policy"]);
    const draft: AgentDefinitionDraft = {
      name: text(input.name, "name", 200),
      description: text(input.description, "description", 2_000, true),
      systemPrompt: text(input.systemPrompt, "systemPrompt", 100_000, true),
      runtime: runtime(input.runtime),
      resources: resources(input.resources),
      policy: policy(input.policy),
    };
    if (canonicalAgentValue(draft).length > 512 * 1024) return invalid("Agent draft exceeds 512 KiB");
    return draft;
  }

  private projection(record: StoredAgentDefinition): AgentDefinition {
    return {
      id: record.id,
      slug: record.slug,
      tenantId: record.tenantId,
      status: record.status,
      version: record.version,
      draftDigest: record.draftDigest,
      draft: record.draft,
      dependencies: record.dependencies,
      editable: record.status === "active",
      createdByPrincipalId: record.createdByPrincipalId,
      updatedByPrincipalId: record.updatedByPrincipalId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private async dependencies(
    actor: PlatformActorReference,
    tenantId: string,
    selected: AgentDefinitionResourceSelection,
  ): Promise<AgentDefinitionDependency[]> {
    const dependencies: AgentDefinitionDependency[] = [];
    if (selected.modelDefinitionId) {
      dependencies.push({
        kind: "model_definition",
        ...await this.models.resolveReference(actor, tenantId, selected.modelDefinitionId),
      });
    }
    for (const id of selected.toolDefinitionIds) {
      dependencies.push({ kind: "tool_definition", ...await this.tools.resolveReference(actor, tenantId, id) });
    }
    for (const id of selected.skillRevisionIds) {
      const reference = await this.authored.resolveRevisionReference(actor, tenantId, "skill", id);
      dependencies.push({
        kind: "skill_revision",
        resourceId: reference.resourceId,
        revisionId: reference.revisionId,
        revisionNumber: reference.revisionNumber,
        contentHash: reference.contentHash,
        status: reference.status,
      });
    }
    for (const id of selected.instructionRevisionIds) {
      const reference = await this.authored.resolveRevisionReference(actor, tenantId, "instruction", id);
      dependencies.push({
        kind: "instruction_revision",
        resourceId: reference.resourceId,
        revisionId: reference.revisionId,
        revisionNumber: reference.revisionNumber,
        contentHash: reference.contentHash,
        status: reference.status,
      });
    }
    for (const id of selected.knowledgeBaseIds) {
      dependencies.push({ kind: "knowledge_base", ...await this.knowledge.resolveReference(actor, tenantId, id) });
    }
    return dependencies;
  }

  async list(actor: PlatformActorReference, tenantId: string): Promise<AgentDefinition[]> {
    await this.identity.authorizeTenant(actor, tenantId);
    const records = await this.registry.list(tenantId);
    await this.identity.authorizeTenant(actor, tenantId);
    return records.map((record) => this.projection(record));
  }

  async get(actor: PlatformActorReference, tenantId: string, id: string): Promise<AgentDefinition> {
    await this.identity.authorizeTenant(actor, tenantId);
    const record = await this.registry.get(id);
    await this.identity.authorizeTenant(actor, tenantId);
    if (!record || record.tenantId !== tenantId) throw new IdentityError("not_found", "Agent definition not found");
    return this.projection(record);
  }

  async create(
    actor: PlatformActorReference,
    tenantId: string,
    input: SaveAgentDefinitionInput,
  ): Promise<AgentDefinition> {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => !["slug", "expectedVersion", "draft"].includes(key))) {
      return invalid("invalid Agent definition input");
    }
    if (input.expectedVersion !== 0) return invalid("new Agent definitions require expectedVersion 0");
    const authority = await this.identity.authorizeTenant(actor, tenantId);
    const slug = this.validateSlug(input.slug);
    const draft = this.validateDraft(input.draft);
    const dependencies = await this.dependencies(actor, tenantId, draft.resources);
    const result = await this.registry.save({
      id: `agent:${tenantId}:${slug}`,
      slug,
      tenantId,
      expectedVersion: 0,
      draft,
      draftDigest: this.content.hash(canonicalAgentValue({ draft, dependencies })),
      dependencies,
      principalId: authority.principal.id,
      now: this.content.now(),
    });
    if (result.status === "exists") throw new IdentityError("conflict", "Agent ID already exists in this Tenant");
    if (result.status !== "saved") throw new IdentityError("conflict", "Agent dependencies changed while saving");
    await this.identity.authorizeTenant(actor, tenantId);
    return this.projection(result.item);
  }

  async update(
    actor: PlatformActorReference,
    tenantId: string,
    id: string,
    input: { expectedVersion: number; draft: AgentDefinitionDraft },
  ): Promise<AgentDefinition> {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => !["expectedVersion", "draft"].includes(key)) ||
      !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion <= 0) {
      return invalid("update requires a positive expectedVersion and draft");
    }
    const current = await this.get(actor, tenantId, id);
    if (!current.editable) throw new IdentityError("conflict", "Agent definition is not editable");
    const authority = await this.identity.authorizeTenant(actor, tenantId);
    const draft = this.validateDraft(input.draft);
    const dependencies = await this.dependencies(actor, tenantId, draft.resources);
    const result = await this.registry.save({
      id,
      slug: current.slug,
      tenantId,
      expectedVersion: input.expectedVersion,
      draft,
      draftDigest: this.content.hash(canonicalAgentValue({ draft, dependencies })),
      dependencies,
      principalId: authority.principal.id,
      now: this.content.now(),
    });
    if (result.status === "missing") throw new IdentityError("not_found", "Agent definition not found");
    if (result.status === "archived") throw new IdentityError("conflict", "archived Agent definitions are immutable");
    if (result.status === "stale") throw new IdentityError("conflict", "Agent draft changed; reload before saving");
    if (result.status !== "saved") throw new IdentityError("conflict", "Agent dependencies changed while saving");
    await this.identity.authorizeTenant(actor, tenantId);
    return this.projection(result.item);
  }

  async remove(actor: PlatformActorReference, tenantId: string, id: string): Promise<void> {
    const current = await this.get(actor, tenantId, id);
    if (!current.editable) throw new IdentityError("conflict", "Agent definition is not editable");
    if (await this.registry.archive(id, tenantId, this.content.now()) === "missing") {
      throw new IdentityError("not_found", "Agent definition not found");
    }
    await this.identity.authorizeTenant(actor, tenantId);
  }
}
