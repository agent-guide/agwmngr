# manager

Bun + Next.js + TypeScript web management frontend for [agent-gateway](../../agent-gateway/).

The manager provides a dashboard UI and a thin backend API layer (Next.js Route Handlers) that:

- authenticates manager users with its own session system
- proxies most `/api/admin/*` requests to the agent-gateway Admin API
- manages Caddy HTTP servers and routes directly through the Caddy admin API

The upstream agent-gateway Admin API reference is in `~/github/agent-guide/agent-gateway/README.md`.

## Build and Run

```bash
bun install
bun run dev          # development server (port 3000)
bun run build        # production build
bun run start        # production server
bun run lint         # ESLint
```

The backend API and frontend are served from the same Next.js process on the same port.

## Tech Stack

- **Runtime**: Bun
- **Framework**: Next.js 16.2.4 (App Router, Webpack)
- **Language**: TypeScript 5
- **Styling**: Tailwind CSS 4
- **Data fetching**: SWR (dependency installed; pages currently use useState + useEffect)
- **Charts**: Recharts (dependency installed; not actively used yet)

## Architecture

```
manager/
├── app/
│   ├── api/admin/                    ← Backend: all Route Handlers
│   │   ├── auth/                     ← Manager session auth (login/logout/me)
│   │   ├── caddy/servers/            ← Caddy HTTP server/route CRUD
│   │   ├── health/                   ← Unauthenticated health check
│   │   └── [[...path]]/              ← Catch-all proxy to agent-gateway Admin API
│   ├── login/                        ← Login page
│   ├── dashboard/
│   │   ├── layout.tsx                ← Dashboard shell with auth guard + nav
│   │   └── general/                  ← Overview, Virtual Keys, Usage pages
│   │       └── llm/                  ← Providers, Models, Credentials, Routes pages
│   │       └── mcp/                  ← MCP Services (+ inspect), Routes pages
│   │       └── acp/                  ← ACP Services (+ sessions), Routes, Runtime pages
│   │       └── configuration/        ← Gateway, Servers pages
│   ├── layout.tsx                    ← Root layout (fonts, globals)
│   └── page.tsx                      ← Redirects to /dashboard
├── components/
│   ├── dashboard-*.tsx               ← Layout shell, nav, header, user panel
│   ├── auth-guard.tsx                ← Session validation wrapper
│   ├── mobile-*.tsx                  ← Mobile sidebar context + top bar
│   └── ui/                           ← Reusable UI primitives (button, input, modal, toast, etc.)
├── hooks/
│   └── use-focus-trap.ts             ← Focus trap for modal accessibility
└── lib/
    ├── api.ts                        ← Frontend typed fetch helpers + gateway Admin API wrappers
    ├── auth.ts                       ← localStorage session helpers (token, username)
    ├── caddy-manager.ts              ← Caddy admin API client for server/route CRUD
    ├── gateway-proxy.ts              ← Gateway admin API proxy with session caching
    ├── require-auth.ts               ← Bearer token extraction + requireAuth middleware
    ├── server-env.ts                 ← Raw .env.local parser (avoids $VAR expansion)
    ├── session.ts                    ← Server-side in-memory session store (globalThis Map)
    ├── types.ts                      ← Shared types: ServerRequest, RouteRequest, Caddy internals, AppError
    └── utils.ts                      ← cn() Tailwind merge, extractApiError()
```

## Relationship To Other Projects

- **agent-gateway** (`~/github/agent-guide/agent-gateway/`): the AI gateway runtime. The manager is its dedicated web management frontend. Most dashboard pages interact with the gateway by proxying `/api/admin/*` requests to the gateway Admin API.
- **caddy-runtime** (`../caddy-runtime/`): the custom Caddy binary distribution that bundles `agent-gateway`. The manager talks to its Caddy admin API for server/route management.
- **plugins** (`../plugins/`): Caddy module plugins for the runtime. Manager does not interact with plugins directly; new plugin-backed capabilities should be exposed through the gateway Admin API first.
- `manager` does not implement Caddy modules or gateway business logic. It orchestrates management through documented HTTP boundaries.

