import { getGateway } from "./db";
import { resolveGateway } from "./gateway-resolve";
import type { AgentPayload } from "@/packages/contracts/gateway/agents";
import { gatewayRequestJSON } from "@/packages/gateway-client/admin";
import type {
  GatewayAgentRouteDocument,
  GatewayDeploymentAdapter,
  GatewayVirtualKeyPolicy,
} from "@/packages/platform/ports/deployment";
import { IdentityError } from "@/packages/platform/services/identity";

const timeoutMs = 10_000;

function connection(gatewayId: string) {
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

async function request(
  gatewayId: string,
  method: string,
  path: string,
  body?: unknown,
  optional = false,
): Promise<unknown | null> {
  let result: Awaited<ReturnType<typeof gatewayRequestJSON>>;
  try {
    result = await gatewayRequestJSON(method, path, connection(gatewayId), body, {
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new IdentityError("conflict", "target Gateway is unavailable");
  }
  if (optional && result.status === 404) return null;
  if (result.status < 200 || result.status >= 300) {
    throw new IdentityError(
      "conflict",
      `Gateway rejected ${method} ${path.split("?")[0]} (${result.status})`,
    );
  }
  return result.body ?? null;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new IdentityError("conflict", `Gateway returned an invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function virtualKey(value: unknown): GatewayVirtualKeyPolicy {
  const row = object(value, "Virtual Key");
  if (typeof row.id !== "string") {
    throw new IdentityError("conflict", "Gateway returned an invalid Virtual Key");
  }
  return {
    id: row.id,
    ...(typeof row.tag === "string" ? { tag: row.tag } : {}),
    ...(typeof row.description === "string" ? { description: row.description } : {}),
    disabled: row.disabled === true,
    allowed_route_ids: Array.isArray(row.allowed_route_ids)
      ? row.allowed_route_ids.filter((item): item is string => typeof item === "string")
      : [],
    ...(row.rate_limits && typeof row.rate_limits === "object"
      ? { rate_limits: row.rate_limits } : {}),
    ...(typeof row.status_message === "string" ? { status_message: row.status_message } : {}),
    ...(typeof row.expires_at === "string" ? { expires_at: row.expires_at } : {}),
  };
}

async function listItems(gatewayId: string, path: string): Promise<unknown[]> {
  const items: unknown[] = [];
  let cursor: string | undefined;
  const visited = new Set<string>();
  do {
    const separator = path.includes("?") ? "&" : "?";
    const body = object(await request(
      gatewayId,
      "GET",
      cursor ? `${path}${separator}cursor=${encodeURIComponent(cursor)}` : path,
    ), "collection");
    if (!Array.isArray(body.items)) {
      throw new IdentityError("conflict", "Gateway returned an invalid collection");
    }
    items.push(...body.items);
    const next = typeof body.next_cursor === "string" && body.next_cursor
      ? body.next_cursor : undefined;
    if (next && visited.has(next)) {
      throw new IdentityError("conflict", "Gateway returned a repeated collection cursor");
    }
    if (next) visited.add(next);
    cursor = next;
  } while (cursor);
  return items;
}

function route(value: unknown): GatewayAgentRouteDocument {
  return object(value, "Agent route") as unknown as GatewayAgentRouteDocument;
}

function writableRoute(value: GatewayAgentRouteDocument) {
  return {
    id: value.id,
    protocol: value.protocol,
    ...(value.description ? { description: value.description } : {}),
    disabled: value.disabled,
    match_policy: value.match_policy,
    auth_policy: value.auth_policy,
    agent_id: value.agent_id,
  };
}

export const platformDeploymentGateway: GatewayDeploymentAdapter = {
  async readAgent(gatewayId, agentId) {
    return await request(
      gatewayId,
      "GET",
      `/admin/agents/${encodeURIComponent(agentId)}`,
      undefined,
      true,
    ) as AgentPayload | null;
  },
  async createAgent(gatewayId, value) {
    return object(
      await request(gatewayId, "POST", "/admin/agents", value),
      "Agent",
    ) as unknown as AgentPayload;
  },
  async updateAgent(gatewayId, agentId, value) {
    return object(await request(
      gatewayId,
      "PUT",
      `/admin/agents/${encodeURIComponent(agentId)}`,
      value,
    ), "Agent") as unknown as AgentPayload;
  },
  async deleteAgent(gatewayId, agentId) {
    await request(gatewayId, "DELETE", `/admin/agents/${encodeURIComponent(agentId)}`);
  },
  async readAgentRoute(gatewayId, routeId) {
    const value = await request(
      gatewayId,
      "GET",
      `/admin/agents/routes/${encodeURIComponent(routeId)}`,
      undefined,
      true,
    );
    return value === null ? null : route(value);
  },
  async createAgentRoute(gatewayId, value) {
    return route(await request(gatewayId, "POST", "/admin/agents/routes", writableRoute(value)));
  },
  async updateAgentRoute(gatewayId, routeId, value) {
    return route(await request(
      gatewayId,
      "PUT",
      `/admin/agents/routes/${encodeURIComponent(routeId)}`,
      writableRoute(value),
    ));
  },
  async deleteAgentRoute(gatewayId, routeId) {
    await request(gatewayId, "DELETE", `/admin/agents/routes/${encodeURIComponent(routeId)}`);
  },
  async listAgentRoutes(gatewayId) {
    return (await listItems(gatewayId, "/admin/agents/routes")).map(route);
  },
  listLLMRoutes: (gatewayId) => listItems(gatewayId, "/admin/llm/routes"),
  listMCPRoutes: (gatewayId) => listItems(gatewayId, "/admin/mcp/routes"),
  async listVirtualKeys(gatewayId) {
    return (await listItems(gatewayId, "/admin/virtual_keys")).map(virtualKey);
  },
  async readVirtualKey(gatewayId, keyId) {
    const value = await request(
      gatewayId,
      "GET",
      `/admin/virtual_keys/${encodeURIComponent(keyId)}`,
      undefined,
      true,
    );
    return value === null ? null : virtualKey(value);
  },
  async updateVirtualKey(gatewayId, keyId, value) {
    return virtualKey(await request(
      gatewayId,
      "PUT",
      `/admin/virtual_keys/${encodeURIComponent(keyId)}`,
      value,
    ));
  },
  async setVirtualKeyEnabled(gatewayId, keyId, enabled) {
    return virtualKey(await request(
      gatewayId,
      "POST",
      `/admin/virtual_keys/${encodeURIComponent(keyId)}/${enabled ? "enable" : "disable"}`,
    ));
  },
};
