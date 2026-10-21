# Agent Management Platform UI Architecture

- Document type: **normative**
- Status: **accepted target; Step 7 canonical operational UI implemented**
- Applies to: `feature/agent-resource-platform` canonical dashboard routes and navigation
- Last reviewed: 2026-10-21

This document owns the target information architecture, scope display, page
responsibilities and canonical URLs. It does not grant authority; every visible
action is a projection of the server policy in
[Tenant Authorization Model](tenant-authorization-design.md).

Step 7 implements the Agent contextual workspace, membership-scoped Access and
Test, Tenant Workbench/Observability journeys, and the Platform Admin
Gateway-qualified infrastructure and observability workspace described here.
Legacy LLM/MCP/credential entry points now navigate to the canonical Gateway
path before loading data.

## 1. Product model

The primary object is **Agent**:

- a draft is its editable Tenant configuration;
- a release is an immutable snapshot;
- a deployment applies one release to one Gateway;
- endpoints and invocation keys expose it to callers; and
- calls, usage, health and diagnostics explain its operation.

Resources and Gateways support that lifecycle. Existing Gateway-only Agents are
shown as **Gateway managed** and are not silently assigned a Tenant or release
history. “Drafts” is a state/filter, not a separate product area.

Forms are driven by Gateway capabilities and preserve unsupported advanced fields
without pretending every runtime supports every resource. Workflow engines,
schedules and engine adapters do not appear in this IA.

## 2. Navigation

Desktop uses a persistent left sidebar. The active first-level area expands its
second-level pages beneath it. Mobile preserves the same hierarchy in a drawer.
The top header contains scope, pending actions, theme and account controls; it is
not a second navigation bar.

```text
Workbench
Agents
Resources
  Models
  Tools
  Skills
  Instructions
  Knowledge bases
  My files
Access
  Endpoints
  Invocation keys
Tenant administration
  Members
  Audit
Observability
  Overview
  Calls
  Usage
Platform administration
  Tenants
  Users
  Service accounts
  Gateway access
  Catalog
  Gateways
  Audit log
```

Platform administration is separated at the bottom. Its visibility follows
Platform Admin authority. A direct destination such as Workbench or Agents does
not render a redundant one-item tab bar.

Tenant administration is visible for the selected Tenant only when the human has
an active Tenant Admin membership. Platform Admin status alone does not expose
this section; Platform Admins administer memberships from the platform-scoped
Tenants page without receiving Tenant data access.

`My files` is a Resource page and may also have an account-menu shortcut. Both
links open the same canonical page; this resolves the old documents' conflicting
placements.

## 3. Scope model

The UI always identifies the scope that affects a query or mutation.

| Page kind | Visible scope |
| --- | --- |
| Tenant-authored resource/Agent | Tenant selector/filter or immutable owner label |
| Canonical Gateway operations/resources | Gateway ID from the canonical URL path; a switch navigates to the equivalent path for the selected Gateway |
| Legacy Gateway compatibility pages | Active Gateway selector in the header until their canonical replacement passes parity |
| Mixed Workbench/Agent inventory | Owner/source label per authorized item; Tenant filter for Tenant data and explicit Gateway filter for Platform Admin compatibility data |
| Deployment form | Explicit Tenant-owned release and target Gateway fields; creates a non-applying intent, then shows Await key binding before Apply |
| Personal files/conversations | Current human plus Tenant |
| Tenant administration | Selected Tenant from an active Tenant Admin membership |
| Platform administration | Platform scope; explicit Tenant/Gateway on the edited relation |

The active Gateway never hides accessible Tenant drafts or catalogs. A deployment
never relies on an implicit session Gateway. A selector that does not affect the
current page is not shown. Canonical path-qualified Gateway pages and their APIs
use only `{gateway_id}` from the path: changing a selector must navigate to the
new Gateway-qualified URL before any request, and `session.active_gateway_id` or
an active-Gateway header can neither retarget nor override that path. If the
shell cannot make the selector navigate, it renders the path Gateway as a
read-only label instead. The session selector remains only on explicitly legacy
session-scoped pages during compatibility.

Loading, empty, forbidden and failed states are distinct. A `403` must not render
as an empty collection.

## 4. Page responsibilities

### 4.1 Workbench

Workbench answers “what needs my attention?” It contains:

