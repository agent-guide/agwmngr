import { describe, expect, test } from "bun:test";
import {
  emptyRateLimitsForm,
  rateLimitsFromForm,
  rateLimitsToForm,
} from "./virtual-key-rate-limits";

describe("virtual key rate-limit form", () => {
  test("omits rate_limits when every protocol is unlimited", () => {
    expect(rateLimitsFromForm(emptyRateLimitsForm())).toEqual({
      rateLimits: undefined,
      errors: {},
    });
  });

  test("serializes only enabled protocols", () => {
    const form = emptyRateLimitsForm();
    form.llm = { enabled: true, requestsPerMinute: "120", burst: "20" };
    form.agent = { enabled: true, requestsPerMinute: " 5 ", burst: "1" };

    expect(rateLimitsFromForm(form)).toEqual({
      rateLimits: {
        llm: { requests_per_minute: 120, burst: 20 },
        agent: { requests_per_minute: 5, burst: 1 },
      },
      errors: {},
    });
  });

  test("rejects zero, fractions, and incomplete enabled limits", () => {
    const form = emptyRateLimitsForm();
    form.llm = { enabled: true, requestsPerMinute: "0", burst: "10" };
    form.mcp = { enabled: true, requestsPerMinute: "1.5", burst: "2" };
    form.agent = { enabled: true, requestsPerMinute: "20", burst: "" };

    const result = rateLimitsFromForm(form);
    expect(result.rateLimits).toBeUndefined();
    expect(Object.keys(result.errors)).toEqual(["llm", "mcp", "agent"]);
  });

  test("hydrates persisted limits while leaving other protocols unlimited", () => {
    expect(rateLimitsToForm({ mcp: { requests_per_minute: 90, burst: 9 } })).toEqual({
      llm: { enabled: false, requestsPerMinute: "60", burst: "10" },
      mcp: { enabled: true, requestsPerMinute: "90", burst: "9" },
      agent: { enabled: false, requestsPerMinute: "60", burst: "10" },
    });
  });
});
