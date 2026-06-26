# Multi-User & Multi-Gateway Design

> Project: `agwmngr` (the web management frontend for agent-gateway)
> Scope: introduce multiple manager users (with per-gateway roles) and management of multiple agent-gateways from one manager
> Last updated: 2026-06-23

> **Status: implemented (P1–P4).** All phases are built and validated. One deviation from the locked storage decision: `bun:sqlite` is replaced by a runtime-agnostic adapter (`lib/sqlite.ts`) using `node:sqlite` on Node and `bun:sqlite` on Bun — because Next.js (`next dev`/`next start`) executes route handlers under Node.js even when launched via `bun run`, where `bun:sqlite` is unavailable. The schema, envelope format, guards, and request flow below match the implementation.

## 1. Core Assessment

Today the manager is effectively **stateless**: identity is a single env-configured admin (`AGWMNGR_ADMIN_USER` + bcrypt hash; legacy `CADDYMGR_ADMIN_USER` also accepted), the upstream is a single env-configured gateway (`GATEWAY_ADMIN_ADDR` + `GATEWAY_ADMIN_*`; legacy `GATEWAY_ADDR` also accepted), and the only runtime state is an in-memory `globalThis` session `Map` (lost on restart, not shared across replicas — see `lib/session.ts`).

Both requested features — multiple users and multiple gateways — are the same move at the core: **promote env-configured singletons into persisted entities.** Neither fits in `.env.local`. So the foundational step is to introduce a persistence layer; everything else is a consequence of that.

The manager already orchestrates everything through documented HTTP boundaries (`lib/gateway-proxy.ts`, `lib/caddy-manager.ts`, `lib/acp-dataplane.ts`). But authorization is **not** funnelled through one place today: the catch-all proxy (`app/api/admin/[[...path]]`) is only one of several entry points. Caddy server/route handlers (`app/api/admin/caddy/servers/**`) and the ACP chat data-plane handlers (`app/api/admin/acp/chat/{turn,permission}`) each call `requireAuth()` directly and reach a gateway by a different path. So the design must introduce a **shared access guard** that every admin entry point calls — there is no single proxy choke point to lean on.

### 1.1 Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Storage | **`bun:sqlite`** (single file `data/manager.db`) | Bun built-in, zero dependency; matches agent-gateway's own sqlite configstore; trivial to back up |
| Multi-gateway UX | **Single active-gateway context** (header switcher) | Existing pages need minimal change — data source flips from env to "currently selected gateway". Cross-gateway aggregation is explicitly out of scope for v1 |
| RBAC granularity | **Per-gateway roles** | A user is bound to specific gateways, each with its own role. Fits multi-team / multi-tenant use |

## 2. Permission Model: Two Layers + Actions

Per-gateway roles alone cannot express platform-level operations ("who may register a new gateway?", "who may create users?"). So authorization is **two layers**:

- **Platform level** — `users.is_platform_admin` (bool). Only platform admins can CRUD users, register/edit gateways, and assign gateway memberships. A platform admin implicitly has access to every gateway.
- **Gateway level** — `user_gateways(user_id, gateway_id, role)`, `role ∈ {operator, viewer}`. Governs what a non-admin user may do **inside** a gateway.

### 2.1 Actions, not HTTP methods

Mapping roles to "GET = read, everything else = write" is both too coarse and unsafe: ACP chat is a `POST` that spends tokens, runs tools, and requests permissions; some MCP inspect/tool-call endpoints are `POST` but read-like; and some `GET` endpoints expose sensitive config. So roles grant **actions**, and each entry point declares the action it performs:

| Action | Meaning |
|---|---|
| `gateway:read` | Read gateway resources/config (most `GET`s) |
| `gateway:write` | Mutate gateway resources/config (provider/route/service CRUD, Caddy CRUD) |
| `runtime:chat` | Drive an ACP conversation (data-plane turn) — spends tokens, runs tools |
| `runtime:permission_resolve` | Approve/reject a pending ACP permission |
| `secrets:read-redacted` | Read secret-bearing records in redacted form only |
| `gateway:secrets_raw` | Read a gateway resource that returns **unredacted** secret material (gateway-scoped, platform-admin only) |
| `platform:*` | Manage users, gateways, memberships (no gateway resolution) |

