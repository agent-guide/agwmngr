import { randomUUID } from "node:crypto";
import { getPlatformRuntime } from "./platform-identity";
import type { ResolvedGateway } from "@/packages/contracts/gateway/connection";
import { gatewayRequestJSON } from "@/packages/gateway-client/admin";
import { AgentDeploymentRegistry } from "@/packages/platform/services/deployment-registry";

// A Gateway mutation can legitimately wait on an upstream handler. Keep the
// lease comfortably ahead of the heartbeat so a slow request cannot overlap a
// deployment apply after the original lease expires.
const ROUTE_MUTATION_LEASE_MS = 5 * 60_000;
const ROUTE_MUTATION_HEARTBEAT_MS = 60_000;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function mayWinPlatformPath(value: unknown, platformPath: string): boolean {
  const row = object(value);
  const match = object(row?.match_policy);
  if (!match) return true;
  if (row?.disabled === true) return false;
  const methods = Array.isArray(match.methods) ? match.methods.map(String) : [];
  if (methods.length && !methods.some((item) => item.toUpperCase() === "POST")) return false;
  const path = typeof match.path_prefix === "string" && match.path_prefix
    ? match.path_prefix : "/";
  return path === platformPath || path.startsWith(`${platformPath}/`);
}

export async function conflictsWithPlatformDeploymentPath(
  registry: AgentDeploymentRegistry,
  gatewayId: string,
  desired: unknown,
): Promise<boolean> {
  const deployments = await registry.listForGateway(gatewayId);
  return deployments.some((item) => mayWinPlatformPath(desired, item.target.pathPrefix));
}

async function desiredRoute(
  request: Request,
  gateway: ResolvedGateway,
  proxyPath: string,
): Promise<unknown | null> {
  if (request.method === "POST" && proxyPath.endsWith("/disable")) return null;
  if (request.method === "DELETE") return null;
  if (request.method === "POST" && proxyPath.endsWith("/enable")) {
    const path = proxyPath.slice(0, -"/enable".length);
    const result = await gatewayRequestJSON("GET", path, gateway, undefined, {
      signal: AbortSignal.timeout(10_000),
    });
    if (result.status < 200 || result.status >= 300) return {};
    return { ...object(result.body), disabled: false };
  }
  try { return await request.clone().json(); }
  catch { return {}; }
}

export async function withPlatformRouteMutationSafety(
  request: Request,
  gatewayId: string,
  gateway: ResolvedGateway,
  proxyPath: string,
  work: (signal: AbortSignal) => Promise<Response>,
): Promise<Response> {
  const { database } = await getPlatformRuntime();
  const registry = new AgentDeploymentRegistry(database);
  const ownerToken = `compat-route:${randomUUID()}`;
  const now = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + ROUTE_MUTATION_LEASE_MS).toISOString();
  if (!await registry.acquireGatewayLeases({ gatewayId, ownerToken, now, leaseUntil })) {
    return Response.json({ error: "Gateway route mutation is busy" }, { status: 409 });
  }

  const workController = new AbortController();
  const abortFromRequest = () => workController.abort(request.signal.reason);
  if (request.signal.aborted) abortFromRequest();
  else request.signal.addEventListener("abort", abortFromRequest, { once: true });

  let stopped = false;
  let leaseFailure: unknown;
  let renewal = Promise.resolve();
  const heartbeat = setInterval(() => {
    renewal = renewal.then(async () => {
      if (stopped || leaseFailure) return;
      const renewedAt = new Date().toISOString();
      const renewedUntil = new Date(Date.now() + ROUTE_MUTATION_LEASE_MS).toISOString();
      if (!await registry.acquireGatewayLeases({
        gatewayId,
        ownerToken,
        now: renewedAt,
        leaseUntil: renewedUntil,
      })) {
        throw new Error("Gateway route mutation lease was lost");
      }
    }).catch((error) => {
      leaseFailure = error;
      workController.abort(error);
    });
  }, ROUTE_MUTATION_HEARTBEAT_MS);
  try {
    const desired = await desiredRoute(request, gateway, proxyPath);
    if (desired !== null) {
      if (await conflictsWithPlatformDeploymentPath(registry, gatewayId, desired)) {
        return Response.json(
          { error: "Gateway route could intersect a platform deployment namespace" },
          { status: 409 },
        );
      }
    }
    const response = await work(workController.signal);
    await renewal;
    if (leaseFailure) {
      return Response.json({ error: "Gateway route mutation lease was lost" }, { status: 409 });
    }
    return response;
  } finally {
    stopped = true;
    clearInterval(heartbeat);
    request.signal.removeEventListener("abort", abortFromRequest);
    await renewal;
    await registry.releaseGatewayLeases(gatewayId, ownerToken, new Date().toISOString());
  }
}
