# Agent Resource Platform Rebuild Plan

- Document type: **delivery**
- Status: **active; Steps 0–5 and Steps 6A–6B lifecycle core complete**
- Applies to: `rebuild/agent-resource-platform`
- Last reviewed: 2026-10-20

The branch was originally replayed from a release candidate named `v0.2.0`.
That tag was removed, the release number was reset, and the intermediate release
commits were consolidated. On 2026-10-20 the completed Step 0–4 series received
a one-time history repair so that the final `main` tag `v0.1.0` is an ancestor of
every retained resource-platform commit. This is historical provenance and a
minimum compatibility baseline, not a continuing requirement to replay work at
the tag. Step 5 and later steps advance from the current feature-branch head;
the branch may synchronize with newer `dev` commits when integration requires
it.

This plan rebuilds the selected Agent resource platform capability in a coherent
history. The old `feature/agent-resource-platform` branch is retained as evidence
but is not merged or rebased into this branch.

## 1. Delivery rules

1. One step changes one architectural concern and has its own verification gate.
2. Each step is committed only after its tests pass and its documented status is
   accurate.
3. Source code is ported by contract, not by directory or whole commit.
4. Target authorization lands in server services before UI vocabulary/visibility.
5. Canonical UI routes receive vertical features incrementally; avoid multi-page
   move-and-rewrite commits.
6. Existing Gateway management keeps working until an accepted replacement is
   present. Compatibility is explicit and temporary.
7. Unsupported runtime/resource behavior stays unavailable rather than mocked.
8. Cutover, generated migrations and operational acceptance come after schemas
   and writers stabilize, not before.
9. The completed one-time baseline replay is not repeated for later slices;
   ordinary feature commits advance from the current branch head and synchronize
   with `dev` only through an explicit integration decision.

Every step records: source evidence, target owner, migration effect, positive and
negative authorization cases, verification commands and known limits.

## 2. Step 0 — documentation baseline

Deliver:

- product/service boundary;
- pinned source allowlist and exclusions;
- accepted Tenant authorization model;
- target UI architecture and canonical routes; and
- this ordered rebuild plan.

Gate:

- documents do not claim old-feature implementation on the new baseline;
- target/current behavior are clearly distinguished;
- source and old-feature revisions are pinned;
- authority and UI terms agree; and
- `AGENTS.md` routes future changes to the documents.

No functional code is migrated in Step 0.

Result (2026-10-20): the five-document baseline and `AGENTS.md` routing were
first replayed on the pre-release candidate and later rebased onto `v0.1.0`.
Document whitespace/link targets were
checked; the release baseline passed all 83 Bun tests, ESLint, TypeScript, the
production build and the pinned Agent Gateway v0.7.0 smoke. This is
documentation acceptance only and does not certify any target platform feature.

## 3. Step 1 — runtime and dependency boundary

### 1A. Prove the Bun runtime

- Pin the supported Bun version and make dev/build/start explicitly run Next.js
  under Bun.
- Add an isolated smoke test using a temporary database and object directory.
- Verify health, login failure/success, persisted session after restart and one
  authorization denial in real dev and production processes.

Do not introduce workers in this slice.

Result (2026-10-17): Bun 1.3.13 is pinned and the supported dev/build/start
commands execute Next.js 16.2.4 through `bun --bun next`. The health handler is
dynamic and reports the serving runtime. `bun run smoke:runtime` uses an
isolated source copy, SQLite database, object directory and build output; it
proved the runtime, failed/successful login, session persistence across restart,
Platform Admin denial for an ordinary user and logout in both development and
production. All 73 existing tests, ESLint, the new full typecheck and a separate
production build passed. No worker or platform resource API was introduced.

Step 1 remains open until 1B establishes and verifies the shared boundaries.

### 1B. Establish shared boundaries

- Extract framework-neutral Gateway/runtime contracts from `lib/api.ts` only as
  callers are migrated.
- Add pure domain/authorization modules and narrow Gateway client ports.
- Add a boundary check preventing contracts/services from importing React,
  browser APIs or Next.js request types.

Gate: existing tests, lint, typecheck, production build, runtime smoke and
boundary tests pass. No resource API exists yet.

Result (2026-10-17): current Gateway Agent/ACP/runtime, action/role and resolved
connection contracts are owned by `packages/contracts/gateway`; `lib/api.ts`
and `lib/gateway-resolve.ts` retain compatibility re-exports. Current pure
Gateway role evaluation lives under `packages/platform/authorization`, while
authenticated Admin JSON transport and the per-Gateway address cache live under
`packages/gateway-client`. Static boundary checks and an isolated contracts
TypeScript project prevent framework/browser/manager imports from entering the
shared domain layers. The baseline HTTP Agent `card_url`, required
`protocol: "a2a"`, optional `auth_ref` and optional `timeout_seconds` contract
was preserved;
no resource contract, platform API, identity schema or worker was introduced.
All 79 Bun tests (including new boundary and Gateway-client transport tests),
ESLint, project and isolated-contract TypeScript checks, the static boundary
check, production build and isolated dev/build/start runtime smoke passed.

## 4. Step 2 — identity and target authorization foundation

### 2A. Principals and Tenants

- Reuse current manager users as human Principal identities; do not copy password
  hashes into a second editable identity store.
- Add service Principals, Tenants and `admin|user` memberships.
- Revalidate live user/service status and membership on every domain operation.

Result (2026-10-17): manager users are exposed as stable human Principals without
copying credentials or editable identity state. Additive SQLite/PostgreSQL
platform persistence now owns service Principals, digest-only revocable service
credentials, Tenants and one `admin|user` membership per Principal/Tenant.
Platform Admin and Tenant Admin administration paths are explicit under
`/api/platform/v1`; Platform Admin receives no implicit Tenant membership.
Every access check reloads live manager/service, Tenant and membership state.
Manager user IDs are permanently reserved so a deleted account cannot transfer
retained authority to a replacement. Existing Gateway authorization and UI are
unchanged. Direct stable-ID membership creation is confined to the separate
Platform Admin bootstrap API. Tenant Admins may change or remove existing
members, but cannot add one until Step 3 delivers the exact resolver and
single-use receipt flow. Step 2 remains open for per-admin Tenant Gateway grants
and the compatibility boundary.

### 2B. Tenant Gateway grants

- Add `view|manage` grants keyed by Principal, Tenant and Gateway.
- Add a durable deletion-surviving reservation in the same local transaction
  that first issues every Tenant and Gateway ID. It exists throughout active,
  `deleting` and deleted/tombstoned states, so creation always rejects reuse;
  retained resource, allowlist, deployment and offering rows must also require a
  live referenced subject and remain inaccessible after deletion. Step 2B proves
  the reservation primitive and old-grant behavior; each later row-owning slice
  proves the invariant for the rows it introduces.
- Enforce same-store cascading invalidation plus the durable `authority_epoch`
  fencing protocol for every Principal, Tenant, membership and Gateway
  dependency in the authorization design; do not claim a distributed
  SQLite/PostgreSQL transaction.
- Add Platform Admin administration APIs and audit finalization.

Result (2026-10-18): platform schema v2 persists one highest `view|manage`
grant per Principal/Tenant/Gateway plus permanent Tenant/service-Principal ID
reservations and durable service/Tenant/membership epochs. Manager schema v4
adds permanent Gateway ID reservations, durable human/Gateway epochs and scoped
grant audit fields. Same-store invalidation advances its fence and removes
dependent grants atomically; manager-backed dependencies use live cross-store
epoch comparison without claiming a distributed transaction. Grant creation
performs write-then-reread validation, and stale cleanup is best-effort while
authorization remains fail-closed. Platform Admin list/set/revoke APIs are
explicit under `/api/platform/v1/identity/tenant-gateway-grants`; no Gateway
proxy or deployment path accepts these grants yet.

### 2C. Compatibility boundary

- Keep existing Gateway membership/action behavior only for existing Gateway
  screens while scoped deployment APIs do not yet replace it.
- Do not translate old Gateway roles into Tenant grants automatically.
- Mark the compatibility surface in code/tests; no target UI claim yet.

Result (2026-10-18): every retained Gateway-scoped `/api/admin/*` handler now
enters through the explicitly named
`requireGatewayCompatibilityAccess`/`withGatewayCompatibilityAccess` surface.
Its context carries the fixed `gateway_membership_compatibility` authority mode,
and the pure evaluator is named `canPerformGatewayCompatibilityAction`.
Package-boundary checks prevent Tenant platform services from importing this
evaluator and prevent it from depending on Tenant contracts. Migration and
authorization tests prove existing `user_gateways` rows are not converted into
Tenants, Tenant memberships or Tenant Gateway grants. Existing Gateway screens
retain their previous behavior; no target UI vocabulary or visibility was added.

Gate: SQLite and PostgreSQL repository tests, migration dry-run, cross-Tenant
denial, Tenant User grant denial, Platform Admin-without-membership denial,
service revocation, manager-Principal/Gateway disable and re-enable races,
Tenant disable/re-enable and membership demote/re-promote races, stale-grant
cleanup failure, Tenant/Gateway reuse rejection while active, `deleting` and
tombstoned, inaccessible old grant rows, and audit-outcome tests pass.

## 5. Step 3 — canonical shell and scope spine

Result (2026-10-18): the Tenant-Admin exact Principal resolver and short-lived
single-use membership-add receipt flow are implemented. Receipts are stored only
as SHA-256 digests, bind the caller, path Tenant, explicit target namespace and
all current authority epochs, and are consumed atomically with membership
creation. The handler rejects mixed discriminator shapes and arbitrary target
IDs; Platform Admin bootstrap remains separate. The active-membership projection,
Tenant-aware shell scope and `/dashboard/tenant/{tenant_id}/members` page now
provide exact-URL refresh, member add/update/remove and read-only disabled-
Principal feedback. Its dedicated Tenant API requires the path Tenant's active
Admin membership, so Platform Admin status alone cannot authorize the page.
The Platform-scoped Tenants page now provides lifecycle and membership
administration, including disabled-Tenant feedback, and Service accounts
provides digest-only creation with one-time credential delivery and immediate
revocation. Gateway access now assigns or revokes one live `view|manage` grant
for an active Tenant Admin membership and active Gateway; stale epoch snapshots
are omitted from the projection. It exposes neither general Gateway proxy
authority nor connection credentials. The canonical Platform Admin credential
surface now resolves its Gateway exclusively from
`/dashboard/platform/gateways/{gateway_id}/credentials` and matching explicit
`/api/platform/v1/gateways/{gateway_id}` handlers. Its selector changes scope by
navigating first, while a single available Gateway is a read-only scope label.
The legacy active-Gateway credential page and handlers remain available to a
current non-Platform Gateway Admin without translating that compatibility role
into Tenant authority. The shell links only the delivered Tenant and Platform
surfaces; unsupported future destinations remain absent.

- Establish the shell and final canonical URL contracts for Workbench, Agents,
  Resources, Access, Tenant administration, Observability and Platform. Link a
  destination in navigation only when this or a later named slice has delivered
  its authorized data source and direct-URL guard.
- Move only existing feature-equivalent pages behind small adapters/redirects.
- Add scope metadata so Tenant ownership appears on Tenant pages. Canonical
  Gateway-qualified pages and APIs derive authority and upstream selection only
  from `{gateway_id}` in the URL path. Their selector either navigates to the
  equivalent path for the newly selected Gateway before issuing requests or is
  a read-only path-scope label; it never supplies or overrides scope through
  `session.active_gateway_id` or an active-Gateway header. Keep the mutating
  active-Gateway selector only on explicitly legacy session-scoped pages until
  their canonical replacement passes parity.
- Add target role/session projection only for Step 2 capabilities.
- Deliver `/dashboard/tenant/{tenant_id}/members` for an active Tenant Admin
  membership in that path Tenant, backed by the Step 2A membership API. The page
  may add/remove memberships and change `admin|user` roles; listed Principal
  disabled states are read-only feedback, never Tenant-local identity mutations.
- Add a Tenant-Admin-only exact Principal resolver for that add flow. Its input
  is discriminated as either `{ kind: "human", username }` or
  `{ kind: "service", principal_id }`; it never guesses a namespace or accepts
  both identifiers. The selected identifier is supplied out of band and matched
  exactly. The resolver returns only the display label, kind and live status
  needed for confirmation, plus a short-lived single-use add receipt bound to
  caller, Tenant, resolved target kind/id and current authority epochs. It
  provides no prefix search or platform directory listing and rejects malformed,
  inactive or missing identities without creating a membership.
  Tenant-Admin creation must consume that receipt and repeat live checks; direct
  creation with an arbitrary stable Principal ID is denied. Existing-member role
  changes/removal and the separate Platform Admin bootstrap path keep their
  explicit APIs. Receipt issuance, membership mutation and rejection are audited.
- Keep Platform Admin membership administration on the platform-scoped Tenants
  surface, including disabled-Tenant feedback. A disabled Tenant is omitted from
  the Tenant access projection and its Tenant-scoped direct URL is denied.
  Platform Admin status alone does not expose the Tenant-scoped page or grant
  Tenant data access.
- Deliver `/dashboard/platform/tenants` on the Step 2A APIs for Tenant lifecycle
  and platform-scoped membership administration, and
  `/dashboard/platform/service-accounts` for service Principal creation,
  one-time credential display and revocation. The credential value is never
  recoverable from a later list/detail response.
