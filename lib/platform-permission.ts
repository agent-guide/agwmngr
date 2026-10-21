export type OperationalPermissionActionDecision = "allow" | "deny";

export interface OperationalPermissionAction {
  id: string;
  name: string;
}

export interface OperationalPermissionOption {
  id: string;
  name: string;
}

export interface OperationalPermission {
  requestId: string | null;
  resumeMode: "active_stream" | "new_stream" | null;
  actions: OperationalPermissionAction[];
  options: OperationalPermissionOption[];
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(value: unknown, ...keys: string[]): string | null {
  const row = object(value);
  if (!row) return null;
  for (const key of keys) {
    if (typeof row[key] === "string" && row[key]) return row[key];
  }
  return null;
}

function choices(
  value: unknown,
  field: "actions" | "options",
  idKeys: string[],
): Array<{ id: string; name: string }> {
  const candidates = object(value)?.[field];
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap((candidate) => {
    const id = stringField(candidate, ...idKeys);
    if (!id) return [];
    return [{ id, name: stringField(candidate, "name") ?? id }];
  });
}

export function operationalPermission(value: unknown): OperationalPermission {
  const resumeMode = stringField(value, "resume_mode", "resumeMode");
  return {
    requestId: stringField(value, "request_id", "requestId"),
    resumeMode: resumeMode === "active_stream" || resumeMode === "new_stream"
      ? resumeMode
      : null,
    actions: choices(value, "actions", ["action_id", "actionId"]),
    options: choices(value, "options", ["option_id", "optionId"]),
  };
}

export function actionPermissionDecision(
  permission: OperationalPermission,
  selections: Record<string, OperationalPermissionActionDecision>,
): { decisions: Array<{ action_id: string; outcome: OperationalPermissionActionDecision }> } | null {
  if (permission.actions.length === 0 ||
    permission.actions.some((action) => selections[action.id] === undefined)) return null;
  return {
    decisions: permission.actions.map((action) => ({
      action_id: action.id,
      outcome: selections[action.id],
    })),
  };
}

export function optionPermissionDecision(optionId: string): {
  outcome: "selected";
  option_id: string;
} {
  return { outcome: "selected", option_id: optionId };
}

export function rejectPermissionDecision(
  permission: OperationalPermission,
): { outcome: "cancel" | "cancelled" } {
  return permission.resumeMode === "new_stream" || permission.actions.length > 0
    ? { outcome: "cancel" }
    : { outcome: "cancelled" };
}
