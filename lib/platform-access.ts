import { getAuthToken } from "./require-auth";
import { lookupSession } from "./session";
import { insertAudit } from "./db";
import { getPlatformIdentity } from "./platform-identity";
import {
  IdentityError,
  isIdentityError,
  type PlatformIdentityService,
} from "@/packages/platform/services/identity";
import type { PlatformActorReference } from "@/packages/contracts/platform/identity";
import type { PrincipalResolutionInput } from "@/packages/contracts/platform/identity";

type PlatformHandler = (
  service: PlatformIdentityService,
  actor: PlatformActorReference,
  audit: PlatformIdentityAudit,
) => Promise<Response> | Response;

export interface PlatformIdentityAudit {
  set(fields: {
    action?: string;
    tenantId?: string | null;
    gatewayId?: string | null;
    effectiveAccess?: string | null;
    targetKind?: string | null;
    targetId?: string | null;
  }): void;
}

export async function withPlatformIdentity(
  request: Request,
  handler: PlatformHandler,
): Promise<Response> {
  const started = Date.now();
  let actorUserId: number | null = null;
  let actorPrincipalId: string | null = null;
  let failureReason: string | null = null;
  let response: Response;
  const auditDetails = {
    action: "platform:identity",
    tenantId: null as string | null,
    gatewayId: null as string | null,
    effectiveAccess: null as string | null,
    targetKind: null as string | null,
    targetId: null as string | null,
  };
  const audit: PlatformIdentityAudit = {
    set(fields) {
      if (fields.action !== undefined) auditDetails.action = fields.action;
      if (fields.tenantId !== undefined) auditDetails.tenantId = fields.tenantId;
      if (fields.gatewayId !== undefined) auditDetails.gatewayId = fields.gatewayId;
      if (fields.effectiveAccess !== undefined) {
        auditDetails.effectiveAccess = fields.effectiveAccess;
      }
      if (fields.targetKind !== undefined) auditDetails.targetKind = fields.targetKind;
      if (fields.targetId !== undefined) auditDetails.targetId = fields.targetId;
    },
  };

  try {
    const token = getAuthToken(request);
    if (!token) throw new IdentityError("unauthenticated");
    const service = await getPlatformIdentity();
    let actor: PlatformActorReference;
    if (token.startsWith("agwmngr_svc_")) {
      actor = await service.authenticateService(token);
      actorPrincipalId = actor.kind === "service" ? actor.principalId : null;
    } else {
      const session = lookupSession(token);
      if (!session) throw new IdentityError("unauthenticated");
      actorUserId = session.userId;
      actorPrincipalId = `user:${session.userId}`;
      actor = { kind: "human", userId: session.userId };
    }
    response = await handler(service, actor, audit);
    if (!response.ok) failureReason = `http_${response.status}`;
  } catch (error) {
    if (isIdentityError(error)) {
      failureReason = error.code;
      const status = {
        unauthenticated: 401,
        forbidden: 403,
        invalid_input: 400,
        not_found: 404,
        conflict: 409,
      }[error.code];
      response = Response.json({ error: error.message, code: error.code }, { status });
    } else if (error instanceof Error && /unique|duplicate key/i.test(error.message)) {
      failureReason = "conflict";
      response = Response.json({ error: "record already exists", code: "conflict" }, { status: 409 });
    } else {
      console.error("[platform identity] unexpected failure", error);
      failureReason = "identity_store_unavailable";
      response = Response.json(
        { error: "platform identity store unavailable" },
        { status: 503 },
      );
    }
  }

  // Tokens and request bodies (including one-time credentials) are never logged.
  insertAudit({
    actor_user_id: actorUserId,
    actor_principal_id: actorPrincipalId,
    tenant_id: auditDetails.tenantId,
    gateway_id: auditDetails.gatewayId,
    effective_access: auditDetails.effectiveAccess,
    action: auditDetails.action,
    method: request.method,
    path: new URL(request.url).pathname,
    target_kind: auditDetails.targetKind ?? (actorPrincipalId?.startsWith("service:")
      ? "service_principal_actor"
      : "platform_identity"),
    target_id: auditDetails.targetId ?? actorPrincipalId,
    decision: response.ok ? "allow" : "deny",
    failure_reason: failureReason,
    http_status: response.status,
    duration_ms: Date.now() - started,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function platformIdentityBody(
  request: Request,
  fields: readonly string[],
): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new IdentityError("invalid_input", "invalid JSON body");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new IdentityError("invalid_input", "expected an object");
  }
  if (Object.keys(value).some((key) => !fields.includes(key))) {
    throw new IdentityError("invalid_input", "unsupported body field");
  }
  return value as Record<string, unknown>;
}

export function requiredText(body: Record<string, unknown>, field: string): string {
  if (typeof body[field] !== "string" || !body[field]) {
    throw new IdentityError("invalid_input", `${field} is required`);
  }
  return body[field];
}

export function principalResolutionInput(
  body: Record<string, unknown>,
): PrincipalResolutionInput {
  const kind = requiredText(body, "kind");
  if (kind === "human") {
    if (body.principal_id !== undefined) {
      throw new IdentityError("invalid_input", "human resolution accepts only username");
    }
    return { kind, username: requiredText(body, "username") };
  }
  if (kind === "service") {
    if (body.username !== undefined) {
      throw new IdentityError("invalid_input", "service resolution accepts only principal_id");
    }
    return { kind, principalId: requiredText(body, "principal_id") };
  }
  throw new IdentityError("invalid_input", "kind must be human or service");
}
