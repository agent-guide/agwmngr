import { describe, expect, test } from "bun:test";
import {
  buildNetworkConfig,
  emptyNetworkDraft,
  networkDraftFromConfig,
  parseProviderOptions,
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
