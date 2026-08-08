# Hierarchical Resource RBAC Design

> Project: `agwmngr`
> Status: proposed; the initial Gateway-boundary Caddy/Virtual-Key hardening and
> Provider/Credential API-key redaction are implemented
> Last updated: 2026-08-07
> Scope: evolve the manager's platform/gateway RBAC into hierarchical,
> resource-scoped authorization without changing the existing Platform Admin
> behaviour

This document builds on `docs/multi-tenant-design.md`. That design established
authentication, durable sessions, active-gateway resolution, platform access,
gateway membership, shared access guards, and audit finalization. This design
keeps those foundations and adds authorization below the gateway boundary.

The central decision is:

> **A Gateway Admin is not a separate kind of user. It is a Gateway Member with
> an `admin` role bound at gateway scope.**

The gateway is the tenant boundary and the root RBAC resource. LLM, MCP, Agent,
and their concrete resources are descendants of that root. A member can have a
different role and scope in every gateway.

---

## 1. Goals

1. Keep Platform Admin behaviour compatible with the current manager.
2. Treat every non-platform user's access as membership in a specific gateway.
3. Let a Gateway Admin manage the contents of one gateway without gaining
   platform or other-gateway access.
4. Let an ordinary Member access only explicitly granted LLM, MCP, or Agent
   domains/resources.
5. Prevent Members from accessing gateway-wide and platform-wide content.
6. Support both domain-wide grants and individual-resource grants.
7. Enforce authorization on the server, including collection filtering,
   observability queries, runtime operations, and indirect references.
8. Preserve fail-closed behaviour when a new or unclassified upstream endpoint
   is introduced for an ordinary Member. Gateway Admin compatibility uses the
   narrower, explicitly accepted denylist tradeoff in §7.4.
9. Extend the existing allow/deny audit trail with the effective scope, role,
   and resource that caused the decision.
10. Define role-appropriate response projections for upstream objects that
    embed secrets: a secret-redacted management projection for Gateway Admin
    and a narrower authorization projection for Member. Neither may expose raw
    bearer or credential values through undocumented upstream redaction.

## 2. Non-goals

- Moving authentication or policy storage into `agent-gateway`.
- Giving a Gateway Admin access to the manager's gateway registry credentials.
- Cross-gateway aggregation for non-platform users.
- General-purpose, user-configurable field-level authorization. The fixed
  secret-safe projections in §10 are part of v1 and are not optional.
- Negative grants or explicit deny rules in the first version.
- Custom user-defined roles or policy expressions in the first version.
- Treating frontend navigation hiding as a security control.

Manager-side RBAC protects access through `agwmngr`. If a user can independently
reach and authenticate to the upstream Gateway Admin API, that path is outside
this policy boundary. The gateway's Admin API must therefore remain network- and
credential-protected from manager users.

---

## 3. Terminology and principals

### 3.1 User and membership are separate concepts

`User` is an authenticated manager identity. Except for the existing platform
flag, it has no global role. Authorization comes from bindings inside a gateway.

The same user may be:

- Gateway Admin in gateway A;
- an object-scoped Member in gateway B;
- absent from gateway C and therefore unable to discover or select it.

### 3.2 Platform Admin

A user with `users.is_platform_admin = 1`. This remains the only global role.
It implicitly receives Gateway Admin authority in every gateway, subject to the
existing disabled-gateway and credential-decryption checks.

### 3.3 Gateway Member

Any non-platform user with a `gateway_memberships` row for a gateway. Membership
is required before any child resource grant is considered. A resource grant
must never create gateway membership implicitly.

### 3.4 Gateway Admin

A Gateway Member whose gateway-scope role is `admin`. The role inherits access
to all RBAC-controlled descendants inside that gateway. It does not turn the
user into a Platform Admin.

In particular, `admin` is not a synonym for the current guard's synthetic
platform-admin role. A Gateway Admin never receives `gateway:secrets_raw`,
`platform:*`, Caddy configuration access, or raw Bundle import/export.

### 3.5 Resource Member

A Gateway Member whose gateway-scope role is `member`. It receives no implicit
gateway-wide read permission and can access only domains or concrete resources
for which it has an applicable grant.

The UI may label this role simply **Member**. “Resource Member” is used in this
document only to distinguish it from Gateway Admin, who is also a member.

---

## 4. Resource hierarchy

Authorization follows this hierarchy:

```text
Platform
└── Gateway
    ├── Domain: agent
    │   ├── Agent
    │   └── Agent Route
    ├── Domain: llm
    │   ├── Provider
    │   ├── Model / Logical Model
    │   └── LLM Route
    ├── Domain: mcp
    │   ├── MCP Service
    │   └── MCP Route
    └── Shared / gateway-level
        ├── Credential
        ├── Virtual Key
        ├── Runtime diagnostics
        ├── Metrics / Interactions
        ├── Bundle
        └── Caddy Server / Route
```

The initial resource taxonomy is deliberately closed. Adding a new resource
family requires an explicit policy classification and tests before Members can
reach it.

### 4.1 Scope kinds

| Scope kind | Example | Meaning |
|---|---|---|
| `gateway` | `prod` | All gateway-internal content and child resources |
| `domain` | `agent` | All resources in one domain |
| `resource` | `agent/agent-a` | One concrete resource |

A Gateway Admin is represented by the gateway-scope role, not by materializing
wildcard grants for every child object.

### 4.2 Initial domains

- `agent`
- `llm`
- `mcp`

Shared resources are not automatically assigned to one of those domains.
Credentials and Virtual Keys can cross domain boundaries, so ordinary Members
must not receive them merely because they can access an Agent or LLM Route.
Where necessary, the manager returns a minimal redacted dependency summary.

---

## 5. Roles, permissions, and inheritance

### 5.1 Gateway roles

| Gateway role | Meaning |
|---|---|
| `admin` | Manage gateway-internal resources and gateway-scoped RBAC |
| `member` | No implicit child-resource access; explicit grants required |

### 5.2 Resource roles

| Resource role | Granted actions |
|---|---|
| `viewer` | Read the resource and its scoped, redacted observations |
| `operator` | `viewer` + execute runtime operations |
| `maintainer` | `operator` + create/update/delete configuration |

The role order is:

```text
viewer < operator < maintainer
```

`operator` is intentionally distinct from `maintainer`: sending a chat turn,
calling an MCP tool, resolving a permission, or cancelling a run is operational
and may spend tokens or cause side effects, but does not necessarily authorize
configuration changes.

**`maintainer` is deliberately incomplete in v1, and this must not be hidden.**
Two other v1 restrictions intersect it: §6.6 denies ordinary Members every
Agent/MCP ingress-route mutation, and §12.2 keeps Virtual Keys Gateway
Admin/Platform Admin-only. A Member with domain `maintainer` on `agent` can
therefore create and edit an Agent, but can neither make it reachable (no
ingress route) nor mint a credential for it (no Virtual Key); a Gateway Admin
must complete the last two steps. The role is useful for editing and operating
existing wiring, not for end-to-end self-service delivery. Do not plan a product
around Member self-service until §6.6's upstream atomic cross-kind prefix API
and a Member-safe Virtual Key workflow both exist.

### 5.3 Inheritance rules

1. Platform Admin implicitly has Gateway Admin authority in all gateways.
2. Gateway Admin implicitly has `maintainer` authority for all descendant domains
   and resources in that gateway.
3. A domain grant applies to all resources classified in that domain.
4. A concrete resource grant applies only to that resource.
5. When multiple positive grants apply, the highest resource role wins.
6. There are no negative grants in v1; a child grant cannot reduce an inherited
   parent permission.
7. Membership in one gateway never grants access in another gateway.

### 5.4 Gateway-level actions

Gateway-level actions are available to Platform Admin and Gateway Admin, not to
ordinary Members:

- gateway Overview and system health;
- global runtime diagnostics and in-flight pools;
- unscoped Usage, Metrics, and Interactions;
- gateway-wide Credentials and Virtual Keys management;
- gateway-scoped membership and resource-grant administration.

An ordinary Member may receive a scoped projection of Usage or Interactions for
an authorized Agent, but never the unfiltered gateway-wide endpoint.

### 5.5 Caddy and raw Bundle operations remain platform-only

All Caddy Server and Route reads and mutations remain Platform Admin-only in
v1. Caddy configuration is not merely another gateway child resource: a caller
who can create a listener and add `agent_gateway_admin`, or reverse-proxy to the
Admin API, can manufacture a new unauthenticated path around manager RBAC. The
current read-only detection happens only after a protected handler exists, so
it does not make creation safe.

Consequently, the explicit `/api/admin/caddy/**` handlers must require platform
status in addition to resolving the target gateway. If a later version delegates
Caddy management, it needs a separately reviewed safe configuration language
that cannot express Admin handlers, arbitrary reverse proxies, unsafe listen
addresses, or references to protected servers. Handler-name filtering alone is
not sufficient.

Raw Bundle import/export also remains Platform Admin-only because it aggregates
secret-bearing Agent, Provider, MCP, Credential, and Virtual Key configuration.
A future Gateway Admin export must have a separately versioned redacted schema;
silently applying the object projections in §10 to a round-trippable bundle is
unsafe and misleading.

The current Bundle page is manager-side composition, not one upstream endpoint:
`lib/gateway-bundle.ts` fans out over the individual resource APIs. The page at
`/dashboard/configuration/bundle` is therefore Platform Admin-only, and each
underlying API still enforces its own classifier. Reserve the canonical upstream
prefixes `/admin/bundle` and `/admin/gateway/bundle` as
`kind: "platform_gateway"` in the classifier before method defaults; they
remain denied even if a future gateway version implements them. There is no
assumption that either prefix exists today.

### 5.6 Platform-owned gateway registration

The following remain platform-only even though they describe a gateway:

- register or delete a gateway from the manager;
- change `admin_addr`, `admin_user`, or encrypted admin password;
- change `caddy_admin_addr` or `dataplane_addr`;
- enable/disable the manager's gateway record;
- perform stored-credential connectivity tests;
- read platform-wide audit logs;
- create, disable, delete, or promote manager users.

The boundary is:

> Platform Admin manages **how the manager connects to a gateway**. Gateway Admin
> manages **the contents and memberships inside that gateway**.

---

## 6. Data model

### 6.1 Gateway memberships

The existing `user_gateways` table is rebuilt as `gateway_memberships`. The
physical name is fixed because resource grants use its composite identity as
their foreign-key parent.

```sql
CREATE TABLE gateway_memberships (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gateway_id TEXT    NOT NULL REFERENCES gateways(id) ON DELETE CASCADE,
  role       TEXT    NOT NULL CHECK (role IN ('admin', 'member')),
  legacy_role TEXT   CHECK (legacy_role IN ('operator', 'viewer')),
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (user_id, gateway_id)
);
```

### 6.2 Resource grants

```sql
CREATE TABLE resource_grants (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  gateway_id    TEXT    NOT NULL,
  -- v1/Phase 2 admits domain grants only. The 'resource' branch and the
  -- concrete resource_type allowlist are added by the Phase 3 table rebuild
  -- (see below), so the closed taxonomy is only paid for if Phase 3 ships.
  scope_type    TEXT    NOT NULL CHECK (scope_type = 'domain'),
  domain        TEXT    NOT NULL CHECK (domain IN ('agent', 'llm', 'mcp')),
  resource_type TEXT,
  resource_id   TEXT,
  role          TEXT    NOT NULL CHECK (role IN ('viewer', 'operator', 'maintainer')),
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  CHECK (resource_type IS NULL AND resource_id IS NULL),
  FOREIGN KEY (user_id, gateway_id)
    REFERENCES gateway_memberships(user_id, gateway_id) ON DELETE CASCADE
);

CREATE INDEX ix_resource_grants_lookup
  ON resource_grants
    (user_id, gateway_id, domain, resource_type, resource_id);

CREATE UNIQUE INDEX ux_resource_grants_domain
  ON resource_grants (user_id, gateway_id, domain)
  WHERE scope_type = 'domain';

CREATE TABLE manager_chat_keys (
  gateway_id             TEXT NOT NULL PRIMARY KEY
    REFERENCES gateways(id) ON DELETE CASCADE,
  virtual_key_id         TEXT NOT NULL UNIQUE,
  pending_virtual_key_id TEXT UNIQUE,
  rotation_started_at    TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  CHECK (
    pending_virtual_key_id IS NULL
    OR pending_virtual_key_id <> virtual_key_id
  )
);
```

The `resource_type`/`resource_id` columns exist from the start so Phase 3 widens
CHECKs rather than adding columns, but they must be NULL in v1 and the
application must never write them before Phase 3.

The Phase 3 rebuild replaces the two CHECKs with the closed concrete taxonomy
and adds the second partial unique index:

```sql
  scope_type    TEXT    NOT NULL CHECK (scope_type IN ('domain', 'resource')),
  ...
  CHECK (
    (scope_type = 'domain' AND resource_type IS NULL AND resource_id IS NULL)
    OR
    (scope_type = 'resource' AND resource_id IS NOT NULL AND (
      (domain = 'agent' AND resource_type = 'agent') OR
      (domain = 'llm'   AND resource_type IN
        ('llm_provider', 'llm_model', 'llm_route')) OR
      (domain = 'mcp'   AND resource_type = 'mcp_service')
    ))
  )

CREATE UNIQUE INDEX ux_resource_grants_resource
  ON resource_grants
    (user_id, gateway_id, domain, resource_type, resource_id)
  WHERE scope_type = 'resource';
```

Deferring that CHECK is deliberate. Phase 3 is demand-gated and §6.4 rule 7 may
keep it permanently disabled in deployments with external Admin API writers, so
v1 should not pay a SQLite table-rebuild migration for a taxonomy that may never
be used. The taxonomy stays closed *at the storage boundary* whenever it exists;
the implementation must not move the resource-type allowlist into application
code to avoid the Phase 3 rebuild.

Keeping `domain` separate from `resource_type` makes invalid combinations
unrepresentable once Phase 3 lands: for example, a domain-scoped `agent_route`
row cannot be inserted. The concrete-resource set is closed by the table CHECK
and is widened only with policy-classifier and migration tests.

Provider, Model, and LLM Route IDs are all caller-selected identities that may
be reused after delete. LLM Route is therefore not singled out: it is eligible
for the same demand-gated concrete grant as Provider and Model, subject to the
uniform lifecycle rule in §6.4. Deployments that permit object lifecycle writes
outside this manager cannot safely enable concrete grants for any reusable-ID
type until the gateway supplies immutable incarnation IDs or authoritative
lifecycle events.

