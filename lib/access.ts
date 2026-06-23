import { getAuthToken } from "./require-auth";
import { lookupSession, setActiveGateway, type SessionRecord } from "./session";
import {
  getGateway,
  getMembership,
  insertAudit,
  finalizeAudit,
  listGatewaysForUser,
  type GatewayRole,
  type AuditFinalizePatch,
} from "./db";
import { resolveGateway, type ResolvedGateway } from "./gateway-resolve";
import { actionForProxyPath, type GatewayAction } from "./proxy-action";

// Re-export so existing importers (the catch-all proxy) keep using `@/lib/access`
// as the single entry point; the implementation lives in the dependency-free
// proxy-action module so it can be unit-tested in isolation.
export { actionForProxyPath };
export type { GatewayAction };

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Shared access guards (§5 of docs/multi-tenant-design.md). Platform actions
// (user/gateway management) resolve no gateway; gateway-scoped actions resolve
// an active gateway, membership, role, and decrypted credentials. Both guards
// emit audit rows (§5.1): every deny, plus every allow for mutating/sensitive
// actions (plain reads are skipped to keep the log bounded).

export interface PlatformContext {
  session: SessionRecord;
  auditId: number | null;
}

export type GuardResult<T> =
  | { ok: true; ctx: T }
  | { ok: false; res: Response };