Role → action grants:

| Action | viewer | operator | platform admin |
|---|:---:|:---:|:---:|
| `gateway:read` | ✓ | ✓ | ✓ |
| `secrets:read-redacted` | ✓ | ✓ | ✓ |
| `gateway:write` | | ✓ | ✓ |
| `runtime:chat` | | ✓ | ✓ |
| `runtime:permission_resolve` | | ✓ | ✓ |
| `gateway:secrets_raw` | | | ✓ |
| `platform:*` | | | ✓ |

`gateway:secrets_raw` and `platform:*` are both platform-admin-only, but they are **not** the same: `platform:*` runs through `requirePlatformAccess` (no gateway), whereas `gateway:secrets_raw` is a **gateway-scoped** action evaluated by `requireGatewayAccess` — a raw secret read still targets a specific gateway and needs its resolved context/credentials to proxy. So `requireGatewayAccess` grants `gateway:secrets_raw` only when `user.is_platform_admin`, every other role denied.

The catch-all proxy, which handles arbitrary gateway-admin paths, derives a **default** action from the method (`GET`/`HEAD` → `gateway:read`, else → `gateway:write`) plus an explicit **path-prefix override table** for known exceptions. Explicit handlers (Caddy CRUD, ACP chat) declare their action directly rather than inferring it.

The override table is the security-critical part, because for **proxied** gateway endpoints the manager does not control the upstream response body — it cannot retroactively redact a raw secret the gateway returns. So each override must state not just the action but whether redaction is actually guaranteed.

**Matching semantics (pin this down to avoid off-by-`/admin` bugs):** the browser calls `/api/admin/<rest>`; the catch-all builds `proxyPath = "/admin/" + segments.join("/")` and forwards that (see `app/api/admin/[[...path]]/route.ts`). The override table matches against **exactly that `proxyPath`** — the `/admin/...` string handed to `proxyToGateway` — not the raw browser path and not the `[[...path]]` segment array. Match by normalized path-prefix on that single canonical form so one rule cannot be bypassed by an equivalent alternate spelling. The examples below use the **real upstream paths in this repo** (verified against `lib/api.ts`); treat the set as illustrative — the full table is built by auditing every secret-bearing endpoint, not just these:

| `proxyPath` prefix (canonical `/admin/...`) | Method | Decision |
|---|---|---|
| `/admin/credentials`, `/admin/llm/providers` (config with secret fields) | GET | `secrets:read-redacted` **only if** the upstream already redacts; if the endpoint can return unredacted secrets it maps to `gateway:secrets_raw` (platform-admin only, still gateway-scoped) |
| `/admin/mcp/services/*/tools/call`, `/admin/mcp/services/*/resources/read` | POST | `runtime:chat`-class (read-like but executes) — not `gateway:read` |
| `/admin/acp/services/*/sessions/*/transcript` | GET | `gateway:read` (no secret material) |

> Rule of thumb: a viewer/operator is granted `secrets:read-redacted` **only** for paths where the manager (or a known-redacting upstream) guarantees no raw secret leaves the server. Where redaction cannot be guaranteed, the path maps to `gateway:secrets_raw` (platform-admin only, but still gateway-scoped via `requireGatewayAccess`), never silently downgraded to a plain read. The table starts as a deny-by-default allowlist and is widened deliberately as upstream redaction is verified per endpoint.

> A user with no `user_gateways` row for gateway X and `is_platform_admin = false` cannot see or reach gateway X at all — the switcher does not list it, and every guard rejects requests carrying its id.

## 3. Data Model

`bun:sqlite`, file `data/manager.db`. Schema (illustrative DDL with the integrity constraints v1 should ship):

