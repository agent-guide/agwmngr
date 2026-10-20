export const deploymentLifecycleStates = [
  "awaiting_key_binding",
  "ready_to_apply",
  "active",
  "offline",
  "partial_failure",
  "deleting",
  "deleted",
] as const;

export type DeploymentLifecycleState = (typeof deploymentLifecycleStates)[number];

export const deploymentOperationStates = [
  "stable",
  "applying",
  "reconciliation_required",
] as const;

export type DeploymentOperationState = (typeof deploymentOperationStates)[number];

export interface AgentDeploymentTarget {
  gatewayId: string;
  gatewayAgentId: string;
  gatewayRouteId: string;
  pathPrefix: string;
}

export interface AgentDeployment {
  id: string;
  tenantId: string;
  definitionId: string;
  requestedReleaseId: string;
  appliedReleaseId: string | null;
  target: AgentDeploymentTarget;
  desiredDigest: string;
  lifecycleState: DeploymentLifecycleState;
  operationState: DeploymentOperationState;
  invocationEpoch: number;
  lastVerifiedAt: string | null;
  failureCode: string | null;
  createdByPrincipalId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentDeploymentInput {
  releaseId: string;
  gatewayId: string;
  requestKey: string;
}

export const deploymentOperationKinds = [
  "apply",
  "retry",
  "take_offline",
  "online",
  "rollback",
  "verify",
  "decommission",
] as const;

export type DeploymentOperationKind = (typeof deploymentOperationKinds)[number];

export interface AgentDeploymentOperation {
  id: string;
  deploymentId: string;
  kind: DeploymentOperationKind;
  requestKey: string;
  releaseId: string;
  sequence: number;
  status: "applying" | "succeeded" | "failed";
  phase: string;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  updatedAt: string;
}
