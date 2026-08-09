import { describe, expect, test } from "bun:test";
import type { AgentPayload } from "@/lib/api";
import {
  bindBuiltinDependencies,
  collectBuiltinReferences,
  diagnoseBuiltinDependencies,
  findStaleBuiltinLlmBindings,
  stripBuiltinDependencies,
} from "@/lib/agent-bindings";

function builtinPayload(): AgentPayload {
  return {
    id: "helper",
    name: "Helper",
    runtime: {
      type: "builtin",
      builtin: {
        model: { llm_route_id: "acp-chat" },
        tools: [{ mcp_service_id: "files" }],
        topology: {
          kind: "planexecute",
          plan_execute: {
            planner: { model: { llm_route_id: "planner" } },
            executor: { tools: [{ mcp_service_id: "search" }] },
          },
          sub_agents: [{ name: "reviewer", model: { llm_route_id: "review" }, tools: [{ mcp_service_id: "files" }] }],
        },
      },
    },
    routes: { llm_route_ids: ["manual"] },
    resources: { mcp_service_ids: ["manual-service"] },
    policy: {},
    disabled: false,
  };
}

describe("bindBuiltinDependencies", () => {
  test("collects the same root and nested references used by attribution", () => {
    const refs = collectBuiltinReferences(builtinPayload().runtime.builtin);
    expect(refs).toEqual({
      llmRouteIDs: ["acp-chat", "planner", "review"],
      mcpServiceIDs: ["files", "search"],
    });
  });

  test("does not recurse forever when a defensive caller supplies a cyclic definition", () => {
    const builtin = builtinPayload().runtime.builtin!;
    builtin.topology!.sub_agents = [builtin as never];

    expect(collectBuiltinReferences(builtin)).toEqual({
      llmRouteIDs: ["acp-chat", "planner"],
      mcpServiceIDs: ["files", "search"],
    });
  });

  test("adds root and nested builtin model and tool references", () => {
    const bound = bindBuiltinDependencies(builtinPayload());
    expect(bound.routes.llm_route_ids).toEqual(["manual", "acp-chat", "planner", "review"]);
    expect(bound.resources.mcp_service_ids).toEqual(["manual-service", "files", "search"]);
  });

  test("does not mutate the editor payload", () => {
    const payload = builtinPayload();
    bindBuiltinDependencies(payload);
    expect(payload.routes.llm_route_ids).toEqual(["manual"]);
    expect(payload.resources.mcp_service_ids).toEqual(["manual-service"]);
  });

  test("leaves non-builtin agents unchanged", () => {
    const payload: AgentPayload = {
      ...builtinPayload(),
      runtime: { type: "http", http: { endpoint: "https://agent.example/run" } },
    };
    expect(bindBuiltinDependencies(payload)).toBe(payload);
  });

  test("strips derived references when a bound payload is hydrated into the form", () => {
    const stripped = stripBuiltinDependencies(bindBuiltinDependencies(builtinPayload()));
    expect(stripped.routes.llm_route_ids).toEqual(["manual"]);
    expect(stripped.resources.mcp_service_ids).toEqual(["manual-service"]);
  });

  test("does not mutate a bound payload while stripping derived references", () => {
    const bound = bindBuiltinDependencies(builtinPayload());
    stripBuiltinDependencies(bound);
    expect(bound.routes.llm_route_ids).toEqual(["manual", "acp-chat", "planner", "review"]);
    expect(bound.resources.mcp_service_ids).toEqual(["manual-service", "files", "search"]);
  });

  test("does not retain an old exclusive route after the builtin model changes", () => {
    const form = stripBuiltinDependencies(bindBuiltinDependencies(builtinPayload()));
    form.runtime.builtin!.model!.llm_route_id = "replacement";

    const rebound = bindBuiltinDependencies(form);
    expect(rebound.routes.llm_route_ids).toEqual(["manual", "replacement", "planner", "review"]);
    expect(rebound.routes.llm_route_ids).not.toContain("acp-chat");
  });

  test("reports references that are absent from a loaded resource catalog", () => {
    const diagnostics = diagnoseBuiltinDependencies(builtinPayload(), {
      llmRouteIDs: ["acp-chat", "review"],
      mcpServiceIDs: ["files"],
    });

    expect(diagnostics.missingLlmRouteIDs).toEqual(["planner"]);
    expect(diagnostics.missingMcpServiceIDs).toEqual(["search"]);
  });

  test("reports a previously derived YAML route that remains bound after its reference changes", () => {
    const payload = bindBuiltinDependencies(builtinPayload());
    payload.runtime.builtin!.model!.llm_route_id = "replacement";
    payload.routes.llm_route_ids!.push("replacement");

    expect(findStaleBuiltinLlmBindings(payload, ["acp-chat", "planner", "review"])).toEqual(["acp-chat"]);
  });

  test("does not classify a still-referenced or already-removed YAML route as stale", () => {
    const payload = bindBuiltinDependencies(builtinPayload());
    expect(findStaleBuiltinLlmBindings(payload, ["acp-chat", "removed"])).toEqual([]);
  });
});
