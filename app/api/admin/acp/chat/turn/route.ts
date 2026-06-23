import { requireGatewayAccess, finalizeAccess } from "@/lib/access";
import { ACPRouteError, dataplaneCandidates, resolveACPRouteTarget } from "@/lib/acp-dataplane";

// Streaming proxy: forwards a chat turn to the ACP data plane and pipes the
// SSE response straight back to the browser. The manager session is required
// here; the data-plane virtual key is injected server-side so it never has to
// live in the browser. This is an explicit route, so it takes precedence over
// the /api/admin/[[...path]] gateway-admin catch-all.

interface TurnBody {
  route_id?: string;
  virtual_key?: string;
  thread_id?: string;
  session_id?: string;
  input?: string;
  cwd?: string;
  model?: string;
  fresh_session?: boolean;
  config_overrides?: Record<string, string>;
}

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
  if (!payload.thread_id?.trim()) return fail(Response.json({ error: "thread_id is required" }, { status: 400 }), 400, "bad_request");
  if (!payload.input?.trim()) return fail(Response.json({ error: "input is required" }, { status: 400 }), 400, "bad_request");

  let target;
  try {
    target = await resolveACPRouteTarget(routeId, gateway);
  } catch (e) {
    if (e instanceof ACPRouteError) return fail(Response.json({ error: e.message }, { status: e.status }), e.status, "route_error");
    return fail(Response.json({ error: `gateway unreachable: ${String(e)}` }, { status: 502 }), 502, "gateway_unreachable");
  }

  const virtualKey = payload.virtual_key?.trim();
  if (target.requireVirtualKey && !virtualKey) {
    return fail(Response.json({ error: "this route requires a virtual key" }, { status: 400 }), 400, "virtual_key_required");
  }

  const turnBody: Record<string, unknown> = {
    thread_id: payload.thread_id,
    input: payload.input,
  };
  if (payload.session_id?.trim()) turnBody.session_id = payload.session_id.trim();
  if (payload.cwd?.trim()) turnBody.cwd = payload.cwd.trim();
  if (payload.model?.trim()) turnBody.model = payload.model.trim();
  if (payload.fresh_session) turnBody.fresh_session = true;
  if (payload.config_overrides && Object.keys(payload.config_overrides).length > 0) {
    turnBody.config_overrides = payload.config_overrides;
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
      return fail(
        Response.json(
          { error: text.trim() || `data plane returned ${upstream.status}` },
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
