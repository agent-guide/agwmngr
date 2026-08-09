import { requireGatewayAccess, finalizeAccess } from "@/lib/access";
import {
  AgentRouteError,
  dataplaneCandidates,
  resolveAgentRouteTarget,
  resolveAgentRuntimeType,
} from "@/lib/acp-dataplane";
import { extractApiError, extractRuntimeErrorType } from "@/lib/utils";
import { VirtualKeyError, resolveVirtualKeySecret } from "@/lib/virtual-key-secret";

// Streaming proxy: forwards a chat turn to the agent data plane and pipes the
// SSE response straight back to the browser. The manager session is required
// here; the caller names a virtual key by ID and the bearer is resolved and
// injected server-side, so it never lives in the browser. This is an explicit
// route, so it takes precedence over the /api/admin/[[...path]] gateway-admin
// catch-all.

interface PermissionDecision {
  request_id?: string;
  outcome?: string;
  option_id?: string;
  decisions?: { action_id: string; outcome: string }[];
}

interface TurnBody {
  route_id?: string;
  // The key is named, never carried: the browser has no access to bearer values
  // now that the Virtual Key read path is redacted.
  virtual_key_id?: string;
  thread_id?: string;
  session_id?: string;
  input?: string;
  cwd?: string;
  model?: string;
  fresh_session?: boolean;
  config_overrides?: Record<string, string>;
  // Carries a permission decision for runtimes whose resume mode is
  // `new_stream` (builtin): they do not accept the side-channel POST
  // /permission, the decision rides a fresh turn instead.
  permission?: PermissionDecision;
}

// The AgentRoute turn decoder is strict (DisallowUnknownFields): it accepts only
// input/session_id/permission/options, and every runtime-specific field must sit
// inside the versioned options envelope. Sending the old flat body — or omitting
// options.version — is a hard 400, not a silently ignored field.
// See unified-agent-runtime.md §6.5 and docs/v0.5-alignment-plan.md §2.4.
const TURN_OPTIONS_VERSION = "v1";