```sql
CREATE TABLE users (
  id                INTEGER PRIMARY KEY,
  username          TEXT NOT NULL,                 -- see case-insensitive unique index below
  password_hash     TEXT NOT NULL,                 -- bcryptjs, same as today
  is_platform_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_platform_admin IN (0,1)),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_users_username ON users (username COLLATE NOCASE);

CREATE TABLE gateways (
  id                  TEXT PRIMARY KEY,             -- slug, e.g. "prod-us"
  name                TEXT UNIQUE NOT NULL,
  description         TEXT,
  admin_addr          TEXT NOT NULL,               -- replaces GATEWAY_ADMIN_ADDR
  admin_user          TEXT NOT NULL,               -- replaces GATEWAY_ADMIN_USER
  admin_password_enc  TEXT NOT NULL,               -- encrypted envelope, replaces GATEWAY_ADMIN_PASSWORD
  caddy_admin_addr    TEXT,                         -- replaces CADDY_ADMIN_ADDR
  dataplane_addr      TEXT,                         -- replaces GATEWAY_DATAPLANE_ADDR
  readonly_server_ids TEXT,                         -- replaces CADDYMGR_READONLY_SERVER_IDS (CSV)
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE user_gateways (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gateway_id TEXT    NOT NULL REFERENCES gateways(id) ON DELETE CASCADE,
  role       TEXT    NOT NULL CHECK (role IN ('operator','viewer')),
  PRIMARY KEY (user_id, gateway_id)
);

CREATE TABLE sessions (
  token             TEXT PRIMARY KEY,              -- random hex, same shape as today
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_gateway_id TEXT REFERENCES gateways(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  last_seen         TEXT NOT NULL
);
CREATE INDEX ix_sessions_user    ON sessions (user_id);
CREATE INDEX ix_sessions_expires ON sessions (expires_at);

CREATE TABLE audit_log (
  id             INTEGER PRIMARY KEY,
  ts             TEXT    NOT NULL,
  request_id     TEXT,                              -- correlate with logs
  actor_user_id  INTEGER,                           -- nullable: failed pre-auth attempts
  gateway_id     TEXT,
  action         TEXT,                              -- the §2.1 action evaluated
  method         TEXT,
  path           TEXT,
  target_kind    TEXT,                              -- e.g. provider|route|user|gateway|acp_thread
  target_id      TEXT,
  decision       TEXT NOT NULL CHECK (decision IN ('allow','deny')),
  failure_reason TEXT,                              -- e.g. no_membership|role_denied|expired_session
  http_status    INTEGER,
  ip             TEXT,
  user_agent     TEXT,
  duration_ms    INTEGER
);
CREATE INDEX ix_audit_user    ON audit_log (actor_user_id, ts);
CREATE INDEX ix_audit_gateway ON audit_log (gateway_id, ts);
```

Each `gateways` row carries **all three upstream addresses** (admin / caddy admin / dataplane), because all three are env singletons today and must travel with the gateway once there is more than one.

> **Connection PRAGMAs (required).** SQLite does **not** enforce foreign keys by default — they are per-connection. Since the schema relies on `ON DELETE CASCADE` / `SET NULL`, `lib/db.ts` must run `PRAGMA foreign_keys = ON` on every connection open, or the cascades silently no-op. It should also set `PRAGMA journal_mode = WAL` (better read/write concurrency for the dashboard) and `PRAGMA busy_timeout = 5000` (avoid spurious "database is locked" under concurrent requests). With `bun:sqlite` a single long-lived connection is typical; apply the PRAGMAs at open.

## 4. Credential Encryption & Key Lifecycle

Gateway admin passwords move from env into the DB, so they must not be stored in plaintext. Key lifecycle is designed **in from the start** — retrofitting versioning after records exist is painful.