- recently edited accessible Agents;
- failed, uncertain or drifted deployments the actor may inspect or recover;
- unhealthy deployment summaries from the delivered Tenant-scoped deployment
  health projection the actor may read;
- pending permission requests from the human actor's own live invocation plus
  requests from any other human or service Principal on a deployment that human
  Tenant Admin may manage;
- recent accessible definition/release activity, plus deployment activity only
  where the actor satisfies the deployment-read predicate; and
- focused create/open actions.

It does not duplicate global charts, resource totals or sidebar navigation.

### 4.2 Agents

The list is one authority-filtered inventory for platform-managed and
Gateway-managed Agents. A Tenant session receives only platform Agents owned by
its selected Tenant; Tenant User and Tenant Admin roles never receive any
Gateway-only row. Platform Admin alone receives only unfenced Gateway-managed
pairs for an explicitly selected Gateway and no Tenant Agent. A Principal who
independently has both Platform Admin and matching Tenant authority may receive
the union, with each row authorized by its own source contract. Filtering occurs
server-side before totals or pagination. Rows show separate facts rather than
one ambiguous status:

- identity and Tenant/owner;
- management mode;
- draft/editability state;
- release state, but deployment state only when the row passes the
  deployment-read predicate;
- runtime type, but target count only when the row passes that predicate;
- health/last deployment activity only when the row passes that predicate; and
- the next authorized action.

For a no-grant Tenant member, the server omits deployment state, target count,
health and other-Principals' deployment activity before list serialization; the
browser never masks already-returned fields. Definition/draft/release facts stay
membership-scoped, and membership-scoped Access availability may still offer the
next **Test** action without exposing those deployment internals.
This remains true even when that no-grant member owns a live invocation context:
the Agent inventory row still contains only definition/draft/release facts and
does not derive health or deployment activity from the context.

A platform Agent uses its platform ID. A Gateway-managed Agent is identified and
linked by the `(gateway_id, agent_id)` pair; Agent IDs are not globally unique and
the active session Gateway is never used to fill a missing deep-link scope.

The primary create flow is a full-page wizard:

1. **Identity** — Tenant, name, ID and description.
2. **Runtime** — only fields valid for the selected runtime/capabilities.
3. **Resources** — bind supported models, tools, Skills, instructions and
   knowledge; create missing resources in context.
4. **Review** — scope, dependencies, unsupported items and the draft to save.

Creating a draft never deploys it. Direct creation of a Gateway-managed Agent is
an advanced Platform Admin operation and redirects to the pair-qualified
Gateway-managed workspace.

Agent detail uses these contextual tabs:

| Tab | Responsibility |
| --- | --- |
| Overview | Identity and capability/resource completeness; deployment summaries, health and activity only through the deployment-read predicate |
| Configuration | Runtime and resource configuration; lifecycle-enforced editability |
| Releases & deployments | Membership-scoped immutable releases/dependency snapshots; deployment history through the read predicate and lifecycle actions through `manage` |
| Access | Tenant-membership-scoped endpoint/protection and eligible-key metadata needed to start scoped invocation; no deployment observations or raw bearer |
| Observability | Deployment-read-predicate-filtered calls, usage, health and redacted session/run metadata; `manage`-authorized cancellation |
| Test | Capability-gated interactive invocation of a deployed Agent |

For a platform Agent, Tenant membership authorizes definition/configuration and
release-authoring data only. Deployment summaries, health, recent deployment
activity and deployment Observability on `Overview`, `Releases & deployments`
and `Observability` use the same exact deployment-read predicate as the global
Tenant Observability pages. `Access` is different: active membership in the
owning Tenant may load the server-projected endpoint, protection and eligible
non-secret key references required to create the first scoped invocation, but
receives no deployment observations or bearer. Every platform deployment shows
Virtual Key protection as mandatory; the UI treats an observed
`require_virtual_key=false`/missing route policy as a non-invocable verification
failure, never as an anonymous endpoint. A Tenant User or Tenant Admin
without a matching grant receives no deployment rows on those direct URLs, even
for that Principal's live invocation context. Only the separate Agent-scoped
session/run read may show that context's minimal metadata.
Deploy/offline/online/retry/verify/rollback, operational permission and cancellation
actions require `tenant_gateway:manage`.

