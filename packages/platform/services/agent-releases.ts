import type {
  AgentDefinitionDependency,
  AgentRelease,
} from "../../contracts/platform/agents";
import type { PlatformActorReference } from "../../contracts/platform/identity";
import type { ContentRuntime } from "../ports/content";
import type { AuthoredResourceService } from "./authored-resources";
import type { PlatformCatalogService } from "./catalog";
import type { AgentDefinitionService } from "./agent-definitions";
import { canonicalAgentValue } from "./agent-definitions";
import {
  AgentReleaseRegistry,
  type BuiltinReleaseExecution,
  type InternalAgentReleaseDependency,
  type StoredAgentRelease,
} from "./agent-release-registry";
import { IdentityError, type PlatformIdentityService } from "./identity";
import type { TenantModelDefinitionService } from "./model-definitions";
import type { TenantToolDefinitionService } from "./tool-definitions";

function conflict(message: string): never {
  throw new IdentityError("conflict", message);
}

function sameDefinitionReference(
  stored: AgentDefinitionDependency | undefined,
  resolved: {
    definitionId: string;
    definitionVersion: number;
    definitionDigest: string;
    offeringId: string;
    offeringVersion: number;
    offeringDigest: string;
  },
  kind: "model_definition" | "tool_definition",
): boolean {
  return Boolean(stored && stored.kind === kind &&
    stored.definitionId === resolved.definitionId &&
    stored.definitionVersion === resolved.definitionVersion &&
    stored.definitionDigest === resolved.definitionDigest &&
    stored.offeringId === resolved.offeringId &&
    stored.offeringVersion === resolved.offeringVersion &&
    stored.offeringDigest === resolved.offeringDigest);
}

function sameRevisionReference(
  stored: AgentDefinitionDependency | undefined,
  resolved: {
    resourceId: string;
    revisionId: string;
    revisionNumber: number;
    contentHash: string;
  },
  kind: "skill_revision" | "instruction_revision",
): boolean {
  return Boolean(stored && stored.kind === kind &&
    stored.resourceId === resolved.resourceId &&
    stored.revisionId === resolved.revisionId &&
    stored.revisionNumber === resolved.revisionNumber &&
    stored.contentHash === resolved.contentHash);
}

export class AgentReleaseService {
  constructor(
    private readonly registry: AgentReleaseRegistry,
    private readonly identity: PlatformIdentityService,
    private readonly definitions: AgentDefinitionService,
    private readonly authored: AuthoredResourceService,
    private readonly models: TenantModelDefinitionService,
    private readonly tools: TenantToolDefinitionService,
    private readonly catalog: PlatformCatalogService,
    private readonly content: ContentRuntime,
  ) {}

  private projection(release: StoredAgentRelease): AgentRelease {
    return {
      id: release.id,
      definitionId: release.definitionId,
      tenantId: release.tenantId,
      number: release.number,
      draftVersion: release.draftVersion,
      snapshot: release.snapshot,
      dependencies: release.dependencies,
      runtimeType: release.runtimeType,
      digest: release.digest,
      createdByPrincipalId: release.createdByPrincipalId,
      createdAt: release.createdAt,
    };
  }

  async list(
    actor: PlatformActorReference,
    tenantId: string,
    definitionId: string,
  ): Promise<AgentRelease[]> {
    await this.definitions.get(actor, tenantId, definitionId);
    const releases = await this.registry.list(definitionId, tenantId);
    await this.identity.authorizeTenant(actor, tenantId);
    return releases.map((release) => this.projection(release));
  }

  async get(
    actor: PlatformActorReference,
    tenantId: string,
    definitionId: string,
    releaseId: string,
  ): Promise<AgentRelease> {
    await this.definitions.get(actor, tenantId, definitionId);
    const release = await this.registry.get(releaseId);
    await this.identity.authorizeTenant(actor, tenantId);
    if (!release || release.tenantId !== tenantId || release.definitionId !== definitionId) {
      throw new IdentityError("not_found", "Agent release not found");
    }
    return this.projection(release);
  }

