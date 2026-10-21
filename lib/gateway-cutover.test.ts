import { describe, expect, test } from "bun:test";
import { gatewayCutoverDecision } from "./gateway-cutover";

describe("Step 6E legacy Gateway allowlist", () => {
  test("removes Agent invocation, runtime and mutation paths", () => {
    for (const [method, path] of [
      ["GET", "/admin/agents"],
      ["POST", "/admin/agents/a/permissions/p"],
      ["DELETE", "/admin/agents/a/runs/r"],
      ["POST", "/admin/acp/chat/turn"],
      ["GET", "/admin/acp/runtime"],
    ]) {
      expect(gatewayCutoverDecision(method, path)).toMatchObject({ allowed: false });
    }
  });

  test("retains reviewed Platform Admin infrastructure families", () => {
    expect(gatewayCutoverDecision("GET", "/admin/metrics/interactions").allowed).toBe(true);
    expect(gatewayCutoverDecision("POST", "/admin/llm/models/managed").allowed).toBe(true);
    expect(gatewayCutoverDecision("PUT", "/admin/mcp/services/search").allowed).toBe(true);
    expect(gatewayCutoverDecision("POST", "/admin/llm/routes")).toMatchObject({
      allowed: true, routeMutation: true,
    });
    expect(gatewayCutoverDecision("POST", "/admin/mcp/services/search/tools/call").allowed)
      .toBe(false);
  });

  test("denies an omitted family before forwarding", () => {
    expect(gatewayCutoverDecision("GET", "/admin/memory")).toEqual({
      allowed: false,
      routeMutation: false,
      reason: "not_allowlisted",
    });
  });

  test("marks retired MCP execution as removed rather than unrecognized", () => {
    expect(gatewayCutoverDecision("POST", "/admin/mcp/services/search/tools/call"))
      .toEqual({ allowed: false, routeMutation: false, reason: "runtime_execution_removed" });
    expect(gatewayCutoverDecision("POST", "/admin/mcp/services/search/resources/read"))
      .toEqual({ allowed: false, routeMutation: false, reason: "runtime_execution_removed" });
  });
});
