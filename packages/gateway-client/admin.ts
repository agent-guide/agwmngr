import type { ResolvedGateway } from "../contracts/gateway/connection";

// Gateway Admin authentication belongs to the HTTP layer. The successful base
// address is cached per Gateway so one Gateway cannot affect another's routing.
const globalCache = globalThis as typeof globalThis & {
  __gatewayBaseURL?: Record<string, string>;
};

export function baseURLCache(): Record<string, string> {
  if (!globalCache.__gatewayBaseURL) globalCache.__gatewayBaseURL = {};
  return globalCache.__gatewayBaseURL;
}

export function gatewayAddrCandidates(gateway: ResolvedGateway): string[] {
  const cached = baseURLCache()[gateway.id];
  const configured = (cached ?? gateway.adminAddr).replace(/\/$/, "");
  const candidates = [configured];

  try {
    const url = new URL(configured);
    if (url.hostname === "localhost") {
      url.hostname = "127.0.0.1";
      candidates.push(url.toString().replace(/\/$/, ""));
    } else if (url.hostname === "127.0.0.1") {
      url.hostname = "localhost";
      candidates.push(url.toString().replace(/\/$/, ""));
    }
  } catch {
    // Keep the configured address and let fetch report the actionable error.
  }

  return [...new Set(candidates)];
}

export function basicAuthHeader(gateway: ResolvedGateway): string {
  return `Basic ${Buffer.from(`${gateway.adminUser}:${gateway.adminPassword}`).toString("base64")}`;
}

/**
 * Issue one authenticated JSON request to a Gateway Admin API. This narrow
 * client knows connection credentials and transport fallback, but nothing about
 * manager sessions, Tenant authority, secret redaction or audit records.
 */
export async function gatewayRequestJSON(
  method: string,
  path: string,
  gateway: ResolvedGateway,
  body?: unknown,
  options: { signal?: AbortSignal } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { Authorization: basicAuthHeader(gateway) };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const errors: string[] = [];
  let response: Response | undefined;
  for (const baseURL of gatewayAddrCandidates(gateway)) {
    try {
      response = await fetch(`${baseURL}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: options.signal,
      });
      baseURLCache()[gateway.id] = baseURL;
      break;
    } catch (error) {
      errors.push(`gateway unreachable (${baseURL}): ${String(error)}`);
    }
  }

  if (!response) throw new Error(errors.join("; "));

  const text = await response.text();
  let parsed: unknown;
  if (text.trim()) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: response.status, body: parsed };
}
