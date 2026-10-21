import { describe, expect, test } from "bun:test";
import {
  actionPermissionDecision,
  operationalPermission,
  optionPermissionDecision,
  rejectPermissionDecision,
} from "./platform-permission";

describe("platform operational permission decisions", () => {
  test("builds complete builtin per-action decisions and uses cancel", () => {
    const permission = operationalPermission({
      request_id: "permission:builtin",
      resume_mode: "new_stream",
      actions: [
        { action_id: "call:one", name: "Read file" },
        { action_id: "call:two" },
      ],
    });
    expect(actionPermissionDecision(permission, { "call:one": "allow" })).toBeNull();
    expect(actionPermissionDecision(permission, {
      "call:one": "allow",
      "call:two": "deny",
    })).toEqual({ decisions: [
      { action_id: "call:one", outcome: "allow" },
      { action_id: "call:two", outcome: "deny" },
    ] });
    expect(rejectPermissionDecision(permission)).toEqual({ outcome: "cancel" });
  });

  test("keeps ACP option and cancellation decisions distinct", () => {
    const permission = operationalPermission({
      requestId: "permission:acp",
      resumeMode: "active_stream",
      options: [{ optionId: "allow-once", name: "Allow once" }],
    });
    expect(permission.options).toEqual([{ id: "allow-once", name: "Allow once" }]);
    expect(optionPermissionDecision("allow-once"))
      .toEqual({ outcome: "selected", option_id: "allow-once" });
    expect(rejectPermissionDecision(permission)).toEqual({ outcome: "cancelled" });
  });
});