- Encrypt with **AES-256-GCM** (Node/Bun `crypto`, built-in) under a master key `MANAGER_SECRET_KEY` read via `lib/server-env.ts` (keeps it off `$`-expansion).
- **Envelope format (versioned now):** `v1:<keyId>:<iv>:<tag>:<ciphertext>` (base64 segments). The `keyId` lets a future rotation re-encrypt records key-by-key without a flag day; v1 ships with a single key id.
- **Key validation at boot:** require `MANAGER_SECRET_KEY` to decode to exactly 32 bytes (hex or base64); refuse to start otherwise. Never silently fall back to plaintext.
- **Decrypt-failure behaviour:** if a record cannot be decrypted (wrong/rotated key), do **not** crash the whole manager and do **not** treat it as auth success. Persisted `status` stays `active`/`disabled` (per the §3 CHECK); instead the gateways API returns a **computed** `health_status: 'credential_error'` field with a clear "credential undecryptable — re-enter" state. Persisted lifecycle and transient health are kept separate so the enum stays closed.
- **Redaction:** the gateways API returns records with `admin_password_set: true` and never the ciphertext or plaintext. Decrypt only at the moment of forwarding, in memory.
- **At-rest hygiene:** create `data/manager.db` with `0600` permissions; document that DB backups contain encrypted secrets and that backup + key must be stored separately (a backup is useless to an attacker without `MANAGER_SECRET_KEY`, and useless to you if the key is lost).

## 5. Request Flow & The Shared Access Guard

There is no single proxy to hang authorization on (see §1). Instead, **two shared guards** are called by every admin entry point — split because platform actions (creating the first gateway, managing users) have **no active gateway to resolve**, and forcing one would deadlock the bootstrap case (a fresh platform admin with zero gateways).

```
requirePlatformAccess(req) →                       // for platform:* endpoints
   ├─ resolve session → user        (sqlite; rejects expired / disabled-user sessions)
   ├─ require user.is_platform_admin (else deny(not_platform_admin))
   ├─ open audit context            (no gateway_id)
   └─ return { user, audit }        // no gateway resolution at all

requireGatewayAccess(req, action) →                // for gateway-scoped endpoints
   ├─ resolve session → user        (sqlite; rejects expired / disabled-user sessions)
   ├─ resolve active gateway        (session.active_gateway_id, or X-Gateway-Id override; else deny(no_active_gateway))
   │      ├─ platform admin → any gateway
   │      └─ else → require user_gateways row; else deny(no_membership)
   ├─ gateway.status == 'disabled'  → deny(gateway_disabled, 403)   // members AND platform admins
   ├─ authorize(action, role)       (per §2.1 grant table; else deny(role_denied))
   ├─ decrypt admin creds           → on failure deny(credential_undecryptable, 503)
   ├─ open audit context            (request_id, ip, ua, gateway_id, action, start time)
   └─ return { user, gateway, audit } (gateway carries decrypted creds + all 3 addrs)
```

Two failure modes are enforced **in the guard, not the handler**:

- **Disabled gateway** (`gateways.status='disabled'`) blocks all gateway-scoped *forwarding* — for members and platform admins alike — so "disabled" is not merely cosmetic. The platform APIs (`requirePlatformAccess`) can still **view / edit / reactivate** a disabled gateway, because they never enter this flow.
- **Undecryptable credentials** (wrong/rotated `MANAGER_SECRET_KEY`, the §4 `health_status: 'credential_error'` state) make gateway-scoped forwarding deny with `503 credential_undecryptable` — it never forwards with empty/garbage credentials. The platform gateway-edit API still works (it sets new ciphertext, it does not decrypt), so an admin can re-enter the password to recover.

### 5.1 Audit is a finalizer, not a single insert

The guard runs **before** the handler, so it cannot yet know the upstream status, duration, or error. Auditing is therefore a two-step **open → finalize** lifecycle, not one insert:

1. The guard **opens** an audit context at authz time (actor, gateway, action, request_id, start time) and immediately records any **deny** as a terminal row.
2. On an **allow**, the handler runs, then a `finalizeAudit(ctx, { http_status, target_kind, target_id, duration_ms, failure_reason })` call writes (or updates) the row with the real outcome — including upstream gateway status and errors.

