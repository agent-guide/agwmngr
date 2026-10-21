import { describe, expect, test } from "bun:test";
import { isUnhealthyAgentHealth } from "./platform-health";

describe("isUnhealthyAgentHealth", () => {
  test("reads the nested Gateway runtime health shape", () => {
    expect(isUnhealthyAgentHealth({ runtime: { healthy: true, state: "ready" } })).toBe(false);
    expect(isUnhealthyAgentHealth({ runtime: { healthy: false, state: "unhealthy" } })).toBe(true);
    expect(isUnhealthyAgentHealth({ runtime_health: { healthy: false, state: "degraded" } })).toBe(true);
  });

  test("treats Gateway health-check errors as unhealthy", () => {
    expect(isUnhealthyAgentHealth({ runtime_error: { error_type: "runtime_not_executable" } })).toBe(true);
    expect(isUnhealthyAgentHealth({
      runtime: { healthy: true, state: "ready" },
      runtime_health_error: { error_type: "backend_unavailable" },
    })).toBe(true);
  });

  test("keeps legacy top-level health responses compatible", () => {
    expect(isUnhealthyAgentHealth({ healthy: false })).toBe(true);
    expect(isUnhealthyAgentHealth({ status: "healthy" })).toBe(false);
    expect(isUnhealthyAgentHealth({ status: "failed" })).toBe(true);
  });
});
