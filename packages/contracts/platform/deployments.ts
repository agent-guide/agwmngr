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

export interface DeploymentVirtualKeyReference {
  id: string;
  disabled: boolean;
  expiresAt: string | null;
  policyEpoch: number;
  status: "stable" | "mutating" | "reconciliation_required" |
    "containment_in_progress" | "containment_reconciling" |
    "quarantined_contained" | "containment_failed";
}

export interface AgentDeploymentEndpoint {
  deploymentId: string;
  tenantId: string;
  definitionId: string;
  releaseId: string;
  gatewayId: string;
  gatewayAgentId: string;
  gatewayRouteId: string;
  pathPrefix: string;
  protected: boolean;
  invocable: boolean;
  keys: DeploymentVirtualKeyReference[];
}

export interface DeploymentKeyBinding {
  deploymentId: string;
  tenantId: string;
  gatewayId: string;
  keyId: string;
  routeId: string;
  status: "binding" | "bound" | "cleanup_required" | "awaiting_key_restore";
  keyPolicyEpoch: number;
  keyPolicyStatus: DeploymentVirtualKeyReference["status"];
  updatedAt: string;
}

export interface DeploymentKeyBindingCandidate {
  deploymentId: string;
  tenantId: string;
  definitionId: string;
  gatewayId: string;
  gatewayRouteId: string;
  lifecycleState: DeploymentLifecycleState;
  bindingKeyId: string | null;
}

export interface DeploymentInvocationContext {
  id: string;
  deploymentId: string;
  tenantId: string;
  gatewayId: string;
  gatewayAgentId: string;
  gatewayRouteId: string;
  keyId: string;
  expiresAt: string;
  completedAt: string | null;
}

export const deploymentObservationKinds = [
  "activity",
  "usage",
  "interactions",
  "health",
] as const;

export type DeploymentObservationKind = (typeof deploymentObservationKinds)[number];

export interface DeploymentObservation {
  deploymentId: string;
  tenantId: string;
  definitionId: string;
  releaseId: string | null;
  gatewayId: string;
  gatewayAgentId: string;
  kind: DeploymentObservationKind;
  data: unknown;
}

export interface DeploymentOperationalMetadata {
  deploymentId: string;
  tenantId: string;
  gatewayId: string;
  gatewayAgentId: string;
  sessions: unknown[];
  runs: unknown[];
  permissions: unknown[];
}

export interface OwnInvocationMetadata {
  contextId: string;
  deploymentId: string;
  tenantId: string;
  gatewayId: string;
  gatewayAgentId: string;
  keyId: string;
  expiresAt: string;
  completedAt: string | null;
}

export interface ManagedRuntimeAttention {
  deploymentId: string;
  tenantId: string;
  gatewayId: string;
  gatewayAgentId: string;
  pendingPermissions: unknown[];
  runningRuns: unknown[];
}

export interface TenantRuntimeAttention {
  ownInvocations: OwnInvocationMetadata[];
  managed: ManagedRuntimeAttention[];
}
