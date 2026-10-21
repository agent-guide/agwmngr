import type {
  AgentDeploymentOperation,
  AgentDeploymentEndpoint,
  DeploymentInvocationContext,
  DeploymentKeyBinding,
  DeploymentKeyBindingCandidate,
  DeploymentVirtualKeyReference,
} from "../../contracts/platform/deployments";
import type { PlatformActorReference } from "../../contracts/platform/identity";
import type { AgentPayload } from "../../contracts/gateway/agents";
import type { ContentRuntime } from "../ports/content";
import type {
  GatewayAgentRouteDocument,
  GatewayDeploymentAdapter,
  GatewayVirtualKeyPolicy,
} from "../ports/deployment";
import {
  DeploymentAccessRegistry,
  type StoredInvocationContext,
  type StoredKeyPolicy,
} from "./deployment-access-registry";
import {
  AgentDeploymentRegistry,
  type DeploymentKeyBindingRecord,
  type DeploymentPairFence,
  type StoredAgentDeployment,
  type StoredDeploymentOperation,
} from "./deployment-registry";
import {
  IdentityError,
  type PlatformIdentityService,
  type TenantInvocationAuthorization,
} from "./identity";
import {
  deploymentAgentFingerprint,
  deploymentRouteFingerprint,
  conflictsWithFinalRoute,
  virtualKeyPolicyFingerprint,
  virtualKeyPolicyValue,
} from "./deployments";
import { canonicalAgentValue } from "./agent-definitions";

function conflict(message: string): never {
  throw new IdentityError("conflict", message);
}

function keyExpired(key: GatewayVirtualKeyPolicy, now: string): boolean {
  if (!key.expires_at || key.expires_at === "0001-01-01T00:00:00Z") return false;
  const expires = Date.parse(key.expires_at);
  return Number.isFinite(expires) && expires <= Date.parse(now);
}

function keyEligible(key: GatewayVirtualKeyPolicy, routeId: string, now: string): boolean {
  return !key.disabled && !keyExpired(key, now) && key.allowed_route_ids.length > 0 &&
    key.allowed_route_ids.includes(routeId);
}

function routeProtected(value: unknown): boolean {
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? value as { auth_policy?: { require_virtual_key?: unknown } } : {};
  return row.auth_policy?.require_virtual_key === true;
}

function contextProjection(value: StoredInvocationContext): DeploymentInvocationContext {
  return {
    id: value.id,
    deploymentId: value.deploymentId,
    tenantId: value.tenantId,
    gatewayId: value.gatewayId,
    gatewayAgentId: value.gatewayAgentId,
    gatewayRouteId: value.gatewayRouteId,
    keyId: value.keyId,
    expiresAt: value.expiresAt,
    completedAt: value.completedAt,
  };
}

function routeId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return typeof (value as Record<string, unknown>).id === "string"
    ? (value as Record<string, string>).id : null;
}

