import { describe, expect, test } from "bun:test";
import { parse } from "yaml";
import type { Agent } from "@/lib/api";
import { agentPayload, agentYamlFragment } from "@/lib/agent-yaml";

const agent: Agent = {
  id: "support",
  name: "Support: primary",
  description: "Answers questions\nwith concise guidance.",
  runtime: {
    type: "builtin",
    builtin: {
      model: { llm_route_id: "chat-main", model: "yes" },
      system_prompt: "Return #1 result",
      topology: { kind: "single" },
      permissions: { mode: "interactive", auto_approve_tools: ["files/read"] },
    },
  },
  routes: { llm_route_ids: ["chat-main"] },
  resources: { virtual_key_ids: ["vk-support"] },
  policy: { max_agent_depth: 2 },
  disabled: false,
  source: "store",
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T01:00:00Z",
  runtime_status: {
    state: "ready",
    executable: true,
    active_runs: 0,
    pending_permissions: 0,
    session_count: 0,
  },
};

describe("agentYamlFragment", () => {
  test("round-trips the Admin API payload inside an agents bundle field", () => {
    const parsed = parse(agentYamlFragment(agent));
    expect(parsed).toEqual({ agents: [agentPayload(agent)] });
  });

  test("omits gateway-managed fields", () => {
    const yaml = agentYamlFragment(agent);
    expect(yaml).not.toContain("created_at");
    expect(yaml).not.toContain("updated_at");
    expect(yaml).not.toContain("runtime_status");
    expect(yaml).not.toContain("source:");
  });
});