- Deliver `/dashboard/platform/gateway-access` only on the Step 2B grant APIs.
  It assigns or revokes `view|manage` for one active Tenant Admin membership and
  one Gateway; it never exposes general Gateway proxy access or connection
  credentials.
- Establish `/dashboard/platform/gateways/{gateway_id}/credentials` as the
  target upstream-credential page, guarded only by Platform Admin infrastructure
  authority. During Steps 3–6D, keep the existing legacy credential page and
  explicit handlers available to a current non-Platform Gateway Admin under the
  old membership/action checks; do not redirect that actor to the target page or
  revoke this compatibility workflow early. Tenant Admin/User target roles have
  no navigation or direct-URL access. Step 6E removes the legacy path only after
  explicit operator assignment and parity acceptance.

Do not add empty Workbench/Skills/Knowledge/Deployment pages. Navigation grows
when each vertical slice below lands. In particular, do not link Workbench in
Step 3; activate it in Step 5 from Tenant-readable definition/release data and
extend it with deployment/runtime attention in Step 6D.

Tenant policy is deferred until a separately accepted vertical slice defines a
real policy schema, repository/service contract, API and negative authorization
tests. It has no navigation entry or placeholder route in Step 3.

Gate: active route, deep-link refresh, redirect context, mobile/keyboard and
direct-URL authorization tests pass. Tenant Admin membership CRUD succeeds;
Tenant User and Platform-Admin-without-membership access to the Tenant-scoped
page is denied; disabled Principal state is displayed without a Tenant-local
status mutation; a disabled Tenant disappears from Tenant navigation and its
direct URL is denied while remaining visible to Platform Admins on the Tenants
surface. Platform identity pages reject non-Platform Admin direct access;
the exact Principal resolver cannot enumerate the platform directory and
rejects Tenant Users, Platform-Admin-without-membership, partial identifiers and
inactive identities. A fixture in which a human username equals a service
Principal ID proves the required `kind` selects only that namespace; missing,
mixed or contradictory discriminator/identifier shapes are rejected. Membership
creation rejects caller-supplied target IDs and
expired, replayed, cross-Principal, cross-Tenant or stale-epoch receipts, and a
target disabled after resolution cannot be added;
deep links to Gateway A's delivered credential page continue to address A if
`session.active_gateway_id` changes to B; a working selector navigates the URL to
B before any B request, while a non-navigating shell shows only a read-only A
label;
service credentials appear once and cannot be redisplayed; Gateway grant
creation rejects inactive/non-admin memberships and revocation is reflected on
the next authorization check. Refreshing a Tenant-qualified Members URL restores
that exact Tenant; a disabled path Tenant is denied while another active
administration membership still loads. Tenant Admin/User credential URLs are
denied and Platform Admin credential update still succeeds. Existing Gateway
workflows retain parity.

Acceptance (2026-10-18): the complete Step 3 series passed 97 ordinary Bun
tests (with only the opt-in PostgreSQL suite skipped in the final run), ESLint,
project and isolated-contract typechecks, package-boundary checks, a production
build and the isolated Bun development/production runtime smoke. The membership
receipt slice also passed the same identity repository contract against an
isolated PostgreSQL 16 instance. Scope tests prove deep-link parsing, equivalent
Gateway navigation and route-parameter-only upstream resolution; secret tests
prove redaction and omitted-key preservation.

## 6. Step 4 — resource vertical slices

Catalog foundation result (2026-10-19): platform-owned model/tool offerings now
have immutable stable IDs, version-one dependency digests, explicit human
Platform Admin owners and a required `platform-native|gateway-backed`
discriminant. Gateway-backed records capture the source Gateway authority epoch
and upstream stable ID without any credential. Draft approval rechecks the live
source, retirement is irreversible, and Tenant projection rechecks active
membership, active Tenant, current allowlist epoch and current source Gateway
epoch. Availability is either all active Tenants or an explicit allowlist;
Platform Admin mutation and Tenant read APIs are separate. The Platform Catalog
page supplies create, approve, retire and availability workflows with explicit
loading, failure, forbidden and empty states. See
[Platform shared catalog](../../capabilities/platform-catalog.md). Resource slices are delivered
independently below; all Step 4 slices are now complete.

Catalog foundation acceptance (2026-10-19): 100 ordinary Bun tests passed with
only the two opt-in PostgreSQL suites skipped; rerunning the catalog and
persistence suites against an isolated PostgreSQL 16 instance passed all 5
tests, including the additive v3→v4 rehearsal. ESLint,
project and isolated-contract typechecks, package-boundary checks, the
production build, `git diff --check`, and isolated Bun
development/production runtime smoke passed. The runtime smoke exercises HTTP
authorization denial, malformed-source rejection, create/approve, Tenant
redaction, audit finalization, restart persistence and retirement.

Each numbered slice is independently committed and includes contract, service,
repository, migration, Route Handler, browser client, final UI page and tests.

Before a slice accepts a platform-shared or Gateway-backed reference, deliver
the common catalog authority it depends on:

- platform-owned catalog records carry an explicit owner and immutable stable
  identifier. A required offering-kind discriminant makes `gateway-backed`
  require both `source_gateway_id` and `upstream_stable_id`, while
  `platform-native` forbids both; partial or contradictory source fields are
  rejected. The Platform Admin record carries no upstream secret. Tenant
  projections and write contracts expose only the catalog `offering_id`, never
  those infrastructure binding identifiers;
- persisted availability is either all active Tenants or an explicit Tenant
  allowlist, is administered only by Platform Admin, and is independent of the
  deferred Tenant policy surface and legacy Gateway membership;
- Platform Admin catalog/availability APIs and
  `/dashboard/platform/catalog` provide create/approve/retire and availability
  management with audit finalization; Tenant APIs expose only the allowed,
  active, secret-redacted projection; and
- reference validation rechecks Tenant availability and source health, while
  the catalog supplies a stable reference/digest plus the internal source
  Gateway binding for later immutable release snapshots if availability or
  source state changes.

Gate: Platform Admin-only mutation, Tenant allowlist isolation, durable internal
source-Gateway identity, unavailable/retired behavior, secret redaction, audit
outcomes and SQLite/PostgreSQL parity pass before the dependent slice is
accepted.
Deleting a Tenant or source Gateway must make retained availability/offering
rows inaccessible, and a newly created subject cannot inherit them. Catalog
writes reject a gateway-backed offering missing either source field and a
platform-native offering supplying either field.

### 4A. Skills and instructions

- Tenant ownership plus optional platform-shared owner;
- content/path/package limits, hash and immutable revisions;
- reference-safe archive/delete; and
- list/editor/revision UI at canonical Resource routes.

Completed (2026-10-19): Tenant-owned and optional Platform-shared Skills and
instructions now use explicit owner discriminants, Tenant authority-epoch
fencing, bounded canonical content, SHA-256 hashes and immutable numbered
revisions. Platform sharing uses the catalog availability modes and Tenant epoch
rules. Reference rows fail closed for archive/delete, while the canonical Skills
and Instructions pages provide scope selection, content/metadata editors and
revision lifecycle controls. See
[Platform authored resources](../../capabilities/platform-authored-resources.md).

### 4B. Knowledge bases and documents

- Tenant metadata ownership;
- upload URL/session/completion, per-file partial failure, download and deletion;
- explicit unavailable indexing/retrieval state; and
- knowledge/document UI.

Completed (2026-10-19): Tenant-owned knowledge metadata now has fenced CRUD and
reference-safe archive. Document batches create independent upload results,
Principal-bound digested object tickets, immutable local objects, retryable
failed sessions, idempotent completion, downloads and soft deletion. Contracts
and UI explicitly report indexing, parsing and retrieval as unavailable. See
[Platform knowledge bases and documents](../../capabilities/platform-knowledge-documents.md).

### 4C. Personal files

- Tenant + human owner enforcement;
- deny service Principals and service credentials regardless of Tenant role
  until a separate service-access workflow is accepted;
- permanent upload, preview, download, soft delete and GC; and
- one canonical `/dashboard/resources/files` page plus account shortcut.

Temporary chat attachments and promotion are deferred with chat.

Completed (2026-10-19): permanent files now require exact Tenant plus human
owner authority; service credentials are denied for both Tenant roles and Tenant
Admin cannot read another human's files. Idempotent upload/completion, safe
preview, download, reference-safe soft delete and durable idempotent GC are
implemented at the one canonical My Files page and its account shortcut. See
[Platform personal files](../../capabilities/platform-personal-files.md).

### 4D. Tenant model definitions

- Tenant-owned authoring records whose sole infrastructure binding is the
  approved catalog `offering_id`;
- no provider credential, API key or raw Gateway administrator secret in the
  definition contract or response;
- reference/digest semantics sufficient for deterministic Agent release
  snapshots; and
- combined Tenant definitions and authorized shared offerings on the canonical
  Models page, with source/owner labels and Used by Agents attribution.

Completed (2026-10-19): Tenant model definitions now bind only an approved
model offering ID, create immutable numbered versions and deterministic
definition/offering digest references, and recheck both Tenant/catalog authority
and the live source capability. Exact-version references protect archival. The
canonical Models page combines Tenant-owned definitions with authorized shared
offerings; Used by Agents remains explicitly empty until Step 5 creates platform
Agent references. See [Tenant model definitions](../../capabilities/platform-tenant-models.md).

### 4E. Tenant tool definitions

- Tenant-owned authoring records whose sole infrastructure binding is the
  approved MCP/tool catalog `offering_id`;
- capability validation and explicit unavailable state when the referenced
  offering disappears or is no longer accessible;
- no upstream service credential or general Gateway proxy authority in the
  definition contract; and
- combined Tenant definitions and authorized shared offerings on the canonical
  Tools page, with source/owner labels and Used by Agents attribution.

Completed (2026-10-19): Tenant tool definitions bind only an approved tool
offering ID, append immutable versions and expose deterministic
definition/offering digest references. Gateway-backed references are checked
server-side against the exact MCP service/tool capability on create, update,
read and reference resolution; missing capabilities are explicit unavailable
state. Exact-version references protect archival. The canonical Tools page
combines Tenant definitions and authorized offerings without exposing service,
credential, Gateway or upstream IDs. See
[Tenant tool definitions](../../capabilities/platform-tenant-tools.md).

Step 4 replay acceptance (2026-10-20): 118 Bun tests passed with zero failures;
the seven opt-in PostgreSQL cases were skipped because no PostgreSQL URL was
configured for this replay. ESLint, project and isolated-contract typechecks,
package-boundary checks, production build, `git diff --check`, and isolated Bun
development/production runtime smoke passed. The pinned Agent Gateway v0.7.0
HTTP Agent smoke also passed in development and production modes. It covers
create/read/update, capability discovery, native-route denial and authenticated
SSE while exercising the rebuilt manager boundary against the exact Gateway
commit recorded by the active `v0.1.0` release document.

Common gate for every slice: SQLite/PostgreSQL behavior, cross-Tenant/owner
denial, deleted-Tenant retained-row inaccessibility, reference-safe mutation and
UI error/empty/forbidden states. Content and package slices additionally prove
revision immutability. Object-backed slices prove failure recovery and
idempotent completion; personal-file tests explicitly deny a service credential
owned by a Tenant User and by a Tenant Admin. Model/tool slices prove approved-offering validation,
deterministic release references, and rejection of provider, credential,
service, Gateway, upstream-object and secret fields.

## 7. Step 5 — Agent definitions and releases

### 5A. Definition

- Tenant-owned mutable AgentDefinition with runtime-neutral core and validated
  advanced configuration;
- references to exact accessible resources; and
- lifecycle enforcement for editability.

Completed (2026-10-20): platform schema v10, shared contracts and explicit
Tenant-scoped APIs now persist optimistic mutable Agent definitions without any
Gateway operation. Drafts use a runtime-neutral core plus strictly validated
builtin/ACP/HTTP advanced configuration, reject unknown and secret-bearing
fields, resolve exact accessible model/tool versions, Skill/instruction
revisions and knowledge bases, and protect those references transactionally.
The server returns deterministic draft digests and editability; active Tenant
Admin and Tenant User membership is the only authoring authority. See
[Platform Agent definitions and publication](../../capabilities/platform-agent-publication.md).

### 5B. Release

- immutable AgentRelease and dependency snapshots/digests, including every
  Gateway-backed offering's internal source-Gateway binding while keeping it out
  of Tenant write contracts and secret-redacted projections;
- publication-time validation of every reference and supported runtime/resource
  combination; and
- create wizard, Agent inventory, Configuration and Releases UI.

Completed (2026-10-20): platform schema v11 now persists immutable numbered
releases with deterministic draft/dependency/execution digests. Publication
re-authorizes the Tenant actor, re-resolves exact references, freezes internal
Gateway-backed source bindings without returning them in Tenant projections,
and rejects stale, unpublished, unavailable or unsupported inputs. The initial
safe release subset is builtin/single with one model, optional tools and
published Skills/instructions; ACP, HTTP, other topologies and knowledge remain
draft-only. The four-step create flow, combined platform/Gateway inventory,
Configuration/Releases detail, Workbench recent activity and resource
attribution are backed by these Tenant APIs. No Gateway grant or remote write is
performed.

