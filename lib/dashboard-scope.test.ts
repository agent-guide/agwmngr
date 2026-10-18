import { expect, test } from "bun:test";
import {
  gatewayEquivalentPath,
  gatewayPathScope,
  tenantEquivalentPath,
  tenantPathScope,
} from "./dashboard-scope";

test("Tenant path scope survives deep links and changes only by navigation", () => {
  expect(tenantPathScope("/dashboard/tenant/alpha/members")).toEqual({
    tenantId: "alpha",
    suffix: "/members",
  });
  expect(tenantEquivalentPath("/dashboard/tenant/alpha/members", "beta")).toBe(
    "/dashboard/tenant/beta/members",
  );
  expect(tenantPathScope("/dashboard/platform/tenants")).toBeNull();
});

test("canonical Gateway scope is derived only from the URL path", () => {
  expect(gatewayPathScope("/dashboard/platform/gateways/prod/credentials")).toEqual({
    gatewayId: "prod",
    suffix: "/credentials",
  });
  expect(
    gatewayEquivalentPath("/dashboard/platform/gateways/prod/credentials", "stage"),
  ).toBe("/dashboard/platform/gateways/stage/credentials");
  expect(gatewayPathScope("/dashboard/llm/credentials")).toBeNull();
});