`manager_chat_keys` stores one canonical association per gateway, not bearer
material. The pending fields make replacement recoverable across crashes and
replicas; they do not contain a bearer. It has no membership dependency because
the same manager-owned Chat path is used for Platform Admin, Gateway Admin, and
Member. The simplified lifecycle is specified in §10.1. **This table is created
only if §17.2 decision 4 selects §10.1**; under §10.2 there is no new table and
this DDL is dropped from the migration.

The partial unique indexes are intentional: SQLite treats null values as
distinct in a normal unique constraint, so a single nullable composite key would
allow duplicate domain grants.

The closed `domain` CHECK is also intentional. Adding a domain requires
rebuilding `resource_grants` in SQLite, just as changing the membership role
CHECK requires a rebuild. That migration cost is accepted because it keeps the
security taxonomy closed at the storage boundary.

### 6.3 Why memberships and grants remain separate

A single polymorphic role-binding table is logically possible, but two tables
are preferred because:

- gateway membership is a security and tenant-discovery boundary;
- the active-gateway switcher needs a simple, fast membership query;
- a stale or malformed object grant cannot accidentally expose a gateway;
- foreign-key and cleanup behaviour is easier to reason about;
- Gateway Admin inheritance does not require wildcard rows.

### 6.4 Upstream object lifecycle

Concrete resources live in `agent-gateway`, not the manager database. Therefore
the manager cannot maintain foreign keys from `resource_grants.resource_id` to
the object itself.

Rules:

1. Creating a concrete grant verifies that the target currently exists.
2. Deleting an upstream object removes matching grants when the request flows
   through the manager. The gateway-wide Chat key is not
   object-owned; its obsolete route entry is harmless to manager authorization
   and is removed by the §10.1 reconciliation path.
3. List/read authorization must tolerate stale grants and never synthesize an
   object from them.
4. A reconciliation job or admin action reports and removes stale grants.
5. Resource identifiers must be treated as stable security identifiers. If an
   upstream type permits ID reuse, deleting the object must revoke grants before
   a same-ID replacement can inherit them. A manager-mediated create also checks
   for stale same-type/same-ID grants and refuses or revokes them before creating
   a replacement; it never treats their presence as authorization for a new
   incarnation.
6. IDs are normalized with the resource type's upstream canonicalizer before
   lookup and storage, then compared as exact UTF-8 byte strings. No request
   path, grant check, or reconciliation pass may apply a second URL decode,
   Unicode folding, case folding, or prefix match unless that transformation is
   part of the upstream type's documented identity.
7. Concrete grants are enabled only where the manager is the authoritative
   lifecycle write path, or the upstream exposes an immutable incarnation ID or
   lifecycle event that the manager verifies. Direct Admin API writers are
   outside the request-policy boundary but can invalidate object-lifecycle
   assumptions; a deployment that allows them must keep Phase 3 concrete grants
   disabled for reusable-ID types.

### 6.5 Derived route identifiers

`agent_route` and `mcp_route` are deliberately absent from the concrete grant
set. Their upstream IDs are derived from mutable fields (`agent_id` or
`service_id` plus `path_prefix`), so a path update both abandons a grant and can
let a later route inherit it.

In v1, read and operate authorization follows the stable owner instead:

- an Agent grant covers viewing its ingress routes, and `operator` covers using
  them through manager-authorized runtime paths;
- an MCP Service grant similarly covers viewing and operating through routes
  whose `service_id` is that service;
- every Agent/MCP ingress-route mutation remains Gateway Admin or Platform
  Admin-only, even when an ordinary Member has `maintainer` on the owner.

LLM Routes are not owner-derived. Their concrete grants follow the same
reusable-ID lifecycle gate as Provider, Model, Agent, and MCP Service grants in
§6.4; they are not excluded on a Route-specific rationale.

### 6.6 Ingress path namespace is gateway-owned

Agent and MCP `path_prefix` values share a gateway-wide data-plane namespace.
The manager cannot enforce uniqueness or non-shadowing as a security invariant:
another manager or a direct Admin API caller can bypass any local table or
process lock. v1 therefore gives ordinary Members no Agent/MCP ingress-route
create, update, or delete permission. They may view or operate owner-authorized
routes only; Gateway Admin and Platform Admin retain route management.

Delegating route mutation is blocked until `agent-gateway` exposes one atomic,
cross-kind create/update operation that rejects equal, ancestor, and descendant
prefix conflicts across Agent and MCP routes. At that point the manager can add
safe error projection so a conflict never reveals a hidden route identity.
There is no `route_namespaces` table or single-replica guarantee in v1.

---

## 7. Authorization model

### 7.1 Request context

The existing gateway guard continues to authenticate, resolve the active
gateway, verify membership, block disabled gateways, and decrypt upstream
credentials. It returns an expanded context:

```ts
interface GatewayContext {
  session: SessionRecord;
  gateway: ResolvedGateway;
  gatewayRole: "admin" | "member";
  action: GatewayAction;
  auditId: number | null;
}
```

`action` is retained because the catch-all classifier and audit finalizer use
it. The implementation may rename the current `role` field to `gatewayRole`,
but must not overload the value `admin` to imply platform status. Sensitive
checks read `session.isPlatformAdmin` directly.

Resource authorization is a second, explicit step:

```ts
interface ResourceRequest {
  domain: "agent" | "llm" | "mcp" | "gateway";
  resourceType?: ResourceType;
  resourceId?: string;
  action: "view" | "operate" | "manage";
}
```

### 7.2 Decision algorithm

```text
1. Authenticate session.
2. Resolve active gateway.
3. Determine the actor property session.isPlatformAdmin. If false, require a
   gateway membership and read its gateway role; do not synthesize a gateway
   role for Platform Admin.
4. Gateway disabled or credentials unavailable?
     yes → deny as today.
5. Classify request into platform-only/sensitive/resource policy, or
   unclassified compatibility action.
6. session.isPlatformAdmin?
     yes → allow existing Platform Admin behaviour through the guard appropriate
           to the classified surface.
7. Request is platform-only, gateway:secrets_raw, Caddy configuration, or raw
   Bundle import/export?
     yes → deny.
8. Gateway role = admin?
     yes → deny platform-only surfaces; require an explicit redacted handler for
           known secret-bearing reads; otherwise allow gateway-admin
           pass-through with the method-derived compatibility action.
9. Request is gateway-level or platform-level?
     yes → deny ordinary Member.
10. Endpoint is unclassified?
     yes → deny ordinary Member.
11. Find applicable domain and concrete grants.
12. Compute highest effective role.
13. Require role >= action requirement.
14. Apply the endpoint's response-shape validator and Member projection.
15. Audit decision with scope and target.
```

The Platform Admin check is one actor-property branch, not a synthetic
`gatewayRole = "admin"` assignment. `gateway:secrets_raw` is likewise an
actor-property check, not an effective-role grant.
When `operator` memberships are migrated to `admin`, they therefore do not gain
raw-secret access.

Ordinary Member decisions are fail-closed. Gateway Admin uses the deliberately
bounded compatibility policy in §7.4; platform-only and known secret-bearing
families are still classified before any method fallback.

### 7.3 Endpoint classification

The current method/path-to-`GatewayAction` mapper is insufficient for ordinary
Members because it does not identify resource type, resource ID, or response
filtering requirements.

Add a dependency-free policy classifier that returns one of:

```ts
type EndpointPolicy =
  | { kind: "public" }
  | { kind: "session" }
  | { kind: "platform" }
  | {
      kind: "platform_gateway";
      action: "gateway:secrets_raw" | "gateway:platform_config";
      responseMode: "single" | "collection" | "stream" | "empty";
      projection: ProjectionName;
    }
  | {
      kind: "denied";
      reason: "secret_bearing_no_projection" | "gateway_version_unreviewed";
      compatibilityAction: GatewayAction;
    }
  | {
      kind: "gateway";
      action: GatewayAction;
      responseMode: "single" | "collection" | "stream" | "empty";
      projection: ProjectionName;
    }
  | {
      kind: "resource";
      domain: ResourceDomain;
      resourceType: ResourceType;
      resourceId: string | null;
      action: ResourceAction;
      responseMode: "single" | "collection" | "stream" | "empty";
      projection: ProjectionName;
    }
  | { kind: "unclassified"; compatibilityAction: GatewayAction };
```

`public` is an exact, closed set for login and health only. `session` covers
manager-owned authenticated endpoints such as `/api/admin/auth/me`,
`/api/admin/auth/logout`, and `/api/admin/session/*`; it requires a live session
but resolves no gateway and performs no upstream forwarding. These kinds keep
the policy inventory complete without pretending that every authenticated
manager endpoint is platform- or gateway-scoped.

`platform` uses `requirePlatformAccess` and resolves no gateway.
`platform_gateway` requires `session.isPlatformAdmin` but still resolves the
selected gateway and its credentials/addresses; raw-secret, Caddy, and reserved
raw-Bundle surfaces use this kind.

`denied` is the §7.4 deny table's own kind, and it exists so the
security-critical table is a typed classifier result rather than a side list.
It is the correct kind for a known secret-bearing family that has no redacted
handler yet: such a path is not `platform_gateway` (a Platform Admin reaching it
should still go through an explicit raw handler, not catch-all pass-through),
not `gateway` (that would let Gateway Admin pass through), and not
`unclassified` (which would wrongly imply the family is merely unknown). A
`denied` policy denies every actor including Platform Admin on the catch-all;
the explicit Route Handler for that family, when it exists, carries its own
`platform_gateway` or `gateway` policy. `compatibilityAction` is retained only
so the deny is audited under a meaningful action name.

`withPlatformGatewayAccess(action, handler)` is the shared wrapper for that
second case. It authenticates the Platform Admin actor, resolves and validates
the selected gateway with the same disabled/credential failure semantics as a
gateway-scoped request, and opens/finalizes an audit row containing
`gateway_id`. Caddy must use this wrapper, not `withPlatformAccess` followed by
an ad-hoc resolver: the latter loses gateway attribution in the audit context.

`classifyEndpoint(method, canonicalSegments)` is the only method/path policy
truth source. It owns exact resource shapes, sensitive/platform-only prefixes,
and the final method-based `compatibilityAction` used to audit/guard Platform
Admin and Gateway Admin compatibility pass-through. `actionForProxyPath()`
becomes a thin compatibility projection from the returned `EndpointPolicy`;
it has no override or default table of its own. Existing
`proxy-action.test.ts` cases remain as
regression tests against this projection, and new policy coverage tests target
the classifier directly. The exact per-segment platform-only table includes
`/admin/bundle` and `/admin/gateway/bundle`, so no later method default can
downgrade either prefix to `gateway:read` or `gateway:write`.

#### 7.3.1 Classifier input namespace

`canonicalSegments` must come from exactly one URL space, or the classifier
grows the second matcher it exists to remove. Two spaces are in play today: the
manager's own route space (`/api/admin/**`, the only place
`/api/admin/auth/login`, `/api/admin/session/*`, and `/api/admin/caddy/**`
exist at all) and the upstream proxy space that the catch-all currently builds
as `"/admin/" + params.path.join("/")`. They are not interchangeable.

v1 fixes decoded, structured manager-route segments as the classifier's only
input:

1. Callers do not derive policy segments from `new URL(req.url).pathname`:
   WHATWG `pathname` preserves percent escapes and therefore is not the decoded
   route identity. The catch-all passes `["api", "admin", ...params.path]`, where
   Next has decoded each dynamic route parameter exactly once. Explicit Route
   Handlers construct the same manager-space array from their literal route
   template and decoded Next params. A decoded parameter remains one array
   element even if its value contains `/`; it is never split again. Empty,
   `.`/`..`, NUL-containing, and malformed inputs fail closed rather than being
   dropped or normalized into another route identity.
2. `classifyEndpoint` requires the leading `["api", "admin"]` segments and
   returns `unclassified` for anything else; it never accepts a bare
   `/admin/...`.
3. Only the catch-all's proxy projection maps a classified policy onto the
   upstream path. It removes the leading `api` segment and percent-encodes every
   remaining logical segment independently before joining with `/`. It never
   forwards decoded `params.path.join("/")`, which would turn an encoded slash
   inside an ID into an upstream path separator.
4. `actionForProxyPath(method, proxyPath)` keeps its current signature so the
   existing pure regression tests stay valid, but is implemented as
   a legacy adapter: it parses the percent-encoded upstream path into segments,
   decodes each segment exactly once with malformed escapes rejected, prepends
   `api`, and projects `classifyEndpoint` to a `GatewayAction`. The `/api/admin`
   prefix and decoding rule are reintroduced in exactly one adapter, not assumed
   independently at each call site. New policy-aware callers pass structured
   manager-route segments directly and do not round-trip through this string
   adapter.

Representative mappings, written in upstream form for readability — the
classifier sees each with the `api` prefix restored per rule 4:

| Request | Resource decision |
|---|---|
| `GET /admin/agents` | Agent collection; filter |
| `POST /admin/agents` | Agent domain `manage` |
| `GET /admin/agents/{id}` | Agent `{id}` `view` |
| `PUT/DELETE /admin/agents/{id}` | Agent `{id}` `manage` |
| `POST /admin/agents/{id}/permissions/{rid}` | Agent `{id}` `operate` |
| `DELETE /admin/agents/{id}/runs/{rid}` | Agent `{id}` `operate` |
| `GET /admin/llm/providers` | LLM Provider collection; filter |
| `PUT /admin/llm/providers/{id}` | LLM Provider `{id}` `manage` |
| `GET /admin/mcp/services` | MCP Service collection; filter |
| `POST /admin/mcp/services/{id}/tools/call` | MCP Service `{id}` `operate` |
| `GET /admin/acp/runtime` | Gateway-level; Member denied |
| `GET /admin/metrics/interactions` | Gateway-level unless server-enforced Agent scope is applied |

Canonical per-segment matching and single percent-decoding remain mandatory, as
defined by `lib/proxy-action.ts`. Tests pin `%2F`, `%252F`, encoded dot segments,
and malformed percent escapes so authorization and forwarding cannot interpret
the same input differently.

### 7.4 Catch-all policy

Platform Admin retains general pass-through. Gateway Admin v1 also retains
gateway-internal pass-through, but only after an exact per-segment deny table
has rejected platform APIs, Caddy, raw Bundle, raw-secret actions, and every
known secret-bearing read that lacks a redacted handler. Known secret-bearing
families never fall through to method defaults. This makes Gateway Admin
delivery independent of a 60–100-family DTO inventory while preserving the
four intended changes from today's Operator: no platform API, no Caddy, no raw
secret, and gateway-scoped RBAC administration.