Gateway-managed Agents omit platform release controls. Before legacy runtime
handlers are removed, their inventory, CRUD, configuration/capability/health,
Test, permission, redacted session/run metadata reads and run-cancellation
actions move to explicit Platform Admin-only compatibility APIs. Agent and route
inventory filters every blocking deployment pair fence on the server before
totals or pagination. All operations require an active Gateway and fail closed
when an operation-bound provisional reservation, a promoted live or
deletion-retained claim, or a quarantined collision names the exact
`(gateway_id, agent_id)` pair.
Tenant roles never receive those actions. For platform-managed Agents, a human
sees only session/run metadata tied to that human's live invocation contexts;
a Tenant Admin with a deployment `view|manage` grant may also see redacted
operational metadata, never another Principal's prompts, transcript or tool
payloads. Tabs and actions are capability- and
authority-driven, never inferred only from `runtime.type`.

Agent Test is enabled only when a platform deployment is verified
`operation_state=stable`, has an invocable lifecycle and owns the verified final
Agent/route pair. A stable take-offline deployment whose route remains at the
non-public staging fingerprint stays disabled until online/rollback restores and
verifies that same route in place. A Gateway-only pair remains disabled while
`mutating`/`reconciliation_required`; the UI shows the operation/lifecycle state
and retry/reconciliation owner rather than creating a context in either window.

### 4.3 Resources

Every resource list shows **Used by Agents** where attribution is reliable and
highlights missing/orphan references.

| Page | Scope | Responsibility |
| --- | --- | --- |
| Models | Tenant definitions plus approved/shared catalog offerings | Tenant model definitions and non-infrastructure offering choices |
| Tools | Tenant definitions plus approved/shared catalog offerings | Tenant tool definitions and non-infrastructure offering choices |
| Skills | Tenant/platform catalog | Metadata, content/package and immutable revisions |
| Instructions | Tenant/platform catalog | Content and immutable revisions |
| Knowledge bases | Tenant | Knowledge/document metadata and files; no fake retrieval state |
| My files | Human within Tenant | Private upload, preview, download and deletion |

The upstream-credential page lives on the Platform Admin Gateway detail, not in
Tenant Resources. Step 6E removes the former non-Platform Gateway Admin
credential compatibility path; continued operators require an explicit,
reviewed Platform Admin assignment. Credentials, Virtual Keys and service
credentials stay distinct.
Models/Tools may use one compact view switch between Tenant-authored definitions
and the Tenant-visible approved-offering projection; it never renders provider,
credential, service, Gateway, upstream object or global route identifiers.
Tenant model/tool editors submit only an approved catalog `offering_id`;
provider, credential, service, Gateway and upstream object identifiers remain
Platform-Admin-only offering internals. A deployment target is selectable only
when every Gateway-backed offering in the immutable release snapshot names that
Gateway. Mixed-source releases show a precondition error and require a new
release with compatible offerings; the UI never offers a cross-Gateway
materialization attempt.

### 4.4 Access

Access answers how callers reach Agents:

- **Endpoints** projects the owning Tenant's deployed ingress routes, protection
  state and invocation examples without granting global route mutation.
- **Invocation keys** shows only eligible Virtual Key references and non-secret
  status/expiry metadata used by scoped platform invocation. It never returns a
  bearer or offers create, allowlist, rotation, disable, reveal or recovery
  actions.

Tenant Admin deployment screens show only the owning Tenant's mapped endpoints.
Virtual Key lifecycle, allowlists, one-time issuance and audited recovery remain
on `/dashboard/platform/gateways/{gateway_id}/virtual-keys`; the Step 6C Tenant
projection does not relax that authority. Tenant Admin and Tenant User direct
URLs cannot retrieve a bearer or mutate a key. Platform service credentials
never appear here. The Platform Admin key editor labels an empty
`allowed_route_ids` list as Gateway-wide **Allow all**, excludes that key from
Access/Test eligibility, and explains that an enabled allow-all key blocks
platform publication while a platform-managed route may exist.

### 4.5 Tenant administration

| Page | Responsibility |
| --- | --- |
| Members | Selected-Tenant membership list, role changes, additions and removals; listed Principal disabled states are read-only feedback |
| Audit | Tenant-scoped actor/action/resource/decision/outcome trail, available only to active Tenant Admins |

This page never exposes Tenant lifecycle, platform identity administration,
Gateway grants or another Tenant's membership data. Tenant policy remains target
authority, but no policy schema or API is accepted yet; it does not enter
navigation or receive a route until a dedicated vertical slice defines its
persistence, authorization and tests.

