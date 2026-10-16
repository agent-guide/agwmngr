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

type PlatformHandler = (
  service: PlatformIdentityService,
  actor: PlatformActorReference,
) => Promise<Response> | Response;

export async function withPlatformIdentity(
  request: Request,
  handler: PlatformHandler,
): Promise<Response> {
  const started = Date.now();
  let actorUserId: number | null = null;
  let actorPrincipalId: string | null = null;
  let failureReason: string | null = null;
  let response: Response;

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
    response = await handler(service, actor);
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
    action: "platform:identity",
    method: request.method,
    path: new URL(request.url).pathname,
    target_kind: actorPrincipalId?.startsWith("service:")
      ? "service_principal_actor"
      : "platform_identity",
    target_id: actorPrincipalId,
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
