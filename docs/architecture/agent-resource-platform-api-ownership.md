# Agent Resource Platform API Ownership and Service Boundaries

- Document type: **normative**
- Status: **current through Step 7**
- Applies to: `feature/agent-resource-platform` shared packages and APIs
- Last reviewed: 2026-10-21

This document fixes the dependency and API ownership boundary used by later
platform slices. Steps 2A–3 add identity, scoped Gateway-grant, explicit
compatibility and canonical shell foundations. Step 4 adds the shared model/tool
offering catalog, Step 4A adds Tenant/Platform Skills and instructions, and Step
4B adds Tenant knowledge/document metadata plus a private object adapter, Step
4C adds human-owned personal files, and Steps 4D–4E add Tenant model/tool
definitions. Steps 5–6 add publication, scoped deployment, invocation,
observation, compatibility and recovery APIs. Step 7 projects those services
through canonical Agent, Access, Workbench and Tenant Observability pages
without weakening their server-side predicates.

## 1. Implemented shared modules

| Module | Owner and responsibility | Allowed dependencies |
| --- | --- | --- |
| `packages/contracts/gateway/` | Canonical current Gateway Agent/runtime, capability, action/role and resolved-connection contracts | Other contracts and standard JavaScript values only |
| `packages/platform/authorization/gateway.ts` | Pure historical Gateway-role evaluator retained for tests/data interpretation; Step 6E no longer grants non-Platform actors Gateway content authority | Gateway contracts only; Tenant contracts are rejected by the boundary check |
| `packages/contracts/platform/identity.ts` | Principal, Tenant, membership, Tenant Gateway grant and actor-reference contracts | Other contracts and standard JavaScript values only |
| `packages/contracts/platform/catalog.ts` | Shared offering, availability, Tenant projection and immutable dependency-reference contracts | Other contracts and standard JavaScript values only |
| `packages/contracts/platform/authored-resources.ts` | Skill/instruction ownership, bounded package and immutable revision contracts | Other contracts and standard JavaScript values only |
| `packages/platform/services/identity*.ts` | Principal/Tenant/grant service, repository, live epoch authorization and additive schema migration | Platform contracts and ports only |
| `packages/platform/services/catalog*.ts` | Platform Admin catalog lifecycle, Tenant availability/source revalidation and persistence | Platform contracts, identity service and ports only |
| `packages/platform/services/authored-resource*.ts` | Tenant/Platform resource authorization, content normalization, immutable revisions and persistence | Platform contracts, identity service and ports only |
| `packages/contracts/platform/knowledge.ts` and `packages/platform/services/knowledge*.ts` | Tenant knowledge/document contracts, upload lifecycle, reference safety and persistence | Platform contracts, identity service and object/content/database ports only |
| `packages/contracts/platform/personal-files.ts` and `packages/platform/services/personal-file*.ts` | Human+Tenant ownership, permanent file lifecycle, preview and GC | Platform contracts, identity service and object/content/database ports only |
| `packages/contracts/platform/models.ts` and `packages/platform/services/model-definition*.ts` | Tenant model definitions, immutable versions, live offering capability and exact release references | Platform contracts, catalog/identity services and capability/database ports only |
| `packages/contracts/platform/tools.ts` and `packages/platform/services/tool-definition*.ts` | Tenant tool definitions, immutable versions, exact MCP capability validation and release references | Platform contracts, catalog/identity services and capability/database ports only |
| `packages/platform/ports/` | Database, manager identity-directory, catalog-source/runtime, offering-capability and credential-issuer interfaces | Platform contracts only |
| `packages/gateway-client/admin.ts` | Authenticated Gateway Admin JSON transport, loopback candidates and per-Gateway base-URL cache | Gateway contracts and server HTTP runtime APIs |
| `lib/gateway-resolve.ts` | Manager adapter that decrypts a stored Gateway row into `ResolvedGateway` | Manager database and encryption modules; temporarily re-exports the canonical type |
| `lib/access.ts` | Session/Gateway resolution, explicitly named Gateway compatibility guards and audit lifecycle | Manager persistence plus pure authorization modules |
| `lib/gateway-proxy.ts` | Request/response streaming proxy and header sanitation | Shared Gateway client and manager HTTP lifecycle |
| `lib/api.ts` | Browser fetch facade | Re-exports shared Gateway types for caller compatibility; does not own them |

`ResolvedGateway` contains a decrypted administrative password. It is an
internal server connection value, never a browser DTO or platform resource.
Credential decryption, manager sessions, request guards, redaction and auditing
remain outside `packages/gateway-client`.

The extracted Agent types deliberately preserve the current Gateway v0.7.0
baseline contract, including HTTP Agent `card_url`, `protocol: "a2a"` and
optional `auth_ref` and `timeout_seconds`. The structural step relocates
ownership without changing that protocol shape.

## 2. Dependency direction

The allowed direction is:

```text
contracts <- pure platform services
contracts <- Gateway adapters
contracts/services/adapters <- manager Route Handlers and UI facades
```

Shared contracts and platform services must not import React, Next.js request
types, browser globals, manager `lib/` modules or adapters. Platform services
must not import back into `gateway-client`. Gateway adapters may use server HTTP
APIs but must not resolve manager sessions or decide Tenant authority.

`bun run check:boundaries` parses static imports, re-exports, import types,
dynamic imports and `require` calls in shared packages. It also rejects JSX and
HTTP/browser globals in contracts and pure platform services. The checker has
negative tests for framework imports, manager-layer imports, request coupling,
reverse adapter dependencies and computed module loading.

`bun run typecheck:contracts` compiles the contract package without Node, Bun,
DOM, React or Next.js ambient types. A contract that accidentally relies on
those environments therefore fails independently of the application build.

