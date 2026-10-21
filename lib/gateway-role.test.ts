import { describe, expect, test } from "bun:test";
import type { GatewayPrincipalRole } from "@/packages/contracts/gateway/authorization";
import {
  canPerformGatewayCompatibilityAction,
  GATEWAY_COMPATIBILITY_AUTHORITY,
} from "@/packages/platform/authorization/gateway";
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

describe("legacy Gateway compatibility authority", () => {
  test("has an explicit post-cutover authority-mode marker", () => {
    expect(GATEWAY_COMPATIBILITY_AUTHORITY).toBe("platform_admin_gateway_compatibility");
  });

  test("stored Gateway Admin authority is retired", () => {
    for (const action of ORDINARY_ACTIONS) {
      expect(canPerformGatewayCompatibilityAction("admin", false, action)).toBe(false);
    }
  });

  test("Member receives no implicit gateway content authority", () => {
    for (const action of [...ORDINARY_ACTIONS, ...PLATFORM_ONLY_ACTIONS]) {
      expect(canPerformGatewayCompatibilityAction("member", false, action)).toBe(false);
    }
  });

  test("stored Gateway Admin cannot inherit platform-only authority", () => {
    for (const action of PLATFORM_ONLY_ACTIONS) {
      expect(canPerformGatewayCompatibilityAction("admin", false, action)).toBe(false);
    }
  });

  test("Platform Admin keeps all gateway authority independently of stored role", () => {
    const effectiveStoredRole: GatewayPrincipalRole = "member";
    for (const action of [...ORDINARY_ACTIONS, ...PLATFORM_ONLY_ACTIONS]) {
      expect(canPerformGatewayCompatibilityAction(effectiveStoredRole, true, action)).toBe(true);
    }
  });

  test("Tenant Gateway grant values are never translated into Gateway roles", () => {
    for (const grantAccess of ["view", "manage"] as const) {
      expect(
        canPerformGatewayCompatibilityAction(
          grantAccess as unknown as GatewayPrincipalRole,
          false,
          "gateway:read",
        ),
      ).toBe(false);
    }
  });
});
