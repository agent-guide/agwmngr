import type {
  AgentDeploymentEndpoint,
  DeploymentInvocationContext,
  DeploymentKeyBinding,
  DeploymentKeyBindingCandidate,
  DeploymentVirtualKeyReference,
} from "../../contracts/platform/deployments";
import type { PlatformActorReference } from "../../contracts/platform/identity";
import type { ContentRuntime } from "../ports/content";
import type { GatewayDeploymentAdapter, GatewayVirtualKeyPolicy } from "../ports/deployment";
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
} from "./deployment-registry";
import {
  IdentityError,
  type PlatformIdentityService,
  type TenantInvocationAuthorization,
} from "./identity";
import { virtualKeyPolicyFingerprint, virtualKeyPolicyValue } from "./deployments";

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
        id: `invocation:${this.content.id()}`,
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