// options.runtime is decoded by the *selected backend*, also with
// DisallowUnknownFields, so its accepted keys are per-runtime — not universal:
//
//   acp     → acpRuntimeOptionsV1; thread_id is mandatory (empty ⇒ 400)
//   builtin → an empty struct; ANY key is rejected as unsupported_option, which
//             surfaces as "runtime option is not supported"
//   http    → not executable yet; the gateway answers 501
//
// So the envelope has to be built per backend. Sending the ACP shape to a
// builtin agent fails the whole turn.
const ACP_ONLY_FIELDS = ["thread_id", "cwd", "model", "fresh_session", "config_overrides"] as const;

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const start = Date.now();
  const guard = requireGatewayAccess(req, "runtime:chat");
  if (!guard.ok) return guard.res;
  const gateway = guard.ctx.gateway;
  const finalize = (status: number, reason?: string) =>
    finalizeAccess(guard.ctx, {
      http_status: status,
      duration_ms: Date.now() - start,
      target_kind: "acp_turn",
      failure_reason: reason ?? null,
    });
  const fail = (res: Response, status: number, reason: string): Response => {
    finalize(status, reason);
    return res;
  };

  let payload: TurnBody;
  try {
    payload = (await req.json()) as TurnBody;
  } catch {
    return fail(Response.json({ error: "invalid JSON body" }, { status: 400 }), 400, "bad_request");
  }

  const routeId = payload.route_id?.trim();
  if (!routeId) return fail(Response.json({ error: "route_id is required" }, { status: 400 }), 400, "bad_request");
  // The dispatcher accepts a turn carrying only a permission decision — that is
  // how a `new_stream` runtime resumes — so input is required only without one.
  const permissionRequestId = payload.permission?.request_id?.trim();
  if (!payload.input?.trim() && !permissionRequestId) {
    return fail(Response.json({ error: "input or permission is required" }, { status: 400 }), 400, "bad_request");
  }

  let target;
  let runtimeType: string;
  try {
    target = await resolveAgentRouteTarget(routeId, gateway);
    runtimeType = await resolveAgentRuntimeType(target.agentId, gateway);
  } catch (e) {
    if (e instanceof AgentRouteError) return fail(Response.json({ error: e.message }, { status: e.status }), e.status, "route_error");
    return fail(Response.json({ error: `gateway unreachable: ${String(e)}` }, { status: 502 }), 502, "gateway_unreachable");
  }

  const virtualKeyId = payload.virtual_key_id?.trim();
  if (target.requireVirtualKey && !virtualKeyId) {
    return fail(Response.json({ error: "this route requires a virtual key" }, { status: 400 }), 400, "virtual_key_required");
  }

  let virtualKey = "";
  if (virtualKeyId) {
    try {
      virtualKey = await resolveVirtualKeySecret(virtualKeyId, routeId, gateway);
    } catch (e) {
      if (e instanceof VirtualKeyError) {
        return fail(Response.json({ error: e.message }, { status: e.status }), e.status, "virtual_key_error");
      }
      return fail(Response.json({ error: `gateway unreachable: ${String(e)}` }, { status: 502 }), 502, "gateway_unreachable");
    }
  }

  // thread_id/cwd/model/fresh_session/config_overrides are ACP-runtime options,
  // so they belong under options.runtime rather than at the top level — and only
  // when the target actually runs on ACP.
  const options: Record<string, unknown> = { version: TURN_OPTIONS_VERSION };
  if (runtimeType === "acp") {
    if (!payload.thread_id?.trim()) {
      return fail(Response.json({ error: "thread_id is required" }, { status: 400 }), 400, "bad_request");
    }
    const runtimeOptions: Record<string, unknown> = { thread_id: payload.thread_id.trim() };
    if (payload.cwd?.trim()) runtimeOptions.cwd = payload.cwd.trim();
    if (payload.model?.trim()) runtimeOptions.model = payload.model.trim();
    if (payload.fresh_session) runtimeOptions.fresh_session = true;
    if (payload.config_overrides && Object.keys(payload.config_overrides).length > 0) {
      runtimeOptions.config_overrides = payload.config_overrides;
    }
    options.runtime = runtimeOptions;
  } else {
    // Omit options.runtime entirely: the backend treats an absent object as {}.
    // Reject supplied ACP-only fields instead of dropping them silently — the
    // caller asked for behaviour this runtime cannot give (a builtin agent has
    // no threads and no cwd), and a quiet drop would look like it took effect.
    const rejected = ACP_ONLY_FIELDS.filter((field) => {
      const value = payload[field];
      if (typeof value === "string") return value.trim() !== "";
      if (typeof value === "object" && value !== null) return Object.keys(value).length > 0;
      return Boolean(value);
    });
    if (rejected.length > 0) {
      return fail(
        Response.json(
          { error: `the ${runtimeType} runtime does not accept ${rejected.join(", ")}` },
          { status: 400 },
        ),
        400,
        "bad_request",
      );
    }
  }

  const turnBody: Record<string, unknown> = { input: payload.input ?? "", options };
  if (payload.session_id?.trim()) turnBody.session_id = payload.session_id.trim();
  if (permissionRequestId) {
    const decision: Record<string, unknown> = { request_id: permissionRequestId };
    if (payload.permission?.outcome?.trim()) decision.outcome = payload.permission.outcome.trim();
    if (payload.permission?.option_id?.trim()) decision.option_id = payload.permission.option_id.trim();
    if (payload.permission?.decisions?.length) decision.decisions = payload.permission.decisions;
    turnBody.permission = decision;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (virtualKey) headers["Authorization"] = `Bearer ${virtualKey}`;
  if (target.host) headers["Host"] = target.host;

  const requestBody = JSON.stringify(turnBody);
  let stream: ReadableStream | null = null;
  let lastError = "";

  // Try each host candidate. The dispatcher answers with an event stream; a 2xx
  // that is NOT an event stream means the Host did not match the dispatcher site
  // (Caddy fell through) — try the next candidate. A >=400 means the dispatcher
  // handled the request and rejected it, so surface that immediately.
  for (const base of dataplaneCandidates(gateway)) {
    const url = `${base}${target.pathPrefix}/turn`;
    let upstream: Response;
    try {
      upstream = await fetch(url, { method: "POST", headers, body: requestBody });
    } catch (e) {
      lastError = `data plane unreachable at ${url}: ${String(e)}`;
      continue;
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    if (upstream.ok && upstream.body && contentType.includes("text/event-stream")) {
      stream = upstream.body;
      break;
    }

    if (upstream.status >= 400) {
      const text = await upstream.text().catch(() => "");
      let error = text.trim() || `data plane returned ${upstream.status}`;
      let errorType: string | undefined;
      if (text.trim()) {
        try {
          const body: unknown = JSON.parse(text);
          error = extractApiError(body, error);
          errorType = extractRuntimeErrorType(body);
        } catch {
          // Preserve a non-JSON upstream error body verbatim.
        }
      }
      return fail(
        Response.json(
          { error, ...(errorType && { error_type: errorType }) },
          { status: upstream.status },
        ),
        upstream.status,
        "dataplane_error",
      );
    }

    await upstream.body?.cancel().catch(() => {});
    lastError = `data plane at ${url} did not return an event stream — its Host (${new URL(base).host}) may not match the dispatcher site`;
  }

  if (!stream) {
    return fail(
      Response.json({ error: lastError || "data plane did not return a stream" }, { status: 502 }),
      502,
      "no_stream",
    );
  }

  // Stream-aware finalize (§5.1): the turn may still fail or be cancelled after
  // the 200 headers are sent, so finalize when the stream actually ends, not now.
  const reader = stream.getReader();
  const wrapped = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          finalize(200);
          return;
        }
        controller.enqueue(value as Uint8Array);
      } catch (e) {
        controller.error(e);
        finalize(599, "stream_error");
      }
    },
    cancel(reason) {
      void reader.cancel(reason);
      finalize(499, "client_cancelled");
    },
  });

  return new Response(wrapped, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering so SSE chunks flush immediately.
      "X-Accel-Buffering": "no",
    },
  });
}
