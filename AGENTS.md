# manager

Bun + Next.js + TypeScript web management frontend for [agent-gateway](../../agent-gateway/).

The manager provides a dashboard UI and a thin backend API layer (Next.js Route Handlers) that:

- authenticates manager users against a persisted `users` table with its own sqlite-backed session system
- supports **multiple manager users** with two-layer RBAC (platform admins + per-gateway operator/viewer roles)
- manages **multiple agent-gateways** from one manager (a header switcher selects the active gateway per session)
- proxies most `/api/admin/*` requests to the **active gateway's** Admin API
- manages Caddy HTTP servers and routes through the active gateway's Caddy admin API

The upstream agent-gateway Admin API reference is in `~/github/agent-guide/agent-gateway/README.md`.

The multi-user / multi-gateway design (data model, permission model, request flow, audit) is documented in `docs/multi-tenant-design.md` — read it before changing auth, the access guards, gateway resolution, or credential encryption.

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
│   │   ├── auth/                     ← Manager session auth (login/logout/me; table-backed)
│   │   ├── users/                    ← Platform: user CRUD (platform-admin only)
│   │   ├── gateways/                 ← Platform: gateway registry CRUD + /test + /[id]/members
│   │   ├── session/                  ← Current user's gateways + active-gateway switcher
│   │   ├── audit/                    ← Read-only audit log (platform-admin only)
│   │   ├── caddy/servers/            ← Caddy HTTP server/route CRUD (active gateway)
│   │   ├── acp/chat/                 ← ACP chat data-plane proxy (turn/permission)
│   │   ├── health/                   ← Unauthenticated health check
│   │   └── [[...path]]/              ← Catch-all proxy to the active gateway's Admin API
│   ├── login/                        ← Login page
│   ├── dashboard/
│   │   ├── layout.tsx                ← Dashboard shell: AuthGuard + CurrentUserProvider + nav + AutoRefreshProvider
│   │   └── general/                  ← Overview (health dashboard), Virtual Keys pages
│   │       └── agents/               ← Agents list, [id] workspace (tabs), new/edit, interactions, usage (all-agents LLM/MCP/ACP metrics tabs)
│   │       └── llm/                  ← Providers, Models, Credentials, Routes pages
│   │       └── mcp/                  ← MCP Services (+ inspect), Routes pages
│   │       └── acp/                  ← ACP Services (+ sessions), Routes, Runtime (inline actions) pages (chat lives on the agent Chat tab)
│   │       └── platform/             ← Platform admin: Users, Gateways (+ members + test), Audit Log
│   │  (general/overview, /virtual-keys are grouped under the "Agents" nav section, not a standalone "General" group — see dashboard-nav.tsx)
│   │       └── configuration/        ← CLI Authenticators, Servers pages
│   ├── layout.tsx                    ← Root layout (fonts, globals)
│   └── page.tsx                      ← Redirects to /dashboard
├── components/
│   ├── dashboard-*.tsx               ← Layout shell, nav (gated Platform section), header (gateway switcher), user panel
│   ├── current-user-context.tsx     ← Current user + accessible gateways + active gateway + switchGateway()
│   ├── gateway-switcher.tsx         ← Header dropdown to select the active gateway (reloads on switch)
│   ├── auth-guard.tsx                ← Session validation wrapper
│   ├── auto-refresh-context.tsx      ← Global auto-refresh interval provider (off/5s/10s/30s, persisted)
│   ├── permission-banner.tsx         ← Global pending-ACP-permission alert banner (polls runtime)
│   ├── agent-form.tsx                ← Agent create/edit form (runtime.type generalized, 1:1 service guard)
│   ├── mobile-*.tsx                  ← Mobile sidebar context + top bar
│   └── ui/                           ← UI primitives: button, input, modal, toast, card, page-header,
│                                        stat-card, badge, select, multi-select, charts (Recharts),
│                                        auto-refresh-control, tooltip, confirm-dialog, skeleton, …
├── hooks/
│   ├── use-admin-swr.ts              ← SWR wrapper over adminFetch (+ live auto-refresh + lastUpdated)
│   └── use-focus-trap.ts             ← Focus trap for modal accessibility
└── lib/
    ├── api.ts                        ← Typed fetch helpers + gateway Admin API wrappers (incl. metrics, agents, users, gateways, audit)
    ├── db.ts                         ← sqlite connection, migrations, env seeding; users/gateways/memberships/sessions/audit helpers
    ├── sqlite.ts                     ← Runtime-agnostic SQLite adapter (node:sqlite on Node, bun:sqlite on Bun)
    ├── crypto.ts                     ← AES-256-GCM credential envelope (v1:keyId:iv:tag:ct) under MANAGER_SECRET_KEY
    ├── access.ts                     ← requirePlatformAccess / requireGatewayAccess guards + withPlatformAccess/withGatewayAccess wrappers + action grants + audit open→finalize
    ├── proxy-action.ts               ← Pure method+path → GatewayAction map (canonical per-segment matching); dependency-free + unit-tested (proxy-action.test.ts)
    ├── gateway-resolve.ts            ← Decrypt a gateway row → in-memory ResolvedGateway (admin/caddy/dataplane addrs + creds)
    ├── gateway-test.ts               ← Connectivity probe (pingGateway) for the gateway /test endpoints
    ├── metrics-util.ts               ← Time-range → query mapping, timeseries pivot, error-rate helpers
    ├── auth.ts                       ← localStorage session helpers (token, username)
    ├── caddy-manager.ts              ← Caddy admin API client; functions take a per-gateway CaddyConfig (caddyConfigFor)
    ├── gateway-proxy.ts              ← Gateway admin API proxy; takes a ResolvedGateway, base-URL cache keyed by gateway id
    ├── acp-dataplane.ts              ← ACP data-plane route resolution; takes a ResolvedGateway (dataplane_addr)
    ├── require-auth.ts               ← Bearer token extraction + requireAuth (table-backed session check)
    ├── server-env.ts                 ← Raw .env.local parser (avoids $VAR expansion)
    ├── session.ts                    ← sqlite-backed session store (user_id, active_gateway_id, expires_at)
    ├── types.ts                      ← Shared types: ServerRequest, RouteRequest, Caddy internals, AppError
    └── utils.ts                      ← cn() Tailwind merge, extractApiError()

