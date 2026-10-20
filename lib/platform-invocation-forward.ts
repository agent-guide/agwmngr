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

function turnError(frame: string): string | null {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    if (line.startsWith("data:")) data.push(line.slice("data:".length).trim());
  }
  if (event !== "error") return null;
  try {
    const value = JSON.parse(data.join("\n")) as { message?: unknown; error?: unknown };
    if (typeof value.message === "string" && value.message) return value.message;
    if (typeof value.error === "string" && value.error) return value.error;
  } catch {
    // Fall through to the stable public error below.
  }
  return "Agent permission continuation failed";
}

/**
 * Fully consume a new-stream permission continuation. Operational callers do
 * not own the original browser stream, but the Gateway still requires the SSE
 * response to be driven to completion before the suspended builtin run resumes.
 */
export async function consumePlatformTurn(response: Response): Promise<void> {
  if (!response.ok || !response.body) {
    let message = `Agent permission continuation failed (${response.status})`;
    try {
      const value = await response.json() as { message?: unknown; error?: unknown };
      if (typeof value.message === "string" && value.message) message = value.message;
      else if (typeof value.error === "string" && value.error) message = value.error;
    } catch {
      // Keep the bounded status-only fallback.
    }
    throw new IdentityError("conflict", message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      if (buffer.length > 1024 * 1024 && !buffer.includes("\n\n")) {
        throw new IdentityError("conflict", "Agent permission continuation emitted an oversized event");
      }
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const message = turnError(frame);
        if (message) throw new IdentityError("conflict", message);
      }
    }
    buffer += decoder.decode().replace(/\r\n/g, "\n");
    if (buffer.trim()) {
      const message = turnError(buffer);
      if (message) throw new IdentityError("conflict", message);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