After these slices provide a real Tenant-readable source, link Workbench and
populate it with recently edited accessible definitions/releases plus authorized
create/open actions. It must not fall back to the legacy general Gateway proxy;
deployment, health and permission attention is added by Step 6D.

Tenant Admin and Tenant User may perform both slices. No Gateway grant is used
until deployment.

Gate passed: cross-Tenant denial, deleted-Tenant retained definition/release
inaccessibility, secret-field rejection, stale/missing dependency failure,
release immutability, deterministic hash and unsupported runtime/resource tests
pass.

## 8. Step 6 — scoped Gateway deployment

### 6A. Deployment records and adapter

- explicit Gateway target, Agent/route mapping and desired hash;
- split allocation from apply. An authorized Tenant Admin calls
  `POST /api/platform/v1/tenants/{tenant_id}/deployments` with an immutable
  release and explicit granted Gateway. The server persists and returns a
  deployment ID plus deterministic Agent/route IDs in non-invocable
  `awaiting_key_binding`; this local step performs no Gateway read/write, opens
  no apply journal and does not advance the deployment-invocation epoch. The
  Platform Admin can then create the non-secret deployment-key binding and
  explicitly enable the Gateway key (`disabled=false`). Only
  `POST /api/platform/v1/tenants/{tenant_id}/deployments/{deployment_id}/apply`
  enters publication. Cancel may delete an unbound intent; a bound intent must
  first complete verified unbind/reservation cleanup. The UI presents this as
  **Create deployment intent → Await key binding → Apply**, so first publication
  never depends on a binding to a nonexistent deployment. After a verified
  take-offline, `POST /api/platform/v1/tenants/{tenant_id}/deployments/{deployment_id}/online`
  performs the authorized in-place staging-to-final transition; it is not the
  initial `/apply` path;
- every initial deploy, retry, rollback, take-offline, online, route-changing recovery
  and remove-only decommission acquires the same exclusive per-Gateway object
  lease used by every Gateway route writer—including compatibility Agent routes
  and retained Platform Admin LLM/MCP route handlers—before its first remote
  Agent/route read or mutation. It holds that lease through all related remote
  writes, verification and the authoritative operation/claim state commit, so
  apply, cleanup and compatibility cannot interleave on the same Gateway. Every
  operation that can change route invocability or a deployment/compatibility
  authority epoch—including take-offline, online, rollback, route-changing recovery,
  compatibility Agent/route mutation and decommission—also acquires the
  key-policy lease even when it does not edit a key. It always acquires object
  first, then key-policy, holds both through remote verification and
  authoritative state commit, and releases in reverse order;
- under that route/object lease and before any Agent or route write, exhaust all
  pages of the Gateway's Agent, LLM and MCP route inventory and evaluate the
  intended route mutation with the Gateway's effective host, raw path-prefix and
  method match/score rules. A final public route must be the unique winner for
  every concrete ingress method/path/host exposed by that Agent. Reject an
  equal-score tie or a foreign equal/ancestor/descendant prefix that wins any
  supported request as a stable conflict with no remote write while the proposed
  final write has not landed. When recovery observes its operation-owned route
  already at final, the same failed proof authorizes only the guarded staging
  withdrawal and route containment. A non-public
  staging create/move is exempt from the winner requirement: under the same
  snapshot and lease it must instead prove that no supported public request can
  select its operation-unique reserved tuple. A create preserves public
  selection. A move may withdraw only its own exact expected final route; after
  excluding that source route, the selected unrelated fallback—or no match—must
  equal evaluation with that route absent. The only permitted selection change
  is the intended withdrawal to that fallback/no match. Containment is not
  rejected because the withdrawal makes an ancestor win or leaves no match. Retry and
  rollback exempt only their own journaled route ID at its expected fingerprint;
  all retained compatibility/LLM/MCP route create/update handlers perform the
  symmetric check under the same lease. Keep the lease through verification and
  state commit so no route writer can enter after preflight;
- derive Gateway Agent and route IDs server-side from the deployment; callers do
  not select an arbitrary existing Gateway object. Before an initial remote
  create, take that exclusive object lease, require both IDs to be absent
  remotely, require its binding-owned prepublication route-ID reservation and no
  foreign reservation/blocking pair fence, and convert that reservation into a
  provisional pair reservation bound to the operation id. Compatibility and all
  route writers fail closed
  while that reservation exists. A verified successful create promotes it to a
  durable deployment pair claim keyed by `(gateway_id, agent_id)` only after the
  Agent, route and their relationship all match their journaled final desired
  state;
  infrastructure guards may read the claim even when its Tenant or Gateway is
  not live, while
  ordinary Tenant projections may not. Promoted claims survive deployment,
  Tenant and Gateway deletion so a retained mapping cannot be reclassified as
  Gateway-only inventory. Create conflict never adopts or overwrites the
  pre-existing object: after verifying no operation-owned object was written it
  invokes the declared `binding_conflict_cleanup` key-writer transition under
  the already held leases. That transition removes the derived route from the
  bound key (setting `disabled=true` if it was the final entry), verifies the
  live key policy, then releases the provisional/prepublication reservations and
  binding and returns the deployment to non-invocable `awaiting_key_binding`
  with conflict metadata. It does not advance the deployment-invocation epoch;
  it is safety cleanup of an earlier binding side effect, not an ordinary
  no-write precondition result or a publication-owned key mutation. If cleanup
  is unknown, `binding_conflict_cleanup_failed` retains the fence/binding and
  operation token for Platform Admin retry and raises an incident; a foreign
  route is never knowingly left allowlisted. The operator may remove the foreign
  route and rebind the same intent, or abandon the unbound intent and allocate a
  new deterministic ID. Crash
  recovery under the same lease first loads the write-ahead operation kind and
  phase; take-offline, online and rollback resume their recorded desired
  lifecycle before generic pair classification. It reconciles the pair, never
  one object in isolation. Without a pending lifecycle goal, a complete pair matching the final fingerprints is promoted
  atomically. A matching proper subset remains provisional in
  `partial_failure`; retry may re-enter only its own operation reservation,
  revalidate the existing object and create only the absent object. The journal
  also records `objects_created_awaiting_activation` and the allowed
  present-but-disabled staging-route fingerprint. Its match policy uses an
  operation-unique manager-reserved staging path/host/method tuple that no
  supported public ingress request can match; preflight also proves it does not
  displace any existing route. Recovery treats that state as an intentional
  intermediate, keeps the pair provisional and atomically updates the same route
  in place from staging match+`disabled=true` to the final match+`disabled=false`
  fingerprint before verification and
  promotion. If both writes are absent, the same operation may retry both. It
  may be abandoned only through the Platform Admin binding-abandon handler,
  which records the existing `binding_conflict_cleanup` writer token with reason
  `zero_write_abandon`, removes or safely final-entry-disables and verifies the
  derived key allowlist entry, re-proves both remote IDs absent, and only then
  releases the binding plus provisional/prepublication reservations and returns
  the intent to `awaiting_key_binding`. Unknown cleanup enters
  `binding_conflict_cleanup_failed` and retains every fence; no raw reservation-
  release path exists. That
  `objects_created_awaiting_activation` phase belongs only to initial
  publication. Rollback uses distinct promoted-claim phases:
  `rollback_staged_awaiting_agent_update` records the target release while the
  prior Agent remains hidden behind the staging route, and
  `rollback_agent_updated_awaiting_activation` records the verified target Agent
  before final route restoration. Recovery resumes exactly that phase—updating
  and verifying the Agent first when necessary, then restoring the same route—
  and never routes the previous Agent publicly. Rollback does not reapply the
  initial-absence rule. Recovery never quarantines a mismatched route before
  evaluating its data-plane auth: an enabled operation-owned route with
  missing/false key protection first runs/adopts the crash-safe route-containment
  token and verifies final-ingress closure. After that, a foreign or any other
  mismatched object converts the pair into a durable blocking quarantine fence for Platform
  Admin investigation without claiming ownership. Compatibility treats
  provisional reservations and quarantines exactly like promoted claims. An
  explicit resolver may clear a
  quarantine only after verifying the operation wrote no object and the pair is
  safe to classify as Gateway-only. Before each initial remote create the
  operation journal durably records the object ID, canonical final fingerprint,
  any allowed intermediate fingerprint/phase, verified pre-write absence and
  write-attempt sequence. If a mismatched object
  first appeared after that recorded attempt while the exclusive lease excluded
  every supported writer, the Platform Admin quarantine resolver may instead use
  remove-only authority under object-then-key-policy leases: revoke every key
  that permits the quarantined route, delete only the journal-proven
  operation-owned route/Agent, verify absence, mark the deployment partial
  failure and, for an otherwise active deployment, atomically convert the
  quarantine back into a provisional reservation bound to that same operation.
  It is exposed as the explicit Platform Admin-only
  `POST /api/platform/v1/gateways/{gateway_id}/deployment-quarantines/{operation_id}/resolve`
  handler and **Resolve deployment quarantine** action, using a declared
  `quarantine_artifact_cleanup` key-writer token through the common lease,
  desired/observed journal and finalizer. For a key in an ordinary state that
  token is an explicitly accepted ordinary-state safety-revocation finalizer:
  shared-list narrowing preserves every unrelated route and the prior
  `disabled` value. If the quarantined route is the final explicit entry, the
  finalizer atomically writes `{disabled:true, allowed_route_ids:[]}` or first
  verifies `disabled=true` and only then removes the entry. It never commits
  `stable` with an enabled empty list. Verified closure records the new
  fingerprint and returns the key to `stable`; unknown closure records
  `reconciliation_required` and keeps the outer quarantine fenced. A key already
  in a containment state instead dispatches the containment-aware cleanup token
  and records only its cleanup receipt, never `stable`. For an active deployment
  that key creates a `key_restore_blocked_by_containment` blocker on the retained
  binding: ordinary binding PUT and key enable both reject until the dedicated
  Platform Admin containment-reconciliation operation verifies a safe stable
  policy that excludes the absent derived route and resolves the incident. The
  blocker is cleared only by that reconciliation receipt; it never treats the
  cleanup receipt as eligibility restoration. It works for both active and `deleting`
  deployments, returns no bearer and is retained by the cutover allowlist. For
  an active deployment, successful artifact removal retains its selected binding
  as `awaiting_key_restore` under the converted provisional reservation; Tenant
  retry remains denied. Once any containment blocker above is cleared, the same
  Platform Admin binding PUT accepts only that exact resolver-created
  reservation, re-proves Agent/route absence, and re-adds
  only the server-derived route ID through the normal key barrier without
  releasing the fence or enabling the key. After separate enable when needed
  and exact key eligibility verification it marks the operation retry-ready.
  Only that operation may retry; compatibility remains denied. A Tenant/Gateway decommission
  may invoke this same resolver for its quarantined operation but retains the
  cleanup fence through final tombstone rather than creating retry authority.
  Missing provenance, a pre-existing ID or an unverifiable delete leaves the
  quarantine blocking; neither retry nor compatibility may clear or edit it;
- narrow Gateway apply/read/verify operations; and
- durable operation/idempotency records with partial-failure state.

Completed (2026-10-21): schema v12 now persists deployment intents, operation
journals, pair fences, ordered per-Gateway lease records, deployment-key
bindings and route-ID reservations. The explicit Tenant API allocates an
idempotent `awaiting_key_binding` intent only for a live Tenant Admin
`tenant_gateway:manage` grant, validates immutable Gateway-backed release
sources, derives the deployment/Agent/route/path mapping server-side and stores
the desired materialization digest. Allocation opens no operation, advances no
post-creation invocation epoch and performs no Gateway read/write. Tenant
list/get is filtered by the exact `view|manage` grant, unbound intents alone may
be cancelled, and the server-only adapter exposes only the narrow Agent,
Agent-route and non-secret Virtual-Key policy operations required by later
slices. See [Platform Agent deployments](../../capabilities/platform-agent-deployments.md).

### 6B. Lifecycle operations

- deploy, take offline, bring online, retry, drift verify and rollback;
- reauthorization before each remote mutation;
- while holding the required object/route and key-policy leases, perform all
  operation-specific no-write preconditions before changing deployment state:
  current Principal/Tenant/membership/grant/Gateway authority, applicable
  immutable release source fields, the proof required by the next route write,
  route-ID reservation, and expected journal/remote-object
  reads. Initial publish, online, retry and rollback additionally require the
  deployment-key binding and live key eligibility. Take-offline explicitly does
  not: with an exact promoted final pair it may withdraw ingress even when the
  bound key is disabled, expired, quarantined or `containment_failed`. While the
  operation observes its expected pre-write fingerprint, a rejection writes
  neither Gateway nor deployment state/epoch and returns the previous stable
  record unchanged (apart from independently committed authority/key epochs).
  If recovery observes that an operation-owned public-final write already
  landed, the pre-final guard classifies safety first: any failed authority,
  binding/key, allow-all or unique-winner proof blocks promotion but permits the
  internal remove-only write back to staging and route containment.
  The sole exception is `binding_conflict_cleanup`: when preflight discovers
  that an out-of-band foreign route captured an earlier binding reservation, the
  dedicated key-writer transition reverses that prior side effect without
  entering deployment `applying` or advancing its invocation epoch;
