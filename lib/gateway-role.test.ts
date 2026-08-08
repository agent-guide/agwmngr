import { describe, expect, test } from "bun:test";
import { canPerformGatewayAction, type GatewayPrincipalRole } from "./gateway-role";
import type { GatewayAction } from "./proxy-action";

const ORDINARY_ACTIONS: GatewayAction[] = [
  "gateway:read",
  "secrets:read-redacted",
  "gateway:write",
  "runtime:chat",
  "runtime:permission_resolve",
];

const PLATFORM_ONLY_ACTIONS: GatewayAction[] = [
  "gateway:platform_config",
  "gateway:secrets_raw",
];

describe("Gateway-root roles", () => {
  test("Gateway Admin receives ordinary gateway authority", () => {
    for (const action of ORDINARY_ACTIONS) {
      expect(canPerformGatewayAction("admin", false, action)).toBe(true);
    }
  });

  test("Member receives no implicit gateway content authority", () => {
    for (const action of [...ORDINARY_ACTIONS, ...PLATFORM_ONLY_ACTIONS]) {
      expect(canPerformGatewayAction("member", false, action)).toBe(false);
    }
  });

  test("stored Gateway Admin cannot inherit platform-only authority", () => {
    for (const action of PLATFORM_ONLY_ACTIONS) {
      expect(canPerformGatewayAction("admin", false, action)).toBe(false);
    }
  });

  test("Platform Admin keeps all gateway authority independently of stored role", () => {
    const effectiveStoredRole: GatewayPrincipalRole = "member";
    for (const action of [...ORDINARY_ACTIONS, ...PLATFORM_ONLY_ACTIONS]) {
      expect(canPerformGatewayAction(effectiveStoredRole, true, action)).toBe(true);
    }
  });
});
