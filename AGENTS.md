# manager

Bun + Next.js + TypeScript web management frontend for [agent-gateway](../../agent-gateway/).

The manager provides a dashboard UI and a thin backend API layer (Next.js Route Handlers) that:

- authenticates manager users against a persisted `users` table with its own sqlite-backed session system
- supports **multiple manager users** with two-layer RBAC (platform admins + per-gateway admin/member roles)
- manages **multiple agent-gateways** from one manager (a header switcher selects the active gateway per session)
- proxies most `/api/admin/*` requests to the **active gateway's** Admin API
- manages Caddy HTTP servers and routes through the active gateway's Caddy admin API

The upstream agent-gateway Admin API reference is in `~/github/agent-guide/agent-gateway/README.md`.

The multi-user / multi-gateway design (data model, permission model, request flow, audit) is documented in `docs/multi-tenant-design.md` — read it before changing auth, the access guards, gateway resolution, or credential encryption.

`docs/resource-rbac-design.md` defines the evolution into hierarchical, resource-scoped RBAC. The Gateway-root `admin/member` membership model is implemented; domain/resource grants are not. Gateway Admin may manage ordinary gateway content, while Member has no implicit content access. Caddy, gateway connection credentials, and platform APIs remain Platform Admin-only until dedicated safe handlers exist. Provider/Credential/Virtual Key responses have manager-owned secret redaction, so Gateway Admin manages Virtual Keys too; only recovering an existing key's value stays Platform Admin-only. Read the design before touching `lib/access.ts`, `lib/proxy-action.ts`, the membership schema, or the Caddy/Virtual Key/Chat handlers.

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
│   │   ├── virtual_keys/             ← Redacted Virtual Key CRUD + /[id]/reveal (platform-only)
│   │   ├── acp/chat/                 ← ACP chat data-plane proxy (turn/permission)
│   │   ├── health/                   ← Unauthenticated health check
│   │   └── [[...path]]/              ← Catch-all proxy to the active gateway's Admin API
│   ├── login/                        ← Login page
│   ├── dashboard/
│   │   ├── layout.tsx                ← Dashboard shell: AuthGuard + CurrentUserProvider + nav + AutoRefreshProvider
│   │   └── general/                  ← Overview (agent-first console), Virtual Keys pages
│   │       └── agents/               ← Agents list, [id] workspace (tabs), new/edit, interactions, usage (all-agents LLM/MCP/ACP metrics tabs)
│   │       └── llm/                  ← Providers, Models, Credentials, Routes pages
│   │       └── mcp/                  ← MCP Services (+ inspect), Routes pages
│   │       └── acp/                  ← ACP runtime diagnostics only (services/routes were removed in v0.5.0; chat lives on the agent Chat tab)
│   │       └── platform/             ← Platform admin: Users, Gateways (+ members + test), Audit Log
│   │  (general/overview, /virtual-keys are grouped under the "Agents" nav section, not a standalone "General" group — see dashboard-nav.tsx)
│   │       └── configuration/        ← Bundle import/export and Servers pages
│   ├── layout.tsx                    ← Root layout (fonts, globals)
│   └── page.tsx                      ← Redirects to /dashboard
├── components/
│   ├── dashboard-*.tsx               ← Layout shell, nav (WORKSPACE zone always-visible + collapsible Resources/Configuration/Platform accordion, gated Platform), header (gateway switcher), user panel
│   ├── used-by-agents.tsx            ← Compact "used by N agents" chip for resource rows (orphan signal + link to owning agent)
│   ├── current-user-context.tsx     ← Current user + accessible gateways + active gateway + switchGateway()
│   ├── gateway-switcher.tsx         ← Header dropdown to select the active gateway (reloads on switch)
│   ├── auth-guard.tsx                ← Session validation wrapper
│   ├── auto-refresh-context.tsx      ← Global auto-refresh interval provider (off/5s/10s/30s, persisted)
│   ├── permission-banner.tsx         ← Expandable global pending-ACP-permission banner with inline Approve/Reject
│   ├── acp-pending-permissions.tsx   ← Pending-permission list with inline Approve/Reject (shared by ACP Runtime page + agent Overview tab)
│   ├── interaction-traces.tsx        ← Trace/span-tree waterfall renderer (Interactions page)
│   ├── agent-form.tsx                ← Agent create/edit form with runtime branches + Form/YAML modes; auto-binds builtin model/tool dependencies; `wizard` prop drives the stepped create flow (Basics→Runtime→Resources→Review) with "+ New" resource deep-links + refresh; edit stays single-page
│   ├── mobile-*.tsx                  ← Mobile sidebar context + top bar
│   └── ui/                           ← UI primitives: button, input, modal, toast, card, page-header,
│                                        stat-card, badge, select, multi-select, charts (Recharts),
│                                        auto-refresh-control, tooltip, confirm-dialog, skeleton, …
├── hooks/
│   ├── use-admin-swr.ts              ← SWR wrapper over adminFetch (+ live auto-refresh + lastUpdated)
│   ├── use-focus-trap.ts             ← Focus trap for modal accessibility
│   └── use-agent-attribution.ts      ← Reverse map from listAgents() (provider/mcpService/virtualKey/llmRoute/mcpRoute → agentIds), incl. builtin model/tool refs walked recursively, for resource "used by" chips
└── lib/
    ├── api.ts                        ← Typed fetch helpers + gateway Admin API wrappers (incl. metrics, agents, users, gateways, audit)
    ├── agent-bindings.ts             ← Collect + bind recursive builtin model-route/MCP-service dependencies; strip derived bindings for form state
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