A disabled Tenant is omitted from Tenant navigation and denied at its direct
Tenant-scoped URL. Its lifecycle state remains visible on the Platform Admin
Tenants page; the Tenant-scoped Members page does not receive a read-only access
exception.

Adding a member first selects **Human** or **Service account**, then resolves only
the corresponding complete username or service Principal ID supplied out of
band. The UI sends the explicit kind discriminator and never guesses between
namespaces, even when both contain the same text. It shows a minimal confirmation
result before mutation. The confirmation submits the resolver's short-lived
single-use receipt, never a caller-supplied stable Principal ID. Tenant Admins
receive no global Principal directory, prefix search or identity status control
from this flow.

The Audit page is backed by an authoritative `tenant_id` projection, not a
client-side filter over platform or Gateway logs. It excludes platform-only and
other-Tenant events and redacts secrets and infrastructure-only details.

### 4.6 Observability

Observability answers what happened on an authorized Gateway/Tenant scope:

- **Overview** — connectivity, traffic/error/latency, health exceptions, recent
  calls and deployment pending permissions only when the Tenant Admin has
  `tenant_gateway:manage`; it has no no-grant live-context exception;
- **Calls** — trace/span waterfall filtered by Agent, protocol, result and time;
- **Usage** — LLM/MCP/Agent trends and breakdowns.

Tenant views use the exact deployment-read predicate: a Tenant Admin needs live
`tenant_gateway:view|manage` for the deployment's owning Tenant and Gateway. A
no-grant member receives no Overview, Calls or Usage rows even for that
Principal's live invocation context; its minimal status/session-run metadata is
available only through the separate Agent-scoped context read. Ownership or
membership alone reveals no deployment activity, health, calls or usage. A
`view` grant exposes deployment observations but never another
Principal's pending permissions; that operational feed requires `manage`. Full
ACP/builtin/MCP runtime instances,
Gateway-wide in-flight work and destructive recovery have no Tenant-scoped
projection in the accepted slices, so **Runtime diagnostics** is not part of
Tenant/general Observability. It is a Platform Admin-only Gateway detail at
`/dashboard/platform/gateways/{gateway_id}/runtime`, backed only by retained
explicit diagnostic handlers. The navigation entry is rendered only for a
Platform Admin with that Gateway in the URL; Tenant actors are denied at the
direct URL rather than falling back to unfiltered data.

Interactive permission resolution is bound to the same active invoking Principal
(a human session in this UI, or a service credential through its service API)
and live server-managed invocation. Every resume reloads the Principal, Tenant,
membership-pair, deployment, Gateway and selected-key-policy dependencies and
requires exact equality with all captured authority epochs; restoring
membership or key allowlist, rolling back deployment content, rotating or
re-enabling a key, or re-enabling a Gateway never revives an old prompt.
Operational permission resolution and run
cancellation require `tenant_gateway:manage` for the owning deployment and use
platform deployment mappings rather than caller-supplied Gateway Agent IDs.
Destructive runtime pool/thread recovery remains Platform Admin-only.
Workbench combines minimal entries from the current human's own live invocation
contexts with deployment-scoped entries they may manage; own-invocation entries
do not grant deployment visibility or expose another Principal's request.
After the target cutover, UI actions call only these scoped platform endpoints;
legacy manager chat/permission/run routes are not a Platform Admin fallback.
This sentence applies to platform-managed Tenant Agents. The pair-qualified
Gateway-only Agent workspace calls the explicit Platform Admin compatibility
APIs and their separate compatibility invocation context; it never calls a
deployment-scoped endpoint or the legacy general proxy.

### 4.7 Platform administration

| Page | Responsibility |
| --- | --- |
| Tenants | Tenant lifecycle and platform-wide membership administration |
| Users | Human identity, Platform Admin assignment, status and session revocation |
| Service accounts | Non-human Principals and one-time credential issuance/revocation |
| Gateway access | Per-Tenant-Admin, per-Gateway View/Manage/No access matrix |
| Catalog | Platform-shared resources and Gateway offering approval, retirement and Tenant availability |
| Gateways | Registry, connection health and infrastructure entry point, including models, upstream credentials, Gateway-wide observability and runtime diagnostics |
| Audit log | Actor/action/scope/resource/decision/outcome trail |