- every write that creates or restores the public final match—including initial
  activation, retry activation, online, rollback from offline and the final
  restore of active rollback—must re-run the complete any-key allow-all scan and
  final-route unique-winner proof under the retained object and key-policy leases
  immediately before that write. Recovery after a crash re-runs both after
  reclaiming the leases. A staging create/move separately
  performs the staging non-selection/withdrawal proof; that proof never
  substitutes for the later final proof;
- before the first remote write of every deploy, take-offline, online, retry, rollback
  or route-changing attempt, reauthorize after the successful preflight, then
  atomically persist the operation kind, sequence, expected/desired fingerprints
  and first write-ahead phase, mark the deployment non-invocable with
  `operation_state=applying` and advance its durable invocation epoch in the
  platform store. Take-offline uses `take_offline_pending_stage`, online uses
  `online_pending_activation`, and active rollback uses
  `rollback_pending_stage`; recovery follows that durable goal instead of
  inferring intent from the current route. Context creation, turns and
  resumes require `operation_state=stable` plus an invocable lifecycle state.
  Only successful remote verification may atomically restore a stable operation
  state, record the resulting lifecycle state and advance the epoch again;
  take-offline therefore remains non-invocable even after a successful stable
  operation. It atomically moves the same claimed route ID to the verified
  non-public staging match with `disabled=true` and keeps that fingerprint under
  the promoted claim. Recovery from `take_offline_pending_stage` performs that
  move when the expected final fingerprint remains, or verifies the desired
  staging result when the write already landed, and can commit only the stable
  non-invocable offline lifecycle. Ordinary lifecycle transitions never remove it; only the
  explicit quarantine-artifact resolver, after creating the same operation's
  provisional retry authority, or remove-only decommission may delete it. A
  later authorized online operation starts only from the exact promoted offline
  Agent/staging-route fingerprints, repeats authority, complete any-key allow-all,
  bound-key eligibility and final-route unique-winner preflight,
  enters `applying` with `online_pending_activation`, atomically moves that same route in place to final
  match+`disabled=false`, verifies the final pair, and only then commits an
  invocable stable lifecycle and advances the epoch. Recovery from that phase
  activates expected staging only after repeating those proofs and accepts an
  already-final result only when phase-appropriate authority and bound-key
  eligibility still pass, key protection remains present, and both public-
  ingress safety proofs pass. A failed staging preflight leaves it pending; an
  already-final authority, key or public-ingress safety failure withdraws the
  route through the pre-final guard's containment path rather than treating it
  as generic drift or committing it. Rollback may also restore
  that own staging route through its distinct phases below. Neither operation
  recreates a missing claimed route. It never leaves a disabled route
  on the final match where Gateway would black-hole a shorter live ancestor.
  Failure or crash remains non-invocable in
  `partial_failure`/`applying`, and each retry starts with a newer epoch;
- extend Tenant and Gateway deletion with a durable remove-only decommission
  workflow. A delete request first moves the subject to `deleting` and advances
  its authority epoch. Context creation and every context use require the live
  Tenant and Gateway subjects to remain `active`, in addition to exact epoch
  equality, so a caller cannot capture the new deleting-state epoch and start a
  Test while cleanup is pending or failed. New deployment mutations likewise
  require both subjects active. A narrowly scoped internal lifecycle worker
  acquires the per-Gateway object lease and then the key-policy lease in the
  global order above, holds them through key revocation, Agent/route removal,
  verification and final operation/fence state commit. It enumerates every
  promoted claim, provisional reservation and quarantine for the deleting
  subject plus their per-object journals, as well as every Gateway key including
  legacy/unmanaged keys. Ordinary key edits use the same Virtual Key mutation
  service as explicit handlers: each records desired policy, enters `mutating`
  and advances its epoch before the Gateway write, then verifies and commits the
  observed fingerprint. A key in `quarantined_contained` or
  `containment_failed` instead uses the dedicated containment-cleanup token,
  which obtains and verifies a live disable without restoring `stable`. A stale
  `containment_in_progress` or `containment_reconciling` first runs the durable
  containment-recovery transition to a terminal, then cleanup continues. An
  already-empty enabled allow-all key is disabled; a non-empty shared allowlist
  loses the route; and a
  key whose final explicit route is removed is disabled instead of left empty.
  A legacy/unmanaged permitting key first receives a non-secret manager control
  record and new epoch solely so the same barrier can narrow or disable it,
  without revealing or adopting its bearer. An unverifiable edit leaves cleanup
  failed and the route intact. Only after no enabled, unexpired key permits the
  route does the worker remove every promoted object and every journal-proven
  partial Agent/route write, including one-object and complete-but-not-promoted
  provisional applies, then verify absence. Ambiguous ownership fails closed.
  All associated fences and journals survive until that verification and the
  final state commit; only then can the authoritative row become
  deleted/tombstoned and the cleanup fences close. The issuance-time ID
  reservation already prevents recreation throughout this workflow. Tenant
  deletion touches only that Tenant's claims on a shared Gateway; Gateway
  deletion covers all claims on that Gateway. This worker can only remove
  promoted or
  journal-proven operation-owned runtime objects; it cannot deploy, update,
  retry or roll back content and does not grant the requesting Platform Admin
  Tenant authority. An unreachable Gateway or any
  partial cleanup leaves the subject and operation in `deleting/cleanup_failed`
  for idempotent retry, never reports deletion complete, and keeps every
  promoted, provisional and quarantined pair fenced from compatibility takeover;
- compute eligible targets from the immutable release snapshot before create,
  retry or rollback: revalidate each offering discriminant/source-field pair,
  require every Gateway-backed offering to name the target Gateway, and reject a
  malformed legacy snapshot or mixed-source release with a stable precondition
  error before any Gateway write. Only a valid platform-native offering is
  exempt. Every initial publish, retry, online and rollback acquires the object
  lease and then the per-Gateway key-policy lease before its applicable source,
  route and lifecycle preflight; an operation that can create a route does so
  before its absence check. Hold the key-policy lease through remote route
  activation, verification and durable platform route/pair recording. Under
  that lease reject publish,
  retry, online or rollback when any enabled/unexpired Virtual Key has an empty
  `allowed_route_ids` list, because Gateway interprets it as allow-all. Repeat
  this complete any-key scan immediately before every public-final route write;
  recovery does the same after reacquiring the lease and before restoring
  staging to final. When recovery still observes the expected staging
  fingerprint, a failed repeated scan leaves that staging route and recorded
  lifecycle phase unchanged and performs no final-route write. When it instead
  observes that the earlier final write landed, a failed scan follows the pre-
  final guard's containment branch below and writes the route back to staging
  before returning. The
  operation must resolve a Platform-Admin-configured non-secret
  deployment-specific key binding. Its explicit binding handler derives the
  route ID server-side and adds/removes only that ID through the normal
  desired/observed mutation barrier. The pinned Gateway wire field is
  `disabled`; “enabled” below means `disabled=false`, and fingerprints never
  serialize an `enabled` field. Gateway omits `allowed_route_ids` from a read
  when it is empty, so verification normalizes an absent field and `[]` to the
  same empty-list semantic value before fingerprint comparison. Add and
  non-final removal preserve `disabled`;
  final-route removal is rejected or verifies the normalized
  `{disabled:true, allowed_route_ids:[]}` Gateway fingerprint and never persists
  `{disabled:false, allowed_route_ids:[]}`. A disabled empty-list key may bootstrap binding,
  but remains disabled until a separate explicit Platform Admin lifecycle
  action enables it. Before a public-final write, initial publish, retry, online
  and rollback all require the bound key already `stable`, enabled, unexpired
  and explicitly allowing the derived route; if staging remains, failure returns
  a stable precondition error without Agent/route writes. If the final write
  already landed, key ineligibility blocks promotion but permits only the
  guarded withdrawal/containment write. The publish/retry/online/rollback route-mutation branches never enable or
  otherwise mutate the key. If preflight detects capture of the earlier binding
  reservation, apply exits that path and delegates only reversal of the binding
  side effect to the separately tokened `binding_conflict_cleanup` writer.
  Their object paths are distinct:
  - initial publish alone requires both server-derived IDs absent, creates the
    Agent and a disabled non-public staging route with
    `auth_policy.require_virtual_key=true`,
    verifies/journals that provisional intermediate, then updates/enables that
    same route in place without relaxing the auth policy;
  - retry resumes the same operation journal and reservation. It creates only a
    proven-absent object, re-runs the complete any-key allow-all scan and final-
    route unique-winner proof before it activates an existing matching staging
    route in place, or verifies current phase-appropriate authority, bound-key
    eligibility, both safety proofs and an already-final pair; it never blindly
    recreates either ID; and
  - take-offline records `take_offline_pending_stage` with expected final and
    desired staging fingerprints before moving the same promoted route. Recovery
    performs or verifies that move and finishes only as stable offline; and
  - online starts only from the exact promoted offline Agent and non-public
    staging-route fingerprints, performs the complete any-key allow-all and
    final-route unique-winner preflight,
    records `online_pending_activation` before the remote write and atomically
    restores the same route to final match+`disabled=false`; it verifies the
    pair before committing the invocable lifecycle; and
  - rollback starts from the promoted claim in either active-final or
    offline-staging form and updates its existing Agent/route pair in place to
    the recorded release. From active, it records `rollback_pending_stage` with
    the expected final and desired staging fingerprints plus target release
    before its first route write, then atomically changes final
    match+`disabled=false` to the operation-unique non-public staging
    match+`disabled=true`; recovery from that phase performs the move when final
    remains or verifies staging when the write already landed. From offline it
    verifies and retains that same staging object. Only after verified staging
    does it record `rollback_staged_awaiting_agent_update`, before the Agent write, then updates and
    verifies the Agent, records `rollback_agent_updated_awaiting_activation`, and
    finally re-runs the complete any-key allow-all scan and final-route unique-
    winner proof and atomically restores
    the route at final match+`disabled=false`. Recovery resumes the recorded
    phase, re-runs both proofs after reclaiming the leases and never enables the previous Agent.
    Each staging/final transition is journaled and verified. The
    initial-absence gate does not apply. A missing or mismatched claimed object
    enters `partial_failure`/reconciliation or quarantine instead of being
    blindly created.
  Both the disabled non-public staging fingerprint and enabled final fingerprint include
  `auth_policy.require_virtual_key=true`; an operation-owned journaled
  intermediate may be updated to that desired value, while every other
  absent/false observation is fenced and denied, never activated. If initial
  activation, retry, online or rollback observes its operation-owned route
  enabled with that field
  absent/false, it enters `route_containment_in_progress` under the retained
  locks, atomically moves the same route to the non-public staging match with
  `disabled=true`, verifies that no final-ingress request selects it, then
  records `route_quarantined_contained` plus the blocking pair quarantine before
  returning a contained failure. The lifecycle operation never deletes the
  claimed route and never reports ordinary failure while it is still enabled.
  A failed/unknown closure records `route_containment_failed`, retains
  every fence, raises a security incident and never claims containment or
  publication success. Route containment is crash-safe: initial activation,
  retry, online and rollback each write a sequence-bound pre-final containment
  guard before every final-match mutation. It records the lifecycle phase,
  expected safe staging fingerprint and desired protected-final fingerprint.
  Recovery under reacquired leases resumes the recorded lifecycle when the route
  still matches staging, after reauthorization, the complete any-key allow-all
  scan, bound-key eligibility and unique-winner preflight. If current phase-
  appropriate authority, bound-key eligibility, the exact protected final pair,
  repeated complete any-key allow-all scan and final unique-winner proof all
  verify, recovery atomically retires the guard in the same promotion/stable
  commit; live success does the same. If the route is already at the enabled
  final match but authority or bound-key eligibility fails, either repeated
  public-ingress safety proof fails, or key protection is missing/false, recovery adopts
  `route_containment_in_progress`, moves that same route back to non-public
  staging with `disabled=true`, verifies the claimed route is no longer selected
  by final ingress, and only then records `route_quarantined_contained` plus the
  blocking pair quarantine. A failed/unknown withdrawal records
  `route_containment_failed`, retains every fence and incident, and never leaves
  the route knowingly public while the local operation is uncommitted. It
  examines every other observation before generic pair-quarantine
  classification. Neither terminal permits Tenant retry. Platform Admin may
  retry the same token through
  `POST /api/platform/v1/gateways/{gateway_id}/deployment-route-containment/{operation_id}/retry`,
  including for a `deleting` deployment, before using the quarantine-artifact
  resolver. Startup recovery processes every live guard and adopted containment
  token before the manager reports
  deployment recovery ready. A retired guard is not processed on the next
  restart. Only after current phase-appropriate authority and bound-key
  eligibility pass and the activated pair matches the final fingerprints and
  relationship does the operation promote or return the claim to `stable` and
  retire its guard in that same commit. A partial
  object/activation result remains fenced and non-invocable for retry or
  remove-only cleanup. Explicit key handlers reject
  creating/enabling an allow-all key while any platform-managed route may still
  exist on the Gateway. Because the publisher retains the same key-policy lease
  until its route is activated and recorded, a handler cannot insert an
  allow-all key between preflight and route activation. Explicit
  lifecycle/binding, ordinary-reconciliation, binding-conflict-cleanup retry,
  binding zero-write abandon,
  containment-reconciliation and quarantine-artifact-cleanup handlers plus
  internal binding-conflict cleanup, drift containment, containment recovery
  and decommission-cleanup operations are the complete supported Virtual Key writer set; every writer uses the same
  lease, desired/observed journal and operation-token guard; and
