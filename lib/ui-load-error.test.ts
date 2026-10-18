import { expect, test } from "bun:test";
import { ApiError } from "./api";
import { loadFailureFrom } from "./ui-load-error";

test("collection load failures keep forbidden and unavailable states distinct", () => {
  expect(loadFailureFrom(new ApiError(403, "gateway is disabled"), "fallback")).toEqual({
    kind: "forbidden",
    message: "gateway is disabled",
  });
  expect(loadFailureFrom(new ApiError(503, "store unavailable"), "fallback")).toEqual({
    kind: "failed",
    message: "store unavailable",
  });
  expect(loadFailureFrom("unknown", "fallback")).toEqual({
    kind: "failed",
    message: "fallback",
  });
});
