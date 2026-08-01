import { describe, expect, test } from "bun:test";
import { extractApiError, extractRuntimeErrorType } from "@/lib/utils";

describe("runtime error extraction", () => {
  test("preserves the normalized runtime message and stable error type", () => {
    const body = {
      error_type: "runtime_not_executable",
      message: "runtime is not executable",
    };
    expect(extractApiError(body, "fallback")).toBe("runtime is not executable");
    expect(extractRuntimeErrorType(body)).toBe("runtime_not_executable");
  });

  test("keeps compatibility with manager error bodies", () => {
    expect(extractApiError({ error: "permission denied" }, "fallback")).toBe("permission denied");
    expect(extractRuntimeErrorType({ error: "permission denied" })).toBeUndefined();
  });
});