interface RequestMeta {
  method: string;
  path: string;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

function requestMeta(req: Request): RequestMeta {
  let path = "";
  try {
    const url = new URL(req.url);
    path = url.pathname + (url.search || "");
  } catch {
    path = "";
  }
  return {
    method: req.method,
    path,
    ip:
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      null,
    userAgent: req.headers.get("user-agent"),
    requestId: req.headers.get("x-request-id"),
  };
}

/** Finalize an open "allow" audit row (no-op if nothing was recorded). */
export function finalizeAccess(ctx: { auditId: number | null }, patch: AuditFinalizePatch): void {
  if (ctx.auditId != null) finalizeAudit(ctx.auditId, patch);
}

// ---- Platform guard ----

export function requirePlatformAccess(req: Request): GuardResult<PlatformContext> {
  const meta = requestMeta(req);
  const token = getAuthToken(req);

  const denyAudit = (
    status: number,
    error: string,
    failureReason: string,
    actorUserId: number | null,
  ): { ok: false; res: Response } => {
    insertAudit({
      decision: "deny",
      actor_user_id: actorUserId,
      action: "platform:*",
      method: meta.method,
      path: meta.path,
      failure_reason: failureReason,
      http_status: status,
      ip: meta.ip,
      user_agent: meta.userAgent,
      request_id: meta.requestId,
    });
    return { ok: false, res: Response.json({ error }, { status }) };
  };

  if (!token) return denyAudit(401, "authentication required", "no_token", null);

  const session = lookupSession(token);
  if (!session) return denyAudit(401, "invalid or expired session", "invalid_session", null);

  if (!session.isPlatformAdmin) {
    return denyAudit(403, "platform administrator access required", "not_platform_admin", session.userId);
  }

  // Record allow rows only for mutations (platform reads are low-value noise).
  let auditId: number | null = null;
  if (meta.method !== "GET" && meta.method !== "HEAD") {
    auditId = insertAudit({
      decision: "allow",
      actor_user_id: session.userId,
      action: "platform:*",
      method: meta.method,
      path: meta.path,
      ip: meta.ip,
      user_agent: meta.userAgent,
      request_id: meta.requestId,
    });
  }

  return { ok: true, ctx: { session, auditId } };
}

// ---- Gateway-scoped guard (§2.1, §5) ----

type EffectiveRole = GatewayRole | "admin";

// §2.1 role → action grant table.
const GRANTS: Record<GatewayAction, EffectiveRole[]> = {
  "gateway:read": ["viewer", "operator", "admin"],
  "secrets:read-redacted": ["viewer", "operator", "admin"],
  "gateway:write": ["operator", "admin"],
  "runtime:chat": ["operator", "admin"],
  "runtime:permission_resolve": ["operator", "admin"],
  "gateway:secrets_raw": ["admin"],
};

// Allow decisions are audited only for mutating/sensitive actions; plain reads
// would flood the log (auto-refresh polling) with little security value.
const AUDIT_ALLOW_ACTIONS = new Set<GatewayAction>([
  "gateway:write",
  "runtime:chat",
  "runtime:permission_resolve",
  "gateway:secrets_raw",
]);

export interface GatewayContext {
  session: SessionRecord;
  gateway: ResolvedGateway;
  role: EffectiveRole;
  action: GatewayAction;
  auditId: number | null;
}

/**
 * Guard for gateway-scoped endpoints. Resolves the active gateway (session or
 * X-Gateway-Id override), enforces membership + role for the requested action,
 * blocks disabled gateways, decrypts admin credentials, and audits the decision.
 */
export function requireGatewayAccess(
  req: Request,
  action: GatewayAction,
): GuardResult<GatewayContext> {
  const meta = requestMeta(req);

  const denyAudit = (
    status: number,
    error: string,
    failureReason: string,
    actorUserId: number | null,
    gatewayId: string | null,
  ): { ok: false; res: Response } => {
    insertAudit({
      decision: "deny",
      actor_user_id: actorUserId,
      gateway_id: gatewayId,
      action,
      method: meta.method,
      path: meta.path,
      failure_reason: failureReason,
      http_status: status,
      ip: meta.ip,
      user_agent: meta.userAgent,
      request_id: meta.requestId,
    });
    return { ok: false, res: Response.json({ error }, { status }) };
  };

  const token = getAuthToken(req);
  if (!token) return denyAudit(401, "authentication required", "no_token", null, null);

  const session = lookupSession(token);
  if (!session) return denyAudit(401, "invalid or expired session", "invalid_session", null, null);

  let gatewayId = req.headers.get("X-Gateway-Id")?.trim() || session.activeGatewayId;
  if (!gatewayId) {
    // Self-heal sessions with no active gateway (e.g. created before the gateway
    // registry was seeded): default to the user's first accessible gateway.
    const first = listGatewaysForUser(session.userId, session.isPlatformAdmin)[0];
    if (first) {
      gatewayId = first.id;
      setActiveGateway(session.token, first.id);
    }
  }
  if (!gatewayId) {
    return denyAudit(400, "no active gateway selected", "no_active_gateway", session.userId, null);
  }

  const row = getGateway(gatewayId);
  if (!row) return denyAudit(404, "gateway not found", "gateway_not_found", session.userId, gatewayId);

  let role: EffectiveRole;
  if (session.isPlatformAdmin) {
    role = "admin";
  } else {
    const membership = getMembership(session.userId, gatewayId);
    if (!membership) {
      return denyAudit(403, "no membership for this gateway", "no_membership", session.userId, gatewayId);
    }
    role = membership.role;
  }

  if (row.status === "disabled") {
    return denyAudit(403, "gateway is disabled", "gateway_disabled", session.userId, gatewayId);
  }

  if (!GRANTS[action].includes(role)) {
    return denyAudit(403, `role '${role}' is not permitted to perform ${action}`, "role_denied", session.userId, gatewayId);
  }

  let gateway: ResolvedGateway;
  try {
    gateway = resolveGateway(row);
  } catch {
    return denyAudit(
      503,
      "gateway credentials could not be decrypted (re-enter the password)",
      "credential_undecryptable",
      session.userId,
      gatewayId,
    );
  }

  let auditId: number | null = null;
  if (AUDIT_ALLOW_ACTIONS.has(action)) {
    auditId = insertAudit({
      decision: "allow",
      actor_user_id: session.userId,
      gateway_id: gatewayId,
      action,
      method: meta.method,
      path: meta.path,
      ip: meta.ip,
      user_agent: meta.userAgent,
      request_id: meta.requestId,
    });
  }

  return { ok: true, ctx: { session, gateway, role, action, auditId } };
}

// ---- withAccess wrappers (§5.1) ----
//
// The guards open an "allow" audit row *before* the handler runs, so they cannot
// yet know the upstream status, duration, or error. These wrappers encapsulate
// the open→finalize lifecycle so individual route handlers don't repeat it — and,
// critically, they guarantee the row is finalized on success, a handled error
// Response, AND an uncaught throw. Without them, mutating handlers that don't
// call finalizeAccess leave allow rows with empty http_status/duration_ms.
//
// Streaming (SSE) handlers need a stream-aware finalizer and must not use these
// wrappers — see app/api/admin/acp/chat/turn for that pattern.

type RouteHandler<Access, Ctx> = (
  req: Request,
  access: Access,
  routeCtx: Ctx,
) => Promise<Response> | Response;

/** Wrap a platform-scoped handler so its audit row is always finalized. */
export function withPlatformAccess<Ctx = unknown>(
  handler: RouteHandler<PlatformContext, Ctx>,
): (req: Request, routeCtx: Ctx) => Promise<Response> {
  return async (req, routeCtx) => {
    const start = Date.now();
    const guard = requirePlatformAccess(req);
    if (!guard.ok) return guard.res;
    try {
      const res = await handler(req, guard.ctx, routeCtx);
      finalizeAccess(guard.ctx, { http_status: res.status, duration_ms: Date.now() - start });
      return res;
    } catch (e) {
      finalizeAccess(guard.ctx, {
        http_status: 500,
        duration_ms: Date.now() - start,
        failure_reason: errorMessage(e),
      });
      throw e;
    }
  };
}

/** Wrap a gateway-scoped handler (fixed action) so its audit row is always finalized. */
export function withGatewayAccess<Ctx = unknown>(
  action: GatewayAction,
  handler: RouteHandler<GatewayContext, Ctx>,
): (req: Request, routeCtx: Ctx) => Promise<Response> {
  return async (req, routeCtx) => {
    const start = Date.now();
    const guard = requireGatewayAccess(req, action);
    if (!guard.ok) return guard.res;
    try {
      const res = await handler(req, guard.ctx, routeCtx);
      finalizeAccess(guard.ctx, { http_status: res.status, duration_ms: Date.now() - start });
      return res;
    } catch (e) {
      finalizeAccess(guard.ctx, {
        http_status: 500,
        duration_ms: Date.now() - start,
        failure_reason: errorMessage(e),
      });
      throw e;
    }
  };
}