data/manager.db                       ← sqlite store (users, gateways, user_gateways, sessions, audit_log); 0600, WAL
```

## Relationship To Other Projects

- **agent-gateway** (`~/github/agent-guide/agent-gateway/`): the AI gateway runtime. The manager is its dedicated web management frontend. Most dashboard pages interact with the gateway by proxying `/api/admin/*` requests to the gateway Admin API.
- **caddy-runtime** (`../caddy-runtime/`): the custom Caddy binary distribution that bundles `agent-gateway`. The manager talks to its Caddy admin API for server/route management.
- **plugins** (`../plugins/`): Caddy module plugins for the runtime. Manager does not interact with plugins directly; new plugin-backed capabilities should be exposed through the gateway Admin API first.
- `manager` does not implement Caddy modules or gateway business logic. It orchestrates management through documented HTTP boundaries.

## Environment Variables

Defined in `.env.local`. With multi-tenancy, identity and gateway connection live in `data/manager.db`, not env. The `AGWMNGR_*` / `GATEWAY_*` / `CADDY_ADMIN_ADDR` vars are now **bootstrap seeds only**: on first boot with an empty DB they seed the initial platform-admin user and the `default` gateway (its admin password is encrypted into the DB). After seeding, editing them has no effect — manage users/gateways through the UI.

| Variable | Default | Description |
|---|---|---|
| `MANAGER_SECRET_KEY` | — | **Required for gateway features.** 32-byte key (64 hex chars or base64) for AES-256-GCM encryption of gateway admin passwords. Without it, gateway seeding/CRUD/forwarding is unavailable; login + user management still work. Boot does not silently fall back to plaintext. |
| `MANAGER_DB_PATH` | `data/manager.db` | Override the sqlite file path |
| `MANAGER_SESSION_TTL` | `7d` | Session lifetime (e.g. `7d`, `24h`, `3600`) |
| `AGWMNGR_ADMIN_USER` | — | Seed: initial platform-admin username. Legacy alias: `CADDYMGR_ADMIN_USER` |
| `AGWMNGR_ADMIN_PASSWORD_HASH` | — | Seed: bcrypt hash of the initial admin password. Legacy alias: `CADDYMGR_ADMIN_PASSWORD_HASH` |
| `GATEWAY_ADMIN_ADDR` | `http://localhost:8019` | Seed: default gateway Admin API address. Legacy alias: `GATEWAY_ADDR` |
| `GATEWAY_ADMIN_USER` | — | Seed: default gateway admin username |
| `GATEWAY_ADMIN_PASSWORD` | — | Seed: default gateway admin password (encrypted into the DB at seed time) |
| `CADDY_ADMIN_ADDR` | `http://localhost:2019` | Seed: default gateway Caddy admin API address |
| `GATEWAY_DATAPLANE_ADDR` | `http://127.0.0.1:8080` | Seed: default gateway data-plane address (ACP chat). Host must match the dispatcher site's host matcher (commonly `127.0.0.1`, while the admin site binds `localhost`) |
| `CADDYMGR_READONLY_SERVER_IDS` | — | Seed: default gateway's read-only Caddy server IDs (CSV) |
| `NEXT_PUBLIC_API_BASE_URL` | `""` | Frontend API base URL (empty = same origin) |

> **Runtime note:** `next dev` / `next start` execute under **Node.js** even when launched via `bun run`. `lib/sqlite.ts` therefore uses `node:sqlite` (`DatabaseSync`, Node 22.5+) on Node and `bun:sqlite` only when the process genuinely runs under Bun. Do not import `bun:sqlite` directly in server code.

`lib/server-env.ts` reads `.env.local` with raw file parsing to avoid Next.js `$VAR` shell expansion corrupting bcrypt hashes.

## Backend API (Route Handlers)

All routes are under `/api/admin/`. Every route except `/api/admin/health` and `/api/admin/auth/login` requires `Authorization: Bearer <token>`.

### Access Control (two guards)

Authorization is not funnelled through one proxy — several entry points reach a gateway. So `lib/access.ts` provides two shared guards every entry point calls (see `docs/multi-tenant-design.md` §5):

- **`requirePlatformAccess(req)`** — for platform endpoints (users, gateways, memberships, audit). Requires a live session whose user is a platform admin. Resolves no gateway.
- **`requireGatewayAccess(req, action)`** — for gateway-scoped endpoints. Resolves the active gateway (`X-Gateway-Id` header override, else `session.active_gateway_id`, self-healed to the user's first gateway if unset), enforces membership + role for the **action**, blocks disabled gateways, and decrypts admin credentials into a `ResolvedGateway` for forwarding. Returns `{ ok, ctx | res }`; `ctx.gateway` carries the decrypted creds + all three upstream addresses.

Actions (not HTTP methods): `gateway:read`, `gateway:write`, `runtime:chat`, `runtime:permission_resolve`, `secrets:read-redacted`, `gateway:secrets_raw`, `platform:*`. The catch-all derives its action from `actionForProxyPath(method, proxyPath)` in `lib/proxy-action.ts` — a **pure, dependency-free, unit-tested** map (method default + a small override table). Matching is **canonical per-segment** (the proxy path is already percent-decoded once by the Next router, then split into segments — never decoded twice), so `/admin/credentials-extra` cannot masquerade as the `/admin/credentials` secret prefix, and `runtime:chat` only fires when the trailing segments are exactly `tools/call` or `resources/read`. Roles: platform admin (implicit `admin` on every gateway, all actions), `operator` (read+write+runtime), `viewer` (read only).

The guards write `audit_log` rows: every **deny**, plus **allow** for mutating/runtime/platform actions (plain reads skipped). To guarantee every opened allow row is **finalized** (with `http_status` + `duration_ms`) on success, a handled error Response, OR an uncaught throw, all non-streaming gateway/platform handlers are wrapped with **`withGatewayAccess(action, handler)`** / **`withPlatformAccess(handler)`** (the `withAccess` wrappers of §5.1) instead of calling the guard + `finalizeAccess` by hand. The two streaming exceptions — the catch-all proxy and the ACP chat handlers — finalize explicitly (`finalizeAccess(ctx, …)`) because the catch-all's action is dynamic and SSE turns must finalize on **stream end**, not Response-return.

### Health

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/health` | Unauthenticated health check |

### Auth

| Method | Path | Description |
|---|---|---|
| POST | `/api/admin/auth/login` | Validate username + bcrypt against the `users` table (rejects disabled), return session token |
| POST | `/api/admin/auth/logout` | Revoke session token |
| GET | `/api/admin/auth/me` | Return current user + `is_platform_admin` + `active_gateway_id` |

Session tokens are random hex strings persisted in the sqlite `sessions` table (durable across restart; honour `expires_at`; bound to a `user_id` and an `active_gateway_id`). `requireAuth()` from `lib/require-auth.ts` checks for any live session; the access guards (above) do role/gateway resolution.

### Platform: Users, Gateways, Memberships, Session, Audit

All require `requirePlatformAccess` except the `/session/*` endpoints (any logged-in user).

| Method | Path | Description |
|---|---|---|
| GET/POST | `/api/admin/users` | List / create manager users (last-admin protected; disable revokes sessions) |
| GET/PUT/DELETE | `/api/admin/users/[id]` | Get / update (password, role, status) / delete a user |
| GET/POST | `/api/admin/gateways` | List / register gateways (admin password encrypted; returns `admin_password_set` + computed `health_status`, never ciphertext) |
| GET/PUT/DELETE | `/api/admin/gateways/[id]` | Get / update (blank password keeps stored ciphertext) / delete a gateway |
| POST | `/api/admin/gateways/test` | Pre-save connectivity check with supplied credentials |
| POST | `/api/admin/gateways/[id]/test` | Connectivity check against a stored gateway's decrypted credentials |
| GET/PUT | `/api/admin/gateways/[id]/members` | List members / upsert a membership (`{user_id, role}`) |
| DELETE | `/api/admin/gateways/[id]/members/[userId]` | Remove a membership |
| GET | `/api/admin/session/gateways` | The current user's accessible gateways + active id (self-heals a stale active) |
| POST | `/api/admin/session/active-gateway` | Set the session's active gateway (validates access) |
| GET | `/api/admin/audit` | Read-only audit log (`?gateway_id=&decision=&limit=`) |

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

These endpoints guard with `requireGatewayAccess` (read for GET, write for mutations) and translate between the manager's `ServerRequest`/`RouteRequest` types and Caddy's internal JSON config. The active gateway's `caddy_admin_addr` + `readonly_server_ids` are passed in as a `CaddyConfig` (`caddyConfigFor(ctx.gateway)`) — no env reads. Rules:
- Servers in the gateway's read-only ids, whose routes contain `agent_gateway_admin` handlers, or whose routes lack a `group` field (Caddyfile-defined), are read-only — return 403.
- Mutations use a get-modify-post cycle against the Caddy admin API (`GET /config/` + `POST /config/`). Only paths under `/apps/http/servers` are allowed.

### Gateway Proxy Catch-All

Any `/api/admin/*` request not matched by an explicit handler is guarded by `requireGatewayAccess(req, actionForProxyPath(...))` and proxied to the **active gateway's** Admin API (`ctx.gateway.adminAddr`). The gateway delegates admin auth to the HTTP layer (Caddy `basic_auth` or the standalone daemon's basic-auth wrapper) — there is no gateway login/session/token flow. The proxy (`lib/gateway-proxy.ts`) takes the `ResolvedGateway`:
1. Strips any inbound `Authorization` header and replaces it with static HTTP Basic Auth built from the gateway record's decrypted `adminUser`/`adminPassword` before forwarding.
2. Tries the gateway's `adminAddr` then its `localhost`↔`127.0.0.1` alternate on connection failure, caching the base URL that connects in `globalThis` **keyed by gateway id**. A gateway `401` is passed through unchanged (no re-auth retry).
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
- Agents (P0a/P0b/P1, implemented): `GET/POST /agents`, `GET/PUT/DELETE /agents/{id}`, plus `/{id}/workspace` (summary/index), `/{id}/{activity,usage,interactions,resources,health}`. Delete is non-cascading (the backing ACP service/routes stay intact).
- Metrics (implemented): `GET /metrics`, `/metrics/{llm,mcp,acp}/...` (events/timeseries/breakdown/summary), `/metrics/interactions` (cross-protocol call chain with `trace_id`/`agent_depth`), `/metrics/prometheus`.
- Memory: registered but returns 501. Agent tasks/schedules (P2) and workflows (P3) are design-only, not yet exposed.

### ACP Chat Data-Plane Proxy

Driving an ACP conversation is a **data-plane** operation (on the runtime's public listener at `GATEWAY_DATAPLANE_ADDR`), not an Admin API one. Two explicit Route Handlers bridge the browser to it (they take precedence over the catch-all):

| Method | Path | Description |
|---|---|---|
| POST | `/api/admin/acp/chat/turn` | Resolve the ACP route via the Admin API, then forward a turn to `<dataplane>/<route_path_prefix>/turn` and stream the SSE response back to the browser |
| POST | `/api/admin/acp/chat/permission` | Resolve an interactive permission at `<dataplane>/<route_path_prefix>/permission` |

Both guard with `requireGatewayAccess` (`runtime:chat` for turn, `runtime:permission_resolve` for permission), resolve the route's `path_prefix`/`host`/`require_virtual_key` server-side against the active gateway (`lib/acp-dataplane.ts` via `gatewayRequestJSON` with the `ResolvedGateway`), forward to the gateway's `dataplane_addr`, and inject the caller-selected virtual key as the data-plane `Authorization` so it never lives in the browser. The SSE event names are `session`, `delta`, `reasoning`, `content`, `plan`, `tool_call`, `usage`, `permission`, `done`, `error` (see `lib/acp-chat-stream.ts`).

## Frontend (App Router Pages)

The entry route (`/`) redirects to `/dashboard`, which redirects to `/dashboard/general/overview`.

The UI is organized **agent-centric** (per `docs/ui-ux-improvement-plan.md`): the **Agents** section is the first-class, top-most nav group — it holds the agent itself plus the day-to-day views for working with it (observability + the keys used to call it). The **LLM / MCP / ACP** sections below are the *shared infrastructure* that backs agents, not sub-items of any one agent. The ACP service is presented as one of an agent's runtime backends rather than a primary product concept.

> Navigation grouping ≠ URL path. `Overview` and `Virtual Keys` still live under `/dashboard/general/*` but are surfaced inside the **Agents** nav group; the all-agents `Usage` page lives at `/dashboard/agents/usage`. Section membership is set in `components/dashboard-nav.tsx` (`NAV_ITEMS[].section`). There is no standalone "General" nav group.

### Navigation Structure

**Agents** (first-class, top of nav):
- Overview (`/dashboard/general/overview`) — stat cards + **System Health dashboard** (24h request volume sparkline, error rate, pending permissions, ACP runtime, CLI refresher) + quick start guide + integration snippets. This is the dashboard landing route.
- Agents (`/dashboard/agents`) — agent list with search/runtime filter; create via `/dashboard/agents/new`
- Agent detail (`/dashboard/agents/[id]`) — workspace tabs: **Overview** (runtime.type-generalized: ACP service read-through + live runtime view + links, or HTTP runtime degrade), **Chat** (interactive data-plane conversation with the agent over one of its own ACP routes — see below; ACP runtime only, HTTP agents degrade), **Activity**, **Usage** (time-range scoped to this agent via `/admin/agents/{id}/usage`: **LLM Usage** stat cards + requests-over-time chart, then LLM-by-model breakdown, ACP, and MCP usage — additive, all four protocols on one tab), **Resources** (agent-centric **Reachability** map — Agent → virtual keys it holds → permitted LLM/MCP/ACP routes → target provider/service, with dangling highlight — followed by the flat resolved resource groups), **Health** (shallow), **Configuration** (+ edit). Edit at `/dashboard/agents/[id]/edit`.
- Interactions (`/dashboard/agents/interactions`) — cross-protocol call chains grouped by `trace_id`, indented by `agent_depth` (the orchestration view)
- Usage (`/dashboard/agents/usage`) — **all-agents metrics with LLM / MCP / ACP protocol tabs** (shared time-range; each tab has stat cards + a requests-over-time chart + breakdown table + recent-events feed). all three tabs have a group-by selector + a Recharts share donut over the grouped requests (LLM by route/key/provider/model/api, MCP by tool/method/route/service/key via `/metrics/mcp/breakdown`, ACP by route/service/agent_type/operation). All three back the time chart with `/metrics/{llm,mcp,acp}/timeseries`. The **ACP tab** additionally has a **Source** selector (Data-plane / Admin audit / All, default Data-plane) that filters server-side by `route_protocol` — data-plane turns are `route_protocol=acp`, the manager's own `/admin/acp` polling is `route_protocol=admin`; without it the admin audit spans inflate every ACP stat. Per-agent usage lives on the agent detail **Usage** tab.
- Virtual Keys (`/dashboard/general/virtual-keys`) — CRUD for virtual keys with route restrictions (the credentials clients use to call agents)

**LLM** (shared infrastructure):
- Providers (`/dashboard/llm/providers`) — CRUD for LLM providers
- Models (`/dashboard/llm/models`) — CRUD for managed models
- Credentials (`/dashboard/llm/credentials`) — CRUD for upstream credentials + CLI auth login flow
- Routes (`/dashboard/llm/routes`) — CRUD for gateway LLM routes (direct-provider + logical-model targets)

**MCP:**
- Services (`/dashboard/mcp/services`) — CRUD for MCP services (stdio/sse/streamable_http transports, env, auth) + inspect modal (capabilities, tools, tool-call, resources, resource-read, prompts, session)
- Routes (`/dashboard/mcp/routes`) — CRUD for MCP routes (service binding, match policy, auth policy)

**ACP** (management only — interactive chat now lives on the agent's **Chat** tab):
- Services (`/dashboard/acp/services`) — CRUD for ACP agent services (codex/opencode, cwd, allowed roots, env vars, permission mode, idle TTL, config overrides, codex adapter settings) + sessions/transcript modal
- Routes (`/dashboard/acp/routes`) — CRUD for ACP routes (service binding, match policy, auth policy)
- Runtime (`/dashboard/acp/runtime`) — pooled instances, in-flight turns, pending permissions; **auto-refresh + inline actions** (per-instance Close, per-permission Approve/Reject from parsed options). Pending permissions are also surfaced app-wide via the global `PermissionBanner`.

**Configuration:**
- CLI Authenticators (`/dashboard/configuration/cliauth`) — CLI authenticator config, login flow, refresher control
- Servers (`/dashboard/configuration/servers`) — Caddy HTTP server management, TLS, route dispatcher config

**Platform** (visible only to platform admins; the section is hidden via `useCurrentUser()` in `dashboard-nav.tsx`):
- Users (`/dashboard/platform/users`) — manager user CRUD (role, status, password reset)
- Gateways (`/dashboard/platform/gateways`) — gateway registry CRUD + connectivity test + per-gateway member assignment
- Audit Log (`/dashboard/platform/audit`) — read-only authorization decision log

The active gateway is chosen via the **header gateway switcher** (`components/gateway-switcher.tsx`). Switching POSTs `/admin/session/active-gateway` then reloads, so every page (SWR or legacy) re-fetches against the new gateway (§6.1 of the design). The current user, accessible gateways, and active gateway come from `CurrentUserProvider` (`components/current-user-context.tsx`).

### Frontend Conventions

- `lib/auth.ts`: localStorage helpers — `getToken()`, `saveSession()`, `clearSession()`, `isAuthenticated()`.
- `lib/api.ts`: typed `adminFetch<T>()` wrapper that injects `Authorization: Bearer <token>`, auto-redirects to `/login` on 401. Also contains typed wrapper functions for all gateway Admin API resources (providers, credentials, models, CLI auth, MCP/ACP services/routes/runtime, **metrics** (`getLLM*`, `getInteractions`, …), and **agents** (`listAgents`, `getAgentWorkspace`, `getAgentUsage`, …)).
- **Data fetching**: prefer `useAdminSWR(key, fetcher, { live })` from `hooks/use-admin-swr.ts` over manual `useState/useEffect/loading`. Passing `live: true` ties the request to the global auto-refresh interval (`AutoRefreshProvider` in the dashboard layout); pair it with `<AutoRefreshControl>` in the page header. The hook returns the standard SWR response plus `lastUpdated`.
- **Primitives**: build pages from `PageHeader`, `Card`, `StatCard`/`StatGrid`, `Badge` (`protocolTone()` for llm/mcp/acp/http accents), `Select`, `MultiSelect`, and `charts.tsx` (Recharts wrappers) rather than hand-rolled markup. Body text stays ≥ 12px.
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

- **Change password**: UI exists in user panel but no backend endpoint.
- **Deep resource health**: only shallow health is exposed (disabled flags, runtime counts, recent error rate). Upstream reachability / circuit-break / credential-expiry are not yet available from the gateway — the UI marks these as pending, it does not fake them.
- **Agent tasks/schedules (P2) & workflows (P3)**: backend design-only; no task queue / schedule editor / workflow graph yet.
- **Agent create**: can only reference an existing ACP service (auto-creating a backing service on the fly is not supported by P0).
- **SWR migration**: `useAdminSWR` is the standard for new/observability pages; some older CRUD pages still use the legacy `useState/useEffect` pattern and can be migrated incrementally.
