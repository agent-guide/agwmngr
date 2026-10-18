import { expect, test } from "bun:test";
import { resolveActiveHref } from "./dashboard-nav";

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
});
