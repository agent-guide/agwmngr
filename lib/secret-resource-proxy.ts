import type { ResolvedGateway } from "./gateway-resolve";
import { gatewayRequestJSON } from "./gateway-proxy";
import {
  mergeCredentialUpdate,
  mergeProviderUpdate,
  redactCredentialResponse,
  redactProviderResponse,
  redactVirtualKeyResponse,
} from "./secret-resource";

type SecretKind = "provider" | "credential" | "virtualKey";

const REDACT_FOR: Record<SecretKind, (value: unknown) => unknown> = {
  provider: redactProviderResponse,
  credential: redactCredentialResponse,
  virtualKey: redactVirtualKeyResponse,
};

function responseBody(body: unknown, status: number): Response {
  if (typeof body === "string") {
    return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return Response.json(body ?? {}, { status });
}

async function parseBody(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
  try {
    return { ok: true, body: await req.json() };
  } catch {
    return { ok: false, res: Response.json({ error: "invalid request body" }, { status: 400 }) };
  }
}

export async function proxySecretResource(
  req: Request,
  gateway: ResolvedGateway,
  path: string,
  kind: SecretKind,
  id?: string,
): Promise<Response> {
  const redact = REDACT_FOR[kind];
  let body: unknown;

  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "DELETE") {
    const parsed = await parseBody(req);
    if (!parsed.ok) return parsed.res;
    body = parsed.body;
  }

  try {
    // Virtual Keys need no read-modify-write: the bearer is generated upstream
    // and is not a writable field, so an omitted secret cannot erase anything.
    if (req.method === "PUT" && id && kind !== "virtualKey") {
      const current = await gatewayRequestJSON("GET", path, gateway);
      if (current.status >= 400) return responseBody(redact(current.body), current.status);
      body =
        kind === "provider"
          ? mergeProviderUpdate(current.body, body, id)
          : mergeCredentialUpdate(current.body, body);
    }

    const url = new URL(req.url);
    const upstreamPath = req.method === "GET" ? `${path}${url.search}` : path;
    const result = await gatewayRequestJSON(req.method, upstreamPath, gateway, body);
    return responseBody(redact(result.body), result.status);
  } catch (error) {
    return Response.json(
      { error: `gateway request failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 502 },
    );
  }
}
