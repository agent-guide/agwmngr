import type { ACPAgentType, ACPPermissionMode } from "../gateway/acp";
import type { BuiltinTopologyKind } from "../gateway/agents";

export const platformAgentRuntimeTypes = ["builtin", "acp", "http"] as const;
export type PlatformAgentRuntimeType = (typeof platformAgentRuntimeTypes)[number];

export interface BuiltinAgentAdvancedConfiguration {
  topology: {
    kind: BuiltinTopologyKind;
    maxIterations?: number;
  };
  generation?: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
  };
  permissions?: {
    mode?: "auto_approve" | "interactive";
    timeoutSeconds?: number;
    maxPending?: number;
  };
}

export interface ACPAgentAdvancedConfiguration {
  agentType: ACPAgentType;
  cwd: string;
  allowedRoots?: string[];
  permissionMode?: ACPPermissionMode;
  idleTtlSeconds?: number;
  maxInstances?: number;
}

export interface HTTPAgentAdvancedConfiguration {
  cardUrl: string;
  timeoutSeconds?: number;
}

export type PlatformAgentRuntime =
  | { type: "builtin"; advanced: BuiltinAgentAdvancedConfiguration }
  | { type: "acp"; advanced: ACPAgentAdvancedConfiguration }
  | { type: "http"; advanced: HTTPAgentAdvancedConfiguration };

export interface PlatformAgentPolicy {
  maxAgentDepth?: number;
  budget?: {
    maxTurnsPerDay?: number;
    maxTokensPerDay?: number;
  };
}

export interface AgentDefinitionResourceSelection {
  modelDefinitionId: string | null;
  toolDefinitionIds: string[];
  skillRevisionIds: string[];
  instructionRevisionIds: string[];
  knowledgeBaseIds: string[];
}

export interface AgentDefinitionDraft {
  name: string;
  description: string;
  systemPrompt: string;
  runtime: PlatformAgentRuntime;
  resources: AgentDefinitionResourceSelection;
  policy: PlatformAgentPolicy;
}

export type AgentDefinitionDependency =
  | {
      kind: "model_definition";
      definitionId: string;
      definitionVersion: number;
      definitionDigest: string;
      offeringId: string;
      offeringVersion: number;
      offeringDigest: string;
    }
  | {
      kind: "tool_definition";
      definitionId: string;
      definitionVersion: number;
      definitionDigest: string;
      offeringId: string;
      offeringVersion: number;
      offeringDigest: string;
    }
  | {
      kind: "skill_revision";
      resourceId: string;
      revisionId: string;
      revisionNumber: number;
      contentHash: string;
      status: "draft" | "published";
    }
  | {
      kind: "instruction_revision";
      resourceId: string;
      revisionId: string;
      revisionNumber: number;
      contentHash: string;
      status: "draft" | "published";
    }
  | {
      kind: "knowledge_base";
      knowledgeBaseId: string;
      updatedAt: string;
    };

export interface AgentDefinition {
  id: string;
  slug: string;
  tenantId: string;
  status: "active" | "archived";
  version: number;
  draftDigest: string;
  draft: AgentDefinitionDraft;
  dependencies: AgentDefinitionDependency[];
  editable: boolean;
  createdByPrincipalId: string;
  updatedByPrincipalId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveAgentDefinitionInput {
  slug: string;
  expectedVersion: number;
  draft: AgentDefinitionDraft;
}

export interface AgentRelease {
  id: string;
  definitionId: string;
  tenantId: string;
  number: number;
  draftVersion: number;
  snapshot: AgentDefinitionDraft;
  dependencies: AgentDefinitionDependency[];
  runtimeType: "builtin";
  digest: string;
  createdByPrincipalId: string;
  createdAt: string;
}