- release/deployment correlation in Gateway interactions.

Completed lifecycle core (2026-10-21): explicit grant-scoped handlers now
apply, retry, take a deployment offline, restore it online, verify drift and
roll back to a journal-verified release. They use ordered Gateway object/key
leases, immutable source validation, allow-all-key rejection, cross-family
route-winner checks, write-ahead operation phases, provisional/promoted pair
fences and observed-state verification. Initial publication creates a disabled
non-public protected staging route before activating that same route; partial
publication remains fenced and retry creates only a journal-proven missing
object. Offline/online and rollback mutate the claimed pair in place, operation
request keys are idempotent, and an observed unprotected public route enters
remove-only containment/quarantine. Platform Admin key binding, startup-wide
recovery/decommission and all invocation/observation/cutover work remain in the
following Step 6 slices and the final Step 6 gate does not pass yet. See
[Platform Agent deployments](../../capabilities/platform-agent-deployments.md).

### 6C. Scoped Access and invocation replacement

- expose Agent endpoint/route projections from deployment mappings to any active
  Principal with active membership in the owning Tenant, including protection
  state and eligible Virtual Key references but never raw bearer values or
  deployment observations. This membership-scoped discovery is what permits a
  Tenant User to create the first server-managed invocation context; it does not
  require `tenant_gateway:view|manage`;
- provide the narrow server-managed invocation path required by Agent Test and
  the Access examples. It first resolves the deployment, then requires a live
  Principal, a live `active` Tenant subject, active Tenant membership matching
  `deployment.tenant_id`, an invocable deployment state, active target Gateway
  and live Virtual Key policy;
- create an opaque, expiring server-owned invocation context in the platform
  store, bound to Principal, Tenant, deployment, resolved Gateway objects and
  selected key reference without storing or returning the raw bearer. Capture
  the Principal, Tenant, membership-pair, deployment-invocation, manager-owned
  Gateway, deployment-pair-claim and selected-Virtual-Key-policy authority
  epochs/fingerprints used for
  authorization. Context creation and every turn/resume reload both Tenant and
  Gateway subjects and require `active`; an epoch captured after a transition to
  `deleting` is never sufficient. Deployment fence rows survive row deletion and increment on
  every deployment state, release or route transition; rolling back to an
  earlier release never reuses an epoch. Gateway and key disable/re-enable,
  rotation and allowlist restoration likewise never reuse their epochs. Every
  turn and permission resume may use those checks as an early rejection, but
  then acquires the per-Gateway key-policy lease before its final authorization
  decision. While retaining the lease, it synchronously reloads the Principal,
  Tenant, membership pair, deployment, target Gateway and selected binding/key,
  requires every captured authority epoch to match, both subjects to remain
  active, the deployment lifecycle to remain invocable, its operation state to
  remain `stable`, and the exact deployment's promoted live pair claim to remain
  present with the captured Agent/route relationship and claim fingerprint. It
  does not apply compatibility's global no-fence predicate to that own claim. A
  provisional/quarantined claim, a missing/mismatched own claim, or a
  conflicting claim owned by another operation denies. It then re-reads the selected key's manager operation state,
  desired/last-verified fingerprints and live Gateway policy, requires `stable`
  and compares the live non-secret policy fingerprint before any eligibility
  decision or bearer resolution. Any dependency mismatch denies with no
  data-plane forward. A stable-state key mismatch atomically records `containment_in_progress`,
  advances the epoch, synchronously disables the key on the Gateway and verifies
  the live fingerprint before returning the terminal denial. Successful
  containment records `quarantined_contained`; the
  key stays ineligible until explicit reconciliation and a direct external call
  with its bearer must fail. A failed/unknown write records
  `containment_failed`, keeps related deployments non-invocable, returns a hard
  service error and raises a Platform Admin security incident without claiming
  containment. Containment uses a distinct operation kind and compare-and-set
  token; the normal mutation finalizer cannot replace either terminal state with
  `stable`/`reconciliation_required` or drop the incident. A durable operation
  journal and sequence make both nonterminal states recoverable. If a crash or
  lost response leaves `containment_in_progress` or
  `containment_reconciling`, a lease-owning containment-recovery worker claims
  that sequence, advances the epoch, repeats disable idempotently, re-reads the
  live policy and records `quarantined_contained` only after verified disable;
  any failed/unknown result becomes `containment_failed`. Invocation remains
  denied, and decommission runs this recovery before cleanup. The only
  eligibility-restoring exit from a terminal is a Platform Admin
  containment-reconciliation operation under the same lease. It
  records `containment_reconciling`, advances the epoch and, from either terminal
  state, first obtains a verified live disable. Failure returns to
  `containment_failed`; success records `quarantined_contained` and preserves the
  incident. The operator may leave that disabled state for decommission, or
  explicitly approve a safe desired-policy rewrite. Only exact remote
  verification, a second epoch advance and incident resolution may restore
  `stable`. A stable empty allowlist must remain disabled; an enabled restored
  policy must contain at least one explicit route. Reconciliation after removal
  of a final entry therefore verifies
  `{disabled:true, allowed_route_ids:[]}`, and only a later binding PUT may add
  the deployment route back. Decommission uses its own containment-cleanup token to
  verify disable or remove the retiring route and record a cleanup receipt. The
  stable-restore finalizer rejects that token, so cleanup can never restore
  eligibility.
  Only a matching fingerprint proceeds to enabled-state, wall-clock-expiry and
  route-allowlist checks. For turns/resumes, resolve the bearer and obtain
  outbound data-plane
  forward acceptance before releasing the lease. Context creation instead
  commits the selected-key epoch before release and repeats this critical
  section on first use. No bearer is cached in the context. The context survives
  separate permission Route Handlers without requiring sticky process memory
  and expires after completion or timeout;
- expose only eligible Virtual Key references and non-secret status metadata to
  Tenant Access/Test clients. They cannot create, rotate, disable, reveal or
  receive a bearer. An eligible key must be stable, enabled, unexpired and have
  a non-empty explicit `allowed_route_ids` containing the deterministic route;
  an empty list is Gateway allow-all and is never eligible for a platform
  deployment. Virtual Key lifecycle and one-time issuance/audited recovery
  remain separate Platform Admin infrastructure APIs. The canonical
  `/dashboard/platform/gateways/{gateway_id}/virtual-keys` page also displays
  containment state/incident and manages the non-secret Tenant/Gateway
  deployment-key binding through explicit Platform Admin-only
  `PUT/DELETE /api/platform/v1/gateways/{gateway_id}/deployment-key-bindings/{deployment_id}`
  handlers plus
  `POST /api/platform/v1/gateways/{gateway_id}/deployment-key-bindings/{deployment_id}/abandon`.
  They validate the active owning Tenant/Gateway, resolve the
  deployment and derive its route ID. They acquire the route/object lease and
  then key-policy lease. For `awaiting_key_binding`, PUT exhausts all Agent/LLM/
  MCP route pages, proves the derived route ID absent, then durably records a
  prepublication route-ID reservation
  before adding only that ID through the normal key barrier. Every route writer
  treats the reservation as blocking. For an existing deployment PUT instead
  requires the exact own promoted claim and journaled route fingerprint. The
  sole exception is `awaiting_key_restore`: PUT accepts only the exact
  resolver-created provisional reservation for that operation, re-proves the
  deterministic Agent and route IDs absent, and re-adds only the server-derived
  route ID without releasing that reservation. It never enables the key. If the
  key is disabled, Platform Admin must use the separate enable action; only
  after an exact stable, enabled, unexpired, non-empty allowlist containing that
  route is verified does the operation become retry-ready. Until then Tenant
  retry and compatibility remain denied. The
  handlers never return its bearer or implicitly enable a disabled key.
  Add and non-final removal preserve the Gateway `disabled` field. DELETE of the
  final route is rejected or first obtains the verified Gateway fingerprint
  `{disabled:true, allowed_route_ids:[]}` (atomically where supported, otherwise
  write/verify `disabled=true` before removal), and never persists
  `{disabled:false, allowed_route_ids:[]}`. The unbind commits only after observing the safe fingerprint;
  a failed or unknown write retains the binding and either the prior policy or a
  verified disabled state. It releases a prepublication reservation only after
  verified allowlist cleanup and proof that the remote route ID remains absent;
  an unknown result retains both as a blocking reconciliation state. DELETE is
  accepted only for a never-published prepublication intent whose Agent/route
  IDs are both proven absent. Any promoted, provisional or quarantined pair, or
  any journaled object write, returns a conflict: the handler cannot strand a
  final/staging route, release its claim or regress it to
  `awaiting_key_binding`. Such objects leave only through their explicit
  quarantine/decommission lifecycle, and deployment cancel cannot complete
  while they remain. A verified PUT changes `awaiting_key_binding` to
  non-invocable `ready_to_apply`; only a verified prepublication unbind returns
  it to `awaiting_key_binding`. If apply nevertheless discovers a
  foreign route at the reserved ID, it delegates to the declared
  `binding_conflict_cleanup` key-writer token: remove that allowlist entry (or set
  `disabled=true` for a final-entry key), verify the Gateway fingerprint, release
  binding/reservation and return to `awaiting_key_binding`. Its retry handler
  owns `binding_conflict_cleanup_failed`; unverifiable cleanup remains fenced
  and never leaves the foreign route knowingly authorized by the binding.
  Platform Admin retries that exact token through
  `POST /api/platform/v1/gateways/{gateway_id}/deployment-key-bindings/{deployment_id}/conflict-cleanup/retry`;
  it cannot edit any other policy field or restore eligibility.
  The abandon handler accepts only an exact operation-bound provisional
  reservation whose deterministic Agent and route IDs both verify absent. It
  records the same `binding_conflict_cleanup` token with
  `reason=zero_write_abandon`, removes or safely final-entry-disables and
  verifies the allowlist entry, and only then releases the binding and every
  reservation and returns to `awaiting_key_binding`. Unknown cleanup uses the
  existing failed state/retry handler. It is not binding DELETE and never drops
  a fence first.
  Enabling remains a separate explicit Platform Admin lifecycle action. A key
  in ordinary `reconciliation_required` exposes only
  `POST /api/platform/v1/gateways/{gateway_id}/virtual-keys/{key_id}/reconcile`.
  That Platform Admin handler acquires the key-policy lease, claims the durable
  ordinary-reconciliation token, advances the epoch and re-reads the live
  policy. It may adopt an exactly verified live policy only when it is not
  enabled with an empty allowlist, retry and verify the journaled desired policy
  subject to the same rule, or write and verify a safe disable. An enabled-empty
  live document must first be disabled and verified; it is never adoptable as
  `stable`. The handler returns no bearer; an unknown result stays
  `reconciliation_required`. It also verifies the originating ordinary writer's
  durable postcondition, never releases an outer deployment fence, and rejects
  binding-conflict/zero-write-abandon, decommission and containment cleanup
  tokens because their dedicated retry/finalizer owns those states. The same page
  invokes the
  `POST /api/platform/v1/gateways/{gateway_id}/virtual-keys/{key_id}/containment/reconcile`
  handler to retry verified disable or submit an explicitly reviewed safe-policy
  rewrite. The handler audits the final outcome and never returns a bearer.
  Tenant actors are denied. Containment cleanup remains internal to the
  Tenant/Gateway decommission status/retry handlers and is not a general key
  mutation endpoint. Raw bundle
  validation rejects Agent, Agent-route and Virtual Key records. Before any
  supported key write, the durable token selects an operation-kind-specific
  finalizer. Ordinary lifecycle/binding mutations atomically store desired
  policy separately from
  the last verified observed fingerprint, mark the key `mutating` and advance
  the manager-owned key-policy epoch before the Gateway write. Platform
  invocation is denied while mutating. Their verified write records the new
  observed fingerprint, marks `stable` and advances the epoch again; a verified
  unchanged failure may return to `stable`, while an unknown/partial result
  becomes `reconciliation_required`. Ordinary reconciliation may adopt a live
  policy only when it satisfies the originating operation's durable postcondition
  and never releases an outer deployment fence. An ordinary-state
  `quarantine_artifact_cleanup` safety revocation uses that key-state finalizer,
  but reconciliation must still prove the quarantined route excluded or the key
  safely disabled before returning control to the resolver. Binding-conflict
  cleanup, including zero-write abandon, has a dedicated finalizer: verified
  route exclusion/safe final-entry disable plus both remote-ID absence proofs
  completes it; any unknown or unsatisfied result remains
  `binding_conflict_cleanup_failed` with every fence retained for only its retry
  token. Decommission has its own cleanup finalizer: only verified key revocation
  and object absence records its receipt; an unknown/failed edit stays
  `deleting/cleanup_failed` for only the decommission retry token. Neither
  cleanup failure may become `stable` or `reconciliation_required` through the
  generic finalizer. Drift containment, containment recovery or
  reconciliation, and containment-aware cleanup use only their declared
  nonordinary transitions/terminals or cleanup receipt. The generic finalizer
  rejects every such token and cannot restore `stable` or discard an incident.
  Only a mismatch observed while ordinary state is `stable` is external drift
  and triggers the separately tokened synchronous containment protocol above;
- redirect the legacy Virtual Key page to that Gateway-qualified Platform Admin
  page only after lifecycle, one-time-secret and audit parity. Tenant Admin/User
  navigation and direct URLs remain denied;