## Environment Variables

Defined in `.env.local`:

| Variable | Default | Description |
|---|---|---|
| `CADDYMGR_ADMIN_USER` | — | Manager admin username |
| `CADDYMGR_ADMIN_PASSWORD_HASH` | — | bcrypt hash of admin password |
| `CADDY_ADMIN_ADDR` | `http://localhost:2019` | Caddy admin API address |
| `GATEWAY_ADDR` | `http://localhost:8019` | Agent-gateway Admin API address |
| `GATEWAY_DATAPLANE_ADDR` | `http://127.0.0.1:8080` | Gateway data-plane address (runtime public listener) for ACP chat turns/permissions. Host must match the dispatcher site's host matcher (commonly `127.0.0.1`, while the admin site binds `localhost`) |
| `GATEWAY_ADMIN_USER` | — | Gateway proxy auth username |
| `GATEWAY_ADMIN_PASSWORD` | — | Gateway proxy auth password |
| `CADDYMGR_READONLY_SERVER_IDS` | — | Comma-separated Caddy server IDs that are read-only |
| `NEXT_PUBLIC_API_BASE_URL` | `""` | Frontend API base URL (empty = same origin) |

`lib/server-env.ts` reads `.env.local` with raw file parsing to avoid Next.js `$VAR` shell expansion corrupting bcrypt hashes.

## Backend API (Route Handlers)

All routes are under `/api/admin/`. Every route except `/api/admin/health` and `/api/admin/auth/login` requires `Authorization: Bearer <token>`.

### Health

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/health` | Unauthenticated health check |

### Auth

| Method | Path | Description |
|---|---|---|
| POST | `/api/admin/auth/login` | Validate username + bcrypt password, return session token |
| POST | `/api/admin/auth/logout` | Revoke session token |
| GET | `/api/admin/auth/me` | Return current session info |

Session tokens are random hex strings stored in an in-process `globalThis` Map. Authenticate with `requireAuth()` from `lib/require-auth.ts`.

### Caddy Server and Route Management

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/caddy/servers` | List Caddy HTTP servers |
| POST | `/api/admin/caddy/servers` | Create a server |
| GET | `/api/admin/caddy/servers/[id]` | Get a server |
| PUT | `/api/admin/caddy/servers/[id]` | Update a server |
| DELETE | `/api/admin/caddy/servers/[id]` | Delete a server |
| GET | `/api/admin/caddy/servers/[id]/routes` | List routes for a server |
| POST | `/api/admin/caddy/servers/[id]/routes` | Add a route |
| PUT | `/api/admin/caddy/servers/[id]/routes/[routeId]` | Update a route |
| DELETE | `/api/admin/caddy/servers/[id]/routes/[routeId]` | Delete a route |

These endpoints translate between the manager's `ServerRequest`/`RouteRequest` types and Caddy's internal JSON config. Rules:
- Servers listed in `CADDYMGR_READONLY_SERVER_IDS`, whose routes contain `agent_gateway_admin` handlers, or whose routes lack a `group` field (Caddyfile-defined), are read-only — return 403.
- Mutations use a get-modify-post cycle against the Caddy admin API (`GET /config/` + `POST /config/`). Only paths under `/apps/http/servers` are allowed.

### Gateway Proxy Catch-All