Ordinary Member requests use the strict policy-aware path:

1. Only explicitly classified endpoint families are eligible.
2. Single-resource requests are authorized before forwarding.
3. Collection responses are parsed, projected, and filtered before returning.
4. Streaming requests are authorized before the upstream stream is opened.
5. Unclassified endpoints return 403, even if the HTTP method would previously
   map to `gateway:read`.

Explicit Gateway Admin handlers still validate request/response shapes where
needed, especially for secret-redacted management DTOs. Other gateway-internal
responses may pass through unchanged. This is a conscious compatibility and
delivery tradeoff: a future upstream endpoint that unexpectedly returns a new
plaintext secret could be exposed to Gateway Admin until added to the sensitive
deny table. Gateway Admin is treated as a trusted tenant administrator, but not
as a platform or credential administrator.

#### 7.4.1 Bounding the pass-through risk with a reviewed-version pin

"Upstream release review and CI drift checks" is not implementable as stated:
the manager cannot diff an upstream endpoint inventory it does not have, and the
gateway publishes no machine-readable endpoint manifest. The deny table's
completeness is therefore a property of a *specific reviewed gateway version*,
and v1 makes that explicit instead of assuming a check that cannot be written.

- The manager ships a `REVIEWED_GATEWAY_VERSIONS` allowlist next to the deny
  table, and records which gateway version each deny-table entry was reviewed
  against.
- On first contact with a gateway, the manager reads its reported version and
  caches it beside the existing base-URL cache (`lib/gateway-proxy.ts`, keyed by
  gateway id), invalidated on the same events.
- If the version is not in the allowlist, Gateway Admin **catch-all pass-through
  fails closed**: `classifyEndpoint` yields `{kind: "denied", reason:
  "gateway_version_unreviewed"}` for every path that would otherwise rely on the
  method-default compatibility action. Explicitly classified families with real
  handlers and projections keep working, because their safety does not depend on
  the deny table being complete.
- Platform Admin pass-through is unaffected: a Platform Admin may already read
  raw secrets by design, so an unreviewed version costs them nothing.
- The version pin is a manager release artifact, not gateway configuration. An
  operator who upgrades the gateway first sees Gateway Admins degrade to
  explicitly-classified surfaces, which is a visible, recoverable regression —
  not a silent secret disclosure.

If the gateway does not expose a version endpoint the manager can read, that is
a prerequisite for the Gateway Admin role and must be raised upstream before
Phase 1b; without it, the deny table has no expiry condition and the accepted
risk is unbounded rather than bounded.

Where response filtering is complex, prefer an explicit Route Handler or a
policy-aware proxy adapter over adding special cases to the generic catch-all.
The Phase 1 Gateway Admin foundation must inventory all platform-only and known
secret-bearing paths plus the endpoints that need custom redaction. Complete
endpoint/response classification remains the Phase 2 Member gate and can
proceed in parallel with Gateway Admin delivery.

---

## 8. Collection and observability filtering

Object RBAC fails if detail endpoints are protected but collection endpoints
still return every object. Filtering is therefore part of authorization, not a
UI convenience.

### 8.1 Collections

For an ordinary Member:

- a domain `viewer` grant may return the full domain collection;
- otherwise the collection returns only individually granted objects;
- the domain must have at least one applicable domain or concrete grant before
  its collection surface is authorized; a completely ungranted domain returns
  403;
- once the collection surface is authorized, filtering may legitimately return
  an empty collection with 200;
- counts, pagination metadata, and totals must be recomputed after filtering or
  filtered upstream so they do not leak hidden object counts;
- identifiers embedded in error messages must not reveal hidden resources.

The current collection APIs return one unpaginated `{items}` envelope. v1 does
not invent a paging loop for an upstream protocol that has no paging semantics:
it materializes that single response with a hard 8 MiB decoded-JSON limit.
Crossing the limit returns fail-closed 502
(`upstream_collection_limit_exceeded`) with no partial objects or hidden totals;
it never silently truncates. A collection that routinely exceeds the limit must
gain an upstream authorization/filter parameter before Member access is
enabled. Configuration may lower the bound but may not raise it without load
and leakage tests. If the gateway later adds pagination, Member support remains
disabled until the policy adapter understands that exact cursor/page contract,
fetches/filter counts correctly, and introduces separately reviewed page/object
bounds. Manager pagination is not inferred from future response fields.

The policy-aware proxy must never pass a non-platform response through merely
because the upstream returned 2xx JSON. Each eligible endpoint has an exact
response adapter. Validation is deliberately layered:

- the envelope and security identity are strict: an unrecognized top-level
  container, non-array `items`, missing/wrong-type identity, duplicate identity,
  oversized response, or adapter parse failure returns fail-closed 502
  (`upstream_shape_unrecognized`) and no upstream body;
- additional fields inside a correctly identified object are tolerated but
  discarded unless explicitly allowlisted by its projection. They neither
  appear in output nor turn a routine upstream field addition into an outage.

Strictness is right for the security decision but wrong for the operator
experience if it is the only behaviour. An envelope change on a routine gateway
upgrade would give every Member a bare 502 on an otherwise healthy system, with
no diagnosis path from the UI. v1 therefore pairs the fail-closed default with
two required affordances:

- the manager logs one rate-limited operational error naming the endpoint
  family, the observed top-level shape (container key names and `items` element
  type only — never values, ids, or secret material), and the expected adapter
  version;
- each Member endpoint family carries a per-family kill switch. When it is off,
  `classifyEndpoint` returns `{kind: "denied"}` for that family and Members
  receive the §8.2 403 "not available on this gateway version" state instead of
  a 502. Combined with §7.4.1's version pin, an operator recovering from an
  unexpected upgrade turns the affected families off and leaves the rest of the
  Member surface working.

Never invert this: the kill switch may only downgrade a family to *denied*. It
must not re-enable unvalidated pass-through, and a failed adapter must never
fall back to returning the upstream body.

The initial Member allowlist is intentionally small:

| Endpoint family | Accepted upstream shape | Member output |
|---|---|---|
| `GET /admin/agents` | `{ "items": Agent[] }` | `{items}` filtered by Agent grant and projected by §10 |
| `GET /admin/agents/{id}` | one `Agent` object | projected Agent or 404 |
| `GET /admin/agents/routes` | `{ "items": AgentRoute[] }` | routes whose `agent_id` is visible |
| `GET /admin/llm/providers` | `{ "items": Provider[] }` | visible providers, projected by §10 |
| `GET /admin/llm/routes` | `{ "items": LLMRoute[] }` | visible LLM Routes |
| `GET /admin/mcp/services` | `{ "items": MCPService[] }` | visible services, projected by §10 |
| `GET /admin/mcp/routes` | `{ "items": MCPRoute[] }` | routes whose `service_id` is visible |

Single-resource mutations and explicitly classified subresources may be added
to this list with their own request and response adapters. Bare arrays,
`{data: ...}`, and any other shape are denied in v1 unless that exact endpoint
is separately documented and tested. Global runtime, Virtual Key, Credential,
Bundle, Caddy, and unscoped metrics endpoints are not Member allowlist entries.

Phase 2 is not accepted with only these collection adapters. The Agent list and
detail workspace must classify every call made by the current UI and `lib/api.ts`:

| Agent endpoint | Required Member role / handling |
|---|---|
| `GET /admin/agents`, `GET /admin/agents/{id}` | `viewer`; filtered/projected list or projected single |
| `GET /admin/agents/{id}/workspace` | `viewer`; project nested Agent, routes, runtime summary, and permission data |
| `GET /admin/agents/{id}/capabilities` | `viewer`; capability allowlist |
| `GET /admin/agents/{id}/{health,resources}` | `viewer`; redact hidden dependency details |
| `GET /admin/agents/{id}/{activity,usage,interactions}` | `viewer`; force the authorized Agent attribution server-side |
| `GET /admin/agents/{id}/sessions` and transcript subpaths | `viewer`; capability-gated, transcript projection |
| `GET /admin/agents/{id}/{runs,permissions}` | `viewer`; scoped runtime-state projections |
| `POST /admin/agents/{id}/permissions/{request_id}` | `operator`; exact owner shape |
| `DELETE /admin/agents/{id}/runs/{run_id}` | `operator`; exact owner shape |
| `POST /admin/agents`, `PUT/DELETE /admin/agents/{id}` | domain/resource `maintainer`; request validation and projected response |
| `GET /admin/agents/routes[/{id}]` | owner-derived `viewer`; filtered/projected |
| `POST/PUT/DELETE /admin/agents/routes[/{id}]` | Gateway Admin/Platform Admin only in v1 (§6.6) |

The acceptance test derives this inventory from frontend wrappers/route usage
and fails when a newly used endpoint has no policy. Equivalent LLM and MCP UI
coverage inventories are required before exposing those groups to Members.

### 8.2 Discovery and status semantics

| Situation | Result |
|---|---|
| Surface/domain has no applicable grant | 403 |
| Surface is gateway-only, platform-only (including Caddy/raw Bundle), or unclassified | 403 |
| Authorized collection surface, but no visible objects match | 200 with an empty collection |
| Concrete object exists upstream but is hidden from caller | 404 |
| Concrete object does not exist upstream | 404 |
| Ordinary Member attempts any Agent/MCP ingress-route mutation | 403 |

This table applies consistently to direct API calls and UI pages. A 404 is not
used to disguise an entirely unauthorized surface; it is used only inside a
surface the caller is otherwise allowed to discover.

### 8.3 Usage, Metrics, and Interactions

Gateway-wide observability is denied to ordinary Members. Scoped projections
are allowed only when the server derives the filter from the authorization
context.

The current upstream `MetricsQuery.agent_id` supports only one Agent. Therefore
v1 Member Usage and Interactions require an explicit, server-validated single
Agent selection. The UI offers no Member "All agents" option. The manager checks
that Agent grant and overwrites the upstream `agent_id`; a browser-provided
value is only a requested narrowing condition, never the source of authority.

The manager must not issue N single-Agent queries and merge them: top-N
truncation, weighted average latency, totals, and time buckets cannot be
reconstructed reliably from those responses. Multi-Agent scoped observability
is blocked on an upstream set-valued Agent filter whose aggregation happens
before top-N/pagination.

The response must not contain spans or totals attributed to another Agent. It
may contain the redacted dependency dimensions observed on the authorized
Agent's own events: opaque route, provider, model, service, and Virtual Key IDs
or display labels. This is dependency visibility, not a transitive grant: no
secret/configuration fields are returned, and such an ID does not authorize its
detail endpoint or mutation. This is the same redacted dependency-summary rule
as §9.1. The implementation must use the gateway's full Agent attribution
semantics rather than only durable tags, so untagged-but-mappable events behave
consistently with existing Agent filters.

### 8.4 Runtime state

Global ACP/Builtin/MCP runtime endpoints expose gateway-wide state and are denied
to Members. Per-Agent runs, sessions, transcript, permissions, workspace, and
health may be returned when the Member has the required Agent role and the
backend advertises the corresponding capability.

---

## 9. Indirect references and ownership

Agent and route objects reference shared resources. Grant inheritance must not
silently cross those references.

### 9.1 No transitive management grant

Access to an Agent does not automatically grant direct access to its:

- Virtual Keys or Credentials;
- LLM Providers, Models, or Routes;
- MCP Services or Routes;
- downstream Agents reachable through Agent Routes.

An authorized Agent view may include a minimal, redacted dependency projection
needed to understand the Agent. Direct navigation or mutation of a dependency
requires its own applicable grant.

### 9.2 Create and update validation

When a Member with `maintainer` permission creates or updates a resource, every
referenced object must be checked. The initial rule is:

- the caller must have at least `viewer` permission on a referenced object;
- secret-bearing references may be selectable by opaque ID/name without
  exposing secret values;
- the write is denied if it would attach a hidden or dangling object;
- response bodies are redacted to the caller's effective permissions.

Gateway Admin and Platform Admin retain full reference visibility subject to
the existing raw-secret restriction.

Reference checks also run at operation time, not only on configuration writes.
Chat resolves `route_id -> agent_id` and requires that Agent's `operator` role;
MCP tool/resource/prompt calls resolve the path service and require that MCP
Service's `operator` role; permission and run actions resolve their owning Agent.
Any caller-supplied Virtual Key ID, service ID, route ID, or embedded target is
treated as input to resolution, never as proof of authority.

ACP and HTTP Agent writes use one canonical server-side reference extractor for
create/update validation, response projection, attribution, and tests. The
frontend walker in `hooks/use-agent-attribution.ts` is useful prior art but is
not an authorization control.

`runtime.builtin` is recursively nested, YAML-first configuration whose schema
continues to evolve. An incomplete walker would silently miss references and
violate the non-transitive authorization rule. In v1, an ordinary Member may
view a narrow builtin Agent projection and operate it when authorized, but may
not create or update a builtin Agent even with domain/resource `maintainer`.
Builtin configuration remains Gateway Admin/Platform Admin-only until the
gateway publishes a versioned reference schema or the manager has an exhaustive
server-side extractor with conformance fixtures for every reference-bearing
shape.

### 9.3 Agent Routes

An Agent Route targets one Agent. Because its route ID is derived and mutable,
v1 route authority follows the Agent grant as defined in §6.5: `viewer` may
read its route projection and `operator` may chat through it. Ingress-route
mutation is Gateway Admin/Platform Admin-only as specified in §6.6. The Agent
detail may show only the authorized projection.

Chat authorization is based on the target Agent's `operator` permission after
the manager resolves the route server-side. Supplying a route ID/path must not
be sufficient by itself.

### 9.4 Accepted transitive execution risk

Operating an authorized object can intentionally cause work in a downstream
object the caller cannot manage directly: an Agent can call another Agent, and
an Agent tool can call an MCP Service or LLM Provider. This is an inherent
capability delegation performed by the configured Agent, not an implicit direct
RBAC grant. The caller may observe only the parent operation's redacted result
and scoped trace; it cannot navigate to or reconfigure the downstream object.
Maintainers who attach dependencies accept this execution delegation and must
pass the reference checks above.

---

## 10. Secret policy

The existing distinction between redacted secret reads and raw secret reads is
preserved.

