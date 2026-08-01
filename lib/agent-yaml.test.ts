import { describe, expect, test } from "bun:test";
import { parse } from "yaml";
import type { Agent } from "@/lib/api";
import { agentPayload, agentPayloadYaml, agentYamlFragment, parseAgentPayloadYaml } from "@/lib/agent-yaml";

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

describe("agent form YAML", () => {
  test("round-trips a direct Admin API payload", () => {
    const payload = agentPayload(agent);
    expect(parseAgentPayloadYaml(agentPayloadYaml(payload))).toEqual(payload);
  });

  test("accepts the one-agent fragment shown on the detail page", () => {
    expect(parseAgentPayloadYaml(agentYamlFragment(agent))).toEqual(agentPayload(agent));
  });

  test("accepts a complete one-agent GatewayBundle", () => {
    const fragment = agentYamlFragment(agent);
    expect(parseAgentPayloadYaml(`apiVersion: gateway.agw/v1alpha1\nkind: GatewayBundle\n${fragment}`)).toEqual(agentPayload(agent));
  });

  test("fills optional containers with API defaults", () => {
    expect(parseAgentPayloadYaml(`
id: minimal
name: Minimal
runtime:
  type: http
  http:
    endpoint: https://agent.example/run
`)).toEqual({
      id: "minimal",
      name: "Minimal",
      runtime: { type: "http", http: { endpoint: "https://agent.example/run" } },
      routes: {},
      resources: {},
      policy: {},
      disabled: false,
    });
  });

  test("rejects multiple agents, managed fields, and mismatched runtimes", () => {
    expect(() => parseAgentPayloadYaml("agents: []")).toThrow("exactly one agent");
    expect(() => parseAgentPayloadYaml(agentPayloadYaml({ ...agentPayload(agent), created_at: "nope" } as never))).toThrow("created_at");
    expect(() => parseAgentPayloadYaml(`
id: bad
name: Bad
runtime:
  type: http
  http: { endpoint: https://example.test }
  acp: { agent_type: codex, cwd: /tmp }
`)).toThrow("does not match runtime.type");
    expect(() => parseAgentPayloadYaml(`
id: bad
name: Bad
runtime: { type: http, http: { endpoint: https://example.test } }
routes: { future_route_ids: [future] }
`)).toThrow("Unsupported routes field");
  });
});