- test the delivered Virtual Key page and handlers with a deep link to Gateway A
  while `session.active_gateway_id` changes to B; every request remains scoped to
  path A unless the selector first navigates to B;
- connect the canonical Access and Agent Test UI to those scoped APIs; and
- keep persistent product chat/history outside this mandatory slice.

Completed (2026-10-21): schema v13 now persists manager-owned key-policy state
and expiring invocation contexts. Platform Admin has Gateway-qualified Virtual
Key lifecycle and deployment-binding APIs, including safe disabled-empty
bootstrap, separate enable/disable, zero-write abandon, audited reveal and
reviewed containment restoration. Active Tenant members can discover eligible
endpoint/key references and use opaque server-managed turn/permission contexts
without receiving a bearer or requiring a `tenant_gateway` grant. Every forward
rechecks the captured Principal, Tenant membership, deployment, Gateway, pair
claim and key-policy authorities under ordered leases; live policy drift enters
verified disable containment and fences related deployments. The Access UI and
canonical Gateway key page consume these APIs. Startup-wide recovery, the
remaining specialized retry paths, scoped observations/runtime actions and
compatibility cutover remain in the following Step 6 work.

### 6D. Scoped Tenant observation and runtime-action replacement

- deliver Tenant deployment activity, usage, interaction and health projections
  with the same deployment-visibility predicate as section 5 of the
  authorization design: a Tenant Admin sees only owning-Tenant deployments on a
  Gateway where that exact membership has `tenant_gateway:view|manage`; a Tenant
  User or Tenant Admin without such a grant receives no rows from those
  deployment-observation projections, even for that Principal's live invocation
  context.
  Platform Admin without matching Tenant authority and cross-Tenant records are
  denied. Apply this predicate to Overview, Calls, Usage and the minimum
  Workbench deployment-attention feed that replaces compatibility reads;
- provide Agent-scoped session and run metadata reads before catch-all cutover.
  The current Principal may see minimal records tied to that Principal's live
  invocation contexts; a Tenant Admin with `tenant_gateway:view|manage` may see redacted
  operational metadata for the owning deployment. These responses contain no
  other Principal's prompts, transcript, tool payloads or secrets. `manage` is
  still required for operational cancellation;
- expose the union of (a) minimal pending-permission entries from the current
  Principal's own live invocation contexts, even when that Tenant member has no
  deployment visibility, and (b) grant-filtered pending permissions/runs from
  deployments the actor may manage. The human Workbench consumes that union: its
  own-context entries plus other human and service Principals' deployment
  entries only where that human Tenant Admin has `tenant_gateway:manage`. A
  service credential may query
  and resolve only its own-context subset unless it independently has manage
  authority. Provide narrow mutation APIs for
  interactive resolution by the same active invoking Principal/context (human
  session or service credential) and operational resolution or run cancellation
  by a Tenant Admin with `tenant_gateway:manage` for the owning deployment;
- resolve every Gateway Agent, request and run identifier through the platform
  deployment mapping, reauthorize and capability/resume-mode check immediately
  before the remote mutation, require the target Gateway to remain active, and
  audit the final outcome. Never accept an unscoped Gateway Agent ID or fall back
  to the general proxy. Destructive pool/thread recovery remains Platform
  Admin-only;
- before legacy runtime navigation is removed, deliver the Platform Admin-only
  `/dashboard/platform/gateways/{gateway_id}/runtime` page on the retained
  explicit ACP/builtin/MCP diagnostic handlers. It includes runtime instances,
  in-flight state and authorized destructive recovery, derives Gateway scope
  only from the path and denies Tenant direct URLs. A legacy runtime redirect is
  enabled only after feature/authorization parity;
- before removing legacy runtime handlers, add explicit Platform Admin-only
  compatibility APIs for Gateway-managed Agents. Their identity and every route
  parameter use the `(gateway_id, agent_id)` pair; the active session Gateway is
  never an implicit substitute. The APIs provide Agent inventory list/get,
  create/update/delete, configuration/capability/health reads, Test, interactive
  permission resolution, redacted session/run metadata reads and run
  cancellation, plus Agent-route
  list/get/create/update/delete limited to routes whose recorded id, current
  target and proposed target do not intersect a blocking deployment pair fence.
  The fence guard covers operation-bound provisional reservations, promoted live
  or deletion-retained claims and quarantined collisions even after an object
  lease is lost. The APIs require an active Gateway and recheck that guard
  immediately before every list/get/mutation/Test/session/run operation. Tenant
  actors and fenced pairs are denied. Test and interactive resume use the separate
  compatibility invocation context defined by the authorization design. Context
  creation/turn/resume acquire the per-Gateway key-policy lease before final
  authorization, then synchronously reload the Principal, Gateway, exact pair
  claim/fence, compatibility epoch/state, selected-key epoch/state,
  expected/observed fingerprints and live key policy. Any mismatch denies with
  no forward. They retain the lease through eligibility, bearer resolution and
  outbound forward acceptance;
  drift enters the same containment protocol as platform invocation;
  operational permission/cancel calls repeat the same active-Gateway,
  exact-unfenced-pair and capability checks, and every runtime operation is
  audited. Agent and Agent-route mutations acquire object then key-policy lease,
  atomically mark every affected pair `mutating` and advance its manager-owned
  compatibility epoch before remote writes, and retain both leases through
  verification and state commit. Test context creation/turn/resume requires
  `stable`. Successful remote
  verification marks `stable` and advances again; an unknown/partial result
  remains `reconciliation_required`, so neither an older nor an apply-window
  Test context can survive a reconfiguration;
  the Agent inventory implementation may take an initial blocking-fence
  snapshot for early filtering, but it first exhausts/iterates the upstream
  pages and then synchronously re-reads the authoritative provisional/promoted/
  quarantined fence set immediately before server-side filtering and response
  serialization. It removes every pair in that final set before computing items,
  totals or manager-side pagination. Agent-route, redacted session and run lists
  apply the equivalent post-scan final pair-fence re-read (plus route-id/current-
  target checks where applicable), filter before serialization, and compute
  items/totals/pagination only afterward. A deployment that starts during any
  upstream scan therefore has at least its provisional reservation in the final
  read before its object could be returned. No list may expose an upstream
  document and filter it in the browser;
  this surface grants no Tenant authority and never uses the general proxy;
- deliver `/api/platform/v1/tenants/{tenant_id}/audit` and
  `/dashboard/tenant/{tenant_id}/audit` for active Tenant Admins in that path
  Tenant, filtered by authoritative `tenant_id` and redacted so another Tenant,
  platform-only events, secrets and infrastructure details cannot appear; and
- connect the canonical Tenant observation, audit and Workbench UI before
  removing its legacy data source.

### 6E. Target access cutover

- expose Tenant deployment views through APIs that enforce the exact
  deployment-read predicate from Step 6D: matching Tenant Admin
  `tenant_gateway:view|manage`; no-grant live-context records are excluded from
  Overview, Calls, Usage and every other deployment-observation response and
  remain available only from the separate Agent-scoped session/run read;
- remove Tenant actors from the general Gateway proxy;
- remove `/api/admin/acp/chat/{turn,permission}` and the catch-all Agent
  permission/run mutation shapes as human invocation or runtime-mutation
  authority, including the `isPlatformAdmin -> Gateway admin` shortcut. After
  cutover those operations must use the scoped platform invocation/runtime APIs;
  retain only the following Platform Admin operations through explicit handlers:
  manager users/Tenants/Gateway registry and grants; catalog; Caddy servers and
  routes; raw configuration bundles; Gateway providers, upstream credentials,
  provider types, LLM API-handler types, discovered/managed/logical models,
  global LLM/MCP routes and MCP services; Virtual Key
  lifecycle, ordinary-key reconciliation, deployment-key bindings,
  deployment-binding zero-write abandon,
  one-time issuance/audited secret recovery and the explicit binding-conflict-cleanup retry,
  key-containment-reconciliation, route-containment-retry and
  deployment-quarantine resolver handlers;
  Tenant/Gateway deletion status and retry
  handlers whose internal worker owns containment cleanup; read-only
  Gateway-wide metrics and ACP/builtin/MCP runtime diagnostics; destructive
  pool/thread recovery; and the scoped Gateway-managed-Agent compatibility APIs
  from Step 6D. The dedicated platform deployment lifecycle,
  route-containment, quarantine-artifact and remove-only decommission handlers
  above keep only their stated narrow mutation authority. Everything else is
  deny-before-forward: no retained Gateway-only compatibility, diagnostic or
  infrastructure handler may invoke or mutate a platform-managed Tenant Agent,
  retarget its ingress route, resolve its permission or cancel its run. Raw configuration bundle handlers remain on
  the allowlist only with server-side rejection of Agent, Agent-route and Virtual
  Key records. Agent-route CRUD is no longer a global retained handler: it is
  part of the Step 6D Gateway-only compatibility service and uses the exact-pair
  claim guard before forwarding. Every retained handler or accepted bundle
  section capable of changing LLM/MCP routes also acquires the shared
  route/object lease and applies the symmetric unique-winner conflict check; a
  bundle path that cannot do so rejects all route records before forwarding;
- migrate assignments administratively. A legacy non-Platform Gateway Admin who
  must continue provider/credential/model/route/service administration requires
  an explicit, reviewed Platform Admin assignment; never infer it from the old
  role. Keep that actor's legacy credential workflow until this cutover, record
  deliberate removal for actors not elevated, then remove the legacy handler
  and navigation atomically with the old membership authority; and
- retire old user-facing Gateway membership only after the scoped Access,
  invocation, runtime-action and deployment replacements pass parity and
  negative tests.