Independent of the later resource hierarchy, the management UI treats Provider
`api_key` and Credential `attributes.api_key` as write-only. Inputs use password
controls while the user types; list/detail/mutation responses omit the value and
return only `api_key_set`; edit forms start empty; and an omitted/blank edit
preserves the stored value through a server-side merge. The UI never renders a
prefix, suffix, mask derived from the key, or a previously submitted value.

- Platform Admin may perform `gateway:secrets_raw` where explicitly supported.
- Gateway Admin may manage secret-bearing resources through write-only or
  redacted interfaces but does not receive raw provider credentials, MCP auth,
  Agent runtime secrets, Virtual Key bearer values, or the manager's stored
  gateway admin password.
- Ordinary Members never receive raw credentials.
- A domain or resource grant never overrides the raw-secret restriction.
- Collection filtering happens after guaranteed upstream redaction, or the
  endpoint is denied.

Credential resources are gateway-level in v1. If future requirements need
credential delegation, add a dedicated credential-reference permission rather
than classifying credentials under LLM or MCP.

The current upstream cannot be assumed to redact. In the implementation
reviewed for this design, MCP Service responses embed `env` and `auth`, Agent
runtime config includes ACP `env` and `cwd`, and Virtual Key list/get responses
include the bearer `key`. Two manager-owned DTO levels are therefore required:

| Object | Gateway Admin management projection | Member authorization projection | Always omitted from non-platform responses |
|---|---|---|---|
| Agent | full editable structure: identity/policy, `cwd`, command/args, and builtin config; environment names retained only as `value_set` metadata and secret writes use an explicit write-only patch | identity, description/status, runtime type/status, capabilities, policy, and authorized dependency IDs/summaries | environment values, credential/bearer values, and unknown secret fields |
| MCP Service | editable transport/endpoint structure; env/header names retained only as `value_set` metadata and secret writes use an explicit write-only patch | identity, description/status, transport kind, capabilities, source/read-only flags | env/auth/header values and unknown secret fields |
| LLM Provider | editable non-secret provider configuration and model metadata; secret fields represented only by `*_set` markers | identity, type/status, source/read-only flags, non-secret model metadata | API keys, auth header values, credential payloads, and unknown secret fields |
| Virtual Key | policy metadata, identity, status, allowlist and `key_set` | no general Member listing; authorized Agent dependency views may expose only an opaque ID/name | bearer `key`; only Platform Admin may use a separate one-time raw-secret delivery path |

**Credential has no row in this table on purpose.** It is not an oversight and
not a pending DTO: v1 keeps the Credential family denied to Gateway Admin and
Member entirely (§5.4 makes credentials gateway-level, and §10's closing rule
denies any endpoint whose documented projection cannot be constructed). The
current `GET /admin/credentials` mapping to `secrets:read-redacted` is a
*Platform-Admin-era* assumption about upstream redaction that has not been
verified endpoint by endpoint; until it is, delegating it is not safe. Any
future Credential delegation adds a dedicated credential-reference permission
plus its own projection and write protocol, reviewed separately. §15's Phase 1b
list must not be read as promising a Gateway Admin Credential DTO.

The Gateway Admin Agent DTO must support YAML mode, Configuration-tab bundle
fragments, and edit-form round trips without erasing runtime structure. Secret
fields are not represented by a mask string. A read returns only metadata such
as environment/header name and `value_set: true`; the editable YAML contains
non-secret runtime structure and cannot set or delete secrets. A separate
write-only patch carries `set: {name: plaintext}` and `unset: [name]` for Agent
environment values and the equivalent MCP/auth families. Omission means
preserve, membership in `unset` means delete, and membership in `set` means
create/replace; the same name in both sets, duplicate names, or a non-string
plaintext value is rejected. A literal value that happens to resemble a UI mask
is therefore just an explicit new value, never an ambiguous preservation token.
The manager fetches the raw current object only inside a module-private service,
merges the validated non-secret DTO and write-only patch server-side, and sends
the upstream whole-object update without returning the merged secrets. The
narrower Member DTO is not reused for Gateway Admin.

That merge is a read-modify-write against an upstream that exposes no
concurrency token: the gateway Admin API has no `ETag`/`If-Match` on these
objects. The management DTO therefore carries the `updated_at` observed at read
time — or, where the upstream object has no such field, a manager-computed hash
of the canonicalized raw object. The write path re-reads inside the
module-private service, compares that token, and rejects an already-stale edit
with 409 `stale_object` so the UI reloads and reapplies. The same token check is
used for Member `maintainer` writes and runs only after authorization, so it
does not reveal whether a hidden object changed.

This is stale-edit detection, not compare-and-swap. Two concurrent writers can
both re-read the same version, both pass the comparison, and then overwrite one
another. A direct Admin API writer creates the same race. v1 explicitly accepts
that residual lost-update window; it must not claim serializable updates without
an upstream conditional-write primitive. If that guarantee becomes required,
the gateway must add an atomic revision/`If-Match` contract (or all writers must
share a gateway-authoritative lock). A manager process-local lock is
insufficient across replicas and direct Admin API clients.

Gateway Admin create/update responses and the Platform Admin managed-key
replacement response never include a generated bearer. Only Platform Admin may
invoke a separate, audited one-time raw-secret delivery path; subsequent
list/get/update responses are redacted for everyone unless an explicit Platform
Admin raw action exists. Write APIs use write-only secret fields where blank
means preserve. If the manager cannot
construct and validate the documented projection for an endpoint, that endpoint
is denied. This intentionally expands the old redaction boundary; it does not
introduce arbitrary per-field grants.

The proxy classifier must also close the current Virtual Key gap: member-facing
`GET /admin/virtual_keys[/{id}]` is never the default `gateway:read`. Ordinary
Members are denied, Gateway Admins go through an explicit redacted handler, and
only a Platform Admin may use a raw response path. The same rule applies to any
future endpoint that starts returning bearer or credential material.

This gap is live today, not hypothetical. `actionForProxyPath` has no entry for
`/admin/virtual_keys`, so both reads take the method default `gateway:read`,
which the current `GRANTS` table hands to `viewer` — every gateway member,
including read-only ones, can already read plaintext bearer `key` values off the
list endpoint. The full redacted handlers cannot land before PR3 without
breaking the pages that consume those shapes, so PR1 first maps the two reads to
the temporary `gateway:virtual_keys_raw_compat` action, granted only to
`operator` and the implicit Platform Admin (§15 Phase 1a-0). That bounds the exposure to callers who
can already write gateway configuration during the intervening releases; it is a
mitigation, not the fix, and does not reduce PR3's scope. The action is audited
on allow because it returns bearer material and is deleted when PR3 replaces the
raw compatibility path with explicit redacted/raw handlers.

### 10.1 Managed Chat credential path

Chat uses the same server-managed credential path for Platform Admin, Gateway
Admin, and Member. It never accepts `virtual_key` from the browser and never
returns a Virtual Key value. This design deliberately chooses the simpler of two
possible models: one reserved manager Chat key per gateway, not one key per
user/Agent. Agent-level authorization is authoritative in the manager; the
upstream key is transport authentication, not an upstream RBAC boundary.

1. The manager idempotently creates one key in the reserved `agwmngr-chat:` ID
   namespace and stores only its upstream ID in `manager_chat_keys`. User-created
   Virtual Keys cannot use that prefix. The current gateway validates a Virtual
   Key ID only as non-empty and treats it as an opaque string, so `:` is valid;
   an upstream contract test pins that assumption before release. Its allowlist
   covers all current Agent ingress routes on that gateway and the bearer
   remains upstream.
2. On every turn and permission request, the server re-authorizes effective
   Agent `operator` authority, resolves the requested route and its current
   `agent_id`, and rejects any mismatch before retrieving and injecting the key
   server-to-server. The bearer is fetched through a module-private
   `getManagerChatKeyRaw()`-style helper that calls the gateway Admin API
   directly; it never traverses the manager's redacted HTTP handlers. The raw
   getter itself is not exported; the Chat credential service exports only an
   operation that injects the credential into a server-side data-plane request,
   never a function returning the bearer. A browser route, key ID, or Agent ID
   is never authority.
   The bearer is cached only in process memory, keyed by gateway and upstream
   key ID, with a short bounded TTL. Rotation/delete invalidates the cache, and
   an upstream authentication failure evicts it before the single allowed retry.
3. The Chat hot path never performs a read-modify-write of the shared key.
   Manager route create/update/delete handlers (or the classified proxy's
   successful mutation finalizer) reconcile the key after their mutation, and
   a data-plane 401/403 triggers one bounded lazy reconciliation followed by at
   most one retry. Single-flight is process-local only. With multiple replicas,
   one incident may cause at most one reconciliation per replica; those
   reconciliations may overlap and must therefore be idempotent, read current
   upstream state immediately before writing, and converge to the same complete
   route allowlist. v1 explicitly accepts this bounded redundant work rather
   than claiming a cross-replica lock; deployments that require globally
   serialized repair need an external coordinator. Obsolete route IDs may
   remain temporarily: manager-side resolution cannot resolve a deleted route,
   so they do not widen the manager Chat surface. Missing, disabled, unreadable,
   or non-reserved key state fails closed; the manager never falls back to a
   user key. Direct Admin API route changes are outside the manager policy
   boundary and may temporarily cause Chat denial until lazy repair.
4. Provision, rotate, and reconcile operations are audited without bearer
   material. The Virtual Keys page marks the object `manager-managed`, hides
   ordinary edit/delete controls, and provides an audited rotate action. This
   is also enforced in the server write path: explicit POST/PUT/DELETE handlers
   reject user-created IDs in the reserved prefix and reject ordinary update,
   disable, or delete operations targeting the managed key. Only the internal
   managed-key service may provision/reconcile it, and only the explicit audited
   Platform Admin rotation action may replace it. The catch-all never receives
   a Virtual Key mutation.
   The gateway has no native rotate endpoint. “Rotate” here is a manager-owned,
   retryable replacement workflow: generate a new reserved ID, reserve it with
   a SQLite CAS into `pending_virtual_key_id`, create it upstream with the
   complete allowlist, then atomically promote pending to
   `virtual_key_id`/clear pending. Invalidate the rotating replica's local cache;
   other replicas observe the new association on TTL expiry or evict the old
   bearer on 401. Then delete the old key. A crash or replica takeover resumes
   from the persisted pending state; reconciliation deletes reserved IDs that
   are neither current nor pending. Failure before promotion cleans or retries
   the candidate; failure after promotion leaves the new key canonical and
   queues best-effort cleanup of the old key. A normal rotation accepts a brief
   dual-valid cleanup window;
   an incident-response rotation disables the old key first and accepts
   temporary Chat unavailability. No schema or client code may assume an
   upstream `rotate` verb.
5. Raw Bundle export and import exclude every `agwmngr-chat:` object on both
   sides. `lib/gateway-bundle.ts` must filter it before serialization, planning,
   create, or update so a round trip cannot copy, overwrite, or delete the
   reserved transport credential.

This loses upstream Agent-level defence in depth: compromise or misuse of the
single bearer outside the manager can reach every allowlisted Agent route. The
accepted benefit is avoiding per-user/Agent key quotas, two-phase route/key
updates, orphan-key cleanup, and N-by-M reconciliation. The manager admin
credential can already administer all gateway objects, so this key receives the
same storage, logging, and incident-response treatment. If the threat model later
requires upstream isolation, per-principal keys are a separate design rather
than an implicit v1 requirement.

It also intentionally collapses gateway-side attribution, rate limits, and
quotas for manager Chat onto one Virtual Key. Usage “group by key” identifies
manager Chat as the single reserved key and cannot distinguish manager users;
per-user attribution remains available only from manager audit/session metadata,
not the gateway's key dimension. Per-key quotas apply to aggregate manager Chat
traffic. This observability and quota regression is accepted for v1 alongside
the simpler lifecycle; deployments requiring per-user upstream accounting must
choose the separate per-principal-key design.

Routes with `require_virtual_key=false` still require manager-side Agent
authorization when used through Chat. They are publicly callable on the data
plane by design, so administrators must not treat manager RBAC as protection for
that external path. The current request-body `virtual_key` field in both Chat
handlers must be removed before the managed path is enabled for any role. Direct
distribution of a bearer key to a manager user is explicitly unsupported because
it would let that user bypass manager RBAC.

### 10.2 Alternative considered: server-side key-ID resolution

§10.1 is the largest single new subsystem in this design — a new table, a
reserved ID namespace enforced on every Virtual Key write path, a TTL bearer
cache with eviction, route-mutation reconciliation hooks, bounded lazy repair
with process-local single-flight, a manager-owned rotation workflow with
persisted CAS state and crash resume, Bundle filtering on both sides, and an
upstream contract test for `:` in Virtual Key IDs. It also **gives up** upstream
per-Agent defence in depth, gateway-side by-key attribution, and per-key quotas
(§10.1 states all three).

The requirement that actually forces PR2 before PR3 is narrow: the browser must
stop holding bearer material before the Virtual Key read path is redacted. A
smaller design satisfies exactly that requirement:

> The browser sends a Virtual Key **ID**, never a bearer. The Chat handler
> authorizes the resolved Agent as it does today, then resolves ID → bearer
> inside the same module-private helper §10.1 already specifies
> (`getManagerChatKeyRaw()`-style, never exported, never traversing the
> manager's own redacted HTTP handlers) and injects it server-to-server.

Compared with §10.1 this removes `manager_chat_keys`, the reserved namespace and
its write-path invariants, the rotation workflow, and all allowlist
reconciliation, while keeping every property that matters for this design: no
bearer in the browser, no bearer in a manager response, server-side Agent
authorization on every turn, and a caller-supplied ID treated as input to
resolution rather than as authority. It additionally *keeps* the upstream
allowlist as a second boundary and preserves per-key usage attribution and
quotas.

Its costs are real but smaller: the caller still selects a key, so the UI needs
the redacted Virtual Key list that PR3 delivers anyway; the manager must verify
the selected key's allowlist actually covers the resolved route and return a
clear error when it does not; and there is no single reserved credential to
rotate centrally, so key rotation stays the administrator's existing manual
task. It does not deliver §10.1's "Chat works with zero Virtual Key
administration" property.

**This choice is open — see §17.2 decision 4.** It materially changes the size
and ordering of Phase 1a-1 and Phase 1a-2 and should be settled before either is
estimated. The two options share the same security contract, so choosing the
smaller one is not a weakening of this design; choosing §10.1 buys operational
simplicity for administrators at the cost of the subsystem above and the three
named regressions.

---

## 11. RBAC management API

Platform Admin may manage memberships and grants for every gateway. Gateway
Admin may manage memberships and grants only for its active gateway.

Recommended endpoints:

```text
GET    /api/admin/rbac/members
PUT    /api/admin/rbac/members/{userId}
DELETE /api/admin/rbac/members/{userId}

GET    /api/admin/rbac/members/{userId}/grants
POST   /api/admin/rbac/members/{userId}/grants
PUT    /api/admin/rbac/members/{userId}/grants/{grantId}
DELETE /api/admin/rbac/members/{userId}/grants/{grantId}
```

These are gateway-scoped endpoints resolved through the active gateway. They do
not expose the platform gateway registry. The current platform endpoint
`/api/admin/gateways/{id}/members` remains Platform-Admin-only during Phase 1b
and delegates to the same service functions. It is deprecated as soon as the
new editor switches to `/api/admin/rbac/*` and is removed before Phase 2 Member
enforcement is enabled; there is no indefinite dual API surface.

Safety rules:

1. Gateway Admin cannot grant Platform Admin status.
2. Gateway Admin cannot create or delete manager user identities.
3. A grant's `gateway_id` always comes from the authorization context, never
   solely from the request body.
4. A Gateway Admin cannot modify another gateway's bindings through an
   `X-Gateway-Id` it cannot access.
5. Removing a membership cascades grants through the composite membership FK.
   It does not rotate or delete the gateway-wide manager Chat key; every new
   Chat request is re-authorized before that key can be used.
6. Removing the last non-platform Gateway Admin is allowed only to Platform
   Admin and produces a high-visibility warning. Platform Admin inheritance
   means the gateway is not technically orphaned, but delegated administration
   is lost.

### 11.1 Self-service password change is a prerequisite, not a gap

`AGENTS.md` lists "Change password: UI exists in user panel but no backend
endpoint" as a known gap. Under single-admin operation that was cosmetic. This
design makes it load-bearing: Gateway Admin explicitly cannot create or reset
manager user identities (safety rule 2), so with a real population of Members
every forgotten or shared password becomes a Platform Admin ticket, and the
common workaround — a Platform Admin setting a password and sending it to the
user — is worse for security than the feature.

`POST /api/admin/auth/password` is therefore a Phase 1b deliverable:
`kind: "session"` in the classifier (live session, no gateway resolution, no
upstream forwarding), requires the current password, rejects the request for a
disabled user, revokes the user's *other* sessions on success while keeping the
calling one, and audits allow/deny without password material. It is small and
independent of the RBAC hierarchy, so it may land earlier, but it must not ship
*after* the first release that creates non-platform Members who cannot manage
their own credential.

---

## 12. UI behaviour

### 12.1 Session payload

The session gateway response should expose the active gateway role and a compact
capability summary:

```jsonc
{
  "id": "prod",
  "name": "Production",
  "is_platform_admin": false,
  "role": "admin", // or "member"
  "capabilities": {
    "gateway": ["view", "manage_rbac"],
    "domains": {
      "agent": ["view", "operate"],
      "llm": ["view"],
      "mcp": []
    }
  }
}
```

One shared backend function, `computeEffectiveAccess(session, gatewayId)`,
produces both this summary and the authorization facts consumed by request
enforcement; endpoint-specific checks add resource identity and request shape
to that result. The serialized summary is advisory and may become stale in the
browser, but its computation cannot drift into a second permission model.
`is_platform_admin` is explicit because
the effective gateway role `admin` alone cannot distinguish Platform Admin from
Gateway Admin; the frontend must not infer it or join a second `/auth/me`
response to decide whether to show Platform surfaces.

The migration audits every frontend consumer of `gateway.role`. Code must use
`is_platform_admin` for Platform navigation/actions and `role` only for
gateway-scope capability display; a literal `role === "admin"` must never be
treated as proof of platform authority. Prefer the name `gateway_role` in new
internal types even if the wire field remains `role` for compatibility.

**The overload must be removed at the source, not only avoided by convention.**
`listGatewaysForUser()` today returns the literal `"admin"` for a Platform Admin
on every gateway (`lib/db.ts`, `UserGatewayEntry.role`), which is exactly the
value that will mean "Gateway Admin" after this design lands. Two different
principals would then serialize identically, and the switcher already renders
that field verbatim as a badge (`components/gateway-switcher.tsx`), so a Platform
Admin and a delegated tenant administrator would be visually indistinguishable.

Phase 1b therefore changes `UserGatewayEntry.role` to a three-value union:

```ts
type UserGatewayRole = "platform_admin" | "admin" | "member";
```

`"platform_admin"` is returned only for implicit platform inheritance and is
never stored in `gateway_memberships`. Any code that must answer "may this actor
use Platform surfaces?" still reads `session.isPlatformAdmin` / the
`is_platform_admin` wire field; the third role value exists so the *display* and
any future gateway-scope logic cannot silently conflate the two, not as a second
source of platform authority. The switcher badge renders a distinct label for
it.

### 12.2 Navigation

- Platform group: Platform Admin only, unchanged.
- Overview and Runtime diagnostics: Gateway Admin and Platform Admin only.
  Raw Bundle Configuration and Servers/Caddy: Platform Admin only.
- Agent, LLM, and MCP groups: shown when the Member has at least one grant in
  that domain.
- Usage and Interactions: shown to a Member only as scoped Agent views.
- Credentials and Virtual Keys: Gateway Admin/Platform Admin only in v1.

After login or gateway switch, a Member lands on the first granted domain in
the order Agent → LLM → MCP (normally `/dashboard/agents`), never the
Gateway-Admin-only Overview. A Member with no grants lands on a dedicated
authorized `/dashboard/no-access` empty state explaining that gateway membership
exists but no resources have been assigned; it must not poll denied Overview
endpoints.

Direct navigation follows the status table in §8.2: an unauthorized surface is
403, an authorized collection may be empty with 200, and a hidden concrete
object inside an authorized surface is 404.

`adminFetch` exposes a typed 403 distinct from its current 401 session-expiry
path. A page receiving 403 renders an in-place Access Denied state, stops SWR
retry and auto-refresh for that request key, and offers a link to the first
authorized page; it does not log out or redirect to login. Mutations keep the
current page data, show the denial reason safe for that surface, and refresh the
capability summary once. A 404 inside an authorized surface uses the normal Not
Found state and never reveals whether the object is hidden.

Only the page's authoritative primary query may promote a 403 to the page-level
Access Denied state. Optional cross-domain enrichment such as
`useAgentAttribution()` / `UsedByAgents` treats a typed 403 as “enrichment not
available”, stops retrying that helper key, and hides the chip without failing
the authorized Provider, MCP Service, Route, or Virtual Key page. Other optional
widgets must declare the same local fallback explicitly; they may not let an
ungranted auxiliary domain erase an otherwise authorized surface. Non-403
failures keep their normal error behaviour and are not silently swallowed.

### 12.3 RBAC editor

Gateway Admin gets a gateway-scoped Members page with:

- member search/addition from existing manager users;
- gateway role (`admin` or `member`);
- domain grants for Agent, LLM, and MCP;
- optional expansion into individual resource grants;
- effective-permission preview showing inherited and direct grants;
- rejection or a prominent warning when a proposed grant is fully shadowed by
  a broader equal-or-higher domain grant (for example, resource `viewer` under
  domain `maintainer`); positive grants cannot express narrowing;
- warnings for stale grants and last-Gateway-Admin removal.

Only Platform Admin can create the underlying user account. A future invitation
workflow is outside this design.

---

## 13. Auditing

Extend audit records, or add structured metadata, with:

- `scope_type`: `platform`, `gateway`, `domain`, or `resource`;
- `resource_type`;
- `resource_id`;
- `required_action`;
- `effective_role`;
- `grant_id` when a direct grant caused the allow, plus the immutable decision
  snapshot (`scope_type`, `domain`, `resource_type`, `resource_id`, role) so an
  audit row never depends on a later grant lookup;
- `failure_reason`, including `no_membership`, `gateway_role_denied`,
  `no_resource_grant`, `insufficient_resource_role`, and
  `endpoint_unclassified`.

Continue recording every deny. Record allows for:

- all mutations;
- runtime operations;
- permission resolution;
- RBAC changes;
- sensitive reads.

Collection reads need not emit one audit row per returned object. Record the
scope and number of visible items where useful. Streaming operations continue
to finalize on stream close/error/cancel, not when the Response is returned.

`audit_log` must not grow without bound even before Member RBAC ships. The
manager has no scheduler/worker today, so Phase 1a-0 uses opportunistic
write-path cleanup rather than an unspecified "scheduled job". After a
successful audit insert/finalize, `insertAudit` (or one shared audit-write
helper) attempts cleanup only when a configurable sweep interval has elapsed,
using one idempotent, **row-bounded** statement:

```sql
DELETE FROM audit_log
 WHERE id IN (SELECT id FROM audit_log WHERE ts < ? LIMIT 5000);
```

The `LIMIT` subquery is not decoration. An unqualified
`DELETE FROM audit_log WHERE ts < ?` is one statement but not bounded work: both
SQLite adapters are synchronous, so the first sweep after the retention window
opens (or after any backlog) deletes every eligible row, writes them all to the
WAL, and blocks the request that happened to trigger it — on the audit write
path, which every guarded request traverses. `DELETE ... LIMIT` itself is not
portable (it needs `SQLITE_ENABLE_UPDATE_DELETE_LIMIT`, which neither
`node:sqlite` nor `bun:sqlite` guarantees), so the bound is expressed through
the subquery, which works on a stock build. Each sweep removes at most one
batch; the throttle interval means a large backlog drains over several sweeps
instead of in one stall. The batch size is configurable alongside the cutoff.

Phase 1a-0 also adds `CREATE INDEX ix_audit_ts ON audit_log(ts)`. The existing
compound indexes begin with actor or gateway and cannot support a global
timestamp cutoff; running this DELETE without the single-column index would put
an unbounded full-table scan on the audit write path.

The cutoff defaults to 90 days and has a documented compliance override. A
`globalThis` timestamp, initialized like the existing database singleton,
throttles attempts per process; multiple replicas may run the same DELETE and
are safe because the predicate is idempotent. Cleanup is best-effort, bounded to
one batched statement, never blocks or rolls back the audit write on failure,
and emits a rate-limited operational error. Tests inject the clock and sweep
interval rather than relying on wall time. A future external scheduler
may invoke the same `pruneAuditBefore(cutoff, batchSize)` primitive without changing
semantics.

Phase 2 adds schema and UI support to coalesce identical `(actor_user_id,
gateway_id, method, canonical_path, failure_reason)` denies within a short
window while preserving first/last time and occurrence count. The Virtual Key
redaction PR and Phase 2 UI must also stop polling after a typed 403 as specified
in §12.2. Security-relevant RBAC mutations and raw-secret attempts are never
coalesced. Retention is brought forward because the existing append-only table
is already operationally unbounded; it does not depend on VK being denied in
Phase 1a-0.

---

## 14. Migration

### 14.1 Existing roles

The current roles are `operator` and `viewer`, both gateway-wide. Neither has a
semantically identical automatic target. The schema migration therefore makes
one deterministic, input-free, least-privilege conversion:

| Existing role | Migrated role | Transitional marker |
|---|---|---|
| `operator` | `member`, no grants | `legacy_role = 'operator'` |
| `viewer` | `member`, no grants | `legacy_role = 'viewer'` |

This avoids both silent privilege increase (`operator -> admin`) and an
impossible pre-start approval dependency. Reauthorization does not block login:
legacy users land on `/dashboard/no-access` with no grants. Phase 1b does not
build a separate batch-reauthorization product: the normal Platform Admin RBAC
editor lists `legacy_role` as a pending marker, shows a high-priority count/link,
and requires an explicit save of Gateway Admin, domain/resource grants, or
"leave as Member with no grants" before clearing it. A small installation needs
no dedicated batch workflow, but row count is not a schema invariant; larger
installations may add import/bulk helpers in Phase 4 without changing the safe
migration default. A newly promoted Gateway Admin cannot clear other legacy
markers until a Platform Admin completes this bootstrap decision.

Because this migration removes every non-platform user's effective access at the
instant it applies, Phase 1b must provide a durable pending-reauthorization
inventory. It is generated from the migrated rows after the rebuild, not from a
new pre-migration HTTP endpoint: the new application cannot serve such an
endpoint before lazy `getDb()` has already applied its schema migration. The
copied `legacy_role` preserves the old authorization fact, and the standard RBAC
editor joins it with current user/gateway names to expose every unresolved
`(username, gateway_id, gateway_name, legacy role)` tuple. It carries no secret
material and is Platform-Admin-readable only. Installations that want an
offline before/after artifact may run a separately released CLI/export command
before upgrading, but Phase 1b safety does not depend on that optional step.

#### 14.1.1 This is a planned outage, and must be released as one

The wording above ("least privilege", "lands on `/dashboard/no-access`")
understates the operational event. At the instant Phase 1b deploys, **every
non-platform user loses all access simultaneously**, and the only path back is a
Platform Admin resolving them one at a time through an RBAC editor shipped in
that same release. Nothing degrades gracefully and nothing self-heals.

Release requirements, not suggestions:

- the release notes lead with the access interruption, not with Gateway Admin;
- the pending-reauthorization inventory (§14.1) must be reachable within the
  first minute of the new UI, from the Platform landing surface, not only from a
  per-gateway members page;
- the deployment runbook states the expected reauthorization time as roughly
  *one editor save per (user, gateway) pair* and instructs the operator to
  produce the pre-upgrade inventory — via the optional CLI/export command or
  simply by reading the current members pages — **before** deploying, so the
  work can be planned rather than discovered;
- above roughly a dozen `(user, gateway)` pairs, treat the deploy as a scheduled
  maintenance window rather than a rolling upgrade. Row count is not a schema
  invariant and the design does not build a bulk workflow for Phase 1b (§14.1),
  so the mitigation is scheduling, not tooling.

A middle path exists and is deliberately left as a decision rather than silently
chosen (§17.2 decision 5): the migration could additionally create **domain
grants** for every migrated row — `viewer` → `viewer` on all three domains,
`operator` → `maintainer` on all three — instead of no grants at all. This is
strictly narrower than what those users hold today, because gateway-level
surfaces (Caddy, Virtual Keys, Credentials, Bundle, unscoped
metrics/runtime/Overview) are denied to Members regardless of domain grants. It
is also inert at Phase 1b, since Member enforcement is behind a flag that
defaults closed (§14.3 step 6) — so it costs nothing to pre-create, and it turns
Phase 2's enablement from a second access cliff into a no-op for existing users.

The cost is that it is not literally least-privilege: a legacy `viewer` who
should have had no Agent access at all silently keeps read access to all three
domains until reauthorized, and the `legacy_role` marker becomes the only signal
that the grant was never reviewed by a human. Choose blackout when the
installation is small enough to reauthorize in one sitting and the security
posture demands an explicit decision per user; choose auto-grants when
continuity matters more and the pending markers will realistically be worked
through afterwards. Either way `legacy_role` is still set and still requires an
explicit save to clear.

### 14.2 SQLite schema migration

Changing the role CHECK from `('operator','viewer')` to `('admin','member')`
cannot use `ALTER COLUMN` in SQLite. The append-only `PRAGMA user_version`
migration must rebuild the membership table in one transaction:

1. Extend `MIGRATIONS` from `string[]` to a closed `Migration` union supporting
   SQL text or `(db) => void`. Extend `SqlConnection.transaction()` with an
   explicit `"immediate"` mode implemented by both SQLite adapters. Each
   migration entry runs in one `BEGIN IMMEDIATE` transaction, re-reads
   `PRAGMA user_version` only after acquiring the write reservation, and advances
   it in that same transaction. If another replica already applied the entry,
   the contender skips it after the in-transaction re-read. This prevents two
   deferred transactions from both observing the same version and racing the
   table rebuild. `busy_timeout` bounds lock acquisition. An exhausted timeout
   must fail rather than loop, and "fail startup" needs a concrete mechanism
   here: `getDb()` is lazy (§14.3), so a bare throw leaves
   `globalThis.__managerDb` unset and the *next* request reopens the database
   and retries the migration — precisely the loop this rule forbids. The failure
   is therefore recorded in a process-level migration-failure marker stored
   beside the connection global. While that marker is set, `getDb()` throws a
   typed `DatabaseUnavailableError` without reopening the database; it clears
   only on process restart. A shared `withDatabaseAvailability()` Route Handler
   boundary maps that typed error to a non-sensitive 503 response. Every route
   that can reach `getDb()` — including auth/login, session, platform routes,
   gateway access wrappers, catch-all, and Chat — must use that boundary; an
   inventory test is the release gate because an uncaught database exception
   would otherwise become Next's generic 500 rather than the promised 503.
   Capture one migration timestamp inside the function migration.
2. Create `gateway_memberships_new` with the new role CHECK, nullable
   `legacy_role`, timestamps, and composite primary key.
3. Copy every old row as `role='member'`, copy the old role into `legacy_role`,
   and set both `created_at` and `updated_at` to the captured migration time.
   Generate no resource grants. Validate row counts and role values.
4. Drop the old `user_gateways`, rename the new table to
   `gateway_memberships`, then create `resource_grants` and its indexes against
   the final parent identity. No existing table has a
   foreign key to `user_gateways` (`sessions` references users/gateways), and
   the new child tables are created only after the rename. The migration order
   therefore requires no `foreign_keys` toggle. The per-entry transaction
   boundary remains, but its mode changes from deferred to immediate and its
   version check moves inside the transaction.
5. Update every query/type atomically with the schema. Remove
   `listGatewaysForUser()`'s current `?? "viewer"` fallback entirely: the
   non-platform query is an inner join on membership, so a missing membership is
   an invariant violation and must fail closed, not synthesize any role.
6. Delete the membership insert in `seedGatewayFromEnv()`. A seeded Platform
   Admin already lists and accesses every gateway implicitly; inserting
   `operator` after the old table is removed would reference the wrong table
   and violate the new role CHECK. Add a fresh-database boot test that applies
   all migrations before environment seeding.
7. Run `PRAGMA foreign_key_check` before advancing `user_version`. Any
   failure rolls back the entire migration.

Sessions keep `active_gateway_id` and do not need a role column, but stale
active gateways must continue to self-heal through the new membership table.

### 14.3 Rollout and revocation order

The ordering rule is **live exposure first, infrastructure second**. Two holes
described in this document exist in the shipped product today: any gateway
`viewer` can read plaintext Virtual Key bearer values (§10), and any gateway
`operator` can create a Caddy listener or route that reaches the gateway Admin
API around manager RBAC entirely (§5.5). Neither fix depends on the classifier,
the test harness, or the role hierarchy, and neither may be scheduled behind
them.

1. Apply Phase 1a-0's deliberate Caddy privilege reduction, actor-based secret
   checks, interim Virtual Key narrowing, navigation gating, and audit retention
   while the database still contains only `operator/viewer`. This is PR1 and it
   ships first, standing alone.
2. Land minimal CI (lint, build, existing `bun test`) so PR1 and everything
   after it has a regression gate. The full dual-runtime entry of PR-0.5 is not
   a prerequisite for PR1 and is sequenced with the migration work that actually
   needs it.
3. Land PR0.5's initial `EndpointPolicy` core as the single method/path truth
   source.
4. Ship the Chat credential change chosen in §17.2 decision 4, remove browser
   bearer input, then replace raw Virtual Key reads with role-appropriate
   redacted handlers.
5. Land PR-0.5's dual-runtime test entry and PR0's Route Handler integration
   harness and singleton seams, before the schema rebuild and the response
   projections whose release gates depend on them.
6. Ship the standard RBAC editor's pending-marker support and the neutral schema
   rebuild in §14.2 as one deployment, released as the planned interruption
   described in §14.1.1. `getDb()` is lazy today: the first handler
   that touches the database opens it and completes migrations synchronously
   before that handler's query executes. The guarantee is therefore
   "migration-before-first-database-operation on each process", not
   "migration-before the Next.js listener accepts requests" and does not require
   a new boot hook. A failed migration sets the §14.2 failure marker instead of
   being silently retried by the next request, and the shared database-availability
   boundary returns 503. Existing non-platform users become least-privilege
   Members until a Platform Admin acts, with the copied `legacy_role` inventory
   as the record of what they previously held.
7. Reauthorize legacy rows through the standard Platform RBAC editor and clear
   their markers; no automatic grant or Admin promotion occurs unless §17.2
   decision 5 selects the auto-domain-grant variant.
8. Add Member classifiers, exact response adapters, filtering, and grant-aware
   Chat authorization behind a feature flag that defaults closed.
9. Enable Member domain/resource enforcement only after the endpoint-inventory
   coverage suite passes.
10. Remove legacy compatibility code after every `legacy_role` is null; the
    column itself may be removed in a later table-rebuild migration.

Existing sessions may cache active gateway but must not cache permissions.
Authorization changes take effect on the next request. v1 does not forcibly
terminate an already-authorized SSE turn when a membership or grant is revoked;
that stream may continue until completion/cancellation, and the audit row keeps
the authorization snapshot from stream open. This bounded TOCTOU window is an
explicit tradeoff that avoids a process-local revocation registry pretending to
work across deployments. Administrators can stop the gateway-side run through
existing runtime controls when immediate interruption is required. The UI
refreshes its capability summary after mutations. Shared live-stream revocation
requires a separate multi-replica coordinator design.

---

## 15. Implementation phases

### 15.0 Scope reality check

This document specifies more process than the codebase currently carries: at the
time of writing the manager is 22 Route Handler files, 23 dashboard pages, and
four pure-function test files, with no CI. Executed literally and in the original
order, nothing user-visible ships until Phase 1b, and reaching Phase 2 is on the
order of three months of focused work. That is a legitimate cost for real
multi-tenant RBAC, but it must be a decision rather than a surprise.

Two consequences are built into the ordering below:

- **PR1 is not gated on tooling.** It closes two live holes, is a handful of
  small diffs, and is verifiable by hand. It ships first (§14.3).
- **Phase 1b is the first business release boundary and a legitimate stopping
  point.** Gateway Admin delivers delegated tenant administration. Phase 2's
  Member RBAC costs more than everything before it combined, and §18 already
  observes that its cost is endpoint classification rather than the role schema.
  Do not commit to Phase 2 until a concrete multi-tenant requirement exists;
  the design is structured so stopping after Phase 1b leaves no half-built
  surface.

Indicative sizing for planning only, single implementer:

| Work | Rough size |
|---|---|
| PR1 privilege reduction | ~1 day |
| Minimal CI (lint/build/`bun test`) | ~0.5 day |
| PR0.5 `EndpointPolicy` core | 2–3 days |
| Chat de-bearering + Virtual Key redaction | 3–4 days (§10.2) or 8–12 days (§10.1) |
| PR-0.5 dual-runtime entry + PR0 harness/seams | 4–7 days |
| Phase 1b (rebuild, DTOs, RBAC editor, inventory) | 3–4 weeks |
| Member foundation + Phase 2 | 4–8 weeks |

### PR1: deliberate privilege reduction and retention

**Ships first, before any tooling PR.** See Phase 1a-0 below for its contents.
It is listed ahead of the infrastructure PRs because it closes exposures that
exist in the shipped product, and because its changes are small enough to review
and verify without the integration harness.

### Minimal CI

Before PR0.5, add a workflow running `lint`, `build`, and the existing
`bun test`. This is a few lines and gives every later PR a regression gate. It
is explicitly *not* PR-0.5: the dual-runtime Node entry below is a larger
toolchain deliverable that only the migration work depends on, and blocking the
security fixes on it inverts the risk ordering.

### PR-0.5: dual-runtime test entry

Required before the §14.2 schema rebuild, not before PR1. `bun test` discovers
only the existing pure-function tests, and the production server runs under
Node, so a migration suite that passes only under `bun:sqlite` is not a release
gate for a `node:sqlite` deployment:

- add separately named Bun and Node test commands to the CI workflow above;
- keep `bun test` for the Bun adapter and add a real production-runtime Node
  entry that executes migration tests through `node:sqlite`;
- choose and commit an alias-aware TypeScript execution path for Node (a tested
  loader, or a test-only compile plus alias-rewrite step). Native Node TypeScript
  stripping alone is insufficient because it does not resolve the repository's
  `@/*` paths;
- make both commands runnable locally and in CI, with failures in either command
  blocking later migration releases.

There is no placeholder "repository TypeScript test build/loader step" to rely
on: PR-0.5 must add the chosen path, its package scripts/configuration, and a
smoke test before PR0 consumes it. This is a toolchain deliverable, not part of
the Route Handler harness estimate.

### PR0: Route Handler integration harness and singleton seams

Before any authorization release gate depends on Route Handler behaviour, add a
reusable integration harness with:

- an in-process mock gateway/Caddy/data-plane HTTP upstream that records the
  exact forwarded method, canonical path, headers, and body and can return
  fixture JSON, errors, or SSE;
- a fresh in-memory SQLite database per test, with all migrations applied and
  explicit helpers for users, sessions, gateways, memberships, grants, and
  audit rows;
- a server-environment provider before the database module is imported. In test
  mode `lib/server-env.ts` must not parse `.env.local`; the harness supplies
  `MANAGER_DB_PATH=:memory:` and a test `MANAGER_SECRET_KEY` through an explicit
  test-only provider or test-mode `process.env`, with a reset hook. The current
  module-initialized `.env.local`-first map is not retained for tests because it
  can redirect the harness into the developer's real database;
- an explicit database provider/factory around the current
  `globalThis.__managerDb` lifecycle, plus an outbound `fetch` provider,
  installed only by the test harness before a handler is invoked. The database
  reset must close and clear the injected connection and all related globals.
  Production call sites retain `getDb()` and the default fetch, so the 20+
  importers do not each invent injection logic; no request header or runtime
  input can select the test path;
- the typed `DatabaseUnavailableError` and shared
  `withDatabaseAvailability()` boundary from §14.2, applied to every DB-backed
  Route Handler family through a mechanically checked inventory so migration
  failure produces 503 rather than an uncaught framework 500;
- request builders for bearer session, active gateway, and `X-Gateway-Id`, plus
  safe reset hooks for database, gateway-proxy caches, Chat-key caches, clocks,
  and other `globalThis` state;
- direct invocation of exported Route Handler functions with real `Request`
  objects, so `withGatewayAccess`/`withPlatformAccess`, upstream forwarding,
  response projection, audit finalization, and streaming completion are tested
  together.

This is a real refactor of two module-level singletons (`server-env`'s eager
`.env.local` snapshot and `db`'s long-lived connection), not a one-line test
hook. It is independent infrastructure, not part of Phase 4 hardening. It lands
after PR-0.5 and before the §14.2 schema rebuild and the response-projection
work; Phase 1b's sensitive inventory and Phase 2 filtering release gates must
have Route-level tests that run on it. It is deliberately *not* a prerequisite
for PR1, whose changes are small and hand-verifiable. The migration
suite uses PR-0.5's two commands. Table rebuild/rename, CHECK constraints,
compound foreign keys, `PRAGMA foreign_key_check`, concurrent startup, and
rollback assertions must pass through both adapters; passing only the Bun
adapter is not a production migration release gate.

### PR0.5: initial EndpointPolicy core

Before managed Chat keys, add the dependency-free classifier skeleton and make
it the single method/path truth source described in §7.3. Its first table
preserves every current `proxy-action` override/default case and adds the exact
`public`, `session`, platform-only/Caddy, `/admin/agents/routes`, and
`/admin/virtual_keys` families plus `unclassified`; derive
`actionForProxyPath()` from it and retain the current pure regression tests. It
takes the §7.3.1 structured manager route space (`/api/admin/**`) as its only
input, and the legacy projection is the one place an encoded upstream string is
decoded and the `api` prefix restored — a second accepted input space would
recreate the dual matcher this PR exists to remove.

PR0.5 lands **after** PR1, not before it. PR1's interim Virtual Key narrowing
needs only one entry in the existing `actionForProxyPath` override table and one
row in `GRANTS` — the same shape as the override cases already there — so it has
no dependency on the classifier, and making a live exposure wait for a policy
refactor inverts the risk ordering (§14.3). PR0.5 then absorbs that entry when
it takes over as the single truth source, and the existing
`proxy-action.test.ts` case added by PR1 becomes one of its regression cases.

This small policy PR intentionally precedes the complete Member inventory. It
lets the managed-key service attach a successful Agent-route mutation finalizer
without adding a second path matcher to the catch-all, and lets PR3 extend the
same Virtual Key entries with response projection rather than introducing the
classifier for the first time.

### Phase 1a-0: deliberate privilege reduction and retention

- change `gateway:secrets_raw` from role lookup to
  `session.isPlatformAdmin`;
- move all four Caddy Route Handler families to the shared
  `withPlatformGatewayAccess(action)` wrapper from §7.3, preserving the selected
  `gateway_id` in audit rows before using its Caddy configuration;
- gate the Configuration → Servers navigation item and every Caddy affordance
  on `is_platform_admin` in the same release, so existing Operators/Viewers do
  not see a knowingly inaccessible page;
- remove `listGatewaysForUser()`'s `?? "viewer"` fallback;
- add the §13 throttled, write-path 90-day audit cleanup primitive and
  configuration override, plus `ix_audit_ts` before enabling cleanup;
- narrow `GET /admin/virtual_keys[/{id}]` from the method default `gateway:read`
  to a temporary `gateway:virtual_keys_raw_compat` action granted to `operator`
  and the implicit Platform Admin, but not `viewer`. Add it to `GatewayAction`,
  `GRANTS`, and the sensitive allow-audit set in the same PR. This is the interim
  mitigation of §10 for a live exposure — the default currently lets any
  `viewer` read plaintext bearer `key` values — and is deliberately small: a
  single classifier entry and grant row, no response-shape change, so the
  Virtual Keys page, Agent form, reachability view, and Chat keep working for
  the roles that actually operate them. Viewers lose the Virtual Keys page in
  this release; the release notes name that alongside the Servers/Caddy removal.
  PR3 removes this temporary action and grant when explicit redacted and
  Platform-raw handlers replace the compatibility response.

These changes form PR1, ship **first** (§14.3), and ship while roles remain
`operator/viewer`. PR1
narrows but does not *redact* `/admin/virtual_keys`: replacing the response
shape before PR3's handlers exist would break the current Virtual Keys page,
Agent form, reachability view, and Chat. Caddy closes an existing Operator privilege-escalation path and
must not wait for Gateway Admin. Retention is operational hardening for the
already-unbounded append-only audit table. This is not "zero regression": it is
an intentional privilege reduction for current Operators/Viewers and the
release notes must name the Servers/Caddy removal and its platform-only reason.

Because PR1 precedes the PR0 harness, it is scoped to changes reviewable without
it: guard/wrapper swaps, one override-table entry, one grant row, one index, one
prune helper, and navigation gating. Each has a pure unit test
(`proxy-action.test.ts`, a prune test with an injected clock) or is a mechanical
substitution verifiable by inspection. Nothing in PR1 depends on response
projection or upstream forwarding behaviour — the things that genuinely need
Route-level integration tests.

### Phase 1a-1: Chat de-bearering

Contents depend on §17.2 decision 4. Under §10.1 (reserved managed key):

- add `manager_chat_keys` and idempotent one-key-per-gateway provisioning;
- remove browser-supplied `virtual_key` from both Chat handlers;
- authorize Agent/route ownership on every Chat request and inject the reserved
  key only server-side;
- add the bounded in-process bearer cache, rotation/auth-failure invalidation,
  and module-private raw-key helper constraints from §10.1;
- reconcile after manager route mutations, lazily repair once on data-plane
  401/403 with process-local single-flight and documented idempotent
  cross-replica redundancy, and exclude the reserved key from both sides of
  Bundle processing.

Under §10.2 (server-side key-ID resolution) it reduces to: change both Chat
handlers to accept a Virtual Key **ID** instead of a bearer, resolve ID → bearer
in the module-private helper, verify the selected key's allowlist covers the
resolved route, and keep the existing per-request Agent authorization. No new
table, namespace, cache lifecycle, reconciliation, or rotation workflow.

This is PR2. Under §10.1 it consumes PR0.5's Agent-route classification for
active reconciliation, and a fallback release with only 401/403 lazy repair is
not considered complete because manager-owned route mutations must proactively
converge the transport allowlist. Either variant must precede any change that
prevents the browser from listing or selecting raw Virtual Key bearer values.

### Phase 1a-2: Virtual Key redaction and explicit handlers

- extend PR0.5's `/admin/virtual_keys[/{id}]` policies with the exact
  projection/write adapters; do not add a second classification table;
- replace pass-through list/get with an explicit redacted handler: Gateway
  Admin and pre-migration gateway roles receive ID, status, policy/allowlist,
  provenance, and `key_set`, never bearer `key`; ordinary Member has no general
  VK management surface, but an authorized write form may use a dedicated
  opaque ID/name selector DTO;
- replace POST/PUT/DELETE and enable/disable pass-through with explicit handlers
  too. They reject user IDs in the `agwmngr-chat:` namespace and reject ordinary
  mutation of the managed key, so the reserved prefix is a server invariant,
  not a hidden-button convention;
- migrate the Virtual Keys page, Agent form, reachability view, and Chat away
  from bearer-dependent shapes before enabling the new classification;
- stop retry/auto-refresh on a typed 403;
- make auxiliary attribution/enrichment requests degrade locally on typed 403,
  while only a denied primary page query renders full-page Access Denied.

This is PR3. Mapping the raw upstream endpoint directly to
`gateway:secrets_raw` is not an acceptable released intermediate state because
it would regress existing non-platform workflows.

### Phase 1b: hierarchy and Gateway Admin

- neutral schema migration to `admin/member` with `legacy_role` markers,
  released as the planned access interruption of §14.1.1;
- Platform Admin implicit inheritance;
- the `UserGatewayRole` three-value split of §12.1, so Platform Admin and
  Gateway Admin no longer serialize identically;
- self-service password change (§11.1);
- least-privilege pending markers handled through the standard Platform RBAC
  editor; specialized bulk reauthorization UI is deferred;
- the §14.1 post-migration pending-reauthorization inventory;
- Gateway Admin pass-through minus the exact platform-only/sensitive deny table,
  bounded by the §7.4.1 reviewed-gateway-version pin;
- secret-redacted Gateway Admin management DTOs for Agent, MCP Service,
  Provider, and Virtual Key, preserving editable non-secret Agent
  runtime structure. **Credential is not in this list** — it stays denied to
  Gateway Admin in v1 (§10);
- raw Bundle platform-only on both its page and all fan-out operations;
- gateway-scoped membership administration;
- updated audits and session payloads.

This is the first business release boundary: it delivers delegated Gateway
Admin without waiting for complete Member endpoint classification. The
platform-only/sensitive inventory and current Gateway Admin UI smoke suite are
release gates; a complete response-adapter inventory is not.

Phase 1b is not a “small deny-table” release. Agent DTO/YAML/form support is on
its critical path: without a safe Agent list/get/edit projection the delegated
administrator cannot perform the role's primary job. MCP Service and Provider
DTOs are likewise required for the corresponding enabled infrastructure pages,
and Credential remains denied until its safe workflow exists. Plan these as
separate family PRs (Agent first), including service-layer merge logic and
frontend migrations, then release the role only when the intended Gateway Admin
navigation smoke suite has no raw-pass-through or unusable core page. The deny
table is the smallest part of this work, not a proxy for its total estimate.

The secret-bearing DTO work may be implemented as several PRs, but it is not
removed from this release gate. Until a family has its validated Gateway Admin
projection and write protocol, Phase 1b denies that family to Gateway Admin;
it never restores raw pass-through on the rationale that legacy Operators could
previously read the secret. Delegating a new tenant-admin role while knowingly
returning Agent env, MCP auth, Provider credentials, or Credential payloads
would contradict the locked raw-secret boundary. Virtual Key redaction alone is
therefore necessary but not sufficient for the Phase 1b security contract.

### Member policy foundation (parallel with Phase 1)

- extend the PR0.5 `EndpointPolicy` core with resource identity, action,
  response mode, and projection for each Member endpoint; do not introduce a
  second method/action or resource-classification table;
- inventory every endpoint exposed to Member, with request policy, response
  mode, exact envelope/identity validation, projection, and bounded collection
  adapter;
- land table-driven policy and frontend-call coverage tests in CI.

Frontend-call coverage is a named implementation task, not a regex assertion.
Build a small TypeScript Compiler API walker over `lib/api.ts` and relevant
direct `adminFetch` call sites. It normalizes string literals and template
literals into canonical segment patterns (for example,
`/admin/agents/{id}/runs`), maps method expressions where statically known, and
compares them with `EndpointPolicy`. A non-statically-analyzable call fails CI
unless it carries a reviewed exact-policy annotation. Budget this as its own
tooling PR/work item; keep the generated inventory reviewable in diffs.

This is the largest workstream and may land as endpoint-family PRs in parallel
with Phase 1. It gates Phase 2 Member surfaces, not Gateway Admin creation.

### Phase 2: domain-scoped Member RBAC

Phase 2 starts only after the Chat de-bearering in Phase 1a-1 and
the Virtual Key redaction in Phase 1a-2 are deployed and tested. Per §15.0 it is
also the phase to **not** start by default: it costs more than everything before
it combined and should follow a concrete multi-tenant requirement, not the
existence of this document.

- Agent/LLM/MCP domain grants (`resource_grants` with the domain-only CHECK
  of §6.2);
- navigation gating;
- deny all gateway-level surfaces for Members;
- domain collection filtering, with the per-family kill switch of §8.1;
- exact Member response-shape adapters and the secret-safe projections in §10;
- explicit policy classification for all reachable endpoints;
- reference validation for ACP/HTTP Agent domain maintainers; builtin Agent
  create/update remains Admin-only;
- Member ingress-route mutation denied until the gateway supplies atomic
  cross-kind prefix enforcement;
- grant-aware Chat authorization;
- deny-audit coalescing, shipped with the first polling Member surfaces.

This is the minimum release boundary for ordinary Member resource separation;
it is not required to realize Gateway Admin value from Phase 1b.

### Phase 3: concrete resource grants (demand-gated)

- the §6.2 `resource_grants` table rebuild that widens `scope_type` to
  `('domain','resource')` and adds the closed `resource_type` CHECK and its
  partial unique index;
- individual Agent, Provider, Model, LLM Route, and MCP Service grants, enabled
  only under §6.4's authoritative-lifecycle/incarnation gate;
- owner-derived Agent/MCP Route authorization;
- correct collection totals; add pagination only after the gateway exposes an
  exact reviewed pagination/filter contract;
- scoped Agent Usage/Interactions;
- stale-grant reconciliation.

### Phase 4: hardening

- policy fuzzing and drift checks beyond the foundation's required route/UI
  coverage tests;
- additional authorization-matrix and adversarial integration cases beyond the
  PR-0.5/PR0-backed release gates;
- ID-reuse and deletion tests;
- concurrency and membership-removal tests;
- optional bulk legacy-reauthorization/import helpers for installations whose
  pending inventory is too large for the standard RBAC editor;
- security review of redaction and indirect references.

Phase 3 remains disabled until product demand for concrete grants is confirmed.
Every phase that changes routes, roles, navigation, endpoint behaviour, or
security boundaries includes an `AGENTS.md` update in the same PR; the design
document is not the only maintained source of repository guidance.

---

## 16. Required tests

At minimum, test the following matrix. Items 18, 19, 27, 34, 35, and 38 are
specific to the §10.1 reserved managed key and apply only if §17.2 decision 4
selects it; under §10.2 they are replaced by item 53.

1. Platform Admin retains existing platform and gateway behaviour.
2. Gateway Admin can manage RBAC-controlled content in its gateway but cannot
   reach platform APIs, Caddy, raw secrets, or another gateway.
3. Member without grants can select its gateway but sees no child resources.
4. Domain viewer can list/read only that domain and cannot operate or mutate.
5. Resource operator can run only the granted object and cannot mutate it.
6. Resource maintainer can mutate only the granted object.
7. Collections, totals, and search do not leak hidden resources; future
   pagination stays disabled until its exact upstream contract has a bounded
   adapter.
8. Agent-scoped metrics and interactions do not include other Agents, while
   redacted dependency dimensions from the authorized Agent's own events remain
   visible without granting access to those dependencies.
9. Referenced hidden resources cannot be attached through a crafted request.
10. Unknown endpoint families are denied to Members. Gateway Admin retains
    pass-through only after the platform-only/sensitive deny table; known
    secret-bearing reads cannot reach raw upstream responses.
11. Canonical-path and encoded-segment bypass cases remain rejected.
12. Raw secrets remain unavailable regardless of resource role; a Gateway Admin
    is also denied `gateway:secrets_raw`.
13. Gateway Admin cannot read/mutate Caddy, expose the Admin API through an
    Admin handler/reverse proxy, or import/export a raw Bundle.
14. Removing membership immediately revokes grants for new requests; an already
    authorized SSE stream follows the documented §14.3 TOCTOU window and keeps
    its open-time audit snapshot.
15. Under the supported manager-authoritative lifecycle, stale grants and
    deleted/recreated object IDs cannot restore unintended access; Phase 3
    refuses reusable-ID concrete grants when external lifecycle writers are
    configured without incarnation/event support.
16. Updating an Agent/MCP route ID or `path_prefix` preserves owner-based
    read/operate authorization without stale-grant inheritance, and Members
    cannot mutate ingress routes in v1.
17. An unrecognized envelope/identity fails closed without returning the
    upstream body, while a new non-allowlisted object field is silently dropped
    and does not cause 502.
18. Chat for Platform Admin, Gateway Admin, and Member never accepts/returns
    bearer material; one reserved key works without a Platform Admin membership
    row, while every request still enforces its resolved Agent grant.
19. Interrupted gateway-key allowlist reconciliation may reduce availability
    but cannot authorize a deleted/hidden route through the manager; concurrent
    Chat requests do not perform shared-key writes, and 401/403 lazy repair is
    bounded to one process-local single-flight reconciliation per replica and
    one retry. Concurrent replica reconciliations are idempotent and converge.
20. Member route mutations are denied regardless of owner role; delegated
    mutation remains disabled until a gateway atomic cross-kind conflict API is
    available.
21. The migration boots without external input, maps every legacy role to
    `member` with `legacy_role`, creates timestamps, creates no grants, removes
    the synthetic membership-role fallback, and fresh environment seeding does
    not insert an obsolete `operator` membership.
22. The platform-only/sensitive inventory covers the Gateway Admin UI; Member
    Agent list/detail endpoint inventories have no unclassified request, and
    adding a Member frontend call without policy fails the TypeScript-AST
    inventory check in CI, including template-literal paths.
23. SSE chat auditing finalizes correctly on done, error, cancellation, and
    normal client/gateway abort; revocation does not rewrite the open-time
    authorization decision.
24. Collection adapters reject decoded payloads over 8 MiB without returning
    partial data; a future paginated envelope remains unclassified until its
    exact cursor/page bounds are implemented and tested.
25. `computeEffectiveAccess()` drives enforcement and the session capability
    summary, and a typed 403 stops retry/auto-refresh without logging out. A
    primary-query 403 renders Access Denied, while a 403 from
    `useAgentAttribution()` or equivalent optional enrichment hides only that
    enrichment.
26. Gateway Admin Agent edit/YAML/configuration round trips preserve `cwd`,
    command/args, and builtin structure. Secret metadata never uses a mask as
    writable state: omission preserves, `set` creates/replaces, `unset` deletes,
    invalid/overlapping patches fail, and raw merge results never return to the
    caller. Member DTOs remain narrow and Member builtin writes are denied.
27. Bundle export, import planning, create, and update all exclude the reserved
    `agwmngr-chat:` key.
28. Frontend Platform affordances depend on `is_platform_admin`, never on the
    overloaded gateway `role: "admin"` field alone.
29. Audit retention removes rows older than the configured cutoff, defaults to
    90 days, is throttled on the write path, deletes at most one configured
    batch per sweep, drains a large backlog over several sweeps, runs
    idempotently across replicas, and does not interfere with allow
    finalization or deny coalescing.
30. The PR0 harness exercises a real Route Handler with session/membership
    fixtures and a recording mock upstream, proves platform-only denial happens
    before forwarding, proves Member filtering changes the response, and
    finalizes both normal and streaming audit records.
31. PR0 ignores a real developer `.env.local`, injects `:memory:` and a test
    secret before importing database users, resets the seam, and never creates
    or mutates `data/manager.db`.
32. The full migration suite passes with both `bun:sqlite` and production
    `node:sqlite`, including table rebuild/rename, compound foreign keys,
    `foreign_key_check`, transaction rollback, fresh seed behaviour, and two
    concurrent starters contending for the same pending migration. The loser
    re-reads `user_version` after `BEGIN IMMEDIATE` and does not replay DDL.
33. Audit retention has `ix_audit_ts`, and query-plan/regression coverage proves
    cutoff pruning does not degrade into a full-table scan on the write path.
34. Every Virtual Key write path, including enable/disable, rejects reserved
    prefix creation and ordinary mutation/deletion of the managed Chat key;
    requests are denied before the catch-all can forward them.
35. Gateway-side Chat events intentionally group under the one reserved key;
    per-key quota tests treat all manager Chat as aggregate traffic, while
    manager audit attribution still identifies the actor.
36. PR-0.5 creates locally runnable Bun/Node commands; the Node command
    resolves `@/*` aliases and demonstrably opens `node:sqlite`, rather than
    passing through Bun or relying on native TS stripping alone. Minimal CI
    exists before PR0.5 and runs lint, build, and `bun test`.
37. `EndpointPolicy` classifies public login/health, authenticated
    session/auth-me, Agent-route mutation, Virtual Key, platform-only, and
    unclassified paths without a second action table; session policies neither
    resolve a gateway nor forward upstream.
38. The upstream contract test creates/gets/deletes an opaque Virtual Key ID
    containing the reserved `agwmngr-chat:` prefix. Rotation uses create plus
    persisted pending/CAS promotion and cleanup, never a nonexistent upstream
    rotate endpoint; crash tests resume before and after promotion.
39. The lazy `getDb()` path completes migration before its caller's first query
    without claiming that Next.js delayed listener startup, and two processes
    either migrate or fail once after the configured busy timeout rather than
    entering a startup loop.
40. A Platform Admin can resolve each `legacy_role` marker through the standard
    RBAC editor, including explicitly leaving a no-grant Member; no dedicated
    batch workflow is required for Phase 1b and non-platform actors cannot clear
    a marker.
41. `classifyEndpoint` accepts only the §7.3.1 structured manager route space:
    a bare `/admin/...` segment array is `unclassified`; dynamic params remain
    single logical segments; `%2F`, `%252F`, encoded dot segments, and malformed
    escapes cannot make authorization and forwarding disagree; and the sole
    `actionForProxyPath()` string adapter agrees with every existing
    `proxy-action.test.ts` case.
42. A sequentially stale Gateway Admin whole-object update is rejected with 409
    `stale_object`; the token check runs after authorization, so a stale token on
    a hidden object still yields the §8.2 status rather than disclosing a change.
    A two-writer test documents that this advisory check is not CAS and does not
    claim to eliminate the concurrent read-check-write race.
43. A failed migration sets the process-level failure marker: `getDb()` then
    throws `DatabaseUnavailableError` without reopening the database or replaying
    DDL, the next request does not retry the migration, and every inventoried
    DB-backed Route Handler maps it to 503 through the shared boundary.
44. PR1's interim narrowing denies `GET /admin/virtual_keys[/{id}]` to `viewer`
    while `operator` and Platform Admin keep the unchanged response shape, and
    the Virtual Keys page, Agent form, reachability view, and Chat still function
    for those actors. PR3 removes the temporary action.
45. The §14.1 post-migration inventory lists every migrated `(username,
    gateway, legacy role)` tuple from `legacy_role`, is denied to non-platform
    actors, and contains no secret material; no pre-migration HTTP window is
    assumed.
46. PR1 is releasable without the PR0 harness: its Caddy platform-gating,
    actor-based `gateway:secrets_raw`, interim Virtual Key narrowing, removed
    `?? "viewer"` fallback, and batched audit prune each have a passing pure or
    clock-injected test, and no PR1 assertion requires upstream forwarding or
    response projection.
47. `classifyEndpoint` returns `kind: "denied"` for a known secret-bearing
    family with no redacted handler, and that denial applies to Platform Admin
    on the catch-all as well as to Gateway Admin; the family's explicit Route
    Handler, where one exists, still serves its own `platform_gateway` policy.
48. With a gateway reporting a version outside `REVIEWED_GATEWAY_VERSIONS`,
    Gateway Admin catch-all pass-through fails closed with
    `gateway_version_unreviewed` while explicitly classified families keep
    working and Platform Admin pass-through is unaffected; the cached version is
    invalidated on the same events as the base-URL cache.
49. A Member endpoint family whose kill switch is off returns the §8.2 403
    rather than 502, the shape-mismatch operational log names the family and
    observed container shape without values or identifiers, and no failure path
    ever returns the upstream body.
50. `resource_grants` rejects a non-NULL `resource_type`/`resource_id` and any
    `scope_type` other than `'domain'` before Phase 3; the Phase 3 rebuild
    widens both CHECKs and adds the resource partial unique index without
    losing existing domain grants.
51. `UserGatewayEntry.role` returns `"platform_admin"` for implicit platform
    inheritance and never for a stored membership; no `gateway_memberships` row
    can hold that value, and the switcher renders a distinct label for it.
52. `POST /api/admin/auth/password` classifies as `kind: "session"`, resolves no
    gateway, requires the current password, is denied for a disabled user,
    revokes the user's other sessions while keeping the caller's, and audits
    without password material.
53. Under §10.2, if that variant is chosen: a caller-supplied Virtual Key ID is
    resolved server-side, a key whose allowlist does not cover the resolved
    route is rejected with a clear error, no response or SSE event carries
    bearer material, and Agent authorization is enforced independently of the
    supplied ID.

Policy tests should be table-driven and dependency-free where possible, like the
existing `proxy-action` tests. Route-level integration tests must separately
verify filtering and forwarded upstream requests through the PR0 harness. Pure
classifier tests cannot satisfy a Route-level release gate.

---

## 17. Locked decisions and remaining decisions

### 17.1 Locked by this design

- Gateway is the RBAC root and tenant boundary.
- Gateway Admin is a Gateway Member with gateway-scope `admin` role.
- Platform Admin remains the only global role.
- Membership is required before resource grants are evaluated.
- Member access is positive-grant-only and fail-closed.
- Platform Admin retains general pass-through. Gateway Admin uses pass-through
  minus an exact platform-only/sensitive deny table; Member requires an
  explicit endpoint policy and projection.
- Gateway registry credentials remain platform-owned.
- Raw secret reads, Caddy configuration, and raw Bundle import/export remain
  Platform Admin-only.
- Gateway-wide content is unavailable to ordinary Members.
- Domain grants and concrete resource grants are both supported.
- Agent/MCP route read/operate authorization follows the stable target owner,
  not a derived route ID; Member route mutation is disabled in v1 until the
  gateway supplies atomic cross-kind path enforcement.
- Chat for every role never accepts bearer material from the browser and relies
  on manager-side per-request Agent authorization. **Which** server-side
  credential mechanism delivers that — the reserved per-gateway managed key
  (§10.1) or server-side key-ID resolution (§10.2) — is decision 4, not locked.
- The manager does not claim a route-prefix uniqueness invariant; atomic
  cross-kind conflict enforcement must live in the gateway before route
  mutation can be delegated to Members.
- Reusable caller-chosen IDs, including Provider, Model, and LLM Route, share
  one concrete-grant lifecycle rule. Phase 3 requires manager-authoritative
  lifecycle writes or upstream incarnation/event support; LLM Route is not a
  special-case exclusion.
- Known secret-bearing non-platform reads use fixed allowlist projections;
  Member envelope/identity failures fail closed while unknown object fields are
  discarded. A family with no projection classifies as `denied`, and a family
  whose adapter breaks may be killed to `denied` but never re-opened to
  pass-through.
- Gateway Admin pass-through is bounded by a reviewed-gateway-version pin;
  an unreviewed version fails closed for Gateway Admin rather than relying on
  an unwritable drift check.
- Gateway Admin and Member projections are distinct: Gateway Admin retains
  editable non-secret configuration through explicit write-only secret
  `set`/`unset` patches, while Member receives a narrow DTO. Credential has no
  Gateway Admin projection in v1 and stays denied.
- Ordinary Member `maintainer` may create resources in its granted domain, but
  not ingress routes, Virtual Keys, or builtin Agents in v1 — so it is
  explicitly not an end-to-end self-service role.
- Legacy roles migrate automatically to least-privilege Members with an
  explicit pending-reauthorization marker; migration never waits for UI input,
  and the §14.1 post-migration pending inventory is a Phase 1b deliverable.
  Whether the migration additionally pre-creates equivalent domain grants is
  decision 5.
- Phase 2 stores domain grants only; the concrete-resource taxonomy is added by
  the Phase 3 table rebuild, so its migration cost is paid only if Phase 3
  ships.
- Live exposures ship before tooling: PR1 precedes CI, the classifier, and the
  integration harness.
- The endpoint classifier has exactly one input namespace, the manager route
  space `/api/admin/**`, represented as decoded structured segments;
  `actionForProxyPath()` is its only encoded-string adapter.
- Non-secret whole-object updates use an `updated_at`/content token to reject
  already-stale edits with 409 `stale_object`; this is advisory detection and
  does not eliminate the concurrent read-check-write race without upstream CAS.
- A failed migration is latched in a process-level marker; `getDb()` throws a
  typed availability error and the shared Route Handler boundary answers 503,
  because the lazy path would otherwise retry it per request.
- Platform Admin and Gateway Admin never serialize to the same role value.
- Backend enforcement is authoritative; UI capabilities are advisory.

### 17.2 Decisions required before implementation

1. Whether Gateway Admin may add existing users to its gateway, or only edit
   grants for memberships created by Platform Admin. This document recommends
   allowing both.
2. Whether Agent viewers see redacted dependency summaries or only dependency
   IDs. This document recommends redacted summaries.
3. Whether v1 needs group/team principals. This document assumes user principals
   only; the schema can later generalize `user_id` into principal type/id.
4. **Chat credential mechanism: §10.1 reserved managed key, or §10.2
   server-side key-ID resolution.** Both remove bearer material from the browser
   and both keep manager-side Agent authorization authoritative. §10.1 buys
   zero-administration Chat at the cost of a new table, a reserved namespace
   enforced on every Virtual Key write path, a bearer cache lifecycle, allowlist
   reconciliation, a self-built rotation workflow with crash resume, Bundle
   filtering, and the loss of upstream per-Agent isolation, by-key attribution,
   and per-key quotas. §10.2 is roughly a third of the work and keeps those
   three properties, at the cost of the administrator still managing keys
   manually. This document recommends **§10.2 for v1**, with §10.1 available
   later as a separate, self-contained change if zero-administration Chat
   becomes a requirement. Settle this before estimating Phase 1a-1.
5. **Migration continuity: blackout or pre-created domain grants** (§14.1.1).
   Blackout is strictly least-privilege and forces an explicit human decision
   per user; pre-created domain grants are still narrower than today's
   `operator`/`viewer`, are inert until Phase 2, and avoid a second access cliff
   when Phase 2 enables. This document recommends blackout **only** for
   installations that can reauthorize every `(user, gateway)` pair in one
   sitting, and pre-created grants otherwise. Decide before Phase 1b is
   scheduled, because it changes the release runbook.
6. **Whether to commit to Phase 2 at all** (§15.0). Phase 1b is a complete,
   defensible product boundary. This document recommends treating Phase 2 as
   demand-gated in the same way Phase 3 already is.
---

## 18. Summary

The model has one exceptional global role and one hierarchical resource tree:

```text
Platform Admin
  → implicit authority over every gateway

Gateway Member + gateway role admin
  → tenant-admin compatibility access over one gateway's RBAC-controlled
    descendants, minus platform-only Caddy/raw-secret/Bundle surfaces and with
    explicit redaction for known secret-bearing reads

Gateway Member + gateway role member
  → authority only from explicit domain/resource grants
```

This avoids global "Gateway User" and "Member User" types, supports different
roles per gateway, and preserves a clean platform boundary. The main engineering
cost for Member RBAC is not the role schema; it is complete endpoint
classification, secure collection/observability filtering, and non-transitive
handling of resource references. Gateway Admin can ship behind the smaller
platform/sensitive deny inventory; implementing domain grants before individual
resource grants then gives the manager a useful and safe Member release.

### 18.1 What to do first

The model above is the destination. The immediate action it implies is much
smaller than the document's length suggests:

1. **Ship PR1.** Caddy becomes platform-only, `gateway:secrets_raw` becomes an
   actor check, `GET /admin/virtual_keys[/{id}]` stops handing plaintext bearer
   values to every `viewer`, the synthetic `?? "viewer"` role disappears, and
   the audit table stops growing without bound. These close exposures that are
   live in the shipped product; none of them require the role hierarchy, the
   classifier, or the test harness.
2. **Add minimal CI**, then PR0.5's classifier.
3. **Settle §17.2 decisions 4, 5, and 6** before estimating anything past PR3.
   They change the size of Phase 1a-1, the shape of the Phase 1b release, and
   whether Phase 2 is in scope at all.

Everything after that is genuine multi-tenant product work and should be
scheduled against a real requirement, not against this document's completeness.