Actions (not HTTP methods): `gateway:read`, `gateway:write`, `gateway:platform_config`, `runtime:chat`, `runtime:permission_resolve`, `secrets:read-redacted`, `gateway:secrets_raw`, `platform:*`. The catch-all derives its action from `actionForProxyPath(method, proxyPath)` in `lib/proxy-action.ts` — a **pure, dependency-free, unit-tested** map (method default + a small override table). Matching is **canonical per-segment** (the proxy path is already percent-decoded once by the Next router, then split into segments — never decoded twice), so `/admin/credentials-extra` cannot masquerade as the `/admin/credentials` secret prefix, and `runtime:chat` only fires when the trailing segments are exactly `tools/call` or `resources/read`. `runtime:permission_resolve` fires on `POST /admin/agents/{id}/permissions/{request_id}` matched as an exact 5-segment shape with `routes` excluded (it is the reserved ingress collection, never an agent id). Gateway roles are `admin` and `member`: Gateway Admin receives ordinary read/write/runtime actions, while Member receives none until resource grants land. Platform Admin has implicit Gateway Admin authority, but `gateway:platform_config`, `gateway:secrets_raw`, and `platform:*` additionally require the platform actor flag. The Virtual Key family has explicit redacting handlers, so its reads take `secrets:read-redacted` and its writes `gateway:write`; only `POST /virtual_keys/{id}/reveal` uses `gateway:secrets_raw`. `actionForProxyPath` still maps the family to `gateway:secrets_raw` as the deny-by-default backstop for any Virtual Key subpath without an explicit handler.

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

These endpoints guard with `requireGatewayAccess(req, "gateway:platform_config")`; the action performs an explicit Platform Admin actor check while retaining the selected gateway in the audit context. They translate between the manager's `ServerRequest`/`RouteRequest` types and Caddy's internal JSON config. The active gateway's `caddy_admin_addr` + `readonly_server_ids` are passed in as a `CaddyConfig` (`caddyConfigFor(ctx.gateway)`) — no env reads. Rules:
- Servers in the gateway's read-only ids, whose routes contain `agent_gateway_admin` handlers, or whose routes lack a `group` field (Caddyfile-defined), are read-only — return 403.
- Mutations use a get-modify-post cycle against the Caddy admin API (`GET /config/` + `POST /config/`). Only paths under `/apps/http/servers` are allowed.

### Gateway Proxy Catch-All

Any `/api/admin/*` request not matched by an explicit handler is guarded by `requireGatewayAccess(req, actionForProxyPath(...))` and proxied to the **active gateway's** Admin API (`ctx.gateway.adminAddr`). The gateway delegates admin auth to the HTTP layer (Caddy `basic_auth` or the standalone daemon's basic-auth wrapper) — there is no gateway login/session/token flow. The proxy (`lib/gateway-proxy.ts`) takes the `ResolvedGateway`:
1. Strips any inbound `Authorization` header and replaces it with static HTTP Basic Auth built from the gateway record's decrypted `adminUser`/`adminPassword` before forwarding.
2. Tries the gateway's `adminAddr` then its `localhost`↔`127.0.0.1` alternate on connection failure, caching the base URL that connects in `globalThis` **keyed by gateway id**. A gateway `401` is passed through unchanged (no re-auth retry).
3. Sanitizes request and response headers (removes CORS, content-encoding, hop-by-hop headers).