Gateway detail owns Connection, Providers, provider/API-handler types,
discovered/managed/logical Models and LLM routes, upstream Credentials, MCP
services and routes, Virtual Keys, Configuration bundle, HTTP servers,
Gateway-wide Observability and Runtime diagnostics. The bundle
editor/importer rejects Agent, Agent-route and Virtual Key records; key lifecycle
uses the dedicated tab so policy epochs are
always advanced. During migration Gateway detail may show legacy memberships in
a clearly labelled compatibility view; those are not the target authorization
model.

Tenant and Gateway delete actions show the durable decommission operation and
do not report success while runtime cleanup is pending or failed. Platform Admin
may retry that remove-only cleanup but cannot use the flow to edit or redeploy
Tenant content.

Do not add System settings until real manager-wide settings have persistence and
authorization.

## 5. Canonical URLs

| Target | Treatment |
| --- | --- |
| `/dashboard/workbench` | Home/action queue |
| `/dashboard/agents` | Unified inventory |
| `/dashboard/agents/new` | Platform Agent wizard |
| `/dashboard/platform/gateways/{gateway_id}/agents/new` | Advanced direct Gateway creation; the legacy `/dashboard/agents/new/gateway` URL redirects here using the active Gateway |
| `/dashboard/agents/{id}/{tab}` | Platform Agent contextual lifecycle workspace |
| `/dashboard/platform/gateways/{gateway_id}/agents/{agent_id}` | Pair-qualified Platform Admin workspace and protected Test flow for a Gateway-managed Agent |
| `/dashboard/resources/{models,tools,skills,instructions,knowledge-bases,files}` | Tenant/resource pages |
| `/dashboard/access/{endpoints,keys}` | Invocation exposure |
| `/dashboard/tenant/{tenant_id}/{members,audit}` | Tenant-qualified administration and audit projection for Tenant Admins |
| `/dashboard/observability/{overview,calls,usage}` | Tenant-scoped operations |
| `/dashboard/platform/{tenants,users,service-accounts,gateway-access,catalog,gateways,audit}` | Platform administration |
| `/dashboard/platform/gateways/{id}/{tab}` | Gateway infrastructure detail |

`/dashboard/platform/gateways/{id}/credentials` is the canonical upstream
credential page. Tenant Admin and Tenant User sessions receive no navigation or
direct-URL access to it. Step 6E removes the former non-Platform legacy
credential workflow after explicit reviewed assignment and parity.
`/dashboard/platform/gateways/{id}/virtual-keys` is the canonical Virtual Key
lifecycle, one-time issuance, audited secret recovery, deployment-key binding
and containment-reconciliation page, with the same Tenant direct-URL denial. A
Platform Admin may bind a manager-controlled key to a specific deployment on
this Gateway without exposing its bearer; the binding handler adds/removes only
the server-derived route ID and never implicitly enables the key. **Remove
binding** is enabled only for a never-published intent whose deterministic
Agent/route IDs are absent. Published, offline, provisional, quarantined or
journaled-write deployments show the retained claim and direct the operator to
their explicit quarantine/decommission lifecycle instead of offering DELETE.
For an eligible prepublication removal, removing the last route warns that the
key must become disabled and completes only after the
UI receives a verified Gateway
`{disabled:true, allowed_route_ids:[]}` semantic result, with an omitted read
allowlist normalized to empty (or reports the rejected/uncertain
operation without hiding the retained binding). It never sends an
`enabled=false` field. Publication only consumes that
verified binding and cannot undo an administrative disable.
The page shows ordinary `reconciliation_required` separately and offers
Platform Admin-only **Reconcile uncertain key write**. That action can adopt an
exactly verified safe live policy, retry the journaled desired policy or verify
a safe disable, but never adopts or retry-commits an enabled empty allowlist;
that live result must first be disabled and verified. It never returns a bearer
and does not hide an unresolved state. It is unavailable for binding-cleanup,
zero-write-abandon, decommission or containment tokens, whose existing
dedicated retry actions retain their fences. The page shows containment
operation state and incident status, and
offers audited **Retry containment** / explicitly reviewed safe-policy recovery
through the dedicated handler. A Platform Admin also receives **Retry binding cleanup** for
a `binding_conflict_cleanup_failed` deployment and **Resolve deployment
quarantine** for a journal-proven artifact, plus **Retry route containment** for
`route_containment_failed`; these show the retained fence and incident, return
no bearer and use their dedicated handler/token. After active quarantine
resolution leaves `awaiting_key_restore`, the page offers **Restore retry
binding** through that deployment's Platform Admin binding PUT. It shows that
Tenant retry and compatibility remain fenced, never reveals the bearer, and, if
the key is disabled, directs the operator to the separate enable action before
reporting the operation retry-ready. When the selected key carries
`key_restore_blocked_by_containment`, **Restore retry binding** and ordinary
enable remain disabled; the page first requires the existing audited
containment-reconciliation action to establish a reviewed stable policy that
excludes the absent route. When that was the final explicit route, the page
requires a disabled empty result and confirms that direct bearer use remains
closed; only a later binding PUT may add the route again. Only that
reconciliation receipt unlocks restore.
For an operation-bound provisional reservation with both remote IDs verified
absent, the page offers Platform Admin-only **Abandon zero-write reservation**.
It invokes the dedicated binding-abandon handler, shows key cleanup progress and
does not hide the binding/fence until allowlist reversal verifies.
Decommission-only containment cleanup is not a
general page action. Legacy Virtual Key URLs redirect here only after parity.
`/dashboard/platform/gateways/{id}/{providers,models,llm-routes,mcp-services,mcp-routes,runtime}`
owns the retained Gateway infrastructure and diagnostic families. These pages
require Platform Admin, take scope only from the path Gateway and never render
inside Tenant Resources. Their legacy LLM/MCP/runtime URLs redirect only after
feature and authorization parity.
The Models page includes provider types and LLM API-handler types needed by
discovery, managed/logical model CRUD and route editing. Virtual Key operations
show `mutating`, `reconciliation_required`, `containment_in_progress`,
`containment_reconciling`, `quarantined_contained` and `containment_failed`, and
do not present a key as eligible until the verified observed fingerprint is
`stable`.
`/dashboard/platform/gateways/{id}/observability` is the Platform Admin-only
Gateway-wide metrics page. It takes Gateway scope only from the path and never
reuses the deployment-read-predicate-filtered Tenant Overview, Calls or Usage
responses.