## 3. API authorities

Step 6E narrows retained `/api/admin/*` behavior:

- manager identity, Gateway registry, memberships and audit remain manager
  authority;
- historical Gateway membership rows no longer authorize Gateway content;
- only a reviewed Platform Admin allowlist may use an active/explicit Gateway,
  and unknown catch-all families are denied before forwarding;
- Caddy, raw secrets and Gateway connection credentials retain their current
  Platform Admin restrictions; and
- legacy ACP chat is retired; scoped platform invocation contexts own browser
  turn/resume authority.

Platform access, identity administration and Tenant Gateway grant handlers are
explicit under `/api/platform/v1/access` and `/api/platform/v1/identity/*`.
Tenant Admin self-service membership handlers are separately explicit under
`/api/platform/v1/tenants/{tenant_id}/{members,member-resolutions}`; they do not
grant a Platform Admin implicit Tenant membership. Catalog handlers are explicit
under `/api/platform/v1/catalog/offerings` and the Tenant-redacted projection is
explicit at `/api/platform/v1/tenants/{tenant_id}/catalog`.
Step 4A adds explicit Tenant Skill/instruction collections and separate
Platform Admin catalog collections; neither surface accepts active-Gateway
context. Steps 4B–4E add explicit knowledge/document, personal-file and Tenant
model/tool-definition collections under the same Tenant-qualified prefix. The
definition services receive category-specific source checks through a
server-only port; the manager adapter may resolve an exact Gateway model route
or MCP tool but never returns its credentials or upstream ID to the browser.
Future business-resource handlers use the same prefix over platform services
and repositories; they must never fall through the `/api/admin/*` Gateway
proxy. Sharing manager authentication does not merge Tenant, platform-resource
and Gateway authority.

Step 3 also exposes the canonical Platform Admin upstream-credential adapter at
`/api/platform/v1/gateways/{gateway_id}/credentials` (plus its path-qualified
provider projection). It resolves the upstream connection only from the route
parameter and ignores session active-Gateway state and `X-Gateway-Id`. Manager-
owned secret redaction and omitted-key merge behavior are shared with the legacy
explicit handlers. The existing `/api/admin/credentials` route remains only in
the Platform Admin compatibility allowlist; non-Platform Gateway roles cannot
use it after the Step 6E cutover.

Step 7 adds the Platform Admin infrastructure adapter at
`/api/platform/v1/gateways/{gateway_id}/infrastructure/*`. It is not a generic
proxy: a strict method/path matrix admits only provider types, API handler
types, redacted providers, discovered/managed models, LLM routes, MCP services
and MCP routes needed by the canonical Gateway workspace. The adapter resolves
only the path Gateway and ignores active-session scope and `X-Gateway-Id`.
Legacy LLM/MCP pages redirect to a Gateway-qualified URL before their first
query; the canonical browser facade always supplies the path Gateway ID.

Client-provided Tenant, resource, owner, Principal, role or Gateway IDs are
inputs to server-side resolution, never proof of permission. Later services
must revalidate live Principal status, Tenant membership, ownership and the
specific Gateway grant required by the accepted authorization design.

The catalog service stores no administrative password, provider credential or
upstream bearer. Only its server-side Platform Admin projection contains the
source Gateway ID and upstream stable ID. Tenant responses contain the offering
ID, kind, version and digest but no infrastructure binding identifiers.

## 4. Remaining release boundary

Steps 6A–6E implement target deployment authorization, mappings, scoped
invocation/observation, Platform Admin compatibility and recovery. They do not
establish workflow-engine workers, durable jobs or remote object storage. The
real Gateway v0.7 and shared-Gateway isolation gate passed on 2026-10-21 through
the isolated `smoke:step6-gateway` harness.

The old feature commit `ca12d554385efe84296bbd2b228d2190f5427ba3` was used as
structural evidence. Its premature platform-resource types and its dependency on
an already-migrated HTTP Agent contract were intentionally excluded. No old
commit was cherry-picked.

Step 1B acceptance on 2026-10-17 passed 79 Bun tests, ESLint, project TypeScript,
isolated contract TypeScript, package-boundary checks, the production build and
the isolated Bun dev/build/start runtime smoke.

Steps 2A–2B persistence and HTTP behavior are documented in
[Platform identity persistence](../capabilities/platform-identity-persistence.md).
Step 2C introduced a deliberately named Gateway `admin/member` compatibility
guard. Step 6E retires that user-facing authority; platform services never
imported it or inferred Tenant authority from its memberships.
Step 3 projects the identity administration pages delivered by those
foundations. Accepted Step 4 slices add their own Resource APIs and canonical
Skills, Instructions, Knowledge bases, My files, Models and Tools pages. Agent
definition APIs are documented in
[Platform Agent definitions and publication](../capabilities/platform-agent-publication.md).
Steps 6A–6E add explicit Tenant-qualified deployment-intent/lifecycle handlers,
durable operation journals, scoped Access/invocation/observation handlers and the server-only Gateway deployment adapter documented in
[Platform Agent deployments](../capabilities/platform-agent-deployments.md).
Allocation remains local-only; only an explicit lifecycle request can use the
adapter, and it requires a verified binding record. Tenant endpoint discovery
and invocation use platform-owned contexts and never expose a bearer. Tenant
observation/runtime actions apply exact Tenant/Gateway grants; Platform Admin
diagnostics and Gateway-only Agents use explicit Gateway-path handlers that
filter deployment pair fences. Step 6E adds deny-before-forward cutover,
specialized reconciliation, startup recovery and remove-only decommission.
Immutable release and Workbench surfaces landed in Step 5.