function operationProjection(value: StoredDeploymentOperation): AgentDeploymentOperation {
  return {
    id: value.id,
    deploymentId: value.deploymentId,
    kind: value.kind,
    requestKey: value.requestKey,
    releaseId: value.releaseId,
    sequence: value.sequence,
    status: value.status,
    phase: value.phase,
    failureCode: value.failureCode,
    failureMessage: value.failureMessage,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export interface AuthorizedDeploymentInvocation {
  context: DeploymentInvocationContext;
  gatewayId: string;
  gatewayAgentId: string;
  gatewayRouteId: string;
  pathPrefix: string;
  bearer: string;
}

export interface CreatedGatewayVirtualKey {
  policy: GatewayVirtualKeyPolicy;
  bearer: string;
}

export class DeploymentAccessService {
  constructor(
    private readonly access: DeploymentAccessRegistry,
    private readonly deployments: AgentDeploymentRegistry,
    private readonly identity: PlatformIdentityService,
    private readonly content: ContentRuntime,
    private readonly gateway: GatewayDeploymentAdapter,
  ) {}

  private async withGatewayLeases<T>(gatewayId: string, work: () => Promise<T>): Promise<T> {
    const ownerToken = `deployment-access:${this.content.id()}`;
    const now = this.content.now();
    const leaseUntil = new Date(Date.parse(now) + 5 * 60_000).toISOString();
    if (!await this.deployments.acquireGatewayLeases({ gatewayId, ownerToken, now, leaseUntil })) {
      conflict("another Gateway object or key-policy operation is in progress");
    }
    try {
      return await work();
    } finally {
      await this.deployments.releaseGatewayLeases(gatewayId, ownerToken, this.content.now());
    }
  }

  private async platformDeployment(
    actor: PlatformActorReference,
    gatewayId: string,
    deploymentId: string,
  ): Promise<StoredAgentDeployment> {
    await this.identity.requirePlatformAdmin(actor);
    const deployment = await this.deployments.get(deploymentId);
    if (!deployment || deployment.lifecycleState === "deleted") {
      throw new IdentityError("not_found", "Agent deployment not found");
    }
    if (deployment.target.gatewayId !== gatewayId) {
      throw new IdentityError("not_found", "Agent deployment not found on this Gateway");
    }
    return deployment;
  }

  private async proveRemoteIdsAbsent(deployment: StoredAgentDeployment): Promise<void> {
    const [agent, route, agentRoutes, llmRoutes, mcpRoutes] = await Promise.all([
      this.gateway.readAgent(deployment.target.gatewayId, deployment.target.gatewayAgentId),
      this.gateway.readAgentRoute(deployment.target.gatewayId, deployment.target.gatewayRouteId),
      this.gateway.listAgentRoutes(deployment.target.gatewayId),
      this.gateway.listLLMRoutes(deployment.target.gatewayId),
      this.gateway.listMCPRoutes(deployment.target.gatewayId),
    ]);
    if (agent || route || [...agentRoutes, ...llmRoutes, ...mcpRoutes]
      .some((item) => routeId(item) === deployment.target.gatewayRouteId)) {
      conflict("deployment Gateway Agent or route ID is already occupied");
    }
  }

  private desiredKey(
    current: GatewayVirtualKeyPolicy,
    routeIdValue: string,
    add: boolean,
  ): GatewayVirtualKeyPolicy {
    const allowed = new Set(current.allowed_route_ids);
    if (add) allowed.add(routeIdValue);
    else allowed.delete(routeIdValue);
    const allowedRouteIds = [...allowed].sort();
    return virtualKeyPolicyValue({
      ...current,
      disabled: add ? current.disabled : (allowedRouteIds.length === 0 ? true : current.disabled),
      allowed_route_ids: allowedRouteIds,
    });
  }

  private async mutateKey(input: {
    gatewayId: string;
    keyId: string;
    desired: GatewayVirtualKeyPolicy;
    operationKind: string;
    operationToken: string;
  }): Promise<StoredKeyPolicy> {
    const started = await this.access.beginKeyMutation({
      ...input,
      now: this.content.now(),
    });
    if (!started) conflict("Virtual Key has an unresolved manager operation");
    try {
      await this.gateway.updateVirtualKey(input.gatewayId, input.keyId, input.desired);
      const observed = await this.gateway.readVirtualKey(input.gatewayId, input.keyId);
      if (!observed || virtualKeyPolicyFingerprint(observed, this.content) !==
        virtualKeyPolicyFingerprint(input.desired, this.content)) {
        throw new Error("Virtual Key update could not be verified");
      }
      const completed = await this.access.completeKeyMutation({
        gatewayId: input.gatewayId,
        keyId: input.keyId,
        operationToken: input.operationToken,
        fingerprint: virtualKeyPolicyFingerprint(observed, this.content),
        now: this.content.now(),
      });
      if (!completed) conflict("Virtual Key operation lost its state token");
      return completed;
    } catch (error) {
      await this.access.failKeyMutation({
        gatewayId: input.gatewayId,
        keyId: input.keyId,
        operationToken: input.operationToken,
        incident: error instanceof Error ? error.message : "Virtual Key update failed",
        now: this.content.now(),
      });
      throw error;
    }
  }

  async keys(actor: PlatformActorReference, gatewayId: string): Promise<Array<
    GatewayVirtualKeyPolicy & {
      key_set: true;
      manager_policy_status: "unmanaged" | StoredKeyPolicy["state"];
      manager_policy_epoch?: number;
    }
  >> {
    await this.identity.requirePlatformAdmin(actor);
    const keys = await this.gateway.listVirtualKeys(gatewayId);
    return Promise.all(keys.map(async (key) => {
      const policy = await this.access.keyPolicy(gatewayId, key.id);
      return {
        ...key,
        key_set: true,
        manager_policy_status: policy?.state ?? "unmanaged",
        ...(policy ? { manager_policy_epoch: policy.policyEpoch } : {}),
      };
    }));
  }

  async bindings(actor: PlatformActorReference, gatewayId: string): Promise<DeploymentKeyBinding[]> {
    await this.identity.requirePlatformAdmin(actor);
    return this.access.bindingsForGateway(gatewayId);
  }

  async setKeyEnabled(
    actor: PlatformActorReference,
    gatewayId: string,
    keyId: string,
    enabled: boolean,
  ): Promise<DeploymentVirtualKeyReference> {
    await this.identity.requirePlatformAdmin(actor);
    return this.withGatewayLeases(gatewayId, async () => {
      await this.identity.requirePlatformAdmin(actor);
      const key = await this.gateway.readVirtualKey(gatewayId, keyId);
      if (!key) throw new IdentityError("not_found", "Virtual Key not found");
      if (enabled && key.allowed_route_ids.length === 0) {
        conflict("an allow-all Virtual Key cannot be enabled for platform deployment use");
      }
      const desired = virtualKeyPolicyValue({ ...key, disabled: !enabled });
      const policy = await this.mutateKey({
        gatewayId,
        keyId,
        desired,
        operationKind: enabled ? "key_enable" : "key_disable",
        operationToken: `key-lifecycle:${keyId}:${this.content.id()}`,
      });
      await this.access.refreshBindingsForKey({
        gatewayId,
        keyId,
        policyEpoch: policy.policyEpoch,
        fingerprint: policy.observedFingerprint!,
        now: this.content.now(),
      });
      return this.keyReference(policy, desired);
    });
  }

  async createKey(
    actor: PlatformActorReference,
    gatewayId: string,
    value: GatewayVirtualKeyPolicy,
  ): Promise<CreatedGatewayVirtualKey> {
    await this.identity.requirePlatformAdmin(actor);
    if (!value.id.trim()) throw new IdentityError("invalid_input", "Virtual Key id is required");
    const desired = virtualKeyPolicyValue(value);
    if (!desired.disabled && desired.allowed_route_ids.length === 0) {
      conflict("an enabled allow-all Virtual Key is not permitted on the platform surface");
    }
    return this.withGatewayLeases(gatewayId, async () => {
      await this.identity.requirePlatformAdmin(actor);
      if (await this.gateway.readVirtualKey(gatewayId, desired.id)) {
        conflict("Virtual Key already exists");
      }
      const token = `key-create:${desired.id}:${this.content.id()}`;
      if (!await this.access.beginKeyMutation({
        gatewayId,
        keyId: desired.id,
        desired,
        operationKind: "key_create",
        operationToken: token,
        now: this.content.now(),
      })) conflict("Virtual Key has an unresolved manager operation");
      try {
        const created = await this.gateway.createVirtualKey(gatewayId, desired);
        const observed = await this.gateway.readVirtualKey(gatewayId, desired.id);
        const fingerprint = observed && virtualKeyPolicyFingerprint(observed, this.content);
        if (!observed || fingerprint !== virtualKeyPolicyFingerprint(desired, this.content)) {
          throw new Error("Virtual Key create could not be verified");
        }
        if (!await this.access.completeKeyMutation({
          gatewayId,
          keyId: desired.id,
          operationToken: token,
          fingerprint,
          now: this.content.now(),
        })) conflict("Virtual Key create lost its state token");
        return { policy: observed, bearer: created.bearer };
      } catch (error) {
        await this.access.failKeyMutation({
          gatewayId,
          keyId: desired.id,
          operationToken: token,
          incident: error instanceof Error ? error.message : "Virtual Key create failed",
          now: this.content.now(),
        });
        throw error;
      }
    });
  }

  async updateKey(
    actor: PlatformActorReference,
    gatewayId: string,
    keyId: string,
    value: GatewayVirtualKeyPolicy,
  ): Promise<DeploymentVirtualKeyReference> {
    await this.identity.requirePlatformAdmin(actor);
    if (value.id !== keyId) throw new IdentityError("invalid_input", "Virtual Key id cannot change");
    const desired = virtualKeyPolicyValue(value);
    if (!desired.disabled && desired.allowed_route_ids.length === 0) {
      conflict("an enabled allow-all Virtual Key is not permitted on the platform surface");
    }
    return this.withGatewayLeases(gatewayId, async () => {
      await this.identity.requirePlatformAdmin(actor);
      const bindings = (await this.access.bindingsForGateway(gatewayId))
        .filter((item) => item.keyId === keyId && item.status === "bound");
      if (bindings.some((item) => !desired.allowed_route_ids.includes(item.routeId))) {
        conflict("Virtual Key update cannot remove a bound deployment route");
      }
      const policy = await this.mutateKey({
        gatewayId,
        keyId,
        desired,
        operationKind: "key_update",
        operationToken: `key-update:${keyId}:${this.content.id()}`,
      });
      await this.access.refreshBindingsForKey({
        gatewayId,
        keyId,
        policyEpoch: policy.policyEpoch,
        fingerprint: policy.observedFingerprint!,
        now: this.content.now(),
      });
      return this.keyReference(policy, desired);
    });
  }

  async deleteKey(
    actor: PlatformActorReference,
    gatewayId: string,
    keyId: string,
  ): Promise<void> {
    await this.identity.requirePlatformAdmin(actor);
    return this.withGatewayLeases(gatewayId, async () => {
      await this.identity.requirePlatformAdmin(actor);
      if ((await this.access.bindingsForGateway(gatewayId)).some((item) => item.keyId === keyId)) {
        conflict("remove every deployment binding before deleting this Virtual Key");
      }
      const key = await this.gateway.readVirtualKey(gatewayId, keyId);
      if (!key) throw new IdentityError("not_found", "Virtual Key not found");
      const desired = virtualKeyPolicyValue({ ...key, disabled: true });
      const token = `key-delete:${keyId}:${this.content.id()}`;
      if (!await this.access.beginKeyMutation({
        gatewayId,
        keyId,
        desired,
        operationKind: "key_delete",
        operationToken: token,
        now: this.content.now(),
      })) conflict("Virtual Key has an unresolved manager operation");
      try {
        if (!key.disabled) {
          await this.gateway.setVirtualKeyEnabled(gatewayId, keyId, false);
          if (!(await this.gateway.readVirtualKey(gatewayId, keyId))?.disabled) {
            throw new Error("Virtual Key disable could not be verified");
          }
        }
        await this.gateway.deleteVirtualKey(gatewayId, keyId);
        if (await this.gateway.readVirtualKey(gatewayId, keyId)) {
          throw new Error("Virtual Key delete could not be verified");
        }
        if (!await this.access.deleteKeyControl(gatewayId, keyId, token)) {
          conflict("Virtual Key delete lost its state token");
        }
      } catch (error) {
        await this.access.failKeyMutation({
          gatewayId,
          keyId,
          operationToken: token,
          incident: error instanceof Error ? error.message : "Virtual Key delete failed",
          now: this.content.now(),
        });
        throw error;
      }
    });
  }

  async reconcileContainedKey(
    actor: PlatformActorReference,
    gatewayId: string,
    keyId: string,
  ): Promise<DeploymentVirtualKeyReference> {
    await this.identity.requirePlatformAdmin(actor);
    return this.withGatewayLeases(gatewayId, async () => {
      await this.identity.requirePlatformAdmin(actor);
      const current = await this.access.keyPolicy(gatewayId, keyId);
      if (!current || !["quarantined_contained", "containment_failed"].includes(current.state) ||
        !current.desiredPolicy) {
        conflict("Virtual Key has no contained drift operation to reconcile");
      }
      const desired = virtualKeyPolicyValue(current.desiredPolicy);
      if (!desired.disabled && desired.allowed_route_ids.length === 0) {
        conflict("contained policy cannot be restored as enabled allow-all");
      }
      const bindings = (await this.access.bindingsForGateway(gatewayId))
        .filter((item) => item.keyId === keyId && item.status === "bound");
      if (bindings.some((item) => !desired.allowed_route_ids.includes(item.routeId))) {
        conflict("reviewed policy no longer covers every bound deployment route");
      }
      const token = `containment-reconcile:${keyId}:${this.content.id()}`;
      if (!await this.access.beginReconciliation({
        gatewayId,
        keyId,
        desired,
        operationToken: token,
        containment: true,
        now: this.content.now(),
      })) conflict("Virtual Key containment state changed");
      try {
        await this.gateway.setVirtualKeyEnabled(gatewayId, keyId, false);
        const disabled = await this.gateway.readVirtualKey(gatewayId, keyId);
        if (!disabled?.disabled) throw new Error("Virtual Key disable could not be verified");
        await this.gateway.updateVirtualKey(gatewayId, keyId, desired);
        const observed = await this.gateway.readVirtualKey(gatewayId, keyId);
        const fingerprint = observed && virtualKeyPolicyFingerprint(observed, this.content);
        if (!observed || fingerprint !== virtualKeyPolicyFingerprint(desired, this.content)) {
          throw new Error("reviewed Virtual Key policy could not be verified");
        }
        const restored = await this.access.restoreContainedKey({
          gatewayId,
          keyId,
          operationToken: token,
          fingerprint,
          now: this.content.now(),
        });
        if (!restored) conflict("Virtual Key containment operation lost its state token");
        return this.keyReference(restored, observed);
      } catch (error) {
        await this.access.finishContainment({
          gatewayId,
          keyId,
          operationToken: token,
          fingerprint: null,
          succeeded: false,
          now: this.content.now(),
        });
        throw error;
      }
    });
  }

  async reconcileKey(
    actor: PlatformActorReference,
    gatewayId: string,
    keyId: string,
    resolution: "apply_desired" | "adopt_live",
  ): Promise<DeploymentVirtualKeyReference> {
    await this.identity.requirePlatformAdmin(actor);
    return this.withGatewayLeases(gatewayId, async () => {
      await this.identity.requirePlatformAdmin(actor);
      const current = await this.access.keyPolicy(gatewayId, keyId);
      if (!current || current.state !== "reconciliation_required" ||
        !current.desiredPolicy) {
        conflict("Virtual Key has no ordinary mutation to reconcile");
      }
      const live = await this.gateway.readVirtualKey(gatewayId, keyId);
      if (!live) throw new IdentityError("not_found", "Virtual Key not found");
      const desired = resolution === "adopt_live"
        ? virtualKeyPolicyValue(live)
        : virtualKeyPolicyValue(current.desiredPolicy);
      if (!desired.disabled && desired.allowed_route_ids.length === 0) {
        conflict("an enabled allow-all Virtual Key cannot be reconciled");
      }
      const bindings = (await this.access.bindingsForGateway(gatewayId))
        .filter((item) => item.keyId === keyId && item.status === "bound");
      if (bindings.some((item) => !desired.allowed_route_ids.includes(item.routeId))) {
        conflict("reconciled policy must cover every bound deployment route");
      }
      const token = `ordinary-reconcile:${keyId}:${this.content.id()}`;
      if (!await this.access.beginReconciliation({
        gatewayId,
        keyId,
        desired,
        operationToken: token,
        containment: false,
        now: this.content.now(),
      })) conflict("Virtual Key reconciliation state changed");
      try {
        if (resolution === "apply_desired") {
          await this.gateway.updateVirtualKey(gatewayId, keyId, desired);
        }
        const observed = await this.gateway.readVirtualKey(gatewayId, keyId);
        const fingerprint = observed && virtualKeyPolicyFingerprint(observed, this.content);
        if (!observed || fingerprint !== virtualKeyPolicyFingerprint(desired, this.content)) {
          throw new Error("Virtual Key reconciliation could not be verified");
        }
        const completed = await this.access.completeKeyMutation({
          gatewayId,
          keyId,
          operationToken: token,
          fingerprint,
          now: this.content.now(),
        });
        if (!completed) conflict("Virtual Key reconciliation lost its state token");
        await this.access.refreshBindingsForKey({
          gatewayId,
          keyId,
          policyEpoch: completed.policyEpoch,
          fingerprint,
          now: this.content.now(),
        });
        return this.keyReference(completed, observed);
      } catch (error) {
        await this.access.failKeyMutation({
          gatewayId,
          keyId,
          operationToken: token,
          incident: error instanceof Error ? error.message : "Virtual Key reconciliation failed",
          now: this.content.now(),
        });
        throw error;
      }
    });
  }

  async bindingCandidates(
    actor: PlatformActorReference,
    gatewayId: string,
  ): Promise<DeploymentKeyBindingCandidate[]> {
    await this.identity.requirePlatformAdmin(actor);
    return this.access.bindingCandidatesForGateway(gatewayId);
  }

  async bind(
    actor: PlatformActorReference,
    gatewayId: string,
    deploymentId: string,
    keyId: string,
  ): Promise<DeploymentKeyBinding> {
    const deployment = await this.platformDeployment(actor, gatewayId, deploymentId);
    if (!keyId.trim()) throw new IdentityError("invalid_input", "key_id is required");
    return this.withGatewayLeases(gatewayId, async () => {
      await this.platformDeployment(actor, gatewayId, deploymentId);
      await this.proveRemoteIdsAbsent(deployment);
      const key = await this.gateway.readVirtualKey(gatewayId, keyId);
      if (!key) throw new IdentityError("not_found", "Virtual Key not found");
      const desired = this.desiredKey(key, deployment.target.gatewayRouteId, true);
      const existingPolicy = await this.access.keyPolicy(gatewayId, keyId);
      const initialEpoch = existingPolicy?.policyEpoch ?? 1;
      if (existingPolicy && existingPolicy.state !== "stable") {
        conflict("Virtual Key has an unresolved manager operation");
      }
      if (!await this.access.prepareBinding({
        deploymentId,
        gatewayId,
        keyId,
        routeId: deployment.target.gatewayRouteId,
        keyPolicyEpoch: initialEpoch,
        now: this.content.now(),
      })) {
        conflict("deployment cannot create a prepublication key reservation");
      }
      const token = `binding:${deploymentId}:${this.content.id()}`;
      try {
        const policy = await this.mutateKey({
          gatewayId,
          keyId,
          desired,
          operationKind: "deployment_binding",
          operationToken: token,
        });
        if (!await this.access.completeBinding({
          deploymentId,
          keyPolicyEpoch: policy.policyEpoch,
          fingerprint: policy.observedFingerprint!,
          now: this.content.now(),
        })) {
          conflict("deployment binding changed before completion");
        }
      } catch (error) {
        await this.access.failBinding(deploymentId, this.content.now());
        throw error;
      }
      return (await this.access.bindingProjection(deploymentId))!;
    });
  }

  async unbind(
    actor: PlatformActorReference,
    gatewayId: string,
    deploymentId: string,
  ): Promise<void> {
    const deployment = await this.platformDeployment(actor, gatewayId, deploymentId);
    return this.withGatewayLeases(gatewayId, async () => {
      await this.platformDeployment(actor, gatewayId, deploymentId);
      if (deployment.lifecycleState !== "ready_to_apply" ||
        deployment.operationState !== "stable") {
        conflict("only a never-published ready deployment can remove its binding");
      }
      await this.proveRemoteIdsAbsent(deployment);
      const binding = await this.deployments.binding(deploymentId);
      if (!binding || binding.status !== "bound") {
        throw new IdentityError("not_found", "deployment key binding not found");
      }
      const key = await this.gateway.readVirtualKey(gatewayId, binding.keyId);
      if (!key) conflict("bound Virtual Key no longer exists");
      const desired = this.desiredKey(key, deployment.target.gatewayRouteId, false);
      await this.mutateKey({
        gatewayId,
        keyId: binding.keyId,
        desired,
        operationKind: "deployment_unbinding",
        operationToken: `unbind:${deploymentId}:${this.content.id()}`,
      });
      await this.proveRemoteIdsAbsent(deployment);
      if (!await this.access.completeUnbind(deploymentId, this.content.now())) {
        conflict("deployment became published while removing its binding");
      }
    });
  }

  async abandonBinding(
    actor: PlatformActorReference,
    gatewayId: string,
    deploymentId: string,
  ): Promise<void> {
    const deployment = await this.platformDeployment(actor, gatewayId, deploymentId);
    return this.withGatewayLeases(gatewayId, async () => {
      await this.platformDeployment(actor, gatewayId, deploymentId);
      if (deployment.lifecycleState !== "awaiting_key_binding" ||
        deployment.operationState !== "stable") {
        conflict("only an unpublished failed binding can be abandoned");
      }
      await this.proveRemoteIdsAbsent(deployment);
      const binding = await this.deployments.binding(deploymentId);
      if (!binding || !["binding", "cleanup_required"].includes(binding.status)) {
        conflict("deployment has no failed binding to abandon");
      }
      const policy = await this.access.keyPolicy(gatewayId, binding.keyId);
      if (!policy || policy.state !== "stable") {
        conflict("reconcile the Virtual Key mutation before abandoning this binding");
      }
      const key = await this.gateway.readVirtualKey(gatewayId, binding.keyId);
      if (!key) conflict("bound Virtual Key no longer exists");
      const desired = this.desiredKey(key, deployment.target.gatewayRouteId, false);
      await this.mutateKey({
        gatewayId,
        keyId: binding.keyId,
        desired,
        operationKind: "binding_zero_write_abandon",
        operationToken: `binding-abandon:${deploymentId}:${this.content.id()}`,
      });
      await this.proveRemoteIdsAbsent(deployment);
      if (!await this.access.completeBindingAbandon(deploymentId, this.content.now())) {
        conflict("deployment binding changed before abandon completed");
      }
    });
  }

  async retryBindingConflictCleanup(
    actor: PlatformActorReference,
    gatewayId: string,
    deploymentId: string,
  ): Promise<void> {
    const deployment = await this.platformDeployment(actor, gatewayId, deploymentId);
    return this.withGatewayLeases(gatewayId, async () => {
      await this.platformDeployment(actor, gatewayId, deploymentId);
      if (deployment.lifecycleState !== "awaiting_key_binding") {
        conflict("only a failed prepublication binding can be cleaned up");
      }
      const binding = await this.deployments.binding(deploymentId);
      if (!binding || binding.status !== "cleanup_required") {
        conflict("deployment has no binding-conflict cleanup to retry");
      }
      let key = await this.gateway.readVirtualKey(gatewayId, binding.keyId);
      if (key) {
        const current = await this.access.keyPolicy(gatewayId, binding.keyId);
        if (current && current.state !== "stable") {
          if (current.operationKind !== "binding_conflict_cleanup" ||
            !current.desiredPolicy ||
            !["mutating", "reconciliation_required"].includes(current.state)) {
            conflict("Virtual Key requires a separate reconciliation operation");
          }
          const desired = virtualKeyPolicyValue(current.desiredPolicy);
          let token = current.operationToken;
          if (current.state === "reconciliation_required") {
            token = `binding-conflict-reconcile:${deploymentId}:${this.content.id()}`;
            if (!await this.access.beginReconciliation({
              gatewayId,
              keyId: binding.keyId,
              desired,
              operationToken: token,
              containment: false,
              now: this.content.now(),
            })) conflict("binding-conflict cleanup state changed");
          }
          if (!token) conflict("binding-conflict cleanup has no operation token");
          await this.gateway.updateVirtualKey(gatewayId, binding.keyId, desired);
          key = await this.gateway.readVirtualKey(gatewayId, binding.keyId);
          const fingerprint = key && virtualKeyPolicyFingerprint(key, this.content);
          if (!key || fingerprint !== virtualKeyPolicyFingerprint(desired, this.content) ||
            !await this.access.completeKeyMutation({
              gatewayId,
              keyId: binding.keyId,
              operationToken: token,
              fingerprint,
              now: this.content.now(),
            })) {
            conflict("binding-conflict key cleanup could not be recovered");
          }
        }
        if (key.allowed_route_ids.includes(binding.routeId)) {
          const desired = this.desiredKey(key, binding.routeId, false);
          await this.mutateKey({
            gatewayId,
            keyId: binding.keyId,
            desired,
            operationKind: "binding_conflict_cleanup",
            operationToken: `binding-conflict-retry:${deploymentId}:${this.content.id()}`,
          });
          key = await this.gateway.readVirtualKey(gatewayId, binding.keyId);
        }
        if (key && (key.allowed_route_ids.includes(binding.routeId) ||
          (!key.disabled && key.allowed_route_ids.length === 0))) {
          conflict("binding-conflict cleanup did not revoke the derived route");
        }
      }
      if (!await this.access.completeBindingConflictCleanup(deploymentId, this.content.now())) {
        conflict("binding-conflict cleanup could not release its reservation");
      }
    });
  }

  private async recoverDecommissionKeyState(
    gatewayId: string,
    keyId: string,
  ): Promise<void> {
    const current = await this.access.keyPolicy(gatewayId, keyId);
    if (!current || current.state === "stable") return;
    if (current.operationKind !== "decommission_cleanup" || !current.desiredPolicy) {
      conflict("Virtual Key requires a separate reconciliation before decommission can continue");
    }
    const desired = virtualKeyPolicyValue(current.desiredPolicy);
    if (current.state === "mutating" && current.operationToken) {
      let observed = await this.gateway.readVirtualKey(gatewayId, keyId);
      if (!observed || virtualKeyPolicyFingerprint(observed, this.content) !==
        virtualKeyPolicyFingerprint(desired, this.content)) {
        await this.gateway.updateVirtualKey(gatewayId, keyId, desired);
        observed = await this.gateway.readVirtualKey(gatewayId, keyId);
      }
      const fingerprint = observed && virtualKeyPolicyFingerprint(observed, this.content);
      if (!observed || fingerprint !== virtualKeyPolicyFingerprint(desired, this.content) ||
        !await this.access.completeKeyMutation({
          gatewayId,
          keyId,
          operationToken: current.operationToken,
          fingerprint,
          now: this.content.now(),
        })) {
        conflict("decommission Virtual Key mutation could not be recovered");
      }
      return;
    }
    if (current.state === "reconciliation_required") {
      const token = `decommission-key-recovery:${keyId}:${this.content.id()}`;
      if (!await this.access.beginReconciliation({
        gatewayId,
        keyId,
        desired,
        operationToken: token,
        containment: false,
        now: this.content.now(),
      })) conflict("decommission Virtual Key reconciliation state changed");
      await this.gateway.updateVirtualKey(gatewayId, keyId, desired);
      const observed = await this.gateway.readVirtualKey(gatewayId, keyId);
      const fingerprint = observed && virtualKeyPolicyFingerprint(observed, this.content);
      if (!observed || fingerprint !== virtualKeyPolicyFingerprint(desired, this.content) ||
        !await this.access.completeKeyMutation({
          gatewayId,
          keyId,
          operationToken: token,
          fingerprint,
          now: this.content.now(),
        })) {
        conflict("decommission Virtual Key reconciliation could not be verified");
      }
      return;
    }
    conflict("Virtual Key containment must be resolved before decommission can continue");
  }

  private async cleanupDecommission(
    deployment: StoredAgentDeployment,
    fence: DeploymentPairFence,
    operation: StoredDeploymentOperation,
    reauthorize: () => Promise<void>,
  ): Promise<AgentDeploymentOperation> {
    const gatewayId = deployment.target.gatewayId;
    try {
      await reauthorize();
      const keys = await this.gateway.listVirtualKeys(gatewayId);
      for (const key of keys) {
        const allowAll = !key.disabled && key.allowed_route_ids.length === 0;
        const includesRoute = key.allowed_route_ids.includes(deployment.target.gatewayRouteId);
        if (!allowAll && !includesRoute) continue;
        await this.recoverDecommissionKeyState(gatewayId, key.id);
        const allowed = includesRoute
          ? key.allowed_route_ids.filter((id) => id !== deployment.target.gatewayRouteId)
          : key.allowed_route_ids;
        const desired = virtualKeyPolicyValue({
          ...key,
          disabled: allowAll || allowed.length === 0 ? true : key.disabled,
          allowed_route_ids: allowed,
        });
        const current = await this.gateway.readVirtualKey(gatewayId, key.id);
        if (current && virtualKeyPolicyFingerprint(current, this.content) ===
          virtualKeyPolicyFingerprint(desired, this.content)) continue;
        await this.mutateKey({
          gatewayId,
          keyId: key.id,
          desired,
          operationKind: "decommission_cleanup",
          operationToken: `decommission-key:${operation.id}:${key.id}`,
        });
      }

      await reauthorize();
      const route = await this.gateway.readAgentRoute(
        gatewayId,
        deployment.target.gatewayRouteId,
      );
      if (route) {
        if (route.agent_id !== deployment.target.gatewayAgentId ||
          (fence.routeDigest &&
            deploymentRouteFingerprint(route, this.content) !== fence.routeDigest)) {
          conflict("Gateway Agent route changed during decommission");
        }
        await this.gateway.deleteAgentRoute(gatewayId, deployment.target.gatewayRouteId);
        if (await this.gateway.readAgentRoute(gatewayId, deployment.target.gatewayRouteId)) {
          throw new Error("Gateway Agent route removal could not be verified");
        }
      }

      await reauthorize();
      const agent = await this.gateway.readAgent(gatewayId, deployment.target.gatewayAgentId);
      if (agent) {
        if (fence.agentDigest &&
          deploymentAgentFingerprint(agent, this.content) !== fence.agentDigest) {
          conflict("Gateway Agent changed during decommission");
        }
        await this.gateway.deleteAgent(gatewayId, deployment.target.gatewayAgentId);
        if (await this.gateway.readAgent(gatewayId, deployment.target.gatewayAgentId)) {
          throw new Error("Gateway Agent removal could not be verified");
        }
      }
      const completed = await this.deployments.completeDecommission({
        operationId: operation.id,
        now: this.content.now(),
      });
      if (!completed) conflict("decommission lost its operation token");
      return operationProjection(completed);
    } catch (error) {
      await this.deployments.failDecommission({
        operationId: operation.id,
        code: "decommission_cleanup_failed",
        message: error instanceof Error ? error.message : "decommission cleanup failed",
        now: this.content.now(),
      });
      throw error;
    }
  }

  async retryRouteContainment(
    actor: PlatformActorReference,
    gatewayId: string,
    operationId: string,
  ): Promise<AgentDeploymentOperation> {
    await this.identity.authorizePlatformGateway(actor, gatewayId);
    const initial = await this.deployments.operation(operationId);
    if (!initial || initial.kind === "decommission") {
      throw new IdentityError("not_found", "deployment containment operation not found");
    }
    const initialDeployment = await this.deployments.get(initial.deploymentId);
    if (!initialDeployment || initialDeployment.target.gatewayId !== gatewayId) {
      throw new IdentityError("not_found", "deployment containment operation not found");
    }
    return this.withGatewayLeases(gatewayId, async () => {
      await this.identity.authorizePlatformGateway(actor, gatewayId);
      const operation = await this.deployments.operation(operationId);
      const deployment = await this.deployments.get(initial.deploymentId);
      const fence = deployment && await this.deployments.pairFence(
        gatewayId,
        deployment.target.gatewayAgentId,
      );
      if (!operation || !deployment || !fence || fence.deploymentId !== deployment.id ||
        operation.status !== "failed" ||
        !["route_containment_failed", "route_quarantined_contained"].includes(operation.phase)) {
        conflict("deployment route has no retryable containment token");
      }
      const staging = operation.desiredStagingRoute as GatewayAgentRouteDocument;
      let route = await this.gateway.readAgentRoute(gatewayId, deployment.target.gatewayRouteId);
      if (route) {
        const digest = deploymentRouteFingerprint(route, this.content);
        if (digest !== operation.desiredFinalRouteDigest &&
          digest !== operation.desiredStagingRouteDigest) {
          conflict("Gateway route no longer matches the containment journal");
        }
        if (digest !== operation.desiredStagingRouteDigest) {
          await this.gateway.updateAgentRoute(gatewayId, deployment.target.gatewayRouteId, staging);
          route = await this.gateway.readAgentRoute(gatewayId, deployment.target.gatewayRouteId);
        }
        if (!route || route.disabled !== true ||
          deploymentRouteFingerprint(route, this.content) !== operation.desiredStagingRouteDigest) {
          conflict("deployment route containment could not be verified");
        }
      }
      if (!await this.deployments.markRouteContained({
        operationId,
        observedRoute: route,
        routeDigest: route ? deploymentRouteFingerprint(route, this.content) : null,
        now: this.content.now(),
      })) conflict("deployment containment state changed");
      return operationProjection((await this.deployments.operation(operationId))!);
    });
  }

  async resolveDeploymentQuarantine(
    actor: PlatformActorReference,
    gatewayId: string,
    operationId: string,
  ): Promise<AgentDeploymentOperation> {
    await this.identity.authorizePlatformGateway(actor, gatewayId);
    const operation = await this.deployments.operation(operationId);
    const deployment = operation && await this.deployments.get(operation.deploymentId);
    if (!operation || !deployment || deployment.target.gatewayId !== gatewayId ||
      operation.phase !== "route_quarantined_contained") {
      throw new IdentityError("not_found", "contained deployment quarantine not found");
    }
    await this.withGatewayLeases(gatewayId, async () => {
      await this.identity.requirePlatformAdmin(actor);
      const current = await this.deployments.operation(operationId);
      const item = await this.deployments.get(deployment.id);
      const fence = item && await this.deployments.pairFence(
        gatewayId,
        item.target.gatewayAgentId,
      );
      if (!current || !item || !fence || fence.deploymentId !== item.id ||
        fence.state !== "quarantined" || fence.operationId !== operationId) {
        conflict("deployment quarantine state changed");
      }
      const [agent, route] = await Promise.all([
        this.gateway.readAgent(gatewayId, item.target.gatewayAgentId),
        this.gateway.readAgentRoute(gatewayId, item.target.gatewayRouteId),
      ]);
      if (route && deploymentRouteFingerprint(route, this.content) !==
        current.desiredStagingRouteDigest) {
        conflict("contained route no longer matches the operation journal");
      }
      if (!route && current.routeWriteAttempted) {
        conflict("operation route provenance is ambiguous");
      }
      if (agent) {
        const digest = deploymentAgentFingerprint(agent, this.content);
        if (digest !== current.desiredAgentDigest && digest !== fence.agentDigest) {
          conflict("Gateway Agent no longer matches the operation journal");
        }
      } else if (current.agentWriteAttempted) {
        conflict("operation Agent provenance is ambiguous");
      }
      if (!await this.deployments.resumeQuarantinedOperation(operationId, this.content.now())) {
        conflict("deployment quarantine state changed");
      }
    });
    await this.recoverInterruptedOperations();
    const resolved = await this.deployments.operation(operationId);
    if (!resolved) conflict("deployment quarantine operation disappeared");
    return operationProjection(resolved);
  }

  async decommission(
    actor: PlatformActorReference,
    gatewayId: string,
    deploymentId: string,
    requestKey: string,
  ): Promise<AgentDeploymentOperation> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(requestKey)) {
      throw new IdentityError("invalid_input", "request_key must be 1-100 safe characters");
    }
    await this.platformDeployment(actor, gatewayId, deploymentId);
    return this.withGatewayLeases(gatewayId, async () => {
      await this.identity.requirePlatformAdmin(actor);
      const deployment = await this.deployments.get(deploymentId);
      if (!deployment || deployment.target.gatewayId !== gatewayId ||
        deployment.lifecycleState === "deleted") {
        throw new IdentityError("not_found", "Agent deployment not found on this Gateway");
      }
      const fence = await this.deployments.pairFence(
        gatewayId,
        deployment.target.gatewayAgentId,
      );
      if (!fence || fence.deploymentId !== deployment.id ||
        fence.gatewayRouteId !== deployment.target.gatewayRouteId) {
        conflict("deployment cleanup fence is missing");
      }
      const [agentBefore, routeBefore] = await Promise.all([
        this.gateway.readAgent(gatewayId, deployment.target.gatewayAgentId),
        this.gateway.readAgentRoute(gatewayId, deployment.target.gatewayRouteId),
      ]);
      if (agentBefore && fence.agentDigest &&
        deploymentAgentFingerprint(agentBefore, this.content) !== fence.agentDigest) {
        conflict("Gateway Agent no longer matches the deployment cleanup journal");
      }
      if (routeBefore && (routeBefore.agent_id !== deployment.target.gatewayAgentId ||
        (fence.routeDigest &&
          deploymentRouteFingerprint(routeBefore, this.content) !== fence.routeDigest))) {
        conflict("Gateway Agent route no longer matches the deployment cleanup journal");
      }
      const now = this.content.now();
      const operation = await this.deployments.beginDecommission({
        deploymentId,
        requestKey,
        operationId: `operation:${this.content.id()}`,
        leaseUntil: new Date(Date.parse(now) + 5 * 60_000).toISOString(),
        now,
      });
      if (!operation) conflict("deployment cannot enter remove-only decommission");
      if (operation.status !== "applying") return operationProjection(operation);
      return this.cleanupDecommission(
        deployment,
        fence,
        operation,
        () => this.identity.requirePlatformAdmin(actor).then(() => undefined),
      );
    });
  }

  async recoverDecommissions(gatewayId?: string): Promise<{
    recovered: string[];
    failed: Array<{ deploymentId: string; error: string }>;
  }> {
    const recovered: string[] = [];
    const failed: Array<{ deploymentId: string; error: string }> = [];
    for (const pending of await this.deployments.pendingDecommissions(gatewayId)) {
      const deployment = await this.deployments.get(pending.deploymentId);
      if (!deployment || deployment.lifecycleState !== "deleting") continue;
      try {
        await this.withGatewayLeases(deployment.target.gatewayId, async () => {
          const current = await this.deployments.get(deployment.id);
          const fence = await this.deployments.pairFence(
            deployment.target.gatewayId,
            deployment.target.gatewayAgentId,
          );
          if (!current || current.lifecycleState !== "deleting" || !fence ||
            fence.deploymentId !== current.id) {
            conflict("decommission recovery fence is missing");
          }
          let operation = pending;
          if (operation.status !== "applying") {
            const now = this.content.now();
            const restarted = await this.deployments.beginDecommission({
              deploymentId: current.id,
              requestKey: `startup-recovery:${current.id}:${operation.sequence}`,
              operationId: `operation:${this.content.id()}`,
              leaseUntil: new Date(Date.parse(now) + 5 * 60_000).toISOString(),
              now,
            });
            if (!restarted) conflict("decommission recovery could not acquire an operation token");
            operation = restarted;
          }
          if (operation.status === "applying") {
            await this.cleanupDecommission(current, fence, operation, async () => {});
          }
        });
        recovered.push(deployment.id);
      } catch (error) {
        failed.push({
          deploymentId: deployment.id,
          error: error instanceof Error ? error.message : "decommission recovery failed",
        });
      }
    }
    return { recovered, failed };
  }

  private async proveRecoveryActivation(
    deployment: StoredAgentDeployment,
    desiredRoute: GatewayAgentRouteDocument,
  ): Promise<void> {
    await this.identity.requireDeploymentRecoveryAuthority({
      tenantId: deployment.tenantId,
      tenantAuthorityEpoch: deployment.tenantAuthorityEpoch,
      gatewayId: deployment.target.gatewayId,
      gatewayAuthorityEpoch: deployment.gatewayAuthorityEpoch,
    });
    const binding = await this.deployments.binding(deployment.id);
    if (!binding || binding.status !== "bound" ||
      binding.gatewayId !== deployment.target.gatewayId ||
      binding.routeId !== deployment.target.gatewayRouteId ||
      !binding.keyPolicyFingerprint) {
      conflict("deployment recovery requires a verified Virtual Key binding");
    }
    const policy = await this.access.keyPolicy(binding.gatewayId, binding.keyId);
    const keys = await this.gateway.listVirtualKeys(binding.gatewayId);
    const now = this.content.now();
    if (keys.some((key) => !key.disabled && !keyExpired(key, now) &&
      key.allowed_route_ids.length === 0)) {
      conflict("an enabled allow-all Virtual Key blocks recovered route activation");
    }
    const key = keys.find((candidate) => candidate.id === binding.keyId);
    if (!policy || policy.state !== "stable" || !policy.observedFingerprint || !key ||
      !keyEligible(key, binding.routeId, now) ||
      virtualKeyPolicyFingerprint(key, this.content) !== policy.observedFingerprint ||
      policy.observedFingerprint !== binding.keyPolicyFingerprint) {
      conflict("deployment recovery key policy is not eligible");
    }
    const [agentRoutes, llmRoutes, mcpRoutes] = await Promise.all([
      this.gateway.listAgentRoutes(deployment.target.gatewayId),
      this.gateway.listLLMRoutes(deployment.target.gatewayId),
      this.gateway.listMCPRoutes(deployment.target.gatewayId),
    ]);
    if ([...agentRoutes, ...llmRoutes, ...mcpRoutes]
      .some((route) => conflictsWithFinalRoute(route, desiredRoute))) {
      conflict("Gateway route namespace conflicts with recovered deployment ingress");
    }
  }

  private async completeRecoveredOperation(
    deployment: StoredAgentDeployment,
    operation: StoredDeploymentOperation,
    lifecycle: "active" | "offline",
    expectedRouteDigest: string,
  ): Promise<boolean> {
    const [agent, route] = await Promise.all([
      this.gateway.readAgent(deployment.target.gatewayId, deployment.target.gatewayAgentId),
      this.gateway.readAgentRoute(deployment.target.gatewayId, deployment.target.gatewayRouteId),
    ]);
    if (!agent || !route ||
      deploymentAgentFingerprint(agent, this.content) !== operation.desiredAgentDigest ||
      deploymentRouteFingerprint(route, this.content) !== expectedRouteDigest ||
      (lifecycle === "active" && !routeProtected(route))) return false;
    return this.deployments.completeOperation({
      operationId: operation.id,
      lifecycle,
      appliedReleaseId: operation.releaseId,
      desiredDigest: this.content.hash(canonicalAgentValue({
        agent: operation.desiredAgent,
        route: operation.desiredFinalRoute,
      })),
      agentDigest: operation.desiredAgentDigest,
      routeDigest: expectedRouteDigest,
      now: this.content.now(),
    });
  }

  private async containRecoveredOperation(
    deployment: StoredAgentDeployment,
    operation: StoredDeploymentOperation,
    message: string,
  ): Promise<void> {
    try {
      let route = await this.gateway.readAgentRoute(
        deployment.target.gatewayId,
        deployment.target.gatewayRouteId,
      );
      if (!await this.deployments.updateOperation({
        operationId: operation.id,
        phase: "route_containment_in_progress",
        observedRoute: route ?? undefined,
        routeWriteAttempted: Boolean(route && deploymentRouteFingerprint(route, this.content) !==
          operation.desiredStagingRouteDigest),
        now: this.content.now(),
      })) {
        throw new Error("recovered containment operation changed");
      }
      if (route && deploymentRouteFingerprint(route, this.content) !==
        operation.desiredStagingRouteDigest) {
        await this.gateway.updateAgentRoute(
          deployment.target.gatewayId,
          deployment.target.gatewayRouteId,
          operation.desiredStagingRoute as GatewayAgentRouteDocument,
        );
        route = await this.gateway.readAgentRoute(
          deployment.target.gatewayId,
          deployment.target.gatewayRouteId,
        );
      }
      if (route && (route.disabled !== true ||
        deploymentRouteFingerprint(route, this.content) !==
          operation.desiredStagingRouteDigest)) {
        throw new Error("recovered route withdrawal could not be verified");
      }
      await this.deployments.quarantineOperation({
        operationId: operation.id,
        phase: "route_quarantined_contained",
        message,
        routeDigest: route ? deploymentRouteFingerprint(route, this.content) : null,
        now: this.content.now(),
      });
    } catch {
      await this.deployments.quarantineOperation({
        operationId: operation.id,
        phase: "route_containment_failed",
        message: `${message}; public ingress withdrawal failed`,
        routeDigest: null,
        now: this.content.now(),
      });
    }
  }

  async recoverInterruptedOperations(): Promise<{
    recovered: string[];
    failed: Array<{ deploymentId: string; error: string }>;
  }> {
    const recovered: string[] = [];
    const failed: Array<{ deploymentId: string; error: string }> = [];
    for (const pending of await this.deployments.pendingApplyingOperations()) {
      const deployment = await this.deployments.get(pending.deploymentId);
      if (!deployment) continue;
      try {
        await this.withGatewayLeases(deployment.target.gatewayId, async () => {
          const operation = await this.deployments.operation(pending.id);
          const current = await this.deployments.get(deployment.id);
          if (!operation || operation.status !== "applying" || !current ||
            current.operationState !== "applying") {
            return;
          }
          let route = await this.gateway.readAgentRoute(
            current.target.gatewayId,
            current.target.gatewayRouteId,
          );
          const routeDigest = route ? deploymentRouteFingerprint(route, this.content) : null;
          const isFinal = routeDigest === operation.desiredFinalRouteDigest;
          const isStaging = routeDigest === operation.desiredStagingRouteDigest;
          if (route && !isFinal && !isStaging) {
            await this.deployments.quarantineOperation({
              operationId: operation.id,
              phase: "route_containment_failed",
              message: "startup recovery found a mismatched Gateway route",
              routeDigest,
              now: this.content.now(),
            });
            return;
          }
          if (operation.phase === "route_containment_in_progress") {
            await this.containRecoveredOperation(
              current,
              operation,
              "startup recovery resumed an interrupted route containment",
            );
            return;
          }
          if (operation.kind === "online") {
            if (!route) {
              await this.deployments.quarantineOperation({
                operationId: operation.id,
                phase: "route_quarantined_contained",
                message: "startup recovery found the offline route missing",
                routeDigest: null,
                now: this.content.now(),
              });
              return;
            }
            const agent = await this.gateway.readAgent(
              current.target.gatewayId,
              current.target.gatewayAgentId,
            );
            if (!agent || deploymentAgentFingerprint(agent, this.content) !==
              operation.desiredAgentDigest) {
              await this.containRecoveredOperation(
                current,
                operation,
                "startup recovery found offline Agent drift",
              );
              return;
            }
            try {
              await this.proveRecoveryActivation(
                current,
                operation.desiredFinalRoute as GatewayAgentRouteDocument,
              );
            } catch {
              if (isStaging && operation.phase !== "quarantine_resolved_retrying") return;
              await this.containRecoveredOperation(
                current,
                operation,
                "startup recovery activation proofs failed",
              );
              return;
            }
            try {
              if (!isFinal) {
                await this.deployments.updateOperation({
                  operationId: operation.id,
                  phase: operation.phase,
                  routeWriteAttempted: true,
                  now: this.content.now(),
                });
                await this.gateway.updateAgentRoute(
                  current.target.gatewayId,
                  current.target.gatewayRouteId,
                  operation.desiredFinalRoute as GatewayAgentRouteDocument,
                );
              }
              if (await this.completeRecoveredOperation(
                current,
                operation,
                "active",
                operation.desiredFinalRouteDigest,
              )) return;
            } catch {
              // A failed/unknown final write must be treated as potentially public.
            }
            await this.containRecoveredOperation(
              current,
              operation,
              "startup recovery could not verify online activation",
            );
            return;
          }
          const resumedQuarantine = operation.phase.startsWith("quarantine_resolved_");
          const rollbackStagedPhase = resumedQuarantine
            ? "quarantine_resolved_rollback_staged_awaiting_agent_update"
            : "rollback_staged_awaiting_agent_update";
          const rollbackActivationPhase = resumedQuarantine
            ? "quarantine_resolved_rollback_agent_updated_awaiting_activation"
            : "rollback_agent_updated_awaiting_activation";
          const rollbackFinalActivationLanded = operation.kind === "rollback" && isFinal &&
            operation.phase.endsWith("rollback_agent_updated_awaiting_activation");
          if (isFinal && !rollbackFinalActivationLanded) {
            await this.deployments.updateOperation({
              operationId: operation.id,
              phase: operation.phase,
              routeWriteAttempted: true,
              now: this.content.now(),
            });
            await this.gateway.updateAgentRoute(
              current.target.gatewayId,
              current.target.gatewayRouteId,
              operation.desiredStagingRoute as GatewayAgentRouteDocument,
            );
            route = await this.gateway.readAgentRoute(
              current.target.gatewayId,
              current.target.gatewayRouteId,
            );
            if (!route || route.disabled !== true ||
              deploymentRouteFingerprint(route, this.content) !==
                operation.desiredStagingRouteDigest) {
              await this.deployments.quarantineOperation({
                operationId: operation.id,
                phase: "route_containment_failed",
                message: "startup recovery could not withdraw public ingress",
                routeDigest: route ? deploymentRouteFingerprint(route, this.content) : null,
                now: this.content.now(),
              });
              return;
            }
          }

          if (["apply", "retry"].includes(operation.kind)) {
            await this.deployments.failOperation({
              operationId: operation.id,
              phase: route ? "startup_recovered_to_staging" : "startup_recovered_no_ingress",
              code: "startup_recovery_retry_required",
              message: "startup recovery left publication non-public for an authorized retry",
              now: this.content.now(),
            });
            return;
          }
          if (operation.kind === "rollback" && route) {
            const desiredAgent = operation.desiredAgent;
            let agent = await this.gateway.readAgent(
              current.target.gatewayId,
              current.target.gatewayAgentId,
            );
            if (!agent || deploymentAgentFingerprint(agent, this.content) !==
              operation.desiredAgentDigest) {
              await this.deployments.updateOperation({
                operationId: operation.id,
                phase: rollbackStagedPhase,
                observedRoute: route,
                agentWriteAttempted: true,
                now: this.content.now(),
              });
              await this.gateway.updateAgent(
                current.target.gatewayId,
                current.target.gatewayAgentId,
                desiredAgent as AgentPayload,
              );
              agent = await this.gateway.readAgent(
                current.target.gatewayId,
                current.target.gatewayAgentId,
              );
            }
            if (!agent || deploymentAgentFingerprint(agent, this.content) !==
              operation.desiredAgentDigest) {
              await this.deployments.quarantineOperation({
                operationId: operation.id,
                phase: "route_quarantined_contained",
                message: "startup recovery could not verify the rollback Agent",
                routeDigest: operation.desiredStagingRouteDigest,
                now: this.content.now(),
              });
              return;
            }
            await this.deployments.updateOperation({
              operationId: operation.id,
              phase: rollbackActivationPhase,
              observedAgent: agent,
              observedRoute: route,
              now: this.content.now(),
            });
            try {
              await this.proveRecoveryActivation(
                current,
                operation.desiredFinalRoute as GatewayAgentRouteDocument,
              );
            } catch {
              if (!rollbackFinalActivationLanded && !resumedQuarantine) return;
              await this.containRecoveredOperation(
                current,
                operation,
                "startup recovery rollback activation proofs failed",
              );
              return;
            }
            try {
              await this.deployments.updateOperation({
                operationId: operation.id,
                phase: rollbackActivationPhase,
                routeWriteAttempted: true,
                now: this.content.now(),
              });
              await this.gateway.updateAgentRoute(
                current.target.gatewayId,
                current.target.gatewayRouteId,
                operation.desiredFinalRoute as GatewayAgentRouteDocument,
              );
              if (await this.completeRecoveredOperation(
                current,
                operation,
                "active",
                operation.desiredFinalRouteDigest,
              )) return;
            } catch {
              // A failed/unknown final write must be treated as potentially public.
            }
            await this.containRecoveredOperation(
              current,
              operation,
              "startup recovery could not verify rollback activation",
            );
            return;
          }
          if (operation.kind === "take_offline" && route) {
            const agent = await this.gateway.readAgent(
              current.target.gatewayId,
              current.target.gatewayAgentId,
            );
            if (agent && deploymentAgentFingerprint(agent, this.content) ===
              operation.desiredAgentDigest && await this.completeRecoveredOperation(
              current,
              operation,
              "offline",
              operation.desiredStagingRouteDigest,
            )) return;
          }
          await this.deployments.quarantineOperation({
            operationId: operation.id,
            phase: "route_quarantined_contained",
            message: route
              ? "startup recovery withdrew incomplete lifecycle ingress"
              : "startup recovery verified that incomplete lifecycle ingress is absent",
            routeDigest: route ? deploymentRouteFingerprint(route, this.content) : null,
            now: this.content.now(),
          });
        });
        recovered.push(deployment.id);
      } catch (error) {
        failed.push({
          deploymentId: deployment.id,
          error: error instanceof Error ? error.message : "deployment startup recovery failed",
        });
      }
    }
    return { recovered, failed };
  }

  async decommissionSubject(
    actor: PlatformActorReference,
    subject: { gatewayId: string } | { tenantId: string },
    requestKey: string,
  ): Promise<{
    completed: string[];
    failed: Array<{ deploymentId: string; error: string }>;
  }> {
    await this.identity.requirePlatformAdmin(actor);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(requestKey)) {
      throw new IdentityError("invalid_input", "request_key must be 1-100 safe characters");
    }
    const items = "gatewayId" in subject
      ? await this.deployments.listForGateway(subject.gatewayId)
      : await this.deployments.listForTenantSubject(subject.tenantId);
    const completed: string[] = [];
    const failed: Array<{ deploymentId: string; error: string }> = [];
    for (const item of items) {
      try {
        if (!item.appliedReleaseId && item.operationState === "stable") {
          if (item.lifecycleState === "ready_to_apply") {
            await this.unbind(actor, item.target.gatewayId, item.id);
          } else if (item.lifecycleState === "awaiting_key_binding" &&
            await this.deployments.binding(item.id)) {
            await this.abandonBinding(actor, item.target.gatewayId, item.id);
          }
          if (!await this.deployments.cancelAwaiting(item.id)) {
            conflict("unpublished deployment intent could not be removed safely");
          }
          completed.push(item.id);
          continue;
        }
        await this.decommission(
          actor,
          item.target.gatewayId,
          item.id,
          `subject:${this.content.hash(`${requestKey}:${item.id}`).slice(0, 48)}`,
        );
        completed.push(item.id);
      } catch (error) {
        failed.push({
          deploymentId: item.id,
          error: error instanceof Error ? error.message : "subject decommission failed",
        });
      }
    }
    return { completed, failed };
  }

  private keyReference(
    policy: StoredKeyPolicy,
    key: GatewayVirtualKeyPolicy,
  ): DeploymentVirtualKeyReference {
    return {
      id: key.id,
      disabled: key.disabled,
      expiresAt: key.expires_at ?? null,
      policyEpoch: policy.policyEpoch,
      status: policy.state,
    };
  }

  async endpoints(
    actor: PlatformActorReference,
    tenantId: string,
  ): Promise<AgentDeploymentEndpoint[]> {
    await this.identity.authorizeTenant(actor, tenantId, "user");
    const result: AgentDeploymentEndpoint[] = [];
    for (const deployment of await this.deployments.list(tenantId)) {
      if (deployment.lifecycleState !== "active" || deployment.operationState !== "stable" ||
        !deployment.appliedReleaseId) continue;
      try {
        await this.identity.authorizeTenantInvocation(actor, tenantId, deployment.target.gatewayId);
        const binding = await this.deployments.binding(deployment.id);
        const fence = await this.deployments.pairFence(
          deployment.target.gatewayId,
          deployment.target.gatewayAgentId,
        );
        if (!binding || binding.status !== "bound" || !fence || fence.state !== "promoted" ||
          fence.deploymentId !== deployment.id ||
          fence.gatewayRouteId !== deployment.target.gatewayRouteId) continue;
        const policy = await this.access.keyPolicy(binding.gatewayId, binding.keyId);
        const key = await this.gateway.readVirtualKey(binding.gatewayId, binding.keyId);
        const eligible = policy?.state === "stable" && policy.observedFingerprint && key &&
          virtualKeyPolicyFingerprint(key, this.content) === policy.observedFingerprint &&
          keyEligible(key, deployment.target.gatewayRouteId, this.content.now());
        result.push({
          deploymentId: deployment.id,
          tenantId,
          definitionId: deployment.definitionId,
          releaseId: deployment.appliedReleaseId,
          gatewayId: deployment.target.gatewayId,
          gatewayAgentId: deployment.target.gatewayAgentId,
          gatewayRouteId: deployment.target.gatewayRouteId,
          pathPrefix: deployment.target.pathPrefix,
          protected: true,
          invocable: Boolean(eligible),
          keys: eligible && policy && key ? [this.keyReference(policy, key)] : [],
        });
      } catch (error) {
        if (error instanceof IdentityError && error.code === "forbidden") continue;
        throw error;
      }
    }
    return result;
  }

  private async invocationState(
    actor: PlatformActorReference,
    tenantId: string,
    deploymentId: string,
    keyId?: string,
    allowPolicyDrift = false,
  ): Promise<{
    authority: TenantInvocationAuthorization;
    deployment: StoredAgentDeployment;
    binding: DeploymentKeyBindingRecord;
    fence: DeploymentPairFence;
    policy: StoredKeyPolicy;
    key: GatewayVirtualKeyPolicy;
  }> {
    const deployment = await this.deployments.get(deploymentId);
    if (!deployment || deployment.tenantId !== tenantId ||
      deployment.lifecycleState !== "active" || deployment.operationState !== "stable") {
      throw new IdentityError("not_found", "invocable Agent deployment not found");
    }
    const authority = await this.identity.authorizeTenantInvocation(
      actor,
      tenantId,
      deployment.target.gatewayId,
    );
    if (authority.gateway.authorityEpoch !== deployment.gatewayAuthorityEpoch) {
      conflict("deployment Gateway authority changed");
    }
    const binding = await this.deployments.binding(deployment.id);
    if (!binding || binding.status !== "bound" ||
      (keyId && binding.keyId !== keyId)) conflict("eligible deployment key binding required");
    const fence = await this.deployments.pairFence(
      deployment.target.gatewayId,
      deployment.target.gatewayAgentId,
    );
    if (!fence || fence.state !== "promoted" || fence.deploymentId !== deployment.id ||
      fence.gatewayRouteId !== deployment.target.gatewayRouteId) {
      conflict("deployment pair claim is not invocable");
    }
    const policy = await this.access.keyPolicy(binding.gatewayId, binding.keyId);
    if (!policy || policy.state !== "stable" || !policy.observedFingerprint ||
      policy.policyEpoch !== binding.keyPolicyEpoch) {
      conflict("bound Virtual Key is not in a stable manager state");
    }
    const key = await this.gateway.readVirtualKey(binding.gatewayId, binding.keyId);
    const fingerprintMatches = key &&
      virtualKeyPolicyFingerprint(key, this.content) === policy.observedFingerprint;
    if (!key || (!allowPolicyDrift && (!fingerprintMatches ||
      !keyEligible(key, deployment.target.gatewayRouteId, this.content.now())))) {
      conflict("bound Virtual Key is not eligible for invocation");
    }
    return { authority, deployment, binding, fence, policy, key };
  }

  async createInvocationContext(
    actor: PlatformActorReference,
    tenantId: string,
    deploymentId: string,
    keyId?: string,
  ): Promise<DeploymentInvocationContext> {
    const initial = await this.deployments.get(deploymentId);
    if (!initial || initial.tenantId !== tenantId) {
      throw new IdentityError("not_found", "Agent deployment not found");
    }
    return this.withGatewayLeases(initial.target.gatewayId, async () => {
      const state = await this.invocationState(actor, tenantId, deploymentId, keyId);
      const now = this.content.now();
      const context = await this.access.createContext({
        id: `invocation-${this.content.id()}`,
        principalId: state.authority.principal.id,
        principalAuthorityEpoch: state.authority.principalAuthorityEpoch,
        tenantId,
        tenantAuthorityEpoch: state.authority.tenantAuthorityEpoch,
        membershipAuthorityEpoch: state.authority.membershipAuthorityEpoch,
        deployment: state.deployment,
        gatewayAuthorityEpoch: state.authority.gateway.authorityEpoch,
        pairClaimEpoch: state.fence.claimEpoch,
        keyId: state.binding.keyId,
        keyPolicyEpoch: state.policy.policyEpoch,
        keyPolicyFingerprint: state.policy.observedFingerprint!,
        expiresAt: new Date(Date.parse(now) + 15 * 60_000).toISOString(),
        now,
      });
      if (!context) conflict("invocation authority changed while creating context");
      return contextProjection(context);
    });
  }

  private async containPolicyDrift(
    deployment: StoredAgentDeployment,
    policy: StoredKeyPolicy,
    live: GatewayVirtualKeyPolicy,
  ): Promise<never> {
    const token = `key-containment:${this.content.id()}`;
    const desired = virtualKeyPolicyValue({ ...live, disabled: true });
    const started = await this.access.beginContainment({
      gatewayId: deployment.target.gatewayId,
      keyId: policy.keyId,
      expectedEpoch: policy.policyEpoch,
      desired,
      operationToken: token,
      now: this.content.now(),
    });
    if (!started) conflict("Virtual Key policy changed during invocation authorization");
    try {
      await this.gateway.setVirtualKeyEnabled(deployment.target.gatewayId, policy.keyId, false);
      const observed = await this.gateway.readVirtualKey(deployment.target.gatewayId, policy.keyId);
      const contained = Boolean(observed?.disabled);
      await this.access.finishContainment({
        gatewayId: deployment.target.gatewayId,
        keyId: policy.keyId,
        operationToken: token,
        fingerprint: observed ? virtualKeyPolicyFingerprint(observed, this.content) : null,
        succeeded: contained,
        now: this.content.now(),
      });
      if (!contained) conflict("Virtual Key drift containment could not be verified");
      conflict("Virtual Key policy drift was contained; reconciliation is required");
    } catch (error) {
      const current = await this.access.keyPolicy(deployment.target.gatewayId, policy.keyId);
      if (current?.state === "containment_in_progress") {
        await this.access.finishContainment({
          gatewayId: deployment.target.gatewayId,
          keyId: policy.keyId,
          operationToken: token,
          fingerprint: null,
          succeeded: false,
          now: this.content.now(),
        });
      }
      throw error;
    }
  }

  async withInvocation<T>(
    actor: PlatformActorReference,
    tenantId: string,
    contextId: string,
    forward: (authorized: AuthorizedDeploymentInvocation) => Promise<T>,
  ): Promise<T> {
    const context = await this.access.context(contextId);
    if (!context || context.tenantId !== tenantId) {
      throw new IdentityError("not_found", "invocation context not found");
    }
    return this.withGatewayLeases(context.gatewayId, async () => {
      const fresh = await this.access.context(contextId);
      if (!fresh || fresh.completedAt || fresh.expiresAt <= this.content.now()) {
        throw new IdentityError("forbidden", "invocation context expired or completed");
      }
      const state = await this.invocationState(
        actor,
        tenantId,
        fresh.deploymentId,
        fresh.keyId,
        true,
      );
      if (state.authority.principal.id !== fresh.principalId ||
        state.authority.principalAuthorityEpoch !== fresh.principalAuthorityEpoch ||
        state.authority.tenantAuthorityEpoch !== fresh.tenantAuthorityEpoch ||
        state.authority.membershipAuthorityEpoch !== fresh.membershipAuthorityEpoch ||
        state.authority.gateway.authorityEpoch !== fresh.gatewayAuthorityEpoch ||
        state.deployment.invocationEpoch !== fresh.deploymentInvocationEpoch ||
        state.fence.claimEpoch !== fresh.pairClaimEpoch ||
        state.policy.policyEpoch !== fresh.keyPolicyEpoch ||
        state.policy.observedFingerprint !== fresh.keyPolicyFingerprint) {
        throw new IdentityError("forbidden", "invocation context authority changed");
      }
      const secret = await this.gateway.readVirtualKeySecret(fresh.gatewayId, fresh.keyId);
      if (!secret) conflict("bound Virtual Key no longer exists");
      const liveFingerprint = virtualKeyPolicyFingerprint(secret.policy, this.content);
      if (liveFingerprint !== fresh.keyPolicyFingerprint) {
        return this.containPolicyDrift(state.deployment, state.policy, secret.policy);
      }
      if (!keyEligible(secret.policy, fresh.gatewayRouteId, this.content.now())) {
        throw new IdentityError("forbidden", "bound Virtual Key is not eligible");
      }
      if (!await this.access.touchContext(fresh.id, fresh.principalId, this.content.now())) {
        throw new IdentityError("forbidden", "invocation context expired or completed");
      }
      return forward({
        context: contextProjection(fresh),
        gatewayId: fresh.gatewayId,
        gatewayAgentId: fresh.gatewayAgentId,
        gatewayRouteId: fresh.gatewayRouteId,
        pathPrefix: state.deployment.target.pathPrefix,
        bearer: secret.bearer,
      });
    });
  }

  async completeInvocation(
    actor: PlatformActorReference,
    tenantId: string,
    contextId: string,
  ): Promise<void> {
    const context = await this.access.context(contextId);
    if (!context || context.tenantId !== tenantId) return;
    const principal = await this.identity.resolve(actor);
    if (principal.id !== context.principalId) {
      throw new IdentityError("forbidden", "invocation context belongs to another Principal");
    }
    await this.access.completeContext(contextId, context.principalId, this.content.now());
  }
}