Legacy `/llm`, `/mcp`, `/general`, `/configuration`, `/publication` and old Agent
URLs become redirects only after the canonical destination has feature and
authorization parity. Redirects preserve Tenant, Gateway, Agent and filter
context.

## 6. Composition and interaction rules

Use four repeatable page forms:

1. list page: header, search/filter, one primary create action, data surface and
   precise empty/error state;
2. object detail: breadcrumb, identity/status header, contextual tabs and one
   state-derived primary action;
3. editor/wizard: full page, explicit scope, validation summary and stable action
   footer; and
4. operational page: scope/time filters, statistics, charts/tables and refresh
   state.

Complex Agent and Gateway forms are not small modals. Every mutation represents
pending, success, partial failure and retry. Destructive actions name the target
and explain lifecycle impact. Shared components/theme tokens are reused instead
of source-project styling.

## 7. Authorization projection

- Tenant User sees authoring, release creation and use, never deployment controls.
- Tenant Admin sees membership and Tenant audit plus only the deployments
  permitted by that membership's Gateway grant. With no such grant, the same
  Tenant Admin receives no rows in Agent or Tenant Observability. The separate
  Agent-scoped session/run read may show only that Principal's minimal live-
  context metadata, and Workbench may show only its own pending-permission
  entries; neither exception grants activity, calls, usage, health or other-
  Principal records. Tenant policy remains absent until its own accepted
  vertical slice exists.
- Platform Admin sees platform/infrastructure administration, but no Tenant draft
  solely because of global status.
- Service Principals have no interactive UI session.
- Secret reveal, Caddy and raw bundle controls remain explicit Platform Admin
  operations; bundle inputs still reject Agent, Agent-route and Virtual Key
  records.

Hidden navigation is not security. Direct URL and API calls must yield the same
server decision.

## 8. Delivery rule

The shell and canonical routes are established in a small compatibility slice.
Each later capability lands as a vertical API+UI slice at its final URL. Do not
repeat the old branch's large move-and-rewrite commits. A page is linked from
navigation only when its backing API and authorization are real; unsupported
future pages are not placeholders.

## 9. Out of scope

- Team/project/task management and external Work Management connections;
- workflow graph editors, schedules and engine administration;
- subscriptions, plans and commercial marketplace pages;
- legacy Platform User flows;
- unsupported indexing/retrieval/runtime controls; and
- speculative system settings.