Any `/api/admin/*` request not matched by the above handlers is proxied to the agent-gateway Admin API at `GATEWAY_ADDR`. The gateway delegates admin auth to the HTTP layer (Caddy `basic_auth` or the standalone daemon's basic-auth wrapper) — there is no gateway login/session/token flow. The proxy (`lib/gateway-proxy.ts`):
1. Strips any inbound `Authorization` header and replaces it with static HTTP Basic Auth built from `GATEWAY_ADMIN_USER`/`GATEWAY_ADMIN_PASSWORD` before forwarding.
2. Tries the configured `GATEWAY_ADDR` then its `localhost`↔`127.0.0.1` alternate on connection failure, caching the base URL that connects in `globalThis`. A gateway `401` means bad credentials and is passed through to the caller unchanged (no re-auth retry).
3. Sanitizes request and response headers (removes CORS, content-encoding, hop-by-hop headers).

Proxied gateway Admin API endpoints include (see agent-gateway README for full reference):

- Providers: `GET/POST /providers`, `GET/PUT/DELETE /providers/{id}`, enable/disable
- Provider types: `GET /provider_types`, enable/disable
- LLM routes: `GET/POST /llm/routes`, `GET/PUT/DELETE /llm/routes/{id}`, enable/disable
- Virtual keys: `GET/POST /virtual_keys`, `GET/PUT/DELETE /virtual_keys/{key}`, enable/disable
- Credentials: `GET/POST /credentials`, `GET/PUT/DELETE /credentials/{credential_id}`
- Models: discovered models, managed models, logical models
- CLI auth: authenticators config, login flows, refresher status
- MCP services: `GET/POST /mcp/services`, `GET/PUT/DELETE /mcp/services/{id}`, plus `/capabilities`, `/sessions`, `/tools`, `/tools/call`, `/resources`, `/resource-templates`, `/resources/read`, `/prompts`
- MCP routes: `GET/POST /mcp/routes`, `GET/PUT/DELETE /mcp/routes/{id}` (id auto-generated as `mcp:<service_id>:<path_prefix>`)
- MCP runtime: `GET /mcp/runtime`, `/mcp/runtime/inflight`, `/mcp/runtime/progress`, `/mcp/runtime/history`
- ACP services: `GET/POST /acp/services`, `GET/PUT/DELETE /acp/services/{id}`, plus `/sessions` and `/sessions/{session_id}/transcript`
- ACP routes: `GET/POST /acp/routes`, `GET/PUT/DELETE /acp/routes/{id}` (id auto-generated as `acp:<service_id>:<path_prefix>`)
- ACP runtime: `GET /acp/runtime`, `GET /acp/runtime/inflight`, `POST /acp/runtime/permissions/{request_id}` (resolve), `DELETE /acp/runtime/threads/{service_id}/{thread_id}` (close)
- Memory, Agents, Metrics: registered but return 501

### ACP Chat Data-Plane Proxy

Driving an ACP conversation is a **data-plane** operation (on the runtime's public listener at `GATEWAY_DATAPLANE_ADDR`), not an Admin API one. Two explicit Route Handlers bridge the browser to it (they take precedence over the catch-all):

| Method | Path | Description |
|---|---|---|
| POST | `/api/admin/acp/chat/turn` | Resolve the ACP route via the Admin API, then forward a turn to `<dataplane>/<route_path_prefix>/turn` and stream the SSE response back to the browser |
| POST | `/api/admin/acp/chat/permission` | Resolve an interactive permission at `<dataplane>/<route_path_prefix>/permission` |

Both require a manager session, resolve the route's `path_prefix`/`host`/`require_virtual_key` server-side (`lib/acp-dataplane.ts` via `gatewayRequestJSON`), and inject the caller-selected virtual key as the data-plane `Authorization` so it never lives in the browser. The SSE event names are `session`, `delta`, `reasoning`, `content`, `plan`, `tool_call`, `usage`, `permission`, `done`, `error` (see `lib/acp-chat-stream.ts`).

## Frontend (App Router Pages)

The entry route (`/`) redirects to `/dashboard`, which redirects to `/dashboard/general/overview`.

### Navigation Structure

**General:**
- Overview (`/dashboard/general/overview`) — status cards, quick start guide, integration snippets
- Virtual Keys (`/dashboard/general/virtual-keys`) — CRUD for virtual keys with route restrictions
- Usage (`/dashboard/general/usage`) — usage statistics (currently mock data)

**LLM:**
- Providers (`/dashboard/llm/providers`) — CRUD for LLM providers
- Models (`/dashboard/llm/models`) — CRUD for managed models
- Credentials (`/dashboard/llm/credentials`) — CRUD for upstream credentials + CLI auth login flow
- Routes (`/dashboard/llm/routes`) — CRUD for gateway LLM routes (direct-provider + logical-model targets)

**MCP:**
- Services (`/dashboard/mcp/services`) — CRUD for MCP services (stdio/sse/streamable_http transports, env, auth) + inspect modal (capabilities, tools, tool-call, resources, resource-read, prompts, session)
- Routes (`/dashboard/mcp/routes`) — CRUD for MCP routes (service binding, match policy, auth policy)

**ACP:**
- Chat (`/dashboard/acp/chat`) — interactive conversation with an ACP agent over a selected route + virtual key: streamed text/reasoning/tool-calls/plan, interactive permission cards, session resume + new session, transcript history (data-plane SSE via the chat proxy)
- Services (`/dashboard/acp/services`) — CRUD for ACP agent services (codex/opencode, cwd, allowed roots, env vars, permission mode, idle TTL, config overrides, codex adapter settings) + sessions/transcript modal
- Routes (`/dashboard/acp/routes`) — CRUD for ACP routes (service binding, match policy, auth policy)
- Runtime (`/dashboard/acp/runtime`) — pooled instances, in-flight turns, pending permission resolution, close-thread

**Configuration:**
- Gateway (`/dashboard/configuration/gateway`) — provider type toggles, CLI authenticator config, refresher control
- Servers (`/dashboard/configuration/servers`) — Caddy HTTP server management, TLS, route dispatcher config

### Frontend Conventions

- `lib/auth.ts`: localStorage helpers — `getToken()`, `saveSession()`, `clearSession()`, `isAuthenticated()`.
- `lib/api.ts`: typed `adminFetch<T>()` wrapper that injects `Authorization: Bearer <token>`, auto-redirects to `/login` on 401. Also contains typed wrapper functions for all gateway Admin API resources (providers, credentials, models, CLI auth, MCP services/routes/runtime, ACP services/routes/runtime, etc.).
- `components/auth-guard.tsx`: validates session via `GET /admin/auth/me`, protects dashboard routes.
- All dashboard pages use `AuthGuard` from the dashboard layout.

## Key Types

From `lib/types.ts`:

```typescript
// Caddy server management
interface ServerRequest { id: string; listen: string[]; tls?: TLSConf }
interface TLSConf { auto?: boolean; cert_file?: string; key_file?: string }
interface ServerResponse { id: string; listen: string[]; routes?: RouteResponse[]; readonly?: boolean; source?: string; public_url?: string }

// Caddy route management
interface RouteRequest { id: string; order: number; match: MatchConf; handlers: HandlerConf[] }
interface MatchConf { paths?: string[]; hosts?: string[] }
interface HandlerConf { type: string; apis?: string[]; upstream?: string; root?: string }
interface RouteResponse { id: string; order: number; match: MatchConf; handlers: HandlerConf[] }

// Caddy internal JSON (for caddy-manager.ts translation)
interface CaddyServer { listen: string[]; routes?: CaddyRoute[]; ... }
interface CaddyRoute { group?: string; match: CaddyMatch[]; handle: CaddyHandler[]; ... }

// Error helpers
class AppError { status: number; message: string }
```

Gateway resource types (providers, credentials, models, virtual keys, routes, CLI auth) are defined inline in `lib/api.ts` alongside their API functions.

## Error Handling

Backend handlers return `{ error: string }` JSON on failure:
- 400 Bad Request — invalid input
- 401 Unauthorized — not authenticated
- 403 Forbidden — read-only resource
- 404 Not Found — resource does not exist
- 409 Conflict — resource already exists
- 502 Bad Gateway — Caddy admin or gateway unreachable
- 500 Internal Server Error — unexpected failure

## Known Gaps

- **Usage page**: uses mock data, no real API integration.
- **Change password**: UI exists in user panel but no backend endpoint.
- **SWR / Recharts**: declared as dependencies but not actively used in current pages.
