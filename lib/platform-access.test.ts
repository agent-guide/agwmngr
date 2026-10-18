import { expect, test } from "bun:test";
import { principalResolutionInput } from "./platform-access";

test("Principal resolution requires one explicit namespace and complete identifier", () => {
  expect(principalResolutionInput({ kind: "human", username: "alice" })).toEqual({
    kind: "human",
    username: "alice",
  });
  expect(principalResolutionInput({ kind: "service", principal_id: "service:worker" }))
    .toEqual({ kind: "service", principalId: "service:worker" });
  expect(() => principalResolutionInput({ kind: "human" })).toThrow("username is required");
  expect(() => principalResolutionInput({ kind: "service" })).toThrow("principal_id is required");
  expect(() => principalResolutionInput({ username: "alice" })).toThrow("kind is required");
  expect(() => principalResolutionInput({ kind: "unknown", username: "alice" }))
    .toThrow("kind must be human or service");
  expect(() => principalResolutionInput({
    kind: "human",
    username: "alice",
    principal_id: "service:alice",
  })).toThrow("human resolution accepts only username");
  expect(() => principalResolutionInput({
    kind: "service",
    username: "service:worker",
    principal_id: "service:worker",
  })).toThrow("service resolution accepts only principal_id");
});
