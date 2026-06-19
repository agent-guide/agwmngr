import {
  AppError,
  ErrConflict,
  ErrNotFound,
  ErrReadOnly,
  type CaddyHandler,
  type CaddyMatch,
  type CaddyRoute,
  type CaddyServer,
  type HandlerConf,
  type MatchConf,
  type RouteRequest,
  type RouteResponse,
  type ServerRequest,
  type ServerResponse,
} from "./types";

const ALLOWED_PREFIXES = ["/apps/http/servers"];

function checkAllowed(path: string): void {
  for (const prefix of ALLOWED_PREFIXES) {
    if (path.startsWith(prefix)) return;
  }
  throw new AppError(400, `config path "${path}" is not allowed`);
}

function caddyAdminAddr(): string {
  return (process.env.CADDY_ADMIN_ADDR ?? "http://localhost:2019").replace(/\/$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function caddyGET(path: string): Promise<unknown> {
  checkAllowed(path);
  const res = await fetch(`${caddyAdminAddr()}/config${path}`);
  if (res.status === 404) throw new AppError(404, ErrNotFound);
  if (!res.ok) {
    const text = await res.text();
    throw new AppError(502, `caddy admin error ${res.status}: ${text.trim()}`);
  }
  return res.json();
}

async function getFullConfig(): Promise<Record<string, unknown>> {
  const res = await fetch(`${caddyAdminAddr()}/config/`);
  if (!res.ok) {
    const text = await res.text();
    throw new AppError(502, `caddy admin error ${res.status}: ${text.trim()}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

async function postFullConfig(cfg: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${caddyAdminAddr()}/config/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cfg),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new AppError(502, `caddy admin error ${res.status}: ${text.trim()}`);
  }
}

function setAtPath(obj: Record<string, unknown>, path: string, val: unknown): void {
  const parts = path.replace(/^\//, "").split("/");
  let cur: Record<string, unknown> = obj;
  for (const part of parts.slice(0, -1)) {
    if (typeof cur[part] !== "object" || cur[part] === null) cur[part] = {};
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = val;
}

function deleteAtPath(obj: Record<string, unknown>, path: string): void {
  const parts = path.replace(/^\//, "").split("/");
  let cur: Record<string, unknown> = obj;
  for (const part of parts.slice(0, -1)) {
    if (typeof cur[part] !== "object" || cur[part] === null) return;
    cur = cur[part] as Record<string, unknown>;
  }
  delete cur[parts[parts.length - 1]];
}

async function caddyPUT(path: string, val: unknown): Promise<void> {
  checkAllowed(path);
  const cfg = await getFullConfig();
  setAtPath(cfg, path, val);
  await postFullConfig(cfg);
}

async function caddyDELETE(path: string): Promise<void> {
  checkAllowed(path);
  const cfg = await getFullConfig();
  deleteAtPath(cfg, path);
  await postFullConfig(cfg);
}

// ── Translation helpers ───────────────────────────────────────────────────────

function readOnlyServerIds(): Set<string> {
  const raw = process.env.CADDYMGR_READONLY_SERVER_IDS ?? "";
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return new Set(ids);
}

function routeContainsAdminHandler(route: CaddyRoute): boolean {
  return route.handle.some((h) => handlerContainsAdmin(h));
}

function handlerContainsAdmin(h: CaddyHandler): boolean {
  if (h["handler"] === "agent_gateway_admin") return true;
  if (h["handler"] !== "subroute") return false;
  const rawRoutes = h["routes"];
  if (!Array.isArray(rawRoutes)) return false;
  return (rawRoutes as CaddyHandler[]).some((r) => {
    const nested = r as unknown as CaddyRoute;
    return routeContainsAdminHandler(nested);
  });
}

function isProtectedServer(id: string, srv: CaddyServer): boolean {
  if (readOnlyServerIds().has(id)) return true;
  for (const route of srv.routes ?? []) {
    if (routeContainsAdminHandler(route)) return true;
    if (!route.group) return true;
  }
  return false;
}

function derivePublicURL(listen: string[], hasTLS: boolean): string {
  if (!listen.length) return "";
  let addr = listen[0].trim();
  if (!addr) return "";
  if (addr.startsWith(":")) addr = "127.0.0.1" + addr;
  return `${hasTLS ? "https" : "http"}://${addr}/`;
}

function appendUnique(dst: string[], ...values: string[]): string[] {
  const seen = new Set(dst);
  for (const v of values) {
    if (v && !seen.has(v)) { dst.push(v); seen.add(v); }
  }
  return dst;
}

function toCaddyHandler(h: HandlerConf): CaddyHandler {
  switch (h.type) {
    case "agent_route_dispatcher": {
      const apiHandlers: Record<string, unknown> = {};
      for (const name of h.apis ?? []) {
        if (name) apiHandlers[name] = {};
      }
      return { handler: "agent_route_dispatcher", api_handlers: apiHandlers };
    }
    case "admin":
      return { handler: "agent_gateway_admin" };
    case "reverse_proxy":
      return { handler: "reverse_proxy", upstreams: [{ dial: h.upstream }] };
    case "file_server":
      return { handler: "file_server", root: h.root };
    default:
      return { handler: h.type };
  }
}

function fromCaddyHandler(h: CaddyHandler): HandlerConf {
  const type = h["handler"] as string;
  switch (type) {
    case "agent_route_dispatcher": {
      const apiHandlers = h["api_handlers"] as Record<string, unknown> | undefined;
      const apis = Object.keys(apiHandlers ?? {}).sort();
      return { type: "agent_route_dispatcher", apis };
    }
    case "agent_gateway_admin":
      return { type: "admin" };
    case "reverse_proxy": {
      const ups = h["upstreams"] as Array<Record<string, unknown>> | undefined;
      const upstream = (ups?.[0]?.["dial"] as string | undefined) ?? "";
      return { type: "reverse_proxy", upstream };
    }
    case "file_server":
      return { type: "file_server", root: (h["root"] as string | undefined) ?? "" };
    default:
      return { type: type ?? "" };
  }
}

function extractMatchFromHandler(h: CaddyHandler): MatchConf {
  if (h["handler"] !== "subroute") return {};
  const rawRoutes = h["routes"];
  if (!Array.isArray(rawRoutes)) return {};
  const match: MatchConf = {};
  for (const r of rawRoutes as unknown[]) {
    const nested = r as CaddyRoute;
    const m = extractMatchFromRoute(nested);
    match.paths = appendUnique(match.paths ?? [], ...(m.paths ?? []));
    match.hosts = appendUnique(match.hosts ?? [], ...(m.hosts ?? []));
  }
  return match;
}

function extractMatchFromRoute(r: CaddyRoute): MatchConf {
  const match: MatchConf = {};
  for (const rm of r.match ?? []) {
    match.paths = appendUnique(match.paths ?? [], ...(rm.path ?? []));
    match.hosts = appendUnique(match.hosts ?? [], ...(rm.host ?? []));
  }
  for (const h of r.handle) {
    const nested = extractMatchFromHandler(h);
    match.paths = appendUnique(match.paths ?? [], ...(nested.paths ?? []));
    match.hosts = appendUnique(match.hosts ?? [], ...(nested.hosts ?? []));
  }
  return match;
}

function extractHandlersFromHandler(h: CaddyHandler): HandlerConf[] {
  if (h["handler"] !== "subroute") return [fromCaddyHandler(h)];
  const rawRoutes = h["routes"];
  if (!Array.isArray(rawRoutes)) return [];
  const result: HandlerConf[] = [];
  for (const r of rawRoutes as unknown[]) {
    result.push(...extractHandlersFromRoute(r as CaddyRoute));
  }
  return result;
}

function extractHandlersFromRoute(r: CaddyRoute): HandlerConf[] {
  return r.handle.flatMap((h) => extractHandlersFromHandler(h));
}

function fromCaddyRoute(idx: number, r: CaddyRoute): RouteResponse {
  return {
    id: r.group ?? "",
    order: idx,
    match: extractMatchFromRoute(r),
    handlers: extractHandlersFromRoute(r),
  };
}

function normalizeCaddyServer(raw: unknown): CaddyServer {
  if (!isRecord(raw)) {
    return { listen: [] };
  }

  const listen = Array.isArray(raw["listen"]) ? raw["listen"].filter((v): v is string => typeof v === "string") : [];
  const routes = Array.isArray(raw["routes"]) ? (raw["routes"] as CaddyRoute[]) : [];
  const tls = isRecord(raw["tls"]) ? (raw["tls"] as CaddyServer["tls"]) : undefined;

  return { listen, routes, tls };
}

function fromCaddyServer(id: string, srv: CaddyServer): ServerResponse {
  const readonly = isProtectedServer(id, srv);
  const resp: ServerResponse = {
    id,
    listen: srv.listen ?? [],
    readonly,
    routes: (srv.routes ?? []).map((r, i) => fromCaddyRoute(i, r)),
  };
  if (readonly) {
    resp.source =
      readOnlyServerIds().has(id) || (srv.routes ?? []).some((r) => !r.group)
        ? "caddyfile"
        : "system";
    resp.public_url = derivePublicURL(srv.listen, !!srv.tls);
  }
  return resp;
}

function toCaddyServer(req: ServerRequest, routes: CaddyRoute[]): CaddyServer {
  const srv: CaddyServer = { listen: req.listen, routes };
  if (req.tls?.auto) {
    srv.tls = { automation: { policies: [{}] } };
  }
  return srv;
}

function toCaddyRoute(req: RouteRequest): CaddyRoute {
  const handle = (req.handlers ?? []).map(toCaddyHandler);
  const route: CaddyRoute = { group: req.id, terminal: true, handle };
  if ((req.match.paths?.length ?? 0) > 0 || (req.match.hosts?.length ?? 0) > 0) {
    const m: CaddyMatch = {};
    if (req.match.paths?.length) m.path = req.match.paths;
    if (req.match.hosts?.length) m.host = req.match.hosts;
    route.match = [m];
  }
  return route;
}

async function getRawServer(id: string): Promise<CaddyServer> {
  const raw = await caddyGET(`/apps/http/servers/${id}`);
  return normalizeCaddyServer(raw);
}

async function ensureServerMutable(id: string): Promise<void> {
  const srv = await getRawServer(id);
  if (isProtectedServer(id, srv)) {
    throw new AppError(403, `server "${id}" is managed by Caddyfile/system config and is read-only: ${ErrReadOnly}`);
  }
}

function isEmptyCaddyServer(srv: CaddyServer): boolean {
  return !srv.listen?.length && !srv.routes?.length && !srv.tls;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function listServers(): Promise<ServerResponse[]> {
  const raw = await caddyGET("/apps/http/servers");
  if (!isRecord(raw)) return [];

  return Object.entries(raw)
    .filter(([, srv]) => srv !== null)
    .map(([id, srv]) => fromCaddyServer(id, normalizeCaddyServer(srv)));
}

export async function getServer(id: string): Promise<ServerResponse> {
  const srv = await getRawServer(id);
  return fromCaddyServer(id, srv);
}

export async function createServer(req: ServerRequest): Promise<void> {
  if (!req.id) throw new AppError(400, "server id is required");
  if (!req.listen?.length) throw new AppError(400, "at least one listen address is required");
  if (readOnlyServerIds().has(req.id)) {
    throw new AppError(403, `server "${req.id}" is managed by Caddyfile config and is read-only: ${ErrReadOnly}`);
  }
  try {
    const existing = await getRawServer(req.id);
    if (!isEmptyCaddyServer(existing)) {
      throw new AppError(409, `server "${req.id}" already exists: ${ErrConflict}`);
    }
  } catch (e) {
    if (e instanceof AppError && e.message.includes(ErrNotFound)) {
      // ok — does not exist yet
    } else {
      throw e;
    }
  }
  await caddyPUT(`/apps/http/servers/${req.id}`, toCaddyServer(req, []));
}

export async function updateServer(req: ServerRequest): Promise<void> {
  if (!req.id) throw new AppError(400, "server id is required");
  if (!req.listen?.length) throw new AppError(400, "at least one listen address is required");
  await ensureServerMutable(req.id);
  const existing = await getRawServer(req.id);
  await caddyPUT(`/apps/http/servers/${req.id}`, toCaddyServer(req, existing.routes ?? []));
}

export async function deleteServer(id: string): Promise<void> {
  await ensureServerMutable(id);
  await caddyDELETE(`/apps/http/servers/${id}`);
}

export async function listRoutes(serverID: string): Promise<RouteResponse[]> {
  let raw: unknown;
  try {
    raw = await caddyGET(`/apps/http/servers/${serverID}/routes`);
  } catch (e) {
    if (e instanceof AppError && e.message.includes(ErrNotFound)) {
      await getRawServer(serverID); // throws 404 if server itself not found
      return [];
    }
    throw e;
  }
  const routes = raw as CaddyRoute[];
  return routes.map((r, i) => fromCaddyRoute(i, r));
}

export async function addRoute(serverID: string, req: RouteRequest): Promise<void> {
  if (!req.id) throw new AppError(400, "route id is required");
  await ensureServerMutable(serverID);
  const srv = await getRawServer(serverID);
  const existing = srv.routes ?? [];
  if (existing.some((r) => r.group === req.id)) {
    throw new AppError(409, `route "${req.id}" already exists in server "${serverID}": ${ErrConflict}`);
  }
  const newRoute = toCaddyRoute(req);
  let pos = req.order ?? 0;
  if (pos < 0) pos = 0;
  if (pos > existing.length) pos = existing.length;
  const updated = [...existing.slice(0, pos), newRoute, ...existing.slice(pos)];
  await caddyPUT(`/apps/http/servers/${serverID}/routes`, updated);
}

export async function updateRoute(serverID: string, routeID: string, req: RouteRequest): Promise<void> {
  await ensureServerMutable(serverID);
  const srv = await getRawServer(serverID);
  const existing = srv.routes ?? [];
  const idx = existing.findIndex((r) => r.group === routeID);
  if (idx === -1) {
    throw new AppError(404, `route "${routeID}" not found in server "${serverID}": ${ErrNotFound}`);
  }
  const updated = [...existing];
  updated[idx] = { ...toCaddyRoute(req), group: routeID };
  await caddyPUT(`/apps/http/servers/${serverID}/routes`, updated);
}

export async function deleteRoute(serverID: string, routeID: string): Promise<void> {
  await ensureServerMutable(serverID);
  const srv = await getRawServer(serverID);
  const existing = srv.routes ?? [];
  const filtered = existing.filter((r) => r.group !== routeID);
  if (filtered.length === existing.length) {
    throw new AppError(404, `route "${routeID}" not found in server "${serverID}": ${ErrNotFound}`);
  }
  await caddyPUT(`/apps/http/servers/${serverID}/routes`, filtered);
}
