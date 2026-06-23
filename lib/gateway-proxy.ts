import type { ResolvedGateway } from "./gateway-resolve";

// The gateway Admin API delegates auth to the HTTP layer (Caddy basic_auth or
// the standalone daemon's basic-auth wrapper). Every admin request carries
// static HTTP Basic Auth built from the gateway record's credentials. We cache
// the base URL that successfully connects, keyed by gateway id, across requests.
const g = globalThis as typeof globalThis & {
  __gatewayBaseURL?: Record<string, string>;
};

function baseURLCache(): Record<string, string> {
  if (!g.__gatewayBaseURL) g.__gatewayBaseURL = {};
  return g.__gatewayBaseURL;
}

function gatewayAddrCandidates(gateway: ResolvedGateway): string[] {
  const cached = baseURLCache()[gateway.id];
  const configured = (cached ?? gateway.adminAddr).replace(/\/$/, "");
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

function basicAuthHeader(gateway: ResolvedGateway): string {
  return `Basic ${Buffer.from(`${gateway.adminUser}:${gateway.adminPassword}`).toString("base64")}`;
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
 * Issue an authenticated JSON request to a gateway's Admin API and return the
 * parsed body. For server-side internal calls (e.g. resolving an ACP route
 * before forwarding a data-plane turn). Tries the localhost/127.0.0.1 candidates
 * on connection failure and caches the one that connects (keyed by gateway id).
 */
export async function gatewayRequestJSON(
  method: string,
  path: string,
  gateway: ResolvedGateway,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { Authorization: basicAuthHeader(gateway) };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const errors: string[] = [];
  let res: Response | undefined;
  for (const baseURL of gatewayAddrCandidates(gateway)) {
    try {
      res = await fetch(`${baseURL}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      baseURLCache()[gateway.id] = baseURL;
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
  gateway: ResolvedGateway,
  baseURL: string,
  path: string,
  search: string,
  body: ArrayBuffer,
): Promise<Response> {
  const outHeaders = new Headers();
  for (const [k, v] of req.headers.entries()) {
    if (!SKIP_HEADERS.has(k.toLowerCase())) outHeaders.set(k, v);
  }
  outHeaders.set("Authorization", basicAuthHeader(gateway));

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

export async function proxyToGateway(
  req: Request,
  path: string,
  gateway: ResolvedGateway,
): Promise<Response> {
  const url = new URL(req.url);
  const body = await req.arrayBuffer();

  const errors: string[] = [];
  for (const baseURL of gatewayAddrCandidates(gateway)) {
    try {
      const res = await forward(req, gateway, baseURL, path, url.search, body);
      baseURLCache()[gateway.id] = baseURL;
      return res;
    } catch (e) {
      errors.push(`gateway unreachable (${baseURL}): ${String(e)}`);
    }
  }
  return Response.json({ error: `gateway request failed: ${errors.join("; ")}` }, { status: 502 });
}
