import { describe, expect, test } from "bun:test";
import {
  buildNetworkConfig,
  emptyNetworkDraft,
  networkDraftFromConfig,
  parseProviderOptions,
  updateProviderOption,
} from "./provider-advanced-fields";

describe("provider advanced fields", () => {
  test("serializes network tuning and write-only headers", () => {
    expect(buildNetworkConfig({
      ...emptyNetworkDraft(),
      request_timeout_seconds: "180",
      max_retries: "5",
      proxy_url: "http://127.0.0.1:7890",
      extra_headers: '{"Authorization":"Bearer secret","X-Title":"Gateway"}',
    })).toEqual({
      request_timeout_seconds: 180,
      max_retries: 5,
      proxy_url: "http://127.0.0.1:7890",
      extra_headers: { Authorization: "Bearer secret", "X-Title": "Gateway" },
    });
  });

  test("does not hydrate redacted header values into the edit form", () => {
    expect(networkDraftFromConfig({
      request_timeout_seconds: 120,
      extra_headers_set: ["Authorization"],
    })).toEqual({
      ...emptyNetworkDraft(),
      request_timeout_seconds: "120",
      extra_headers: "",
    });
  });

  test("serializes cleared edit fields as gateway defaults without clearing write-only headers", () => {
    expect(buildNetworkConfig(emptyNetworkDraft(), { includeEmpty: true })).toEqual({
      request_timeout_seconds: 0,
      max_retries: 0,
      retry_delay_seconds: 0,
      max_idle_connections: 0,
      max_idle_connections_per_host: 0,
      idle_keep_alive_timeout_seconds: 0,
      proxy_url: "",
    });
  });

  test("never serializes an invalid numeric option as null", () => {
    const field = { key: "temperature", label: "Temperature", kind: "number" } as const;
    expect(updateProviderOption('{"temperature":0.7}', field, "not-a-number")).toBe('{"temperature":0.7}');
    expect(updateProviderOption("{}", field, "0.25")).toBe('{\n  "temperature": 0.25\n}');
  });

  test("validates network and options JSON", () => {
    expect(() => buildNetworkConfig({ ...emptyNetworkDraft(), max_retries: "1.5" })).toThrow();
    expect(() => buildNetworkConfig({ ...emptyNetworkDraft(), extra_headers: '{"X":1}' })).toThrow();
    expect(parseProviderOptions('{"thinking_type":"disabled","temperature":0.7}')).toEqual({
      thinking_type: "disabled",
      temperature: 0.7,
    });
    expect(parseProviderOptions("{}")).toEqual({});
    expect(() => parseProviderOptions("[]")).toThrow();
  });
});