A thin wrapper (`withAccess(action, handler)`) encapsulates both guards and the finalizer so individual route handlers don't repeat the open/finalize dance; it also guarantees a row is written even if the handler throws.

**Streaming (SSE) handlers need a stream-aware finalizer.** ACP chat (`/acp/chat/turn`) returns an SSE `ReadableStream`: by the time the `Response` object is returned, only the *headers* status is known (typically 200) — the turn may still fail, spend tokens, or be cancelled mid-stream. Finalizing at Response-return time would record a misleading 200. So for streaming handlers `withAccess` wraps the `ReadableStream` and finalizes on **stream close / error / cancel** (recording an `error`/`done`/`cancelled` outcome and any partial-usage signal), not when the Response is constructed.

### 5.2 Call sites

| Entry point | Guard + action |
|---|---|
| `app/api/admin/[[...path]]` (catch-all) | `requireGatewayAccess` — method-derived default + path-prefix overrides (§2.1) |
| `app/api/admin/caddy/servers/**` | `requireGatewayAccess` — `gateway:read` (GET) / `gateway:write` (mutations) |
| `app/api/admin/acp/chat/turn` | `requireGatewayAccess` — `runtime:chat` |
| `app/api/admin/acp/chat/permission` | `requireGatewayAccess` — `runtime:permission_resolve` |
| `app/api/admin/users/**`, `gateways/**`, memberships | `requirePlatformAccess` — `platform:*` |

`X-Gateway-Id` (optional) lets a single request temporarily target a non-active gateway; absent it, the session's `active_gateway_id` is used. `requireGatewayAccess` returns the **resolved gateway record** so the handler forwards to the right `admin_addr` / `caddy_admin_addr` / `dataplane_addr` with that gateway's decrypted credentials — the selected `gateway_id` is threaded through explicitly, never re-read from env.

## 6. Change Map (by file)

