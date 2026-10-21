import { expect, test } from "bun:test";
import { resolveActiveHref, tenantObservabilityHref } from "./dashboard-nav";

test("navigation marks the longest matching canonical route active", () => {
  expect(
    resolveActiveHref("/dashboard/tenant/alpha/members", [
      "/dashboard/tenant/alpha/members",
      "/dashboard/agents",
    ]),
  ).toBe("/dashboard/tenant/alpha/members");
  expect(
    resolveActiveHref("/dashboard/agents/example/edit", [
      "/dashboard/agents",
      "/dashboard/agents/example",
    ]),
  ).toBe("/dashboard/agents/example");
  expect(resolveActiveHref("/dashboard/workbench", [
    "/dashboard/workbench",
    "/dashboard/agents",
  ])).toBe("/dashboard/workbench");
  expect(resolveActiveHref("/dashboard/observability/calls", [
    "/dashboard/observability/overview?tenant=alpha",
    "/dashboard/observability/calls?tenant=alpha",
  ])).toBe("/dashboard/observability/calls?tenant=alpha");
});

test("tenant observability links preserve the administered tenant", () => {
  expect(tenantObservabilityHref("/dashboard/observability/calls", "tenant/a b")).toBe(
    "/dashboard/observability/calls?tenant=tenant%2Fa%20b",
  );
});
