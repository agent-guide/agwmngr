// The gateway Admin API delegates auth to the HTTP layer (Caddy basic_auth or
// the standalone daemon's basic-auth wrapper). There is no login/session/token
// flow: every admin request carries static HTTP Basic Auth. We cache only the
// base URL that successfully connects, shared across requests via globalThis.
const g = globalThis as typeof globalThis & {
  __gatewayBaseURL?: string;
};

function gatewayAddr(): string {
  return (process.env.GATEWAY_ADDR ?? "http://localhost:8019").replace(/\/$/, "");
}

function gatewayAddrCandidates(): string[] {
  const configured = g.__gatewayBaseURL ?? gatewayAddr();
  const out = [configured];
  try {
    const url = new URL(configured);
    if (url.hostname === "localhost") {
      url.hostname = "127.0.0.1";
      out.push(url.toString().replace(/\/$/, ""));
    } else if (url.hostname === "127.0.0.1") {
      url.hostname = "localhost";
      out.push(url.toString().replace(/\/$/, ""));
    }
  } catch {
    // Ignore invalid fallback generation and let fetch report the real error.
  }
  return [...new Set(out)];
}

function gatewayCredentials(): { user: string; pass: string } {
  return {
    user: process.env.GATEWAY_ADMIN_USER ?? "",
    pass: process.env.GATEWAY_ADMIN_PASSWORD ?? "",
  };
}

function basicAuthHeader(): string {
  const { user, pass } = gatewayCredentials();
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

const SKIP_HEADERS = new Set([
  "authorization",
  "connection",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

const SKIP_RESPONSE_HEADERS = new Set([
  // CORS headers — managed by the Next.js layer
  "access-control-allow-origin",
  "access-control-allow-methods",
  "access-control-allow-headers",
  "access-control-max-age",
  // Bun's fetch auto-decompresses the body, so these headers would be stale
  // and cause the browser to attempt a second decompression pass.
  "content-encoding",
  "content-length",
  // Hop-by-hop headers that must not be forwarded end-to-end
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

/**
 * Issue an authenticated JSON request to the gateway Admin API and return the
 * parsed body. Unlike proxyToGateway, this is for server-side internal calls
 * (e.g. resolving an ACP route before forwarding a data-plane turn), not for
 * passing a client Request straight through. Tries the localhost/127.0.0.1
 * candidates on connection failure and caches the one that connects.
 */
export async function gatewayRequestJSON(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const { user } = gatewayCredentials();
  if (!user) {
    throw new Error("gateway proxy not configured: missing admin credentials");
  }

  const headers: Record<string, string> = { Authorization: basicAuthHeader() };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const errors: string[] = [];
  let res: Response | undefined;
  for (const baseURL of gatewayAddrCandidates()) {
    try {
      res = await fetch(`${baseURL}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      g.__gatewayBaseURL = baseURL;
      break;
    } catch (e) {
      errors.push(`gateway unreachable (${baseURL}): ${String(e)}`);
    }
  }
  if (!res) {
    throw new Error(errors.join("; "));
  }

  const text = await res.text();
  let parsed: unknown;
  if (text.trim()) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, body: parsed };
}

async function forward(
  req: Request,
  baseURL: string,
  path: string,
  search: string,
  body: ArrayBuffer,
): Promise<Response> {
  const outHeaders = new Headers();
  for (const [k, v] of req.headers.entries()) {
    if (!SKIP_HEADERS.has(k.toLowerCase())) outHeaders.set(k, v);
  }
  outHeaders.set("Authorization", basicAuthHeader());

  const upstream = await fetch(`${baseURL}${path}${search}`, {
    method: req.method,
    headers: outHeaders,
    body: req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
  });

  const resHeaders = new Headers();
  for (const [k, v] of upstream.headers.entries()) {
    if (!SKIP_RESPONSE_HEADERS.has(k.toLowerCase())) resHeaders.set(k, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers: resHeaders });
}

export async function proxyToGateway(req: Request, path: string): Promise<Response> {
  const { user } = gatewayCredentials();
  if (!user) {
    return Response.json(
      { error: "gateway proxy not configured: missing admin credentials" },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const body = await req.arrayBuffer();

  const errors: string[] = [];
  for (const baseURL of gatewayAddrCandidates()) {
    try {
      const res = await forward(req, baseURL, path, url.search, body);
      g.__gatewayBaseURL = baseURL;
      return res;
    } catch (e) {
      errors.push(`gateway unreachable (${baseURL}): ${String(e)}`);
    }
  }
  return Response.json({ error: `gateway request failed: ${errors.join("; ")}` }, { status: 502 });
}