| Layer | Today | Becomes |
|---|---|---|
| **`lib/db.ts`** *(new)* | — | `bun:sqlite` connection, migrations, boot-time seeding |
| `lib/session.ts` | `globalThis` `Map` | sqlite-backed; stores `active_gateway_id`; honours `expires_at` |
| **`lib/access.ts`** *(new)* | — | `requirePlatformAccess` + `requireGatewayAccess(req, action)` guards and the `withAccess` wrapper / audit finalizer (§5); replaces direct `requireAuth()` calls |
| `lib/require-auth.ts` | compares single env user | looks up `users` table, returns a `{ user }` context (used by the guard) |
| `app/api/admin/auth/login` | bcrypt vs env hash | bcrypt vs `users` row; rejects `status='disabled'` |
| `app/api/admin/auth/me` | returns env username | returns user + `is_platform_admin` + active gateway + memberships |
| **`lib/gateway-resolve.ts`** *(new)* | — | resolve active gateway id → decrypt record (used by the guard) |
| `lib/gateway-proxy.ts` | reads `GATEWAY_*` env | takes a gateway record; base-URL cache keyed **by gateway id**; decrypts creds |
| `lib/acp-dataplane.ts` | reads `GATEWAY_DATAPLANE_ADDR` | reads `dataplane_addr` from the passed-in gateway record |
| `lib/caddy-manager.ts` | reads `CADDY_ADMIN_ADDR` / `CADDYMGR_READONLY_SERVER_IDS` | reads from the passed-in gateway record |
| `app/api/admin/[[...path]]` | `requireAuth` + proxy | `requireGatewayAccess` (method→action) + proxy + audit |
| `app/api/admin/caddy/servers/**` | `requireAuth` + caddy-manager | `requireGatewayAccess` with gateway context passed into caddy-manager |
| `app/api/admin/acp/chat/{turn,permission}` | `requireAuth` + dataplane | `requireGatewayAccess` with gateway context passed into dataplane |
| **`app/api/admin/users/*`** *(new)* | — | platform-admin CRUD for users + gateway memberships |
| **`app/api/admin/gateways/*`** *(new)* | — | gateway registry CRUD + connectivity test (`POST /gateways/{id}/test`) |
| **`app/api/admin/session/active-gateway`** *(new)* | — | set the session's active gateway (switcher target) |
| Frontend header | — | gateway switcher (lists user's gateways; writes session active gateway) |
| Frontend data layer | SWR keyed by `/admin/...` | **include `active_gateway_id` in SWR keys / context** (see §6.1) |
| Frontend nav | — | "Platform" group — **Users**, **Gateways** — visible only to platform admins |

> Because authz + gateway resolution live in **one shared guard** that every entry point calls, the existing CRUD/observability *pages* keep calling `/api/admin/*` and gain multi-gateway + RBAC without per-page authz logic. They are not fully untouched, though — the data layer is gateway-sensitive (§6.1).

### 6.1 Frontend cache is gateway-sensitive

The same `/admin/...` path returns different data after the active gateway changes. Any SWR or local component state keyed only by the path will briefly show stale data from the previous gateway. The switcher must therefore do one of (in order of preference):

1. **Key fetches by gateway** — fold `active_gateway_id` into every SWR key (e.g. via a context that prefixes keys), so a switch is a natural cache miss. Preferred; keeps per-gateway caches warm.
2. **Clear the SWR cache globally** on switch (mutate-all / cache provider reset).
3. **Force a full dashboard reload** on switch — simplest, heaviest.

The `useAdminSWR` wrapper is the natural place to inject the active gateway into the key.

## 7. Zero-Config Migration

The manager must upgrade existing single-gateway deployments without manual steps. Migration is **staged to match the phases** (§9) so that P1 introduces no new required env var:

- **Through P2 (no `MANAGER_SECRET_KEY` yet):** gateway connection stays **env-resolved** exactly as today. The DB holds users + sessions only. Seeding: if `users` is empty and `AGWMNGR_ADMIN_USER` is set → seed one `is_platform_admin` user from `AGWMNGR_ADMIN_USER` / `AGWMNGR_ADMIN_PASSWORD_HASH`. Legacy `CADDYMGR_ADMIN_USER` / `CADDYMGR_ADMIN_PASSWORD_HASH` remain accepted as fallback aliases.
- **At P3 (multi-gateway, `MANAGER_SECRET_KEY` becomes required):** on first boot with the key present, if `gateways` is empty and `GATEWAY_ADMIN_ADDR` is set → seed one gateway from the existing `GATEWAY_ADMIN_ADDR` / `GATEWAY_ADMIN_*` / `CADDY_ADMIN_ADDR` / `GATEWAY_DATAPLANE_ADDR` / `CADDYMGR_READONLY_SERVER_IDS` env, encrypting the admin password into the v1 envelope. Legacy `GATEWAY_ADDR` remains accepted as a fallback alias. Also insert a `user_gateways` row making the seeded admin an `operator` of it. If the key is **absent** at P3 boot, refuse to start with a clear message (it is genuinely required once gateway creds are persisted).

After this, env vars are **bootstrap-only**. P1/P2 deployments behave exactly as before; the new required key is introduced only at the phase that actually needs it.

## 8. Environment Variables

| Variable | Required | Introduced | Description |
|---|---|---|---|
| `MANAGER_SECRET_KEY` | Yes, from **P3** | P3 | 32-byte key (hex/base64) for AES-256-GCM of gateway admin passwords; boot fails if malformed or absent once gateways are persisted |
| `MANAGER_DB_PATH` | No | P1 | Override sqlite path (default `data/manager.db`) |
| `MANAGER_SESSION_TTL` | No | P1 | Session lifetime (default e.g. 7d) |

Existing `AGWMNGR_*` / `GATEWAY_*` / `CADDY_ADMIN_ADDR` env stay valid as **bootstrap seeds only** (env-resolved gateway through P2, seed source at P3). Legacy `CADDYMGR_ADMIN_*` env names remain valid as fallback aliases for the initial manager admin seed.

## 9. Phased Delivery

Phase 1 is a prerequisite for everything else; ship it with **no externally visible behaviour change** to de-risk the foundation. Crucially, P1/P2 keep the gateway env-resolved so no new required env var appears until P3.

- **P1 — Persistence foundation.** `lib/db.ts` + migrations + move sessions into sqlite (durable across restart). Tables created and (forward-compat) seeded from env, but auth + gateway resolution still behave exactly as today. No `MANAGER_SECRET_KEY`.
- **P2 — Multi-user (platform admins only).** `users` CRUD API + login/`require-auth` against the table + "Platform → Users" page. Still single, env-resolved gateway, so gateway access is still plain `requireAuth` with **no membership concept yet** — therefore P2 only provisions **platform-admin** accounts. Non-admin (`operator`/`viewer`) accounts simply **cannot be created** until P3 (the create form rejects/omits the non-admin role), because without membership enforcement any logged-in non-admin user would otherwise get unrestricted access to the single env-resolved gateway. This keeps P2's user-table semantics simple — every row that exists can log in normally; there is no half-disabled login state to reason about.
- **P3 — Multi-gateway + membership enforcement.** Introduce `MANAGER_SECRET_KEY` + credential encryption; `gateways` registry + seed-from-env; `lib/gateway-resolve.ts`; refactor proxy / caddy-manager / acp-dataplane to take a gateway record; header switcher + gateway-keyed SWR (§6.1); "Platform → Gateways" page **plus `user_gateways` assignment API/UI**. The `requireGatewayAccess` guard is wired into **all** gateway entry points (catch-all, Caddy, ACP chat) and **enforces membership** here — multiple users over multiple gateways is unsafe without it. (Between P3 and P4 every member is treated as an `operator`; role is recorded but not yet differentiated.)
- **P4 — Action-level RBAC + audit.** Differentiate `operator` vs `viewer` via action-based enforcement (§2.1) including the path-prefix override table; `audit_log` open→finalize writes for allow + deny (§5.1); a read-only audit view.

> Membership enforcement lands in **P3** alongside multi-gateway (you cannot safely expose a second gateway to a second user without it). P4 only adds the finer operator/viewer **action** distinction and audit — it does not introduce authorization that was missing in P3.

## 10. Security Notes & Open Questions

- **Session durability ≠ multi-replica.** Moving sessions to sqlite fixes *restart durability for a single instance*. It does **not** make sessions shared across concurrently-running web replicas — a single SQLite file is a poor fit for concurrent multi-writer replicas. v1 assumes a **single manager instance** (single writer); document this. If horizontal replicas become a requirement, switch the session/audit store to an external shared store (e.g. Postgres/Redis) — the `lib/session.ts` + `lib/db.ts` boundary is where that swap happens.
- **Log denied authorization attempts.** `audit_log` records both `allow` and `deny` decisions (with `failure_reason`), including failed pre-auth attempts (nullable `actor_user_id`); these are the rows that matter most for security review.
- **Connectivity test before save.** `POST /gateways/{id}/test` should hit the candidate gateway's `/health` (or a cheap admin endpoint) with the supplied credentials before persisting, so a typo'd address/credential is caught at creation time.
- **Disabling vs deleting users.** Prefer `status='disabled'` (keeps audit history intact) over hard delete; **revoke that user's sessions** on disable.
- **Open:** `MANAGER_SECRET_KEY` rotation — re-encrypt all gateway secrets under a new `keyId`. The versioned envelope (§4) makes this a per-record migration rather than a flag day; the rotation tooling itself is out of scope for v1.
- **Open (deferred):** cross-gateway aggregated dashboards (Overview / Usage across all gateways). Explicitly not in v1; the single active-gateway context is the chosen model.
