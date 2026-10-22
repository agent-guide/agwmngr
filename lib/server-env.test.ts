import { expect, test } from "bun:test";
import { getCommandEnv, requireCommandEnvIsolation } from "./server-env";

test("operator commands prefer an explicit process environment value", () => {
  expect(
    getCommandEnv(
      "PLATFORM_DATABASE_URL",
      { PLATFORM_DATABASE_URL: "postgresql://explicit-shell.example/platform" },
      { PLATFORM_DATABASE_URL: "postgresql://repository-default.example/platform" },
    ),
  ).toBe("postgresql://explicit-shell.example/platform");
});

test("operator commands require Bun environment-file isolation", () => {
  expect(() => requireCommandEnvIsolation([])).toThrow("bun --no-env-file");
  expect(() => requireCommandEnvIsolation(["--no-env-file"])).not.toThrow();
});
