import { dataplaneFetch } from "./dataplane-fetch";
import { dataplaneCandidates } from "./acp-dataplane";
import { getGateway } from "./db";
import { resolveGateway } from "./gateway-resolve";
import type { AuthorizedDeploymentInvocation } from "@/packages/platform/services/deployment-access";
import { IdentityError } from "@/packages/platform/services/identity";

function gatewayConnection(gatewayId: string) {
  const row = getGateway(gatewayId);
  if (!row || row.status !== "active") {
    throw new IdentityError("conflict", "target Gateway is not active");
  }
  try {
    return resolveGateway(row);
  } catch {
    throw new IdentityError("conflict", "target Gateway credentials are unavailable");
  }
}

async function forward(
  authorized: AuthorizedDeploymentInvocation,
  suffix: "/turn" | "/permission",
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const gateway = gatewayConnection(authorized.gatewayId);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authorized.bearer}`,
    ...(suffix === "/turn" ? { Accept: "text/event-stream" } : {}),
  };
  let lastError = "data plane unavailable";
  for (const base of dataplaneCandidates(gateway)) {
    const url = `${base}${authorized.pathPrefix}${suffix}`;
    let response: Response;
    try {
      response = await dataplaneFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      lastError = `data plane unavailable: ${error instanceof Error ? error.message : String(error)}`;
      continue;
    }
    if (response.status >= 400) return response;
    const contentType = response.headers.get("content-type") ?? "";
    if (suffix === "/turn" && (!response.body || !contentType.includes("text/event-stream"))) {
      await response.body?.cancel().catch(() => {});
      lastError = "data plane did not return an event stream";
      continue;
    }
    return response;
  }
  return Response.json({ error: lastError }, { status: 502 });
}

export function forwardPlatformTurn(
  authorized: AuthorizedDeploymentInvocation,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  return forward(authorized, "/turn", body, signal);
}

export function forwardPlatformPermission(
  authorized: AuthorizedDeploymentInvocation,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  return forward(authorized, "/permission", body, signal);
}