Gate: real Gateway v0.7 create/invoke/observe/rollback, two-Tenant shared-Gateway
isolation, per-admin differing grants, revocation-before-retry, partial failure
and Virtual-Key-vs-service-credential separation. Intent tests prove Tenant
`manage` creates and returns `awaiting_key_binding` plus deterministic IDs with
zero Gateway calls and no deployment epoch advance; Platform Admin binds that
existing ID, a separate lifecycle action sets `disabled=false`, and only then
may Tenant `manage` call apply. Binding a nonexistent deployment and applying an
unbound intent fail closed. Deployment tests cover
missing-source, mixed-source and wrong-source offering rejection for initial apply,
retry and rollback, with a stable precondition result and no remote Gateway
write. Those no-write rejections preserve the previous deployment operation
state and invocation epoch; with all independently captured dependencies still
unchanged, an existing context continues to forward. Pair-reservation tests cover a pre-existing Agent/route collision with no
overwrite or permanent claim, compatibility continuity after conflict, and
crash recovery for absent, matching operation-owned and mismatched remote
objects under the exclusive lease. Crash injection after only the Agent write
and, independently, after only the route write must keep the pair provisional
and non-invocable; retry revalidates the matching object, creates only the
missing object under the same operation and promotes atomically only after the
complete relationship verifies. Activation-phase crashes after the disabled
non-public staging-route create and after remote activation but before state
commit keep the pair fenced: retry updates the same route in place or verifies
its final fingerprint, then promotes without delete/recreate. A live shorter
ancestor route continues to serve its requests while staging is paused and after
a pre-activation crash; the staging tuple never wins a supported public request.
Take-offline and route containment always retain and move the same claimed route
to staging. Only the subsequent explicit quarantine-artifact resolver or
remove-only decommission may safely remove a journal-proven artifact.
Neither path leaves a disabled final-prefix black hole. The same deterministic-ID fixture covers
initial publish, retry and rollback and asserts that only initial publish issues
create calls for both absent IDs. Retry never creates an existing ID. Rollback
atomically moves the route to the same non-public staging match before updating
the Agent, and an ancestor-traffic pause/crash fixture continues to reach the
ancestor until final restore. Crash injection after the staging move but before
the post-write phase commit must recover from `rollback_pending_stage`, observe
and verify the already-applied staging fingerprint, then advance to
`rollback_staged_awaiting_agent_update`; a crash immediately before the staging
write uses the same phase and performs it. A later crash before the Agent update must
recover from `rollback_staged_awaiting_agent_update`,
update/verify the target Agent, then restore the route; injection after that
update recovers from `rollback_agent_updated_awaiting_activation`. Neither phase
may expose the previous Agent or be mistaken for initial-publication staging. It updates the existing claimed pair in place, issues no create call for
either existing ID and never requires its IDs to be absent; a missing or
mismatched claimed object fences the operation instead of being recreated.
Take-offline retains its own route ID at the staging fingerprint under its
promoted claim. A later online/rollback operation restores that object in place;
ordinary lifecycle never deletes it, and a missing offline claimed route remains
fenced rather than being recreated. Only quarantine resolution that atomically
creates provisional retry authority, or decommission, may delete it.
The offline lifecycle remains Test-ineligible even though its operation state is
stable. A subsequent online operation and, separately, rollback from offline
must use the same Agent/route IDs, restore the staging route in place only after
their required Agent/final-route verification, then make Test eligible; neither
path issues a create call. Crash fixtures stop take-offline and online after
their applying/phase commit but before the route write, and after the route write
but before the final state commit. Recovery follows
`take_offline_pending_stage` to verified non-invocable offline and
`online_pending_activation` to the verified final pair, with no false promotion
or generic quarantine in either window. Recovery from that phase repeats phase-
appropriate reauthorization and bound-key eligibility, validates
`auth_policy.require_virtual_key=true` and repeats both public-ingress safety
proofs before accepting an already-final route; lost authority, an ineligible
bound key, an absent/false value or a failed allow-all/unique-winner proof runs
sequence-bound containment and cannot commit online.
An online fault fixture forces that value both during live verification and
after the final-route write but before the state commit; recovery contains the
route and a no-bearer final-ingress request fails in both cases.
Pre-final guard fixtures cover initial activation, retry, online and both
rollback starts. A crash after guard persistence but before the route write sees
the exact staging fingerprint, repeats full preflight and resumes activation. A
crash after a protected final write but before local commit repeats phase-
appropriate reauthorization and bound-key eligibility, verifies the pair, the
complete any-key scan and the unique-winner proof, then retires the guard
atomically with promotion/stable state; a second restart does not enter
containment. Separate post-write crash fixtures introduce (a) a second enabled,
unexpired allow-all key, (b) a winning/tied foreign route, (c) a disabled or
expired bound key, and (d) revoked authority or a `deleting` subject before
recovery. Each failure adopts the guard into
containment despite the failed activation precondition, moves the operation-
owned route back to non-public staging, verifies it is no longer selected by
final ingress, proves a direct request cannot reach that route and records the
contained pair quarantine; an injected withdrawal failure ends in
`route_containment_failed`, never a publicly invocable uncommitted success.
The corresponding missing/false-protection final route follows the same
containment-only branch.
Online key-preflight fixtures start from the exact promoted offline pair but use
(a) a disabled/expired/otherwise ineligible bound key and (b) a Gateway with a
second enabled, unexpired empty-list allow-all key. Each returns a stable
precondition failure before changing `online_pending_activation` or writing the
route, leaves the staging fingerprint unchanged and leaves final ingress
unmatched.
A recovery fixture first records `online_pending_activation`, crashes before the
final write, then introduces a second enabled, unexpired empty-list key. Recovery
reacquires the leases, repeats the complete any-key scan and leaves the pending
staging pair unchanged without writing final ingress.
Take-offline fixtures repeat with a
disabled, expired, `quarantined_contained` and `containment_failed` bound key;
the safe staging move still completes and a direct bearer call to final ingress
fails.
Route-namespace tests exhaust paginated Agent, LLM and MCP inventories and cover
equal prefixes, both proper-prefix directions and an MCP route that could match
a concrete Agent ingress endpoint. They apply the Gateway's host/method/score
rules and require a final public platform route to be the unique selected route
for every supported request; a tie or winning foreign route returns a stable
conflict before either Agent or route write. Separate initial-stage, rollback,
take-offline and containment fixtures require the reserved non-public staging
tuple never to be selected. Initial create preserves the prior selection. Move
fixtures begin with the own final route as unique winner and, both with and
without a shorter ancestor, require the post-move selection to equal evaluation
with that own source route removed—respectively the ancestor or no match. Those
writes must not fail merely because their intentional withdrawal changes the
winner. A retry-activation fixture and an offline-rollback fixture insert an
overlapping compatibility/LLM/MCP route during the crash/offline window; after
the operation reacquires the lease, its final unique-winner proof fails with the
staging route unchanged and no Agent or route write. The active-rollback recovery
fixture repeats this after a crash in
`rollback_agent_updated_awaiting_activation`. A paused preflight proves
compatibility, LLM/MCP handlers and any bundle route writer cannot commit until
the shared lease is released, then must re-run the symmetric conflict check; a
bundle implementation without that guard rejects its route section.
Binding-reservation tests attempt each Agent, LLM and MCP route family at the
derived ID before PUT and require no key-policy mutation. After a successful
PUT, the durable prepublication reservation blocks every competing route writer.
An injected out-of-band foreign route discovered by apply triggers verified
allowlist removal/final-entry disable through the declared cleanup token, then
returns to `awaiting_key_binding` before the conflict releases its fence; an
unknown cleanup enters `binding_conflict_cleanup_failed`, retains the binding/
reservation and security incident, and the explicit retry handler resumes that
same token. A direct bearer call to the foreign route fails. After successful
cleanup, removing the collision permits rebind; abandon permits a fresh intent.
The separate zero-write-abandon fixture starts after apply has converted the
reservation and journaled an attempt but with both remote IDs absent. It proves
the Platform Admin handler removes or safely disables/verifies the derived key
entry before releasing binding/fences and returning to `awaiting_key_binding`;
an injected unknown cleanup retains `binding_conflict_cleanup_failed`, and a
direct bearer cannot authorize a later route at that ID.
Concurrency tests pause initial apply, take-offline, online,
retry/rollback and decommission around their remote mutations and prove the
shared object lease prevents any later apply, cleanup or compatibility writer
from interleaving until verification and the authoritative state commit.
Lease-loss tests prove a persisted provisional reservation continues to hide and
deny the pair before recovery. A mismatched recovery creates a durable quarantine
that denies compatibility inventory/get/CRUD/Test/session/run access until an
explicit resolver proves no operation-owned object exists and safely clears it.
A crash fixture that writes a non-matching Agent/route after journaled pre-write
absence proves retry and compatibility delete remain denied, while the
remove-only resolver revokes its route eligibility, removes only the proven
operation artifacts, verifies absence and atomically restores the same
operation's provisional reservation. Compatibility create/edit remains denied;
that operation can then retry the full pair and promote it after verification.
Missing or ambiguous provenance stays quarantined, including during
Tenant/Gateway cleanup. Decommission crash fixtures cover one journal-proven
object and a complete-but-not-promoted pair: route eligibility is revoked, every
proven object is removed, and provisional fences/journals remain through verified
absence and final tombstone. An ambiguous object keeps cleanup failed and the
fence durable, so compatibility never inventories it.
Tenant-scoped projection and invocation responses never contain a
Virtual Key bearer; the
separately authorized Platform Admin one-time issuance and audited recovery
paths retain their explicit secret responses. An ineligible key cannot be
selected,
Platform-Admin-without-membership and cross-Tenant callers cannot invoke,
membership or deployment-state revocation invalidates an existing invocation
context,
membership removal and re-addition does not revive that context or its pending
permission, and deployment rollback to the captured release does not revive it.
After Tenant or Gateway deletion enters `deleting`, both existing context use
and creation of a context against the newly advanced epoch are denied throughout
cleanup and `cleanup_failed`, with no Gateway forward.
Platform-mediated invocation does not fall back to the general Gateway proxy,
while external workflow engines continue to invoke published routes directly
through Gateway Virtual Keys. The cutover
leaves Access, Agent Test, Tenant observability, Tenant audit and Workbench
attention usable. Tenant audit tests cover cross-Tenant denial, Platform
Admin-without-membership denial, secret/infrastructure redaction and pagination.
Access tests prove a no-grant Tenant User with active owning-Tenant membership
can load the server-projected endpoint/protection and eligible non-secret key
references and create the first invocation context, while cross-Tenant callers
and raw-bearer fields remain denied. Observation tests require a Tenant User and a Tenant Admin without a matching
Gateway grant to receive no Overview, Calls, Usage, activity or health rows,
even when each owns a live context, while a Tenant
Admin with `view|manage` sees only deployments for that exact Tenant/Gateway;
cross-Principal, cross-Gateway, cross-Tenant and Platform-Admin-only reads are
denied. Separate Agent-scoped session/run tests return only each caller's own
minimal live-context metadata. Workbench unhealthy attention is populated only from this delivered
deployment-health projection and never queries the Platform Admin-only runtime
instance inventory. Agent Overview, Releases & deployments and Observability
direct-URL tests apply the same predicate to deployment summaries,
health, history, calls and usage: Tenant Users and no-grant Tenant Admins receive
no rows, including for their own live contexts. Workbench
recent deployment activity has the same denial, while definition/release
authoring activity remains Tenant-membership scoped.
Runtime-mutation tests cover cross-Tenant/deployment identifiers, `view`-only
grants, Tenant User operational denial, same-invocation permission ownership,
Tenant User visibility of only their own pending invocation permissions in
Workbench and not Overview, a
`view`-only Tenant Admin's denial from other-Principals' pending permissions on
Overview, the same feed becoming visible with `manage`, and the human Workbench
showing the caller's own entry without a grant plus another human's and a service
Principal's deployment entries only with `manage`; same
service-Principal credential resolution of its own interactive permission and
another Principal's denial,
revocation before forwarding, unsupported resume/cancel capabilities and audit
finalization. Cutover tests exercise the legacy chat turn/permission handlers
and catch-all Agent permission/run mutations with a Platform Admin who has no
matching Tenant membership and require denial with no Gateway forwarding.
Invocation-context tests cover deployment change/rollback to the captured
release, requiring the earlier context and pending permission to remain invalid.
With a stable deployment and exactly its own promoted live claim, Test/turn and
permission resume succeed; the same checks deny a provisional/quarantined,
missing/mismatched or foreign conflicting claim. They never feed the expected
own promoted claim into compatibility's global no-fence predicate.
They also pause a turn after its preliminary epoch checks while it waits for the
key-policy lease, let rollback or take-offline acquire object-then-key-policy
leases and commit a new deployment epoch/state, and require the resumed turn's
complete under-lease revalidation to deny without a data-plane forward.
They also pause after the pre-write `applying` transition and after a simulated
partial write: context creation, turn and resume are denied in both windows, and
only verified `stable` state with the post-verification epoch permits a new
context. Equivalent tests cover compatibility-pair `mutating` and
`reconciliation_required` states.
Key tests create an eligible context, then expire, disable or remove its route
allowlist and require the next turn and permission resume to fail before Gateway
forwarding; re-enable, rotation or allowlist restoration does not revive the old
context. A paused invocation test acquires the key-policy lease before its
manager/live fingerprint reads, starts a concurrent manager mutation and proves
the mutation cannot commit between validation, bearer resolution and outbound
forward acceptance; after the lease transfers, the newer epoch invalidates the
old context without false drift quarantine. Ordinary-reconciliation tests inject
a lost response for ordinary lifecycle/binding writers and ordinary-state
quarantine-artifact safety revocation, require invocation denial in
`reconciliation_required`, and exercise exact live-policy adoption, desired-
policy retry and verified safe disable through the explicit Platform Admin
handler. Both adoption and retry reject an enabled empty allowlist and require a
verified disable instead; a direct bearer call to an unrelated route then
fails. An unverifiable result remains fenced, the epoch advances on every
attempt, no prior context revives and no response contains a bearer. The same
handler rejects `binding_conflict_cleanup_failed`, zero-write-abandon cleanup and
`deleting/cleanup_failed` tokens and cannot release their fences. Their dedicated
retry tests require the operation-specific safe key postcondition before
releasing any fence; unknown retry retains the same failure state, and generic
mutation completion cannot normalize it to `stable` or
`reconciliation_required`. Bundle
attempts to write Agents,
Agent routes or Virtual Keys are rejected, and detected Gateway-side key drift
while `stable` quarantines the key, advances its epoch, synchronously disables
and verifies it before the drift-detecting request returns its terminal denial;
a subsequent direct Gateway call with that bearer fails. Injected
containment-write failure records
`containment_failed`, keeps deployments non-invocable, emits the security
incident and never reports safe containment. Containment-finalizer tests race a
generic mutation completion token against both containment outcomes and prove it
cannot restore `stable`, replace `containment_failed` with
`reconciliation_required` or discard the incident. Starting independently from
`containment_in_progress` and `containment_reconciling`, crash-recovery tests
restart before the disable, after an applied disable and after verification but
before state commit; the recovery token idempotently reaches
`quarantined_contained` or `containment_failed`, keeps invocation denied and lets
decommission continue. Starting independently from
`quarantined_contained` and `containment_failed`, containment-reconciliation
tests require a verified Gateway disable and a subsequent direct-bearer failure;
only a separately approved, exactly verified safe-policy rewrite may resolve the
incident and return to `stable`. A final-entry fixture requires the stable
result to remain `{disabled:true, allowed_route_ids:[]}` and verifies that a
direct bearer call to an unrelated route still fails; a later binding PUT is the
only operation that may add the deployment route again. Decommission tests start from both terminal
states and prove containment-aware cleanup can verify disable/remove the route,
while any unverifiable write keeps `cleanup_failed` and the route intact. The
stable-restore finalizer rejects every containment-cleanup token; cleanup records
only its remove/disable receipt and never makes the key eligible. Writer-set
tests exercise lifecycle, ordinary-reconciliation, deployment-binding,
binding-conflict-cleanup, binding zero-write abandon,
drift-containment, containment-recovery, containment-reconciliation,
quarantine-artifact-cleanup and decommission-cleanup tokens
through the common lease/journal guard; an unknown token or direct writer is
rejected before a Gateway write, and only the intended explicit handlers are
public after cutover. Quarantine resolver continuity starts from both active and
`deleting` deployments, revokes/verifies every permitting key without false
stable-state drift, proves a direct bearer failure, removes only journal-proven
artifacts and leaves ambiguous provenance fenced. On an ordinary shared key,
the `quarantine_artifact_cleanup` finalizer removes only the quarantined route,
records the verified remaining policy as `stable`, advances its epoch and leaves
the second platform route eligible; unknown closure leaves the key
`reconciliation_required` and the outer quarantine fenced. A containment-state
key instead records only the containment-cleanup receipt and never returns to
  `stable`. For an active selected binding it records
  `key_restore_blocked_by_containment`; binding PUT and ordinary enable reject.
  A reviewed containment-reconciliation fixture verifies a stable safe policy
  excluding the absent route—disabled empty when it was the final entry—proves
  an unrelated-route direct bearer call fails, resolves the incident and clears only that
  blocker, after which binding PUT may restore the derived route under the still-
  retained provisional pair fence. A final-entry fixture requires the ordinary cleanup finalizer to
