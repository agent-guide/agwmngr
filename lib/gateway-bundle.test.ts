import { describe, expect, test } from "bun:test";
import { parse } from "yaml";
import {
  bundleFromSnapshot,
  parseGatewayBundle,
  planGatewayBundle,
  serializeGatewayBundle,
  type BundleSnapshot,
  type GatewayBundle,
} from "@/lib/gateway-bundle";

function snapshot(overrides: Partial<BundleSnapshot> = {}): BundleSnapshot {
  return {
    providerTypes: [
      { provider_type: "openai", enabled: true },
      { provider_type: "anthropic", enabled: true },
    ],
    providers: [],
    managedModels: [],
    llmRoutes: [],
    virtualKeys: [],
    mcpServices: [],
    mcpRoutes: [],
    agentRoutes: [],
    agents: [],
    ...overrides,
  };
}

describe("GatewayBundle serialization", () => {
  test("exports supported families without view metadata or Virtual Key secrets", () => {
    const yaml = serializeGatewayBundle(bundleFromSnapshot(snapshot({
    providers: [{
      id: "openai",
      provider_type: "openai",
      default_model: "gpt-4.1",
      api_key_set: true,
      network: { request_timeout_seconds: 120, extra_headers_set: ["Authorization"] },
      source: "store",
      read_only: false,
    }],
      virtualKeys: [{ id: "vk-one", key_set: true, key_preview: "secr…alue", disabled: false, allowed_route_ids: ["chat"], source: "store" }],
    })));
    const value = parse(yaml);
    expect(value.apiVersion).toBe("gateway.agw/v1alpha1");
    expect(value.providers).toEqual([{
      id: "openai",
      provider_type: "openai",
      default_model: "gpt-4.1",
      network: { request_timeout_seconds: 120 },
    }]);
    expect(value.virtualKeys).toEqual([{ id: "vk-one", disabled: false, allowed_route_ids: ["chat"] }]);
    expect(yaml).not.toContain("secr…alue");
    expect(yaml).not.toContain("read_only");
  });

  test("round-trips quoted and multiline values", () => {
    const bundle: GatewayBundle = {
      apiVersion: "gateway.agw/v1alpha1",
      kind: "GatewayBundle",
      agents: [{
        id: "assistant",
        name: "Support: primary",
        description: "Line one\nLine two",
        runtime: { type: "http", http: { endpoint: "https://example.com/agent" } },
        routes: {}, resources: {}, policy: {}, disabled: false,
      }],
    };
    expect(parseGatewayBundle(serializeGatewayBundle(bundle))).toEqual(bundle);
  });
});

describe("GatewayBundle validation and planning", () => {
  test("rejects duplicate identities", () => {
    expect(() => parseGatewayBundle(`apiVersion: gateway.agw/v1alpha1\nkind: GatewayBundle\nproviders:\n  - id: p\n    provider_type: openai\n  - id: p\n    provider_type: anthropic\n`)).toThrow("duplicate id p");
  });

  test("validates object shape and rejects unresolved environment placeholders", () => {
    expect(() => parseGatewayBundle(`apiVersion: gateway.agw/v1alpha1\nkind: GatewayBundle\nproviders:\n  - id: p\n`)).toThrow("provider_type");
    expect(() => parseGatewayBundle(`apiVersion: gateway.agw/v1alpha1\nkind: GatewayBundle\nproviders:\n  - id: p\n    provider_type: openai\n    api_key: \${OPENAI_API_KEY}\n`)).toThrow("cannot be resolved by the browser");
  });

  test("plans create, update, unchanged skip, and read-only skip", () => {
    const current = snapshot({
      providers: [
        { id: "same", provider_type: "openai", read_only: false },
        { id: "changed", provider_type: "openai", default_model: "old", read_only: false },
        { id: "fixed", provider_type: "openai", default_model: "old", source: "caddyfile", read_only: true },
      ],
    });
    const bundle: GatewayBundle = {
      apiVersion: "gateway.agw/v1alpha1",
      kind: "GatewayBundle",
      providers: [
        { id: "same", provider_type: "openai" },
        { id: "changed", provider_type: "openai", default_model: "new" },
        { id: "fixed", provider_type: "openai", default_model: "new" },
        { id: "new", provider_type: "anthropic" },
      ],
    };
    expect(planGatewayBundle(bundle, current).map(({ id, action }) => ({ id, action }))).toEqual([
      { id: "same", action: "skip" },
      { id: "changed", action: "update" },
      { id: "fixed", action: "skip" },
      { id: "new", action: "create" },
    ]);
  });

  test("marks unavailable cross-object references as conflicts", () => {
    const bundle: GatewayBundle = {
      apiVersion: "gateway.agw/v1alpha1",
      kind: "GatewayBundle",
      mcpRoutes: [{ id: "tools", service_id: "missing", disabled: false, match_policy: {}, auth_policy: { require_virtual_key: false } }],
      agentRoutes: [{ id: "chat", agent_id: "missing", disabled: false, match_policy: {}, auth_policy: { require_virtual_key: false } }],
    };
    expect(planGatewayBundle(bundle, snapshot()).map(({ action, reason }) => ({ action, reason }))).toEqual([
      { action: "conflict", reason: "Missing or unavailable: MCP service missing" },
      { action: "conflict", reason: "Missing or unavailable: agent missing" },
    ]);
  });
});