  async create(
    actor: PlatformActorReference,
    tenantId: string,
    definitionId: string,
    expectedVersion: number,
  ): Promise<AgentRelease> {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion <= 0) {
      throw new IdentityError("invalid_input", "expectedVersion must be a positive integer");
    }
    const authority = await this.identity.authorizeTenant(actor, tenantId);
    const definition = await this.definitions.get(actor, tenantId, definitionId);
    if (!definition.editable) conflict("Agent definition is not releasable in its current lifecycle state");
    if (definition.version !== expectedVersion) conflict("Agent draft changed; reload before creating a release");
    if (definition.draft.runtime.type !== "builtin") {
      conflict("only builtin Agent definitions can create releases in Step 5");
    }
    if (definition.draft.runtime.advanced.topology.kind !== "single") {
      conflict("only single builtin topology is currently supported for release");
    }
    if (definition.draft.resources.knowledgeBaseIds.length > 0) {
      conflict("knowledge retrieval is unavailable for Agent releases");
    }
    const modelId = definition.draft.resources.modelDefinitionId;
    if (!modelId) conflict("builtin Agent releases require one model definition");

    const internalDependencies: InternalAgentReleaseDependency[] = [];
    const releaseDependencies: AgentDefinitionDependency[] = [];
    const model = await this.models.resolveReference(actor, tenantId, modelId);
    if (!sameDefinitionReference(
      definition.dependencies.find((item) => item.kind === "model_definition"),
      model,
      "model_definition",
    )) conflict("model definition changed after the draft was saved");
    const modelOffering = await this.catalog.resolveReference(actor, tenantId, model.offeringId, "model");
    if (modelOffering.version !== model.offeringVersion || modelOffering.digest !== model.offeringDigest) {
      conflict("model offering changed after the draft was saved");
    }
    const internalModel: Extract<InternalAgentReleaseDependency, { kind: "model_definition" }> = {
      kind: "model_definition",
      ...model,
      offeringKind: modelOffering.kind,
      sourceGatewayId: modelOffering.sourceGatewayId,
      upstreamStableId: modelOffering.upstreamStableId,
      sourceGatewayAuthorityEpoch: modelOffering.sourceGatewayAuthorityEpoch,
    };
    internalDependencies.push(internalModel);
    releaseDependencies.push({ kind: "model_definition", ...model });

    const internalTools: BuiltinReleaseExecution["tools"] = [];
    for (const id of definition.draft.resources.toolDefinitionIds) {
      const tool = await this.tools.resolveReference(actor, tenantId, id);
      if (!sameDefinitionReference(
        definition.dependencies.find((item) => item.kind === "tool_definition" && item.definitionId === id),
        tool,
        "tool_definition",
      )) conflict(`tool definition ${id} changed after the draft was saved`);
      const offering = await this.catalog.resolveReference(actor, tenantId, tool.offeringId, "tool");
      if (offering.version !== tool.offeringVersion || offering.digest !== tool.offeringDigest) {
        conflict(`tool offering ${tool.offeringId} changed after the draft was saved`);
      }
      const internal: Extract<InternalAgentReleaseDependency, { kind: "tool_definition" }> = {
        kind: "tool_definition",
        ...tool,
        offeringKind: offering.kind,
        sourceGatewayId: offering.sourceGatewayId,
        upstreamStableId: offering.upstreamStableId,
        sourceGatewayAuthorityEpoch: offering.sourceGatewayAuthorityEpoch,
      };
      internalDependencies.push(internal);
      internalTools.push(internal);
      releaseDependencies.push({ kind: "tool_definition", ...tool });
    }