atomically produce, or disable-then-verify before producing,
`{disabled:true, allowed_route_ids:[]}`; a direct bearer request to an unrelated
route fails, and no stable enabled-empty allow-all fingerprint is observable.
An active-quarantine fixture verifies resolver success retains the selected
binding as `awaiting_key_restore`: Tenant retry remains denied, Platform Admin
PUT restores only the derived route ID while the compatibility fence remains,
a separate enable is required when disabled, and only exact eligibility makes
the same operation retry-ready and promotable.
Manager-mutation tests pause before and after the Gateway write and require
platform invocation denial without misclassifying the expected fingerprint;
verified success records the observed fingerprint, a verified no-change failure
returns to `stable`, and an unknown/partial result
requires reconciliation. Key-policy tests prove that empty
`allowed_route_ids` is treated as allow-all and excluded from Tenant projection;
an enabled allow-all key blocks every initial publish, retry, online and
rollback public-ingress activation, and handlers cannot create one while a
platform route may exist. A paused public-activation test attempts an
allow-all create/enable after preflight but before route write/recording and
proves the shared key-policy lease blocks it until the recorded route makes the
handler reject it. First-publication tests create a disabled empty-list
manager-controlled key and prove the explicit Platform Admin binding handler
adds only the server-derived route ID while preserving `disabled=true`; an
`enabled=false` payload is rejected by the manager contract and is never sent.
Publish/retry then fails before Agent/route writes and a direct bearer call
fails. After a separate explicit Platform Admin enable, publish creates the
route at the disabled non-public staging match with
`auth_policy.require_virtual_key=true`, records that full staging fingerprint,
atomically updates that route to the final match with `disabled=false` without
relaxing auth, and promotes only after the enabled final fingerprint verifies it.
A direct request without a bearer is denied before the create-to-invoke gate
passes, and disabling every Virtual Key still cannot make the route anonymous.
An absent/false auth flag never verifies or promotes. Activation and rollback
fixtures force that observation on an enabled operation-owned route and require
the same request to move and verify that route at the non-public staging match,
record `route_quarantined_contained` plus the blocking pair quarantine, and only
then return a contained failure; a no-bearer call then fails. An injected unknown closure
records `route_containment_failed`, retains all fences, emits an incident and
never reports the route safe or the deployment successful. Crash injection
immediately after the bad final-match write exercises startup recovery before
generic quarantine: it adopts the sequence, closes/verifies ingress, proves a
no-bearer failure and records `route_quarantined_contained`; closure failure is
retryable only through the explicit Platform Admin route-containment handler,
including while deleting. Starting from successful live containment, the
explicit quarantine-artifact resolver removes and verifies the staged route,
atomically converts an active deployment to the same operation's provisional
reservation and only then permits retry to recreate it; the deleting path keeps
the cleanup fence and grants no retry. A disabled non-empty bound key has the same result:
a Tenant `manage` retry never enables it or activates the route. Missing/stale
binding or failed binding mutation is a stable precondition failure with no
Agent/route write; retry is idempotent and no Tenant response contains the
bearer. Binding-removal tests allow DELETE only for a never-published intent,
prove both deterministic remote IDs absent and require either rejection or the
verified normalized `{disabled:true, allowed_route_ids:[]}` key fingerprint
before commit; a Gateway read that omits the empty allowlist must decode to that
same value.
The same DELETE against final-public, offline-staging, provisional, quarantined
or journaled-write deployments returns a conflict, retains the binding, pair
claim and route, and blocks cancel; explicit decommission proves removal before
the record can disappear. A direct bearer request to another route must still
fail. Removing one route from a shared prepublication allowlist preserves the
other routes and the prior `disabled` value, while an unknown/partial final-route
update retains the binding and never reports
`{disabled:false, allowed_route_ids:[]}` as safe. Decommission tests enumerate all permitting
keys under the shared lease, use the normal mutation barrier for ordinary key
states and the containment-cleanup token for either containment terminal state,
disable both an already-empty allow-all key and a key whose last route is
removed, create a barrier-controlled non-secret record to disable a legacy or
unmanaged permitting key, preserve other explicitly allowed routes on a shared
key, fail cleanup without deleting the route when any edit is unverifiable, and
deny the other Tenant only while that shared key is
`mutating`, never through false drift quarantine. Gateway disable stops scoped Test,
permission-resolution and run-cancellation forwarding; re-enable does not revive
the old context or pending permission. Tenant Admin and Tenant User Access
sessions cannot mutate a Virtual Key or retrieve its bearer. Tenant/Gateway
deletion tests start with an externally invocable deployment and require the
subject to remain `deleting` until key-route eligibility, the Agent route and the
Gateway Agent are verified absent. Injected partial failures remain retryable,
deny compatibility inventory/CRUD/Test against every retained promoted,
provisional or quarantined pair fence, and cannot report successful deletion or
permit external invocation after deletion
completes. The issuance-time reservation rejects recreation while deletion is
pending, and the cleanup resolver retains access to the deleting Gateway's
credentials and complete cleanup fence/journal index until final tombstoning.
Completed deletion makes every retained deployment row inaccessible and cannot
transfer it to a
replacement. Every retained Platform Admin handler in the published
allowlist has a success-continuity test, including explicit ordinary-key and containment
reconciliation, binding-conflict-cleanup retry, binding zero-write abandon and deployment-quarantine
resolver routes plus Tenant/Gateway decommission status/retry routes. The
Virtual Key page tests display both nonterminal and terminal containment states,
permit the Platform Admin recovery action and deny Tenant direct URLs. An
omitted method/path is denied without forwarding. Coverage includes discovered/managed/logical model discovery,
refresh and CRUD plus LLM API-handler-type reads. Compatibility tests keep a
legacy non-Platform Gateway Admin's credential read/update working through Step
6D, then verify that Step 6E removes it only with the reviewed assignment/removal
record and without granting target Tenant authority. Gateway-managed-Agent tests
cover Platform Admin Test/permission/run
control plus inventory and CRUD continuity, Tenant denial, active-Gateway checks,
same Agent ids on two Gateways, exact-pair deep-link refresh and fail-closed
rejection whenever any blocking deployment pair fence names that pair: a
provisional reservation, a promoted live/deletion-retained claim or a quarantine.
A mixed inventory
fixture with claimed, reserved, quarantined and unfenced Agents/routes returns
only unfenced entries and computes totals/pagination after filtering.
An inventory-race test pauses after the initial fence snapshot, completes a
deployment whose Agent appears in the upstream scan, and proves the post-scan
fence re-read removes it from both items and totals; Agent-route pagination has
the equivalent test. Session-list and run-list races pause after their initial
fence snapshot, create a provisional reservation before the upstream scan
finishes and require the post-scan re-read to remove that pair from items and
totals. Bundle
and direct Agent-route tests try to omit, replace and retarget a claimed Agent
and require denial with no Gateway write. A Platform Admin with no Tenant
membership can Test an unfenced pair, resolve its own interactive permission
and cancel its run through compatibility; Tenant actors cannot. A
compatibility Agent/route mutation or any newly created provisional, promoted or
quarantined pair fence invalidates the older Test context before another
forward. A paused compatibility turn/resume test starts a concurrent manager
disable, rotation or allowlist edit after the initial context epoch read and
proves the key-policy lease prevents commit until forward acceptance; after
lease transfer the changed epoch denies the next forward without false drift
classification. A second race pauses after preliminary compatibility epoch/fence
checks, commits an Agent/route mutation under object-then-key-policy leases, and
requires the waiting turn's complete under-lease Principal/Gateway/pair/key
revalidation to deny without forwarding. All outcomes are audited.
Runtime-page and Gateway-managed-Agent deep-link tests keep Gateway A when the
session active Gateway changes to B, and a selector navigates to B before any B
request; Tenant direct URLs are denied.
Unified Agent inventory tests use mixed Tenant platform Agents and Gateway-only
pairs: Tenant sessions receive only their selected Tenant's platform Agents;
Platform Admin alone receives only unfenced pairs from the explicitly requested
Gateway; and a dual-authorized Principal receives only the independently
authorized union. Filtering precedes totals/pagination, and neither active
session Gateway nor a header can retarget the explicit Gateway filter/deep link.
For platform-Agent rows, a no-grant Tenant User and an Admin granted only on a
different Gateway retain definition/draft/release fields but receive no
deployment state, target count, health or other-Principals' deployment activity;
the exact matching `view|manage` grant restores only the authorized Gateway's
facts. The API omits fields rather than relying on browser masking.
Platform-Agent tests cover own-context and grant-scoped redacted session/run
metadata plus cross-Principal content denial; compatibility tests cover
pair-scoped session/run reads and run cancellation with claimed-pair denial.
Deployment tests enter non-invocable `applying` and advance the invocation epoch
before the first remote apply, then simulate a crash after a partial write to
prove that neither pre-apply nor apply-window contexts can forward.
Platform Admin Virtual Key page tests cover create, allowlist, rotation,
disable, one-time
issuance and audited recovery plus legacy redirect; Tenant direct URLs are
denied.

## 9. Step 7 — Agent-first operational UI

- Finish the unified Agent workspace tabs at canonical routes.
- Finish Access ergonomics on the Step 6C deployment mappings and add authorized
  global infrastructure views without bypassing the scoped APIs. Platform Admin
  Gateway detail provides canonical Providers/provider-types/API-handler-types,
  discovered/managed/logical Models, LLM-routes and MCP services/routes pages;
  legacy LLM/MCP pages redirect only after parity.
- Finish the Step 6D Tenant deployment observations, scoped runtime actions and
  Workbench attention ergonomics; add Platform Admin Gateway-wide observability
  at `/dashboard/platform/gateways/{gateway_id}/observability`, backed only by
  the retained read-only Gateway metrics handlers. A Gateway A observability
  deep link remains on path A after the session active Gateway changes to B, and
  the selector must navigate before querying B.
- Remove superseded navigation only after redirects and parity pass.

Gate: desktop/mobile flows cover create resource -> create Agent -> create release
-> deploy -> invoke -> observe, with separate Tenant User, Tenant Admin view,
Tenant Admin manage and Platform Admin sessions. Direct-URL and navigation tests
apply the Step 6D deployment-read predicate to Tenant Overview/Calls/Usage: only
a Tenant Admin with live `tenant_gateway:view|manage` for that deployment's
  Tenant and Gateway may read deployment observations. A no-grant member sees no
  Overview, Calls or Usage rows even when owning a live invocation context; only
  the separate Agent-scoped session/run read may return that context's minimal
  metadata. The
Gateway-qualified Platform Admin Observability page reads only the named
Gateway's retained metrics handlers. The same matrix covers platform-Agent
Overview, Releases & deployments and Observability tabs plus Workbench
deployment attention, and confirms Tenant roles never receive Gateway-managed
inventory rows. Separate Access tests retain owning-Tenant membership discovery
and first-invocation success without a Gateway grant.

## 10. Step 8 — optional chat/history and controlled execution

This is not part of the initial resource/deployment acceptance.

### 8A. Product chat/history

Port generic session ownership, persistent history, attachments and Gateway event
translation. Reuse the mandatory Step 6C server-managed invocation path and add
history semantics here; do not postpone the Test credential boundary to this
optional slice.

### 8B. Durable controlled Agent work

Start only after an independent contract excludes Team, project/task binding,
Work Management and workflow-engine dependencies. Require durable jobs, leases,
idempotency, human wait/resume, cancellation, artifacts and reconciliation.

## 11. Step 9 — migration and operational acceptance

- Freeze canonical SQL migrations and generate manifests only after schemas
  stabilize.
- Rehearse source/account/resource mapping with backups, dry runs, row/reference
  counts and rollback.
- Declare exactly one active writer for each migrated domain.
- Verify backup/restore, SQLite/PostgreSQL, object storage, real Gateway and
  production Bun startup.
- Record accepted, deferred and excluded capabilities separately.

Old feature acceptance records are not evidence for this branch; every gate is
rerun.

## 12. Commit discipline

Recommended commit sequence:

```text
docs(platform): define rebuild boundaries and delivery plan
build(runtime): prove Bun dev and production execution
refactor(platform): establish contract and adapter boundaries
feat(identity): add principals and tenant memberships
feat(authorization): add tenant gateway grants
refactor(ui): establish canonical shell and scope spine
feat(ui): add tenant-scoped membership administration
feat(ui): add platform identity and gateway-grant administration
feat(catalog): add shared offerings and tenant availability
feat(resources): add skills and instruction revisions
feat(resources): add knowledge and document lifecycle
feat(resources): add personal file lifecycle
feat(resources): add tenant model and tool definitions
feat(agents): add tenant definitions and immutable releases
feat(deployments): add scoped gateway deployment lifecycle
feat(ui): complete agent-first operational journeys
chore(operations): add migration and acceptance gate
```

Subdivide any commit that mixes schema, unrelated pages or independent behavior.
The subject list is a direction, not permission to combine all work named by one
line.
