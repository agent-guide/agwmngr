import { expect, test } from "bun:test";
import { GatewayCompatibilityRegistry } from "@/packages/platform/services/gateway-compatibility-registry";
import { DeploymentAccessRegistry } from "@/packages/platform/services/deployment-access-registry";
import { migratePlatformIdentityDatabase } from "@/packages/platform/services/identity-migrations";
import { sqlitePlatformDatabase } from "./platform-database";
import { openDatabase } from "./sqlite";
import { gatewayAgentInventory } from "./platform-gateway-agent-compatibility";

test("Gateway Agent inventory includes claimed agents only for explicit attribution reads", () => {
  const scanned = [{ id: "compat" }, { id: "deployed" }];
  expect(gatewayAgentInventory(scanned, new Set(["deployed"]), false))
    .toEqual([{ id: "compat" }]);
  expect(gatewayAgentInventory(scanned, new Set(["deployed"]), true)).toEqual([
    { id: "compat" },
    {
      id: "deployed",
      disabled: false,
      runtime: {},
      routes: { llm_route_ids: [], mcp_route_ids: [] },
      resources: { provider_ids: [], mcp_service_ids: [], virtual_key_ids: [] },
      policy: {},
    },
  ]);
});

test("Gateway compatibility epochs fence Test contexts across mutations", async () => {
  const database = sqlitePlatformDatabase(openDatabase(":memory:"));
  await migratePlatformIdentityDatabase(database);
  const registry = new GatewayCompatibilityRegistry(database);
  const access = new DeploymentAccessRegistry(database);
  const now = "2026-10-21T00:00:00.000Z";
  const pair = await registry.ensureStable({
    gatewayId: "prod",
    agentId: "gateway-agent",
    agentFingerprint: "agent-v1",
    now,
  });
  expect(pair).toMatchObject({ state: "stable", authorityEpoch: 1 });
  expect(await access.beginKeyMutation({
    gatewayId: "prod",
    keyId: "key:test",
    desired: { id: "key:test", disabled: false, allowed_route_ids: ["route:test"] },
    operationKind: "key_create",
    operationToken: "key-create",
    now,
  })).not.toBeNull();
  const policy = await access.completeKeyMutation({
    gatewayId: "prod",
    keyId: "key:test",
    operationToken: "key-create",
    fingerprint: "key-v1",
    now,
  });
  expect(policy).toMatchObject({ state: "stable", policyEpoch: 2 });
  expect(await registry.createContext({
    id: "context:one",
    principalId: "user:1",
    principalAuthorityEpoch: 1,
    gatewayId: "prod",
    gatewayAuthorityEpoch: 1,
    gatewayAgentId: "gateway-agent",
    gatewayRouteId: "route:test",
    compatibilityPairEpoch: pair!.authorityEpoch,
    agentFingerprint: "agent-v1",
    routeFingerprint: "route-v1",
    pathPrefix: "/gateway-agent",
    keyId: "key:test",
    keyPolicyEpoch: policy!.policyEpoch,
    keyPolicyFingerprint: "key-v1",
    expiresAt: "2026-10-21T00:15:00.000Z",
    now,
  })).toBe(true);
  expect(await registry.beginMutation({
    gatewayId: "prod",
    agentIds: ["gateway-agent"],
    operationToken: "agent-update",
    now,
  })).toBe(true);
  expect(await registry.completeMutation({
    gatewayId: "prod",
    agentFingerprints: { "gateway-agent": "agent-v2" },
    operationToken: "agent-update",
    now,
  })).toBe(true);
  expect((await registry.pair("prod", "gateway-agent"))?.authorityEpoch).toBe(3);
  expect(await registry.createContext({
    id: "context:stale",
    principalId: "user:1",
    principalAuthorityEpoch: 1,
    gatewayId: "prod",
    gatewayAuthorityEpoch: 1,
    gatewayAgentId: "gateway-agent",
    gatewayRouteId: "route:test",
    compatibilityPairEpoch: pair!.authorityEpoch,
    agentFingerprint: "agent-v1",
    routeFingerprint: "route-v1",
    pathPrefix: "/gateway-agent",
    keyId: "key:test",
    keyPolicyEpoch: policy!.policyEpoch,
    keyPolicyFingerprint: "key-v1",
    expiresAt: "2026-10-21T00:15:00.000Z",
    now,
  })).toBe(false);
});