Proxied gateway Admin API endpoints include (see agent-gateway README for full reference):

- Providers: explicit manager Route Handlers for `GET/POST /llm/providers` and `GET/PUT/DELETE /llm/providers/{id}` remove `api_key`, return only `api_key_set`, and merge omitted keys server-side on update; other provider subpaths use the catch-all
- Provider types: `GET /provider_types`, enable/disable
- LLM routes: `GET/POST /llm/routes`, `GET/PUT/DELETE /llm/routes/{id}`, enable/disable
- Virtual keys: explicit manager Route Handlers for `GET/POST /virtual_keys` and `GET/PUT/DELETE /virtual_keys/{id}` strip the upstream `key` and return only `key_set` + a masked `key_preview`. The generated bearer is delivered **once**, in the create response; `POST /virtual_keys/{id}/reveal` (`gateway:secrets_raw`, Platform Admin only, audited) recovers an existing one. Other subpaths use the catch-all and stay Platform Admin-only
- Credentials: explicit manager Route Handlers for `GET/POST /credentials`, `GET/PUT/DELETE /credentials/{credential_id}` remove `attributes.api_key`, return only `api_key_set`, and preserve/replace the key server-side without returning it
- Models: discovered models, managed models, logical models
- MCP services: `GET/POST /mcp/services`, `GET/PUT/DELETE /mcp/services/{id}`, plus `/capabilities`, `/sessions`, `/tools`, `/tools/call`, `/resources`, `/resource-templates`, `/resources/read`, `/prompts`
- MCP routes: `GET/POST /mcp/routes`, `GET/PUT/DELETE /mcp/routes/{id}` (id auto-generated as `mcp:<service_id>:<path_prefix>`)
- MCP runtime: `GET /mcp/runtime`, `/mcp/runtime/inflight`, `/mcp/runtime/progress`, `/mcp/runtime/history`
- ACP services: **removed in v0.5.0.** Execution config is inlined on `Agent.runtime.acp`; sessions/transcript moved to `/agents/{id}/sessions[/{session_id}/transcript]`
- Agent ingress routes (unified, replaces ACP/builtin route families): `GET/POST /agents/routes`, `GET/PUT/DELETE /agents/routes/{id}` (id auto-generated as `agent:<agent_id>:<path_prefix>`). **`routes` is a reserved agent id** — the gateway dispatches `/admin/agents/routes*` to a separate mux ahead of `/admin/agents/{id}`
- ACP runtime: `GET /acp/runtime`, `GET /acp/runtime/inflight`, `POST /acp/runtime/permissions/{request_id}` (resolve), `DELETE /acp/runtime/threads/{service_id}/{thread_id}` (close)
- Agents: `GET/POST /agents`, `GET/PUT/DELETE /agents/{id}`, plus `/{id}/workspace` (summary/index), `/{id}/{activity,usage,interactions,resources,health}`, `/{id}/capabilities`, `/{id}/{sessions,runs,permissions}`, `POST /{id}/permissions/{request_id}`, `DELETE /{id}/runs/{run_id}?mode=force|graceful`. List/get return `runtime_status` + `capabilities` per agent. **Delete fails closed with 409** while any agent route still targets the agent; on success it drains pending permissions and cancels in-flight runs.
- Builtin runtime diagnostics: `GET /builtin/runtime`, `GET /builtin/runtime/inflight`
- ACP pool recovery: `DELETE /acp/runtime/agents/{agent_id}/threads/{thread_id}` (destructive; deliberately separate from run cancellation)
- Metrics (implemented): `GET /metrics`, `/metrics/{llm,mcp,acp}/...` (events/timeseries/breakdown/summary), `/metrics/interactions` (cross-protocol call chain with `trace_id`/`agent_depth`), `/metrics/prometheus`.
- Memory: registered but returns 501. Agent tasks/schedules (P2) and workflows (P3) are design-only, not yet exposed.

### ACP Chat Data-Plane Proxy