    const internalSkills: BuiltinReleaseExecution["skills"] = [];
    for (const id of definition.draft.resources.skillRevisionIds) {
      const revision = await this.authored.resolvePublishedRevision(actor, tenantId, "skill", id);
      if (!sameRevisionReference(
        definition.dependencies.find((item) => item.kind === "skill_revision" && item.revisionId === id),
        revision,
        "skill_revision",
      )) conflict(`Skill revision ${id} changed after the draft was saved`);
      if (revision.content.files.length !== 1 || revision.content.files[0].path !== "SKILL.md") {
        conflict("builtin Agent releases currently support only Skills containing root SKILL.md");
      }
      const internal: Extract<InternalAgentReleaseDependency, { kind: "skill_revision" }> = {
        kind: "skill_revision",
        resourceId: revision.resourceId,
        revisionId: revision.revisionId,
        revisionNumber: revision.revisionNumber,
        contentHash: revision.contentHash,
        name: revision.name,
        description: revision.description,
        content: revision.content,
      };
      internalDependencies.push(internal);
      internalSkills.push(internal);
      releaseDependencies.push({
        kind: "skill_revision",
        resourceId: revision.resourceId,
        revisionId: revision.revisionId,
        revisionNumber: revision.revisionNumber,
        contentHash: revision.contentHash,
        status: "published",
      });
    }

    const instructionText: string[] = [];
    for (const id of definition.draft.resources.instructionRevisionIds) {
      const revision = await this.authored.resolvePublishedRevision(actor, tenantId, "instruction", id);
      if (!sameRevisionReference(
        definition.dependencies.find((item) => item.kind === "instruction_revision" && item.revisionId === id),
        revision,
        "instruction_revision",
      )) conflict(`instruction revision ${id} changed after the draft was saved`);
      const internal: Extract<InternalAgentReleaseDependency, { kind: "instruction_revision" }> = {
        kind: "instruction_revision",
        resourceId: revision.resourceId,
        revisionId: revision.revisionId,
        revisionNumber: revision.revisionNumber,
        contentHash: revision.contentHash,
        name: revision.name,
        description: revision.description,
        content: revision.content,
      };
      internalDependencies.push(internal);
      instructionText.push(revision.content.text);
      releaseDependencies.push({
        kind: "instruction_revision",
        resourceId: revision.resourceId,
        revisionId: revision.revisionId,
        revisionNumber: revision.revisionNumber,
        contentHash: revision.contentHash,
        status: "published",
      });
    }

    if (internalDependencies.length !== definition.dependencies.length) {
      conflict("Agent dependency snapshot does not match the current draft");
    }
    const execution: BuiltinReleaseExecution = {
      type: "builtin",
      model: internalModel,
      tools: internalTools,
      skills: internalSkills,
      systemPrompt: [definition.draft.systemPrompt, ...instructionText].filter(Boolean).join("\n\n"),
      advanced: definition.draft.runtime.advanced,
      policy: definition.draft.policy,
    };
    const createdAt = this.content.now();
    const releaseId = `release:${this.content.id()}`;
    const digest = this.content.hash(canonicalAgentValue({
      definitionId,
      draftVersion: definition.version,
      snapshot: definition.draft,
      dependencies: internalDependencies,
      execution,
    }));
    const result = await this.registry.create({
      definitionId,
      tenantId,
      expectedDraftVersion: definition.version,
      expectedDraftDigest: definition.draftDigest,
      expectedDefinitionDependencies: definition.dependencies,
      release: {
        id: releaseId,
        definitionId,
        tenantId,
        draftVersion: definition.version,
        snapshot: definition.draft,
        dependencies: releaseDependencies,
        internalDependencies,
        execution,
        runtimeType: "builtin",
        digest,
        createdByPrincipalId: authority.principal.id,
        createdAt,
      },
    });
    if (result.status === "missing") throw new IdentityError("not_found", "Agent definition not found");
    if (result.status === "stale") conflict("Agent draft changed while creating the release");
    if (result.status === "archived") conflict("archived Agent definitions cannot create releases");
    if (result.status === "exists") conflict("an identical immutable release already exists");
    if (result.status !== "created") conflict("Agent dependencies changed while creating the release");
    await this.identity.authorizeTenant(actor, tenantId);
    return this.projection(result.item);
  }
}
