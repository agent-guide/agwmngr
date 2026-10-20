import type { ResolvedGateway } from "@/packages/contracts/gateway/connection";
import { gatewayRequestJSON } from "@/packages/gateway-client/admin";
import type { AgentDeploymentRegistry } from "@/packages/platform/services/deployment-registry";
import { IdentityError } from "@/packages/platform/services/identity";

type Json = Record<string, unknown>;

function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new IdentityError("conflict", "Gateway returned an invalid document");
  }
  return value as Json;
}

async function request(
  gateway: ResolvedGateway,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await gatewayRequestJSON(method, path, gateway, body, {
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, body: response.body };
}

async function listAll(gateway: ResolvedGateway, path: string): Promise<unknown[]> {
  const result: unknown[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const response = await request(
      gateway,
      "GET",
      `${path}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    if (response.status < 200 || response.status >= 300) {
      throw new IdentityError("conflict", `Gateway rejected GET ${path} (${response.status})`);
    }
    const page = object(response.body);
    if (!Array.isArray(page.items)) throw new IdentityError("conflict", "Gateway returned an invalid list");
    result.push(...page.items);
    cursor = typeof page.next_cursor === "string" && page.next_cursor
      ? page.next_cursor : undefined;
    if (cursor && seen.has(cursor)) throw new IdentityError("conflict", "Gateway repeated a cursor");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return result;
}

export class GatewayAgentCompatibilityService {
  constructor(private readonly deployments: AgentDeploymentRegistry) {}

  private async blocked(gatewayId: string) {
    const fences = await this.deployments.pairFencesForGateway(gatewayId);
    return {
      agents: new Set(fences.map((item) => item.gatewayAgentId)),
      routes: new Set(fences.map((item) => item.gatewayRouteId)),
    };
  }

  private async requireUnfenced(gatewayId: string, agentId: string, routeId?: string) {
    const blocked = await this.blocked(gatewayId);
    if (blocked.agents.has(agentId) || (routeId && blocked.routes.has(routeId))) {
      throw new IdentityError("conflict", "Gateway object is claimed by a platform deployment");
    }
  }

  async handle(input: {
    gatewayId: string;
    gateway: ResolvedGateway;
    method: string;
    path: string[];
    query: string;
    body?: unknown;
  }): Promise<Response> {
    const { gatewayId, gateway, method, path, query, body } = input;
    if (path.length === 0) {
      if (method === "GET") {
        const scanned = await listAll(gateway, "/admin/agents");
        const blocked = await this.blocked(gatewayId);
        const current = await this.blocked(gatewayId);
        const items = scanned.filter((value) => {
          const id = object(value).id;
          return typeof id === "string" && !blocked.agents.has(id) && !current.agents.has(id);
        });
        return Response.json({ items, total: items.length });
      }
      if (method === "POST") {
        const agentId = object(body).id;
        if (typeof agentId !== "string" || !agentId) {
          throw new IdentityError("invalid_input", "Agent id is required");
        }
        await this.requireUnfenced(gatewayId, agentId);
        const result = await request(gateway, method, "/admin/agents", body);
        return Response.json(result.body, { status: result.status });
      }
    }

    if (path[0] === "routes") {
      if (path.length === 1 && method === "GET") {
        const scanned = await listAll(gateway, "/admin/agents/routes");
        const blocked = await this.blocked(gatewayId);
        const current = await this.blocked(gatewayId);
        const items = scanned.filter((value) => {
          const row = object(value);
          return typeof row.id === "string" && typeof row.agent_id === "string" &&
            !blocked.routes.has(row.id) && !blocked.agents.has(row.agent_id) &&
            !current.routes.has(row.id) && !current.agents.has(row.agent_id);
        });
        return Response.json({ items, total: items.length });
      }
      if (path.length === 1 && method === "POST") {
        const row = object(body);
        if (typeof row.id !== "string" || typeof row.agent_id !== "string") {
          throw new IdentityError("invalid_input", "route id and agent_id are required");
        }
        await this.requireUnfenced(gatewayId, row.agent_id, row.id);
        const result = await request(gateway, method, "/admin/agents/routes", body);
        return Response.json(result.body, { status: result.status });
      }
      if (path.length === 2) {
        const routeId = path[1];
        const current = await request(
          gateway, "GET", `/admin/agents/routes/${encodeURIComponent(routeId)}`,
        );
        if (current.status < 200 || current.status >= 300) {
          return Response.json(current.body, { status: current.status });
        }
        const currentAgent = object(current.body).agent_id;
        if (typeof currentAgent !== "string") throw new IdentityError("conflict", "invalid Agent route");
        await this.requireUnfenced(gatewayId, currentAgent, routeId);
        if (method === "GET") return Response.json(current.body);
        const nextAgent = method === "PUT" ? object(body).agent_id : currentAgent;
        if (typeof nextAgent !== "string") throw new IdentityError("invalid_input", "agent_id is required");
        await this.requireUnfenced(gatewayId, nextAgent, routeId);
        const result = await request(
          gateway, method, `/admin/agents/routes/${encodeURIComponent(routeId)}`, body,
        );
        return result.status === 204
          ? new Response(null, { status: 204 })
          : Response.json(result.body, { status: result.status });
      }
    }

    const agentId = path[0];
    await this.requireUnfenced(gatewayId, agentId);
    const suffix = path.slice(1);
    const readSuffixes = new Set([
      "", "workspace", "capabilities", "health", "activity", "usage", "interactions",
      "resources", "sessions", "runs", "permissions",
    ]);
    const key = suffix.join("/");
    const permissionMutation = method === "POST" && suffix.length === 2 && suffix[0] === "permissions";
    const runCancellation = method === "DELETE" && suffix.length === 2 && suffix[0] === "runs";
    const agentMutation = suffix.length === 0 && (method === "PUT" || method === "DELETE");
    if ((method === "GET" && readSuffixes.has(key)) || permissionMutation ||
      runCancellation || agentMutation) {
      await this.requireUnfenced(gatewayId, agentId);
      const target = `/admin/agents/${path.map(encodeURIComponent).join("/")}${query}`;
      const result = await request(gateway, method, target, body);
      return result.status === 204
        ? new Response(null, { status: 204 })
        : Response.json(result.body, { status: result.status });
    }
    throw new IdentityError("not_found", "Gateway Agent compatibility route not found");
  }
}