Driving an ACP conversation is a **data-plane** operation (on the runtime's public listener at `GATEWAY_DATAPLANE_ADDR`), not an Admin API one. Two explicit Route Handlers bridge the browser to it (they take precedence over the catch-all):

| Method | Path | Description |
|---|---|---|
| POST | `/api/admin/acp/chat/turn` | Resolve the **agent** route via the Admin API, then forward a turn to `<dataplane>/<route_path_prefix>/turn` and stream the SSE response back. The AgentRoute decoder is strict (`DisallowUnknownFields`): only `input`/`session_id`/`permission`/`options` are accepted, and `thread_id`/`cwd`/`model`/`fresh_session`/`config_overrides` must sit inside `options: {version: "v1", runtime: {…}}` — a flat body or a missing `options.version` is a hard 400. Either `input` or `permission` is required, not both |
| POST | `/api/admin/acp/chat/permission` | Resolve an interactive permission at `<dataplane>/<route_path_prefix>/permission`. **Only valid for `resume_mode: active_stream`** — see below |

Both guard with `requireGatewayAccess` (`runtime:chat` for turn, `runtime:permission_resolve` for permission), resolve the route's `path_prefix`/`host`/`require_virtual_key` server-side against the active gateway (`lib/acp-dataplane.ts` via `gatewayRequestJSON` with the `ResolvedGateway`), forward to the gateway's `dataplane_addr`, and inject the caller-selected virtual key as the data-plane `Authorization`. The browser sends `virtual_key_id`, **never** a bearer — it has none, since the Virtual Key read path is redacted — and `lib/virtual-key-secret.ts` resolves the ID server-side, rejecting a key that is disabled, expired, or whose allowlist does not cover the resolved route (`docs/resource-rbac-design.md` §10.2). A key ID is input to resolution, not authority: the session is already authorized for `runtime:chat` on the active gateway. The SSE event names are `session`, `delta`, `reasoning`, `content`, `plan`, `tool_call`, `usage`, `permission`, `done`, `error`, plus v0.5.0's `available_commands`, `session_info`, `mode`, `config_options` (see `lib/acp-chat-stream.ts`).

**`options.runtime` is per-runtime, and so is permission resume.** Chat is not ACP-only — any runtime advertising `turn.streaming` is drivable — so neither the request shape nor the permission path may be hardcoded to ACP:

- **`options.runtime` is decoded by the *selected backend*, also with `DisallowUnknownFields`.** ACP decodes `acpRuntimeOptionsV1` and *requires* a non-empty `thread_id`; **builtin decodes into an empty struct and rejects every key** with `unsupported_option` → `400 {"error":"runtime option is not supported"}`. The turn handler therefore resolves the target agent's runtime (`resolveAgentRuntimeType()` — the AgentRoute view carries only `agent_id`, not the runtime type) and builds the envelope per backend: the ACP object for `acp`, and **`options.runtime` omitted entirely** otherwise (an absent object is read as `{}`). ACP-only fields supplied for a non-ACP agent are a 400 naming them, not a silent drop.
- **Permission resume follows `capabilities.permissions.resume_mode`.** `active_stream` (ACP) resumes the held-open turn when the side-channel `POST /permission` lands. `new_stream` (builtin) **rejects that endpoint with `capability_not_supported`** (`pkg/dispatcher/agent_handler.go` gates it on `active_stream`); the decision must instead ride a fresh `POST /turn` carrying `permission` and no `input`, with the continuation arriving on that new stream. `acp-chat.tsx` branches on the mode.
- **Session affordances follow `capabilities.sessions`.** Builtin reports `resume: true` but `list`/`transcript` `false` — it keeps in-memory sessions only for same-`session_id` continuation. Calling `/sessions` anyway yields a 501 and a gateway ERROR log for something entirely expected, so the chat surface hides the sessions sidebar (and the `cwd` field, an ACP option) rather than relying on tolerating the error.

## Frontend (App Router Pages)

The entry route (`/`) redirects to `/dashboard`, which redirects to `/dashboard/general/overview`.

The UI is organized **agent-centric** (per `docs/ui-ux-improvement-plan.md`): the **Agents** section is the first-class, top-most nav group — it holds the agent itself, its ingress routes, and the day-to-day views for working with it (observability + the keys used to call it). The **LLM / MCP** sections below are the *shared infrastructure* that backs agents, not sub-items of any one agent.

Since v0.5.0 the agent **is** the runtime: `Agent.runtime.<type>` inlines the execution config for exactly one backend (`acp` = gateway-pooled external process, `builtin` = in-process eino ADK definition, `http` = self-managed, not executable until M8). There is no ACP "service" object. Ownership is one-way — an AgentRoute names its `agent_id`, never the reverse — so changing an agent's runtime preserves its route id, URL, and every virtual-key allowlist entry. See `docs/v0.5-alignment-plan.md`.

> Navigation grouping ≠ URL path. `Overview` and `Virtual Keys` still live under `/dashboard/general/*` but are surfaced in the top-level **WORKSPACE** zone (with Agents/Interactions/Usage); the all-agents `Usage` page lives at `/dashboard/agents/usage`. There is no standalone "General" nav group.
>
> **Nav layout (`components/dashboard-nav.tsx`):** the sidebar is two-tier — the agent-centric administrator flow starts with Overview, Agents, Agent Routes, then the collapsible **Runtimes** diagnostics group, followed by Interactions, Usage, and Virtual Keys. Lower infrastructure uses independent collapsible **LLM**, **MCP**, **Configuration** (Bundle, Servers), and **Platform** (admin-gated) groups; there is no generic Resources wrapper. Group openness is **derived, not effect-synced**: `openGroups[key] ?? hasActive` — a group defaults open iff it owns the active route (longest-prefix match via `resolveActiveHref`), and an explicit user toggle (persisted to `localStorage` `dashboard.nav.groups`) then wins. The narrow collapsed rail flattens every item to an icon list in the same order (the accordion is unusable at that width).

### Navigation Structure

**Agents** (first-class, top of nav):
- Overview (`/dashboard/general/overview`) — the **agent-first landing route**, ordered agents → traffic → fleet → activity → onboarding → infrastructure. Primary stats are the agent fleet (agents ready/attention, agent routes incl. **dangling** count, active runs, pending permissions); **Traffic** shows all three data planes over 24h (LLM + MCP + agent ingress, the last read from `/metrics/acp/timeseries` pinned to `route_kind=agent` **and** `route_protocol=agent` so the manager's own admin polling cannot inflate it); **Agent Fleet** derives per-agent issues from `runtime_status` + owned routes (disabled / not executable / no ingress route / degraded / pending); **Recent Activity** reuses `groupTraces()` for a compact trace strip. Get Started has **two paths** (Run an agent / Proxy an LLM), each with a real completion signal from 24h traffic; Integration leads with an **Agent turn** snippet built from the first agent route's `path_prefix`, branching on the target's runtime (ACP emits `options.runtime.thread_id`, others omit `options.runtime` entirely — builtin rejects every key). Runtime reads cover **both** `/acp/runtime` and `/builtin/runtime`, and the Pending Permissions tile links to whichever runtime holds the request. Every fetch is wrapped in an access-aware slice: a **403 renders as "no access", never as an empty resource**, so a Member sees a Limited-access banner instead of a gateway that looks empty, and the Caddy `public_url` probe (Platform Admin-only) is skipped rather than 403'd for everyone else.
- Agents (`/dashboard/agents`) — agent list with search/runtime filter; non-executable runtimes require an alert panel that explains the route can exist while `POST /turn` returns `501 runtime_not_executable` (a normal badge is insufficient); create via `/dashboard/agents/new` (a 4-step **wizard**: Basics→Runtime→Resources→Review). Resources stay independently creatable — the wizard does not gate resource creation; it just threads runtime→resources→virtual-key with "+ New" deep-links (open in a new tab) + a refresh control. Resource list pages (providers, MCP services, virtual keys, LLM/MCP routes) carry a **"used by N agents"** chip (`useAgentAttribution` + `UsedByAgents`) that flags orphans and links to the owning agent
- Agent detail (`/dashboard/agents/[id]`) — workspace tabs, **gated by `GET /admin/agents/{id}/capabilities` rather than `runtime.type`** (`visibleTabs()`): **Overview** (runtime-neutral summary — state/executable/active runs/sessions/last activity — plus a per-backend detail block for acp / builtin / http, the live pool view with **pending permissions and inline Approve/Reject** via the shared `PendingPermissions` component, and a warning when no ingress route targets the agent), **Chat** (interactive data-plane conversation over one of the agent's own agent routes; shown iff the backend advertises streaming turns, so builtin agents get it too), **Runs** (shown iff force or graceful cancellation is advertised; live run list with capability-gated cancel actions), **Resources** (agent-centric **Reachability** map — Agent → virtual keys it holds → permitted LLM/MCP/agent routes → target provider/service/agent, with dangling highlight — followed by the flat resolved resource groups), **Health** (shallow), **Configuration** (runtime/policy summary + copyable read-only Agent YAML bundle fragment, with gateway-managed metadata omitted). Edit at `/dashboard/agents/[id]/edit`. There is no per-agent Activity tab and no per-agent Usage tab — a single agent's call chains and usage are viewed on the **Interactions** and **Usage** pages via their **Agent** filter. The agent detail header has **Usage** and **Interactions** buttons that jump to those pages pre-filtered (`?agent=<id>`).
- Interactions (`/dashboard/agents/interactions`) — cross-protocol call chains grouped by `trace_id`, reconstructed as span-tree waterfalls (`components/interaction-traces.tsx`); the orchestration view and the single-agent activity view (there is no per-agent Activity tab). Filters: **Agent** (server-side `agent_id` **full attribution** — durable tag OR the agent's owned routes, the same selector the Usage page and `/admin/agents/{id}/*` use, so untagged-but-mappable spans still surface; deep-linkable via `?agent=<id>` — the agent detail header has an **Interactions** button that jumps here pre-filtered), Protocol (llm/mcp/**agent**), Status, Source (data-plane/admin/all). Source=Admin audit deliberately drops the Protocol constraint: admin spans are only ever `route_kind=acp`, so partitioning them by the user's protocol choice would return an empty list for every option. Spans carry `runtime_type`, rendered as a second chip beside the protocol chip so an agent span shows which backend ran it
- Usage (`/dashboard/agents/usage`) — **all-agents metrics with LLM / MCP / ACP protocol tabs** (shared time-range; each tab has stat cards + a requests-over-time chart + breakdown table + recent-events feed). all three tabs have a group-by selector + a Recharts share donut over the grouped requests (LLM by route/key/provider/model/api, MCP by tool/method/route/service/key via `/metrics/mcp/breakdown`, ACP by route/service/agent_type/operation). All three back the time chart with `/metrics/{llm,mcp,acp}/timeseries`. The third tab is **Agent** (was ACP): unified agent ingress records `route_kind=agent` / `route_protocol=agent`, while the manager's own `/admin/acp` polling stays `route_kind=acp` / `route_protocol=admin`. It has a **Source** selector (Data-plane / Admin audit / All, default Data-plane) applied server-side by `route_protocol`; without it the admin audit spans inflate every agent stat. It still reads the `/metrics/acp/*` endpoint family — that store keeps ACP-typed runtime events; only the *route* dimensions became runtime-neutral. A page-level **Agent** filter (deep-linkable via `?agent=<id>`, mirroring Interactions) scopes every stat to one agent by passing `agent_id` into all `/metrics/{llm,mcp,acp}/{breakdown,timeseries,events}` calls; the gateway resolves it to the agent's **full attribution** (durable `agent_id` tag OR its owned routes — the same selector `/admin/agents/{id}/usage` uses), so an agent-filtered read is a strict superset of the old per-agent Usage tab (same data, plus group-by / donuts / source filter / event feeds). This is why the per-agent Usage tab was removed in favour of the header **Usage** jump link.
- Agent Routes (`/dashboard/agents/routes`) — CRUD for the unified agent ingress routes (agent binding, match policy, auth policy). Rows link to the owning agent, and flag both a dangling `agent_id` and a target whose runtime is not executable
- Virtual Keys (`/dashboard/general/virtual-keys`) — CRUD for virtual keys with route restrictions (the credentials clients use to call agents). Open to Gateway Admin, not just Platform Admin. The list shows a masked `key_preview` only; the value is copyable once from the create dialog, and a **Reveal** action (Platform Admin only, audited) recovers an existing one. The route picker spans LLM, MCP, and agent routes; create/edit includes independent optional token-bucket limits for LLM, MCP, and agent traffic (`requests_per_minute` + `burst`)

**LLM** (shared infrastructure):
- Providers (`/dashboard/llm/providers`) — CRUD for LLM providers
- Models (`/dashboard/llm/models`) — CRUD for managed models
- Credentials (`/dashboard/llm/credentials`) — CRUD for upstream credentials; externally created OAuth credentials are also listed, and the page visibly states that gateway bundle import/export excludes managed credentials and is not a complete backup
- Routes (`/dashboard/llm/routes`) — CRUD for gateway LLM routes (direct-provider + logical-model targets)

**MCP:**
- Services (`/dashboard/mcp/services`) — CRUD for MCP services (stdio/sse/streamable_http transports, env, auth) + inspect modal (capabilities, tools, tool-call, resources, resource-read, prompts, session)
- Routes (`/dashboard/mcp/routes`) — CRUD for MCP routes (service binding, match policy, auth policy)

**Runtimes** (native diagnostics only — config lives on the agent, ingress lives on Agent Routes):
- ACP Runtime (`/dashboard/acp/runtime`) — pooled instances, in-flight turns, pending permissions, keyed by `agent_id`. Pool scopes are NUL-separated (`owner\0cwd\0thread\0session\0model`), so the page splits them for display and recovers `thread_id` for Close. Closing a thread is destructive recovery, **not** run cancellation
- Builtin Runtime (`/dashboard/agents/runtimes/builtin`) — host-wide materialization state, live sessions, in-flight turns, and suspended interactive tool permissions. It is diagnostics-only: run cancellation stays on each agent's Runs tab, while builtin permission continuation stays in Chat on a new turn stream.

**Configuration:**
- Servers (`/dashboard/configuration/servers`) — Caddy HTTP server management, TLS, route dispatcher config

**Platform** (visible only to platform admins; the section is hidden via `useCurrentUser()` in `dashboard-nav.tsx`):
- Users (`/dashboard/platform/users`) — manager user CRUD (role, status, password reset)
- Gateways (`/dashboard/platform/gateways`) — gateway registry CRUD + connectivity test + per-gateway member assignment
- Audit Log (`/dashboard/platform/audit`) — read-only authorization decision log

The active gateway is chosen via the **header gateway switcher** (`components/gateway-switcher.tsx`). Switching POSTs `/admin/session/active-gateway` then reloads, so every page (SWR or legacy) re-fetches against the new gateway (§6.1 of the design). The current user, accessible gateways, and active gateway come from `CurrentUserProvider` (`components/current-user-context.tsx`).

### Frontend Conventions

- `lib/auth.ts`: localStorage helpers — `getToken()`, `saveSession()`, `clearSession()`, `isAuthenticated()`.
- `lib/api.ts`: typed `adminFetch<T>()` wrapper that injects `Authorization: Bearer <token>`, auto-redirects to `/login` on 401. Also contains typed wrapper functions for all gateway Admin API resources (providers, credentials, models, MCP services/routes/runtime, ACP + builtin runtime diagnostics, **metrics** (`getLLM*`, `getInteractions`, …), and **agents** (`listAgents`, `getAgentWorkspace`, `getAgentCapabilities`, `listAgentRuns`, `cancelAgentRun`, `listAgentRoutes`, …)). Runtime endpoints answer the normalized `{error_type, message}` contract with no `error` wrapper, so **`adminFetch` parses both contracts through `extractApiError()`** and puts the stable code on `ApiError.errorType` (via `extractRuntimeErrorType()`). Branch on `errorType`, not on the status: one status covers several causes (a 502 is `turn_failed` for anything the ACP backend could not classify — including a spawn that failed because the agent's configured `cwd` no longer exists). Reading only `error` used to leave every runtime failure reporting the bare HTTP status name ("Bad Gateway").
- **Data fetching**: prefer `useAdminSWR(key, fetcher, { live })` from `hooks/use-admin-swr.ts` over manual `useState/useEffect/loading`. Passing `live: true` ties the request to the global auto-refresh interval (`AutoRefreshProvider` in the dashboard layout); pair it with `<AutoRefreshControl>` in the page header. The hook returns the standard SWR response plus `lastUpdated`.
- **Primitives**: build pages from `PageHeader`, `Card`, `StatCard`/`StatGrid`, `Badge` (`protocolTone()` for llm/mcp/acp/agent/http accents), `Select`, `MultiSelect`, and `charts.tsx` (Recharts wrappers) rather than hand-rolled markup. Body text stays ≥ 12px.
- `components/auth-guard.tsx`: validates session via `GET /admin/auth/me`, protects dashboard routes.
- All dashboard pages use `AuthGuard` from the dashboard layout.
- **Theming (dark default + light)**: the UI is authored dark-first with hardcoded `slate-*` utilities. Light mode is achieved *without* touching components: `app/globals.css` inverts the Tailwind v4 `--color-slate-*` scale under a `[data-theme="light"]` selector (v4 compiles `bg-slate-900` → `var(--color-slate-900)`), plus explicit light overrides for the `.glass-*` utilities, body gradient, scrollbars, and selection. **Accent hues are remapped too, but only shades 100–400** — those are authored as bright-on-dark text (`text-rose-300`, `text-amber-300`, …) and wash out on a light surface, so each is pointed at its dark-side counterpart with the ramp inverted (lighter-in-dark ⇒ darker-in-light). Shades 500+ stay untouched: they back the tinted chips (`bg-blue-500/15`), borders, and solid buttons, which already read correctly on light. Every hue has entries even when unused, so a newly introduced `text-pink-300` cannot silently become unreadable — **add entries when introducing a new hue**. Two values resist the token approach and get class/utility overrides instead: `.text-slate-600` (its inverted value is a usable border but unreadable as text) and `.glass-card`'s box-shadow (the dark-theme drop shadow darkens the gaps between cards).
- **Chart colours are the one exception to the CSS-variable approach.** Recharts emits `fill`/`stroke` as SVG *presentation attributes*, where `var()` is invalid, so `charts.tsx` resolves colours in JS from `useTheme()` and exports `useChartPalette()` (rotating categorical) + `useChartTones()` (fixed success/danger). The light palette is a per-hue ~600/700 shade, not a tint — thin lines, dots, and the colour-keyed tooltip labels have to hold up on near-white. Take colours from these hooks; do not hardcode hex in pages. `components/theme-context.tsx` (`ThemeProvider`/`useTheme`, `useSyncExternalStore` over the `data-theme` attribute, persisted to `localStorage` `dashboard.theme`, cross-tab synced) wraps the app in the root layout, which also runs an inline anti-FOUC script to set `data-theme` before paint. Toggle via `components/theme-toggle.tsx` in the dashboard header. **Do not add `dark:`-prefixed classes** — keep authoring dark-first slate utilities so the inversion keeps working.

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

Gateway resource types (providers, credentials, models, virtual keys, routes) are defined inline in `lib/api.ts` alongside their API functions.

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
- **Deep resource health**: only shallow health is exposed (disabled flags, runtime counts, recent error rate). Upstream reachability / circuit-break / credential-expiry are not yet available from the gateway — the UI marks these as pending, it does not fake them. An ACP agent whose configured `cwd` no longer exists (a `/tmp` path wiped by a reboot is the common case) still reports `state: ready, healthy: true` while every spawn fails, so the manager cannot flag it: the gateway validates the directory only when it spawns the process, and answers the generic `turn_failed`.
- **Agent tasks/schedules (P2) & workflows (P3)**: backend design-only; no task queue / schedule editor / workflow graph yet.
- **Agent Form/YAML editing**: `agent-form.tsx` has a bidirectional Form ⇄ YAML switch. ACP is form-first; existing builtin agents are YAML-first, and selecting builtin moves the create flow into YAML. YAML edits the `POST /admin/agents` payload and also accepts a one-agent `agents:` fragment / GatewayBundle; referenced builtin LLM routes and MCP services are added to the submitted binding lists before save. Both modes verify that referenced resources exist before saving. This is an intentionally stricter Manager constraint than the Gateway API: dependency-catalog loading errors fail closed, and missing resources block save so a builtin agent cannot be persisted only to fail later during materialization. YAML warns when a previously derived exclusive LLM route remains bound after the builtin stops referencing it, but does not silently remove the route because persisted payloads do not retain binding provenance. Switching back validates and hydrates every form field while keeping derived bindings out of manual selection state. Switching Form away from builtin warns that derived bindings must be re-selected to remain explicit. `runtime.builtin` remains a raw JSON definition inside Form mode because recursive topology and middleware/permission/limit blocks do not yet have a visual editor.
- **Bundle import/export UI**: not built yet. Planned to decompose a bundle into per-object Admin API calls (preserving RBAC + audit granularity) with a `create/update/skip` dry run — see `docs/v0.5-alignment-plan.md` D3. `credentials` are not covered by gateway bundles at all.
- **SWR migration**: `useAdminSWR` is the standard for new/observability pages; some older CRUD pages still use the legacy `useState/useEffect` pattern and can be migrated incrementally.
