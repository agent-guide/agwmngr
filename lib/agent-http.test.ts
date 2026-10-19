import { describe, expect, test } from "bun:test";
import { httpAgentConfigFromForm, httpAgentFormValues, isCommonAgentRoute, supportsAgentChat, validateHTTPAgentConfig } from "./agent-http";
import { agentPayloadYaml, parseAgentPayloadYaml } from "./agent-yaml";

describe("HTTP Agent v0.7 contract", () => {
  test("preserves Card, protocol, credential and zero/custom timeout through Form and YAML", () => {
    for (const timeout of [undefined, 0, 45]) {
      const http = { card_url: "https://agent.example/card", protocol: "a2a" as const, auth_ref: "agent-owned", ...(timeout !== undefined && { timeout_seconds: timeout }) };
      const payload = { id: "remote", name: "Remote", runtime: { type: "http" as const, http }, routes: {}, resources: {}, policy: {}, disabled: false };
      const parsed = parseAgentPayloadYaml(agentPayloadYaml(payload));
      expect(parsed).toEqual(payload);
      expect(httpAgentConfigFromForm(httpAgentFormValues(parsed.runtime.http))).toEqual(http);
    }
  });

  test("accepts HTTPS and Go-compatible loopback HTTP spellings", () => {
    for (const card_url of ["https://agent.example/card", "http://localhost:8090/card", "http://127.12.0.1/card", "http://[::1]/card", "http://[0:0:0:0:0:0:0:1]/card", "http://[::ffff:127.0.0.1]/card"]) {
      expect(validateHTTPAgentConfig({ card_url, protocol: " A2A " }).protocol).toBe("a2a");
    }
  });

  test("rejects legacy fields, missing protocol and unsupported URL policies", () => {
    expect(() => validateHTTPAgentConfig({ endpoint: "https://agent.example/run" })).toThrow("endpoint");
    expect(() => validateHTTPAgentConfig({ card_url: "https://agent.example/card" })).toThrow("protocol");
    for (const card_url of ["/card", "ftp://agent.example/card", "https:agent.example/card", "http://agent.example/card", "https://user:secret@agent.example/card", "https://agent.example/card#section", "http://127.1/card", "http://0x7f000001/card", "http://127.00.0.1/card"]) {
      expect(() => validateHTTPAgentConfig({ card_url, protocol: "a2a" })).toThrow("card_url");
    }
    for (const timeout_seconds of [-1, 0.5, NaN, Infinity, "20"]) {
      expect(() => validateHTTPAgentConfig({ card_url: "https://agent.example/card", protocol: "a2a", timeout_seconds })).toThrow("timeout_seconds");
    }
  });

  test("requires explicit streaming capability and keeps native A2A out of common Chat", () => {
    expect(supportsAgentChat(undefined)).toBe(false);
    expect(supportsAgentChat({ executable: true })).toBe(false);
    expect(supportsAgentChat({ executable: true, turn: { streaming: false } })).toBe(false);
    expect(supportsAgentChat({ executable: false, turn: { streaming: true } })).toBe(false);
    expect(supportsAgentChat({ executable: true, turn: { streaming: true }, sessions: { list: false } })).toBe(true);
    expect(isCommonAgentRoute("a2a")).toBe(false);
    expect(isCommonAgentRoute("future")).toBe(false);
    expect(isCommonAgentRoute("agent")).toBe(true);
    expect(isCommonAgentRoute(undefined)).toBe(true);
  });
});
