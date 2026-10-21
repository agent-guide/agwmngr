import type { ResolvedGateway } from "@/packages/contracts/gateway/connection";
import {
  baseURLCache,
  basicAuthHeader,
  gatewayAddrCandidates,
} from "@/packages/gateway-client/admin";

const SKIP_HEADERS = new Set([
  // Use the selected upstream URL's authority. Bun 1.3.13 uses a supplied
  // Host header as the connection destination, so forwarding the browser
  // Host can send the Admin request back to the manager.
  "host",
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
    signal: req.signal,
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
      if (req.signal.aborted) break;
    }
  }
  return Response.json({ error: `gateway request failed: ${errors.join("; ")}` }, { status: 502 });
}
