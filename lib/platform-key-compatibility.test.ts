import { expect, test } from "bun:test";
import { DeploymentAccessRegistry } from "@/packages/platform/services/deployment-access-registry";
import { migratePlatformIdentityDatabase } from "@/packages/platform/services/identity-migrations";
import { sqlitePlatformDatabase } from "./platform-database";
import { openDatabase } from "./sqlite";
import { platformClaimsGatewayKeyPolicy } from "./platform-key-compatibility";

test("a manager-owned key policy blocks legacy Virtual Key writers", async () => {
  const database = sqlitePlatformDatabase(openDatabase(":memory:"));
  await migratePlatformIdentityDatabase(database);
  expect(await platformClaimsGatewayKeyPolicy(database, "prod")).toBe(false);

  const registry = new DeploymentAccessRegistry(database);
  expect(await registry.beginKeyMutation({
    gatewayId: "prod",
    keyId: "key:test",
    desired: { id: "key:test", disabled: true, allowed_route_ids: [] },
    operationKind: "key_create",
    operationToken: "create:test",
    now: "2026-10-21T00:00:00.000Z",
  })).not.toBeNull();

  expect(await platformClaimsGatewayKeyPolicy(database, "prod")).toBe(true);
  expect(await platformClaimsGatewayKeyPolicy(database, "other")).toBe(false);
});
