import { expect, test } from "bun:test";
import { resolvePlatformGatewayScope } from "./platform-gateway-scope";
import type { GatewayRow } from "./db";
import type { ResolvedGateway } from "@/packages/contracts/gateway/connection";

const row = { id: "gateway-a", status: "active" } as GatewayRow;
const resolved = { id: "gateway-a", name: "Gateway A" } as ResolvedGateway;

test("canonical Platform Gateway scope uses only the path Gateway ID", () => {
  const lookedUp: string[] = [];
  const result = resolvePlatformGatewayScope(
    "gateway-a",
    (id) => {
      lookedUp.push(id);
      return id === "gateway-a" ? row : null;
    },
    (value) => {
      expect(value).toBe(row);
      return resolved;
    },
  );
  expect(lookedUp).toEqual(["gateway-a"]);
  expect(result).toEqual({ ok: true, gateway: resolved });
});

test("unknown path Gateway fails without consulting session or headers", async () => {
  const result = resolvePlatformGatewayScope("missing", () => null, () => resolved);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.response.status).toBe(404);
});

test("disabled path Gateway blocks forwarding before credential decryption", async () => {
  let decrypted = false;
  const result = resolvePlatformGatewayScope(
    "gateway-a",
    () => ({ ...row, status: "disabled" }),
    () => {
      decrypted = true;
      return resolved;
    },
  );
  expect(decrypted).toBe(false);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toEqual({ error: "gateway is disabled" });
  }
});
