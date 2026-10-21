# Tenant Authorization Model

- Document type: **normative**
- Status: **accepted target; implemented through scoped Gateway cutover on the rebuild branch**
- Applies to: accepted target on `rebuild/agent-resource-platform`; `dev` only
  after it contains the corresponding server-side migration
- Last reviewed: 2026-10-17

This document defines the authorization model implemented on
`rebuild/agent-resource-platform`. Step 6E retires user-facing Gateway
`admin/member` authority there; retained Gateway infrastructure and compatibility
APIs require Platform Admin, while Tenant deployment authority uses live Tenant
membership and exact per-admin Gateway grants. `dev` remains governed by the
code it contains until this server-side migration is merged.

## 1. Principles

1. Tenant is an ownership and isolation boundary, not a role.
2. Principal is an identity. A human or service account may be a Principal.
3. Credentials prove identity; they do not define authority by themselves.
4. Platform Admin is the only global role and may be assigned only to a human.
5. A Tenant membership has exactly one role: Tenant Admin or Tenant User.
6. Tenant Users are contributors and consumers, not read-only viewers.
7. Gateway deployment access is assigned to one specific Tenant Admin membership
   for one Gateway. Human and service Tenant Admins follow the same rule.
8. A Tenant Gateway grant applies only to that Tenant's deployment records. It is
   never general Gateway Admin API access.
9. Release creation, Gateway deployment and Agent invocation are three separate
   authorities.
10. Every decision is enforced server-side from live identity, membership, grant
    and resource ownership records.

Point 7 intentionally resolves an ambiguity in the old feature document: a
service Principal may automate deployment only when it has an active Tenant Admin
membership and its own explicit Gateway grant. “Per-admin” means per Tenant Admin
membership, not a role-wide grant and not human-only access.

## 2. Vocabulary

| Term | Meaning |
| --- | --- |
| Principal | Authenticated human or service identity |
| Platform Admin | Human global operator for identities, Tenants, Gateway registry and infrastructure |
| Tenant | Ownership/isolation boundary for Agents and resources |
| Tenant Admin | Tenant contributor with membership/policy authority; Gateway grants remain separate |
| Tenant User | Tenant contributor and Agent consumer without governance/deployment authority |
| Tenant Gateway Grant | `view` or `manage` access for one Tenant Admin membership on one Gateway |
| Virtual Key | Gateway data-plane credential for invoking allowed routes |

Product and API vocabulary is:

- Platform Admin
- Tenant Admin
- Tenant User
- `tenant_gateway:view`
- `tenant_gateway:manage`

The target does not expose Gateway Admin, Gateway Member, Gateway Viewer or a
generic per-action authoring-grant vocabulary to users.

## 3. Authorities

### 3.1 Platform Admin

Platform Admin may:

- manage human users, service accounts, Tenants and Tenant memberships;
- assign and revoke Tenant Gateway grants;
- register, test, disable and remove Gateways;
- manage Gateway connection addresses and encrypted administrator credentials;
- manage Caddy, raw bundles, shared upstream providers/credentials and other
  global infrastructure, subject to the platform-managed Agent/route write
  fences below;
- own platform-shared catalog records and decide which active Tenants may use
  each offering, without gaining access to Tenant-owned authoring data;
- perform explicitly audited secret recovery; and
- inspect platform-wide audit and operational data.

Platform Admin alone does **not** authorize Tenant authoring or deployment. The
same human needs an explicit Tenant membership and, for deployment, an explicit
Tenant Gateway grant.

### 3.2 Tenant User

Within an active membership, a Tenant User may:

- create, read and edit Tenant Agent drafts;
- create immutable releases;
- create and use Tenant-owned Skills, instructions, knowledge and supported
  model/tool definitions;
- reference approved platform-shared resources without reading secrets;
- use Agents made available to the Tenant; and
- when the Principal is human, manage their own files, conversations and
  history.

A Tenant User may not manage membership/policy, receive a Tenant Gateway grant,
inspect deployment internals, operate deployments, mutate platform-shared
infrastructure or reveal secrets. A service Principal in either Tenant role has
no personal-file, conversation or history authority in the accepted slices.

### 3.3 Tenant Admin

Tenant Admin has Tenant User capabilities and may additionally:

- manage Tenant membership and Tenant policy;
- recover/delete Tenant resources where lifecycle policy permits;
- inspect Tenant-wide audit projections; the Principal's own no-grant live
  context exposes only minimal status/session-run metadata through its separate
  Agent-scoped endpoint, not activity or usage; and
- inspect or operate the Tenant's deployments only on Gateways for which that
  exact membership has `view` or `manage`.

Tenant Admin without a Gateway grant has no deployment visibility.

Membership administration does not grant platform identity-directory access.
For an add operation, a Tenant Admin must select exactly one discriminated input:
`{ kind: "human", username }` or `{ kind: "service", principal_id }`. The
identifier is supplied out of band and resolved only in the selected namespace;
the server never guesses precedence when equal text exists in both namespaces.
The resolver returns minimal confirmation fields plus a short-lived, single-use
add receipt bound to the requesting Principal, Tenant, resolved target kind/id
and current authority epochs. It
cannot enumerate or prefix-search Principals and rejects inactive identities.
A Tenant-Admin membership create must consume that receipt and repeat live
caller, Tenant and target checks; it may not accept a caller-supplied stable
Principal ID directly. Stable IDs from the existing-members projection remain
valid for role changes/removal, and the Platform Admin bootstrap path remains a
separate explicitly authorized operation. Receipt issuance, consumption and
rejection are audited.

## 4. Capability matrix

| Capability | Platform Admin alone | Tenant Admin | Tenant User |
| --- | ---: | ---: | ---: |
| Manage platform identities, Tenants and Gateways | Yes | No | No |
| Manage Caddy, raw bundles and global secrets | Yes, but bundles cannot write platform-managed Agent/route objects or Virtual Keys | No | No |
| Author Tenant Agents/resources | No | Yes | Yes |
| Create immutable releases | No | Yes | Yes |
| Manage Tenant memberships | Yes | Yes | No |
| Manage Tenant policy | No | Yes | No |
| Invoke through the scoped platform UI/API | No | Yes | Yes |
| Operate an unfenced Gateway-only Agent through the compatibility service | Yes, on an active explicitly named Gateway | No | No |
| Manage personal files/conversations | No | Human owner only | Human owner only |
| View one Tenant's deployment on one Gateway | No | With `view` or `manage` | No |
| Deploy/take offline/online/retry/rollback | No | With `manage` | No |

“Yes” for Tenant memberships reflects the Platform Admin bootstrap and identity
administration authority in section 3.1. “No” for Tenant policy and Tenant data
capabilities prevents global operator status from becoming implicit Tenant data
access.

## 5. Release, deployment and invocation

| Operation | Required authority |
| --- | --- |
| Save Agent draft | Active Tenant Admin or Tenant User membership in the owning Tenant |
| Create release | Active Tenant Admin or Tenant User membership in the owning Tenant |
| View deployment | Active Tenant Admin membership plus `tenant_gateway:view` or `manage` for the same Tenant/Gateway |
| Create a non-applying deployment intent | Active Tenant Admin membership plus `tenant_gateway:manage` for the same Tenant/Gateway; returns server-derived IDs and performs no Gateway operation |
| Configure the deployment-key binding | Platform Admin; deployment must already exist, while this authority grants no Tenant authoring or apply right |
| Apply, take offline, bring online, retry or roll back | Active Tenant Admin membership plus `tenant_gateway:manage` for the same Tenant/Gateway |
| Invoke through the scoped platform API | Active Tenant subject, active Tenant Admin or Tenant User membership in the deployment Tenant, invocable deployment state, active deployment Gateway, and live Gateway route/Virtual Key policy |
| Invoke a published route directly at Gateway | Gateway route and Virtual Key policy; no platform session or live Tenant-membership lookup |
| Resolve an interactive permission for an invocation | Same active invoking Principal (human session or service credential) and server-managed invocation context, with every captured authority and key dependency still live |
| Resolve an operational permission or cancel a run | Active Tenant Admin membership plus `tenant_gateway:manage` for the owning deployment's Tenant/Gateway |
| Read deployment Agent session/run metadata | Same active invoking Principal for records tied to that Principal's live invocation contexts, or active Tenant Admin plus `tenant_gateway:view` or `manage` for redacted operational metadata on the owning deployment |
| Test an unfenced Gateway-only Agent through compatibility | Active Platform Admin, explicitly named active Gateway, no provisional reservation, promoted live/deletion-retained claim or quarantined collision for the exact `(gateway_id, agent_id)`, supported capability and live route/Virtual Key policy |
| Resolve a compatibility Test permission | Same active human Platform Admin and compatibility invocation context, with its Gateway, pair-claim and key dependencies still live |
| Resolve an operational permission or cancel a run through compatibility | Active Platform Admin, explicitly named active Gateway, unfenced exact pair and supported capability |
| Read unfenced Gateway-only Agent session/run metadata | Active Platform Admin, explicitly named active Gateway and unfenced exact pair; response excludes prompts, transcript, tool payloads and secrets |

A deployment mutation is authorized only when all are true:

```text
active Principal
AND active Tenant Admin membership
AND tenant_gateway:manage for the same Principal, Tenant and Gateway
AND deployment.tenant_id == membership.tenant_id
AND active target Gateway
```

Release creation never implies deployment. Tenant membership is never accepted as
a Gateway bearer.

The membership rule applies to server-managed platform invocation such as
Workbench and Agent Test. External workflow engines and other data-plane callers
invoke a published Agent directly through Gateway with a Virtual Key; Gateway
does not possess or query platform Tenant-membership authority on each request.
Platform availability and deployment policy governs what the platform publishes
and which route/key bindings it maintains, while the published data-plane route
continues to enforce its own Virtual Key policy.

Server-managed invocation first resolves the platform deployment, then requires
an active Principal, an active Tenant subject, active Tenant membership whose
`tenant_id` equals `deployment.tenant_id`, an active resolved Gateway,
`deployment.operation_state=stable` and an invocable deployment lifecycle state.
Platform Admin status,
membership in another Tenant, a Virtual Key reference or knowledge of a Gateway
route is never sufficient platform authority. The server records an opaque,
expiring invocation context bound to the Principal, Tenant, deployment and
resolved Gateway objects, plus the current Principal, Tenant, membership-pair,
deployment-invocation, manager-owned Gateway, deployment-pair-claim and
selected-Virtual-Key-policy authority epochs/fingerprints. Membership-pair,
deployment, Gateway, pair-claim and key-policy fence rows
are durable and monotonic across deletion, recreation, rollback, disable,
re-enable, rotation and allowlist edits. Later turns and permission operations
must use that context, reload every dependency including active Gateway status,
re-resolve the selected key without using a cached bearer, and require it to be
enabled, unexpired and allowed for the resolved route. They also require exact
epoch equality and live authority. The exact deployment's promoted live claim
must still match its captured Agent/route relationship and fingerprint; its own
claim is required rather than rejected by compatibility's global no-fence rule.
A provisional/quarantined, missing/mismatched or foreign conflicting claim
denies. Restoring a membership, rolling a deployment
away and back, re-enabling a Gateway/key or restoring a key allowlist never
revives an older context.

Under the required leases, a deploy/retry/rollback/take-offline/online operation
whose next remote mutation has not landed first runs its no-write preconditions:
current authority, applicable release/source
validity, route-namespace selection and expected object/journal state. Deploy,
retry, rollback and online additionally require binding/key eligibility.
Take-offline does not; an authorized exact promoted final pair may be moved to
safe non-public staging even when the bound key is disabled, expired,
quarantined or `containment_failed`. While the operation still observes its
expected pre-write fingerprint, a rejection leaves the prior deployment
operation state and invocation epoch unchanged and performs no Gateway write;
any independent authority/key
epoch change still has its own normal effect. After successful preflight the
service reauthorizes, then immediately before its first remote write the
platform-store transaction sets `operation_state=applying`, makes the lifecycle
non-invocable, advances the deployment epoch and records the operation kind,
sequence, expected/desired fingerprints and first write-ahead phase:
`take_offline_pending_stage`, `online_pending_activation` or, for active
rollback, `rollback_pending_stage`. Recovery follows that durable goal rather
than inferring intent from the observed route; invocation context creation, turns and resumes all deny a
non-stable operation state or non-invocable lifecycle. Successful remote
verification restores `operation_state=stable`, records the resulting lifecycle
and advances the epoch again; a successful take-offline remains non-invocable.
If recovery instead observes that a public-final write already landed, its pre-
final guard performs safety classification before these admission rules. A
failed authority, binding/key, allow-all or unique-winner proof cannot authorize
promotion, but it also cannot prohibit the internal remove-only containment
write that returns the operation-owned route to non-public staging. That safety
override uses only the journaled operation token and held leases, grants no
content-mutation authority and finishes in a route-containment terminal.
Failure, an unknown result or a worker crash remains non-invocable as
`partial_failure`/`applying` until a later authorized retry and verification. No
context can be minted in the pre-write window and remain valid across the apply.

Tenant Overview, Calls, Usage, deployment activity and health use the same
visibility predicate as deployment reads. A Tenant Admin sees deployment-level
records only for the owning Tenant and a Gateway where that exact membership has
`tenant_gateway:view|manage`. Tenant User, Tenant Admin without the matching
grant, Platform Admin alone and cross-Tenant callers receive no rows from those
deployment-observation projections, even for their own live contexts. A
separate Agent-scoped session/run endpoint may return only the same Principal's
minimal live-context metadata, without deployment internals or another
Principal's content.

Scoped runtime mutations resolve Gateway request/run identifiers through the
owning platform deployment and require an active target Gateway immediately
before forwarding. A caller cannot supply an unrelated Gateway Agent as
authority. Capability and resume-mode checks remain mandatory; destructive
pool/thread recovery stays a Platform Admin infrastructure operation unless a
later contract narrows it.

Gateway-only compatibility authority is deliberately separate from the
deployment rules above. It is available only to Platform Admin for an explicitly
named active Gateway and an exact `(gateway_id, agent_id)` pair with no blocking
deployment fence. A blocking fence is an operation-bound provisional
reservation, a promoted live or deletion-retained claim, or a quarantined
collision. Test creates a distinct opaque
compatibility invocation context bound to the human Principal, Gateway, pair,
route and selected key reference, capturing the Principal, Gateway,
manager-owned compatibility-pair and key-policy epochs without storing or
returning a bearer. The compatibility-pair fence and operation state are keyed
by `(gateway_id, agent_id)` and survive delete/recreate. Before a supported
compatibility Agent mutation, or an Agent-route mutation affecting its current
or proposed target, one manager transaction marks every affected pair `mutating`
and advances its epoch. Context creation, turns and resumes require `stable`.
Successful remote verification marks `stable` and advances again; an unknown or
partial result remains `reconciliation_required`. Every turn and interactive
permission resume reloads those dependencies and requires exact epoch equality,
the route still targeting that pair, absence of every blocking deployment pair
fence and the runtime capability/resume mode. Compatibility context creation,
turns and interactive resumes use the same key-policy critical section as
platform invocation in section 8: acquire the per-Gateway lease before re-reading
manager state, expected/observed fingerprints and live policy, require a stable
eligible key, and retain the lease through bearer resolution and outbound
forward acceptance. Context creation captures the verified key epoch before
release and repeats the critical section on first use; drift enters the same
containment protocol. Operational
permission resolution and run cancellation repeat the active-Gateway,
exact-unfenced-pair and capability checks immediately before forwarding. Every
compatibility runtime operation is audited. It grants no Tenant data or
deployment authority, accepts no implicit session Gateway, never falls back to
the general proxy and cannot operate a fenced pair.

Agent inventory, Agent-route, session and run lists on this compatibility
surface are server-filtered. They remove every provisionally reserved, promoted
live/deletion-retained or quarantined pair (and every route whose recorded id or
target intersects one). Agent inventory, route, session and run scans each
synchronously re-read the authoritative blocking-fence set after exhausting all
upstream pages and immediately before filtering/serialization, then calculate
items, totals or pagination only from the filtered result. A deployment
beginning during any scan is hidden by its provisional reservation in that final
read. A Platform Admin never receives the
materialized Gateway document for a platform-managed Tenant Agent through these
lists.

## 6. Tenant Gateway grants

Logical schema:

```text
tenant_gateway_grants
  principal_id
  tenant_id
  gateway_id
  access: view | manage
  principal_authority_epoch
  tenant_authority_epoch
  membership_authority_epoch
  gateway_authority_epoch
  PRIMARY KEY (principal_id, tenant_id, gateway_id)
  FOREIGN KEY (principal_id, tenant_id) -> tenant_memberships
```

`manage` includes `view`; store only the highest access per tuple. Reject a grant
when the Principal lacks an active Tenant Admin membership or when the Principal,
Tenant or Gateway is disabled.

A grant is accepted only by scoped platform deployment/query services that first
resolve the requested deployment's Tenant. It never authorizes the general
Gateway proxy or direct mutation of:

- another Tenant's Agent or route;
- Gateway registration, addresses or administrator credentials;
- Caddy servers/routes or raw bundles;
- shared providers, credentials, MCP services or global routes;
- raw Virtual Key material; or
- unfiltered Gateway-wide metrics/runtime state.

## 7. Resources and secrets

Tenant-owned resources carry `tenant_id`. Platform-shared resources carry an
explicit platform owner and availability policy. Tenant membership allows use,
not mutation, of shared resources.

Platform-shared availability is platform infrastructure policy, not Tenant
policy. A Platform Admin may publish or retire a shared record and set its
availability to all active Tenants or an explicit Tenant allowlist. Tenant
Admins cannot approve an offering for themselves. Gateway-backed model/tool
offerings use a required discriminant. `gateway-backed` requires both
`source_gateway_id` and `upstream_stable_id`; `platform-native` forbids both.
Missing, partial or contradictory source fields are rejected at catalog write
time. Those fields exist only in the Platform Admin-owned record. The sole
Tenant-visible/writeable binding is `offering_id`; Tenant payloads may not supply
a provider, credential, service, Gateway or upstream object ID. Availability
never exposes provider, service or Gateway credentials. Tenant reads receive
only offerings allowed for that Tenant, and release creation captures the
offering ID plus its immutable version/digest and internal source-Gateway binding
rather than inheriting future availability changes. The all-active-Tenants flag
and explicit allowlist govern catalog projection and whether a new reference or
release may be created; they are not a separate undefined Application authority
and do not revive or invalidate an already-authorized invocation context. Before
create, retry or rollback performs a remote deployment mutation, every
Gateway-backed offering in the immutable release snapshot must name the target
deployment Gateway. A release whose dependencies come from different Gateways
has no eligible target until a matching offering is selected and a new release
is created; the service returns a stable precondition error without contacting a
Gateway. Only a valid `platform-native` offering is exempt from this equality
check.

Secret-bearing infrastructure remains opaque:

- a Tenant author selects an allowed `offering_id`, never a provider or
  credential reference;
- APIs do not return its secret;
- authoring does not directly create arbitrary Gateway configuration; and
- materialization happens through an authorized deployment service.

Personal files and conversations also require a human `owner_principal_id` in
the accepted slices. Tenant Admin does not inherit another person's private
records, and service credentials are denied until a separate service-access
workflow is specified and accepted.

## 8. Invocation and service identities

Credentials remain independent:

```text
human session or service credential -> platform identity and Tenant authority
Virtual Key                         -> Gateway data-plane invocation
```

A service Principal may be Tenant Admin or Tenant User. A service Tenant Admin
may receive its own Tenant Gateway grant and automate the scoped deployment API.
It never receives Platform Admin, the stored Gateway administrator credential or
general proxy access.

The browser never receives a Virtual Key bearer merely because the logged-in user
belongs to a Tenant. Workbench/Test uses a server-managed invocation path.
That path stores only a key reference. On every context creation, turn and
permission resume the server acquires the per-Gateway key-policy lease before
its final authorization decision. While retaining the lease, it reloads the
Principal, Tenant, membership pair, deployment, Gateway and selected-key epochs
and lifecycle/fence state, plus the manager key operation state,
desired/last-verified fingerprints and live key through the Gateway adapter. It
requires every captured epoch to match, every subject and deployment to remain
active/invocable, both deployment and key operation state to be `stable`, and
the exact deployment's promoted live pair claim to match the captured claim
epoch/fingerprint and Agent/route relationship. The deployment's own promoted
claim is required; only compatibility applies the global no-blocking-fence
predicate. A provisional/quarantined, missing/mismatched or foreign conflicting
claim denies. It then requires
the live non-secret policy fingerprint to match the last verified observed
manager projection. Any mismatch denies before bearer resolution or forwarding.
A stable-state key mismatch is external drift: the same critical section atomically marks
`containment_in_progress`, advances the epoch and denies that request before any
data-plane forward. It synchronously disables the key on the Gateway and verifies
the resulting live fingerprint. Verified disable records
`quarantined_contained`; a failed or unknown write records
`containment_failed`, keeps every related deployment non-invocable, returns a
hard service error and raises a Platform Admin security incident. These are
containment terminal states, not outcomes of the normal mutation barrier, and
normal mutation completion cannot replace either with `stable` or
`reconciliation_required`. The key remains ineligible until explicit
reconciliation. After successful containment, a direct external request using
that bearer must fail. Only a matching fingerprint proceeds to enabled-state,
wall-clock-expiry and exact route-allowlist checks. For a turn or permission
resume, bearer resolution and outbound data-plane forward acceptance occur
before releasing the lease; context creation instead commits the selected-key
epoch before release and must re-enter this critical section on first use.
Supported Platform Admin key
lifecycle/policy mutations advance a durable manager-owned key-policy epoch
before the remote mutation, conservatively invalidating old contexts even if the
remote write fails; re-enable, rotation or allowlist restoration never reuses an
epoch. Each supported writer selects its finalizer from the durable operation
kind before mutation. An ordinary lifecycle/binding mutation stores desired
policy separately from the last
verified observed fingerprint, marks `mutating` and advances the epoch before
its Gateway write; platform invocation denies `mutating`. Its verified success
records the live fingerprint, marks `stable` and advances again. A verified
unchanged failure may return to `stable` with a new epoch; an unknown or partial
result enters `reconciliation_required`. Only an explicit Platform Admin
ordinary-reconciliation handler may leave that state. Under the same lease and
a dedicated token it advances the epoch, re-reads the live policy and either
adopts an exactly verified live policy only when it is not enabled with an empty
allowlist, or writes and verifies the recorded desired policy subject to that
same rule or a safe disable. It never adopts an enabled-empty live document;
that result must first be disabled and verified. Adoption must also satisfy the
originating writer's durable operation-specific postcondition, and ordinary
reconciliation cannot release an outer deployment fence or finish another
operation. An unknown result stays
`reconciliation_required`, and the handler never returns a bearer.
An ordinary-state `quarantine_artifact_cleanup` safety revocation may use this
key-state finalizer, but reconciliation must still verify the quarantined route
excluded or the key safely disabled; its outer quarantine remains for the
resolver to finish. Binding-conflict cleanup, including
`reason=zero_write_abandon`, instead reaches success only after the derived
route is verified excluded or safely final-entry-disabled and both deterministic
remote IDs satisfy the required absence proof. Any unknown or unsatisfied result
uses its dedicated `binding_conflict_cleanup_failed` finalizer, retains every
binding/reservation/fence and is resumable only by its cleanup-retry token.
Decommission cleanup likewise records its receipt only after verified key
revocation and object absence; an unknown or failed edit remains
`deleting/cleanup_failed` and only the decommission retry token may resume it.
Neither cleanup finalizer may produce `stable` or `reconciliation_required`.
Containment/recovery/reconciliation and
containment-aware cleanup tokens use only their dedicated terminals or cleanup
receipt and are rejected by that ordinary finalizer. After cutover the explicit
lifecycle/deployment-binding, ordinary-reconciliation,
binding-conflict-cleanup retry, binding zero-write abandon,
containment-reconciliation and quarantine-artifact-cleanup handlers plus the
internal binding-conflict cleanup, drift containment, containment recovery and
decommission-cleanup operations described below are the complete supported
Virtual Key writer set.
Every member uses the same lease, desired/observed journal and operation-token
guard. Raw bundle validation
rejects Agent, Agent-route and Virtual Key records, and direct Gateway-side key
mutation is unsupported. Reconciliation must use an explicit handler and can
never preserve an old context. Drift containment uses a separate operation kind
and compare-and-set token: `containment_in_progress` may finish only as
`quarantined_contained` or `containment_failed`, and the generic mutation
finalizer rejects that token so it cannot normalize containment back to
`stable`/`reconciliation_required` or discard its incident. If a crash or lost
response leaves `containment_in_progress` or `containment_reconciling`, a
lease-owning recovery worker claims the durable operation sequence with a
containment-recovery token, advances the epoch, idempotently disables and
re-reads the live key, then records `quarantined_contained` on verified disable
or `containment_failed` otherwise. Invocation remains denied throughout; the
generic finalizer cannot claim either nonterminal token. Decommission must run
this recovery before its cleanup edit. A dedicated Platform Admin
containment-reconciliation operation is the only eligibility-restoring exit from
a terminal. Under
the same lease it marks `containment_reconciling`, advances the epoch, re-reads
the live policy and, from either terminal state, first disables and verifies the
Gateway key. Failure returns to `containment_failed`; verified disable records
`quarantined_contained` and preserves the incident. From there the operator may
leave the key disabled for decommission, or explicitly approve a desired safe
policy rewrite; only an exact verified rewrite, a second epoch advance and
incident resolution may restore `stable`. A stable empty allowlist must remain
disabled, while an enabled restored policy must contain at least one explicit
route. Therefore reconciliation after removal of the final explicit route
verifies `{disabled:true, allowed_route_ids:[]}`; it cannot enable the excluded
empty policy, and only a later binding PUT may add the route ID back.
Decommission uses a
separate containment-cleanup token to verify disable or remove the retiring
route and record a cleanup receipt. The stable-restore finalizer rejects that
token; cleanup never changes the key to `stable` or otherwise restores
eligibility.

Gateway interprets an empty `allowed_route_ids` as allow-all. The platform never
projects such a key as eligible for a Tenant deployment. Admission and recovery
while the route remains at its expected pre-write fingerprint fail before any
further remote write when an enabled/unexpired allow-all key exists on the
target Gateway. If recovery observes that the public-final write already landed,
the same failed scan instead authorizes only the guarded write back to non-public
staging and route containment. Platform Admin may configure a
non-secret deployment-specific key binding to a manager-controlled key. The
Gateway wire field is `disabled`; all prose shorthand “enabled” means
`disabled=false`, and desired/observed fingerprints serialize and verify
`disabled`, never an invented `enabled` field. Gateway omits
`allowed_route_ids` on reads when empty, so verification decodes an absent field
as the same empty-list semantic value as `[]`; it never requires that array to
be physically present. The
binding handler derives the deployment route ID server-side and, through the
normal desired/observed barrier, may add/remove only that ID; it cannot reveal or
rotate a bearer, change expiry or grant another route. Adding and non-final
removal preserve `disabled`. Removing the final route from an enabled key is
rejected or first produces and verifies
`{disabled:true, allowed_route_ids:[]}` (atomically where supported, otherwise
write/verify `disabled=true` before removal); it may never persist
`{disabled:false, allowed_route_ids:[]}`. The unbind commits only after observing that
normalized safe policy. A failed or unknown update retains the binding and either the prior
policy or a verified `disabled=true` state. An `enabled=false` mutation payload
is rejected locally because Gateway does not define that field. Binding DELETE
is accepted only for a never-published intent after proving both deterministic
Agent/route IDs absent. A promoted/provisional/quarantined claim or any journaled
object write makes DELETE conflict; it cannot regress that deployment to
`awaiting_key_binding`, release the claim or let cancel complete. Those objects
leave only through explicit quarantine/decommission lifecycle cleanup. A disabled empty-list key may bootstrap the
binding, but stays disabled after its allowlist becomes non-empty until a
separate explicit Platform Admin lifecycle action enables it. Initial PUT
requires an already persisted `awaiting_key_binding` deployment. Under
route/object-then-key-policy leases it proves the derived route ID absent across
Agent/LLM/MCP route families and persists a prepublication route-ID reservation
before changing the allowlist; every route writer treats that reservation as
blocking. If a later initial-create preflight nevertheless finds a foreign
object, the declared `binding_conflict_cleanup` writer removes/verifies that
allowlist entry (or sets `disabled=true` for a final-entry key) without entering
deployment applying or advancing its invocation epoch, then releases binding/
reservations and returns the intent to `awaiting_key_binding`. It is safety
cleanup of the earlier binding side effect, not an ordinary no-write
precondition result. Unknown cleanup records
`binding_conflict_cleanup_failed`, retains both as a fenced incident and has an
explicit Platform Admin retry handler. A route-creating
operation acquires the object lease and then the shared per-Gateway key-policy
lease before preflight. Every route writer, including compatibility and retained
LLM/MCP handlers, shares that object/route-namespace lease. Before any Agent or
route write, the operation exhausts the Gateway's Agent/LLM/MCP route pages and
applies the Gateway's effective host, raw path-prefix and method match/score
semantics to each concrete Agent ingress request. A final public route must be
the unique winner; an equal-score tie or foreign equal/ancestor/descendant prefix
that wins a supported request is a stable no-write conflict while the candidate
final write has not landed. If recovery observes that its own final write did
land, the failed proof authorizes only the guarded staging withdrawal and route
containment. Initial activation,
retry activation, online, rollback from offline, active rollback's final restore
and crash recovery each re-run that final proof under the retained/reacquired
lease immediately before the public-final write. A non-public
staging create/move is exempt from the winner requirement and instead proves,
under the same snapshot and lease, that no supported public request selects its
reserved tuple. A create preserves public selection. A move may withdraw only
its own exact expected final route; excluding that source route, the unrelated
fallback—or no match—must equal selection with the source route absent. The only
allowed change is the intended withdrawal to that fallback/no match, so
containment is not rejected merely because an ancestor wins or no route matches. Retry/rollback may
exempt only their own journaled route and expected fingerprint. Before a public-
final write it requires the bound key already `stable`, enabled, unexpired and
explicitly allowing the derived route; while staging remains, a disabled or
otherwise ineligible key is a stable precondition failure with no Agent/route
write. If the final write already landed, key ineligibility instead blocks
promotion and permits only the guarded withdrawal/containment write. The
deployment service never enables the key. Initial publish alone applies the
absent-ID gate, creates the Agent and a disabled non-public staging route with
`auth_policy.require_virtual_key=true`, journals that provisional intermediate,
and then atomically changes the same route from the operation-unique reserved
staging match to the final match with `disabled=false` without relaxing that
flag. No supported public ingress request can match the staging tuple, and
preflight proves it displaces no existing route. Retry resumes that operation,
creating only a proven-absent object or updating/verifying the existing route in
place. Take-offline records `take_offline_pending_stage` with the expected final
and desired staging fingerprints before moving that same promoted route; it does
not require key eligibility. Online starts only from the exact promoted offline Agent/staging-route
fingerprints and restores that same route to the final match in place after the
normal authority/key/final-route preflight, recording
`online_pending_activation` before the route write. Rollback accepts an
active-final or exact promoted offline-staging start. For active it records
`rollback_pending_stage` before the staging write; recovery either performs or
verifies that move. Only after verified staging does it record
`rollback_staged_awaiting_agent_update`, before the Agent write, then updates/verifies the target Agent,
records `rollback_agent_updated_awaiting_activation`, then restores final
match+`disabled=false`; recovery resumes those phases and never exposes the
previous Agent. It never disables on the final match or applies the
initial-absence gate. A missing or mismatched claimed object is
fenced for reconciliation/quarantine rather than blindly recreated. Both the
intermediate and final fingerprints require that auth flag; an absent/false
value never verifies as a platform route. Initial activation, retry, online and
rollback write a sequence-bound pre-final containment guard before every final-
match mutation. It records the lifecycle phase and expected staging/final
fingerprints. Under reacquired leases, recovery resumes the recorded activation
when staging remains, and retires the guard atomically with promotion/stable
commit only when current phase-appropriate authority, bound-key eligibility,
the exact protected final pair, the repeated any-key allow-all scan and the
unique-winner proof all verify. When the journal-proven route is already at the
enabled final match but authority or bound-key eligibility fails, either public-
ingress safety proof fails, or the flag is absent/false, the operation adopts the
guard into containment, retains both leases, enters
route containment, moves the same route to the non-public staging match with
`disabled=true`, verifies final-ingress closure and records
`route_quarantined_contained` plus the blocking pair quarantine before returning
a contained failure. The lifecycle operation never deletes it. Unknown closure records
`route_containment_failed`, retains all fences and raises an incident; it never
claims containment or success. Live success also retires the guard in its
promotion/stable commit. Crash recovery examines the guard and any dangerous
mismatched operation-owned route before generic quarantine, verifies closure and
records `route_quarantined_contained`, or records
`route_containment_failed` for the explicit Platform Admin retry handler.
Promotion or entry into invocable `stable` occurs only after the final pair
fingerprints and relationship verify; a verified take-offline pair is
operation-stable only with a non-invocable lifecycle. Partial failure remains fenced and non-invocable for
retry/cleanup. Every member of the complete key-writer set
above uses the same lease, and the route operation retains it through activation
and durable recording, so a handler cannot insert allow-all in the publication
interval. A platform-eligible key must have a non-empty explicit allowlist
containing the deterministic route id.

## 9. Persistence and revocation invariants

```text
principals(id, kind, status)
tenant_memberships(principal_id, tenant_id, role: admin | user)
tenant_gateway_grants(principal_id, tenant_id, gateway_id, access: view | manage,
                      principal_authority_epoch, tenant_authority_epoch,
                      membership_authority_epoch, gateway_authority_epoch)
```

Services enforce fail-closed. Changes wholly inside the platform store are
transactional; manager users and the Gateway registry remain in manager SQLite,
so their lifecycle changes use generation fencing rather than claiming a
distributed transaction:

1. only an active Tenant Admin membership may own a Gateway grant;
2. demotion, membership removal, Principal revocation, Tenant disable/delete and
   Gateway disable/delete invalidate dependent grants;
3. authorization reloads current state rather than trusting a session/job role
   snapshot;
4. durable jobs reauthorize before every new remote mutation;
5. audit includes Principal, Tenant, Gateway, effective access, resource and
   outcome; and
6. migration never infers Tenant authority from Platform Admin or old Gateway
   membership.

The platform store keeps durable `authority_epoch` fence rows for service
Principals, Tenants, memberships and deployment invocation authority; manager
SQLite keeps the equivalent fences for manager-backed human Principals,
Gateways, Gateway-only compatibility pairs and selected Virtual Key policies.
Fence rows are keyed by subject type and
stable/composite ID and survive subject, relationship or deployment-row deletion.
A demotion, removal, disable or delete increments the corresponding authority
fence in its authoritative local transaction. Before the first remote write of
every deploy, take-offline, online, retry, rollback or deployment-route transition, the
platform store records the non-invocable operation state and advances the
deployment-invocation fence. Manager-side compatibility Agent/route and key
policy mutations likewise record `mutating` and advance their fences before
remote writes. Verified completion records the resulting observed state and
advances again before it becomes `stable`; unknown/partial results remain
non-invocable. A failed write or crash never rolls a fence back, and a retry uses
a newer epoch. A rollback to an earlier release still creates a new
deployment epoch. Platform-store transactions also delete or revoke dependent
grants where applicable, but the fence remains the correctness mechanism for a
concurrent insert that commits after that cascade. Reactivation, re-promotion,
relationship re-creation or restoration of earlier logical content never
restores an earlier epoch.

A durable deployment pair claim keyed by `(gateway_id, agent_id)` is a separate
infrastructure safety index, not a Tenant-readable deployment query. For an
initial deployment it is promoted only after the deployment service, under an
exclusive per-Gateway object lease shared with compatibility writers, verifies
the server-derived Agent/route IDs absent and both operation-owned objects at
their final desired fingerprints/relationship. Before the remote create, a
provisional operation-bound reservation makes
compatibility fail closed. A conflict never adopts or overwrites an existing
object. If binding already changed a key, the declared
`binding_conflict_cleanup` writer reverses/verifies that side effect, releases
binding/reservations and returns to `awaiting_key_binding`; unknown cleanup
retains a retryable fenced incident. Each journal stores the final enabled-route fingerprint and the
allowed intermediate disabled non-public staging-route fingerprint/phase. Crash recovery under the
same lease first dispatches the durable operation kind/phase. Take-offline,
online and rollback complete their recorded lifecycle goal before generic pair
classification only when the phase-specific safety proofs still pass; a failed
proof on an already-final route reaches the recorded containment terminal first.
It reconciles Agent and route as one unit. With no pending
lifecycle goal, it atomically promotes only
when both objects match their final journaled fingerprints and relationship. A
matching operation-owned proper subset remains provisional in
`partial_failure`, and retry re-enters its own reservation, revalidates that
subset and creates only the absent object. A matching present staging route in
`objects_created_awaiting_activation` also remains provisional; retry atomically
updates that same route in place from the reserved non-public match to the final
enabled fingerprint and verifies before
promotion. If neither write occurred, the operation may retry both. Abandon is
a Platform Admin-only binding operation that records
`binding_conflict_cleanup` with `reason=zero_write_abandon`, removes or safely
final-entry-disables and verifies the derived key entry, re-proves both remote
IDs absent, and only then releases the binding/reservations and returns to
`awaiting_key_binding`. Unknown cleanup retains every fence in
`binding_conflict_cleanup_failed`; binding DELETE or raw release is forbidden.
Rollback stages/updates the
existing claimed Agent/route in place under the same lease and never applies the
initial-absence rule. From active-final it records `rollback_pending_stage`
before the staging write; recovery performs the move while final remains or
verifies staging if the write already landed. From the exact promoted offline
fingerprint it retains that staging object. Its distinct
`rollback_staged_awaiting_agent_update` and
`rollback_agent_updated_awaiting_activation` phases make recovery update/verify
the target Agent before restoring the final route, never exposing the previous
Agent. Take-offline records `take_offline_pending_stage` before its route write,
then retains that same claimed route ID at the staging fingerprint and commits a
stable but non-invocable lifecycle; recovery performs/verifies the staging move
and cannot restore invocable final merely because the write had not started. Online is a
separate operation that starts only from the exact promoted offline pair,
reauthorizes and proves the complete any-key allow-all gate, bound-key
eligibility and final-route unique selection, records
`online_pending_activation` before the route write, restores that route in place
and commits invocable stable only after final-pair verification. From expected
staging, recovery repeats reauthorization, the any-key allow-all scan, bound-key
eligibility and final-route unique selection before activation; a failed
pre-write proof leaves staging pending rather than quarantining it. It accepts an
already-final result only when phase-appropriate reauthorization and bound-key
eligibility still pass, `auth_policy.require_virtual_key=true`, and both repeated
public-ingress safety proofs pass. Lost authority, an ineligible bound key,
missing/false protection or either failed public-ingress proof runs the recorded
containment transition, withdraws the route to staging and cannot commit online. Ordinary
lifecycle never removes it; the explicit quarantine-artifact resolver may do so
only while atomically creating the same operation's provisional retry authority,
and remove-only decommission may do so without retry. Later online/rollback
never recreates a missing claimed route.
Recovery contains an enabled operation-owned final route when current authority
or bound-key eligibility fails, auth is missing/false, or a repeated allow-all/
unique-winner proof fails, before classifying the pair.
Any foreign or other mismatched object then converts the pair into a
durable blocking quarantine fence rather than exposing it to compatibility. An
explicit resolver may clear it only after proving the
deployment operation wrote nothing and that the pair is safe to classify as
Gateway-only. Each create has a durable per-object journal containing the
verified pre-write absence, expected ID, final fingerprint, allowed intermediate
fingerprint/phase and write-attempt sequence.
When that journal proves a mismatched object first appeared after the operation's
attempt while the exclusive lease excluded supported writers, a Platform
Admin-only remove resolver may acquire object then key-policy leases, revoke all
key eligibility for the quarantined route, delete only the proven
operation-owned route/Agent and verify absence. For an otherwise active
deployment it atomically marks `partial_failure` and converts the quarantine
back to a provisional reservation bound to the same operation; only that
operation may retry, and compatibility remains fenced. The explicit Platform
Admin deployment-quarantine resolver handler and UI action use a declared
`quarantine_artifact_cleanup` token through the common writer guard, support
active and `deleting` deployments, audit the result and return no bearer. For an
ordinary key state, its dedicated safety-revocation finalizer records the
verified narrowed/disabled fingerprint, advances the epoch and returns that key
to `stable`, preserving unrelated allowed routes. If the quarantined route is
the final explicit entry, it atomically writes
`{disabled:true, allowed_route_ids:[]}` or verifies disable before removal and
never exposes a stable enabled-empty allow-all policy; unknown closure records
`reconciliation_required` and retains the outer fence. For a key already in a
containment terminal, it dispatches containment-aware cleanup and records only a
cleanup receipt, never `stable`. For an active deployment this also records
`key_restore_blocked_by_containment`; ordinary binding PUT and enable reject
until the dedicated Platform Admin containment-reconciliation operation verifies
a safe stable policy that excludes the absent derived route and resolves the
incident. Only that reconciliation receipt clears the blocker.
For an otherwise active deployment, successful removal retains the selected
binding as `awaiting_key_restore` under that operation's provisional
reservation. Tenant retry and compatibility remain denied. After any containment
blocker is cleared, the Platform Admin binding PUT may accept only that exact
resolver-created reservation, re-prove
both deterministic IDs absent and re-add only the derived route ID without
releasing the fence or enabling the key. A separate enable is required when
disabled; exact stable/enabled/unexpired/non-empty eligibility then makes only
that operation retry-ready.
Decommission may invoke
the same remove-only resolver but retains its cleanup fence through final
tombstone instead of creating retry authority. Missing provenance or
unverifiable cleanup leaves the quarantine blocking; it never authorizes
Tenant mutation or arbitrary Gateway-object deletion. A promoted claim survives
removal of its deployment, Tenant or Gateway rows. Bundle validation rejects
every Agent, Agent-route and Virtual Key record. The only retained Agent-route
mutation path is the Gateway-only compatibility service, which rejects a route
whose recorded route id, current target or proposed target intersects a blocking
pair fence. Its Agent operations use the same exact-pair guard. Consequently a
missing live Tenant or Gateway never turns retained platform state into editable
Gateway-only inventory.

Every initial deploy, retry, rollback, take-offline, online, route-changing recovery and
remove-only decommission holds that same exclusive per-Gateway object lease from
its first related remote read/write through verification and the authoritative
operation/claim state commit. Compatibility uses the same lease. Every operation
that can change route invocability or a deployment/compatibility authority epoch
also takes the key-policy lease, even when it does not edit a key. It always
acquires object first and key-policy second, holds both through remote
verification and authoritative state commit, and releases in reverse order;
apply, cleanup and invocation final authorization therefore cannot race or
deadlock by choosing opposite acquisition orders.

Human Principal IDs, service Principal IDs, Tenant IDs and Gateway IDs are
permanently reserved after first issuance. The durable reservation is written
in the same authoritative local transaction that first issues the ID, not when
deletion finishes; it therefore blocks reuse while a subject is active,
`deleting` or tombstoned. The manager store owns Gateway reservations and the
platform store owns Tenant and service-Principal reservations. Creation rejects
every previously issued ID.
Every ownership/availability/deployment query also requires the referenced live
Tenant or Gateway, so deletion makes retained historical rows inaccessible and
re-registration must use a new ID. Epoch fencing protects lifecycle races; it is
not a substitute for preventing a new subject from inheriting bare foreign-key
references.

Once deployments exist, Tenant and Gateway deletion is a state machine rather
than an immediate row removal. The request records `deleting`, advances the
subject epoch and starts an idempotent internal decommission operation. Context
creation/use and deployment mutation require the live Tenant and Gateway
subjects to remain `active`, not merely to match their current epochs; no caller
can mint a new context against the post-transition `deleting` epoch. That
operation has remove-only authority over the subject's promoted claims and every
journal-proven operation object behind its provisional or quarantined fences.
It acquires the object lease and then the shared key-policy lease in the global
order above, enumerates all those fences/journals and reads every Gateway key,
including legacy/unmanaged keys. Every enabled key that currently permits any
recorded route is submitted through the Virtual Key mutation service. Ordinary
key states use its `mutating` barrier; `quarantined_contained` and
`containment_failed` use the dedicated containment-cleanup token, which must
obtain and verify a live disable without restoring `stable`. Stale
`containment_in_progress` or `containment_reconciling` first runs the durable
containment-recovery transition to a terminal, then cleanup continues. The
worker disables
an already-empty allow-all key, removes the route from a
non-empty shared allowlist, or disables a key instead of producing an empty
allow-all list when the last route is removed. A legacy/unmanaged permitting key
first receives a manager control record from its observed non-secret policy and
a new epoch, solely so the same barrier can disable or narrow it; cleanup never
reveals or adopts its bearer. If any such edit cannot be verified, cleanup stays
`cleanup_failed` and does not remove the route. After verifying that no enabled,
unexpired key permits a recorded route, it removes every promoted object and
every journal-proven partial Agent/route write, then verifies absence. This
includes one-object and complete-but-not-promoted provisional applies; ambiguous
ownership fails closed. Their fences and operation journals remain durable until
that verification and the final state commit. Only then may deletion write the
permanent tombstone and close the cleanup fences. Failure or an unreachable
Gateway leaves `deleting/cleanup_failed` plus every promoted, provisional and
quarantined fence in place for retry; it never reports deletion complete, while
the issuance-time reservation continues to reject recreation. A dedicated
decommission resolver may use the stored credentials of a `deleting` Gateway
only for these remove/verify calls and may read the complete cleanup
fence/journal index even though ordinary ownership/deployment projections
require `active`. The credentials, subject row
and cleanup index are retained until successful final tombstoning; normal Gateway
resolution and every compatibility endpoint continue to require `active`. This
lifecycle capability does not permit a Platform Admin to deploy, edit, retry or
roll back Tenant content. Tenant deletion is limited to its claims on shared
Gateways, while Gateway deletion drains all claims for that Gateway.

Each Tenant Gateway grant records the current Principal, Tenant, membership and
Gateway epochs. Authorization reloads every live dependency and fence, then
denies a missing/disabled record, a non-admin membership or any epoch mismatch,
even when a stale grant row remains in the platform store.

Grant creation reads every active dependency and epoch, writes the grant, then
re-reads them before reporting success. A concurrent lifecycle change makes the
grant unusable immediately through the live status/role/epoch check; the final
validation revokes the stale row when possible and returns a conflict. This is a
fencing protocol, not cross-database atomic commit. Tests must cover disable and
delete races, membership demote/remove races, failed stale-row cleanup, and
disable/re-enable or demote/re-promote sequences so an old grant can never become
effective again.

## 10. Migration from current behavior

Migration is staged and fail-closed:

1. add Principals, Tenants, memberships and Tenant Gateway grants without changing
   current behavior;
2. map manager users explicitly; do not duplicate editable password authority;
3. add Tenant ownership to Agent/resource families;
4. implement scoped release/deployment services with target authorization;
5. project the new policy in UI only after server checks exist;
6. remove Tenant actors from the general Gateway proxy after replacement flows
   pass, and remove the legacy chat turn/permission handlers plus catch-all
   Agent permission/run mutation paths as human runtime authority for everyone,
   including implicit Platform Admin Gateway authority; Platform Admin keeps
   only explicitly retained infrastructure/diagnostic operations, while Agent
   invocation and scoped runtime mutations use the platform APIs in section 5;
   and
7. preserve the current non-Platform Gateway Admin credential read/update
   workflow through the Step 6D compatibility period. It is not target Tenant
   authority and is not removed or redirected to the Platform Admin-only page
   until Step 6E has explicit operator assignment, parity and negative tests;
   and
8. retire old Gateway membership and resource-grant concepts only after explicit
   assignment mapping and negative authorization tests pass. Any operator who
   still needs target credential/infrastructure authority is granted Platform
   Admin only by an explicit reviewed decision, never by role inference.

No migration grants access based on a guessed equivalent role.

## 11. Acceptance criteria

1. Tenant Users can author Agents/resources and create releases, but can never
   receive or exercise `tenant_gateway:*`.
2. Tenant Admin without a Gateway grant cannot inspect deployments.
3. `view` and `manage` are limited to the owning Tenant's deployments on the one
   named Gateway.
4. Two Tenant Admins in one Tenant may have different grants per Gateway.
5. A shared Gateway does not leak cross-Tenant deployment inventory or metrics.
6. Platform Admin alone has no Tenant authoring/deployment access.
7. Human and service deployment automation obey the same membership/grant checks.
8. No Tenant role or service credential reveals Gateway or Virtual Key secrets.
9. Revocation/demotion takes effect before the next remote mutation.
10. Direct Gateway invocation requires route and Virtual Key policy and remains
    usable by external callers without a platform session; platform-mediated
    invocation additionally requires the matching live Tenant membership.
11. Every grant mutation, deployment mutation and denial is attributable in
    audit records.
12. Deleted Tenant and Gateway IDs cannot be reused, and retained ownership,
    allowlist, deployment or offering rows cannot attach to a replacement.
13. Removing and recreating a membership cannot revive an invocation context or
    pending permission issued under the earlier membership epoch.
14. A Gateway-backed offering can be materialized only on its recorded source
    Gateway, and a rejected mismatch performs no remote mutation.
15. After cutover, neither Platform Admin status nor a legacy Gateway role can
    invoke an Agent, resolve its permission or cancel its run through legacy
    manager routes.
16. Rolling a deployment away and back cannot revive an older invocation context
    or pending permission.
17. Disabling a Gateway stops scoped invocation, permission resolution and run
    cancellation; re-enabling it cannot revive a context issued under the prior
    Gateway authority epoch.
18. Every server-managed turn and permission resume rechecks selected-key status,
    expiry and route allowlist; key disable/re-enable, rotation or allowlist
    restoration cannot revive an older context.
19. Gateway-backed catalog writes require both source fields, platform-native
    writes require neither, and no malformed offering reaches a Gateway write.
20. Every accepted Virtual Key mutation path advances its policy epoch; raw
    bundles cannot write Agent, Agent-route or key records, and detected
    Gateway-side drift quarantines and invalidates prior contexts, then disables
    and verifies the Gateway key before reporting containment.
21. Raw bundles cannot write Agents or Agent routes, and compatibility Agent or
    route handlers cannot mutate a provisionally reserved, promoted live or
    deletion-retained, or quarantined deployment pair.
22. Tenant or Gateway deletion cannot complete while a claimed published route
    remains externally invocable; cleanup failure stays retryable and cannot
    expose the pair through Gateway-only compatibility APIs. Cleanup disables
    already-empty allow-all and legacy/unmanaged permitting keys as well as
    editing manager-owned explicit allowlists.
23. A Platform Admin without Tenant membership may operate only an explicitly
    named active Gateway's unfenced Agent pair through the compatibility
    service; claiming or reconfiguring that pair invalidates an older Test
    context before the next forward.
24. Compatibility Agent, route, session and run lists omit provisionally
    reserved, promoted and quarantined pairs before totals or pagination, so
    Platform Admin alone cannot read an uncertain or materialized Tenant release
    through Gateway inventory.
25. Every deployment apply becomes non-invocable and advances its epoch before
    its first remote write; partial failure or crash permits neither a pre-apply
    nor an apply-window context to forward.
26. A Virtual Key policy-fingerprint mismatch denies the request that detects
    it before bearer resolution or Gateway forwarding; after successful
    containment, the same bearer also fails direct external Gateway invocation.
27. Tenant and Gateway ID reservations exist from issuance, block recreation
    throughout `deleting`, and do not remove cleanup credentials or claims before
    final tombstoning.
28. Tenant deployment observations require a matching Tenant Admin
    `view|manage` grant; neither membership nor the same Principal's live
    invocation context satisfies that predicate. The context exposes only its
    own minimal status/session-run metadata and never deployment activity,
    health, calls or usage.
29. A service Principal may query and resolve a permission from its own live
    invocation context with the same credential and live authority checks; no
    other Principal gains that ownership.
30. Deployment, Gateway-only-pair and Virtual Key policy mutations deny context
    creation/use while their state is not verified `stable`; expected manager
    writes are tracked separately from external drift.
31. A pre-existing Gateway Agent or route collision is never adopted or
    overwritten and cannot leave a permanent pair claim after a verified
    no-write failure; crash recovery deterministically promotes, releases or
    quarantines the operation-bound provisional reservation. Provisional and
    quarantined fences deny compatibility inventory/get/CRUD/Test/session/run
    access even after lease loss and until verified resolution.
32. An enabled/unexpired empty Virtual Key allowlist is treated as Gateway
    allow-all, excluded from platform eligibility and blocks initial publish,
    retry, online and rollback while platform-managed routes may exist.
    Decommission enumerates every permitting
    key under the shared mutation barrier, disables an already-empty allow-all
    or legacy/unmanaged permitting key, and disables a key when removing its
    final explicit route.
33. A legacy non-Platform Gateway Admin retains credential read/update through
    Step 6D. Step 6E removes it only after an explicit reviewed Platform Admin
    assignment or recorded removal, without inferring Tenant authority.
34. Once a Tenant or Gateway enters `deleting`, no context can be created or
    used against either the old or newly advanced epoch; cleanup failure never
    reopens scoped invocation or deployment mutation.
35. Initial apply, retry, rollback, take-offline, online, recovery and decommission hold
    the shared per-Gateway object lease through remote verification and durable
    state commit, so they cannot interleave with each other or compatibility.
36. Publication holds the key-policy lease from the allow-all preflight through
    verified route recording, so a concurrent handler cannot introduce an
    enabled allow-all key into that interval.
37. Membership add resolution requires an explicit human/service discriminator;
    equal username and service-ID text cannot resolve or receipt-bind the wrong
    Principal namespace.
38. A `view` grant never exposes another Principal's pending permissions;
    deployment pending-permission feeds require `manage`, while every Principal
    may see only its own live-context entries.
39. Active owning-Tenant membership, without a Gateway grant, may discover the
    non-secret endpoint/protection and eligible-key references needed to create
    a first server-managed invocation; it reveals no deployment observations or
    bearer.
40. Human Workbench pending permissions are the union of that human's own live
    contexts and other human/service Principals' deployment entries only where
    the human has `tenant_gateway:manage`.
41. A mismatched operation artifact with journal-proven ownership has a
    Platform Admin-only remove path that revokes route eligibility, removes and
    verifies only that artifact, then restores the same operation's provisional
    reservation for active-deployment retry; ambiguous provenance remains fenced
    from retry, compatibility and decommission deletion.
42. Compatibility Agent inventory, route, session and run lists re-read blocking
    pair fences after exhausting upstream pages and immediately before
    server-side filtering, so a deployment completed during any scan is absent
    from items and totals.
43. Platform-Agent inventory rows expose definition/draft/release facts by
    Tenant membership, but omit deployment state, target count, health and
    other-Principals' deployment activity unless the exact deployment-read
    predicate succeeds.
44. Platform-scoped and Gateway-only compatibility invocation re-read manager
    and live key policy after acquiring the key-policy lease and hold it through
    forward acceptance, so a concurrent manager mutation cannot be misclassified
    as drift or race a previously approved bearer forward.
45. Recovery from a crash after only the Agent or only the route write keeps the
    pair provisional, retries only the missing object under the same operation
    and promotes only after both objects and their relationship verify.
46. Drift containment has operation-token-guarded terminal states distinct from
    ordinary mutation completion; no generic finalizer can turn
    `quarantined_contained` or `containment_failed` into `stable` or discard its
    incident.
47. Dedicated containment reconciliation from either terminal state first
    obtains a verified Gateway disable. Only an explicit verified safe-policy
    rewrite plus incident resolution can restore eligibility; containment-aware
    decommission uses a different cleanup token that can keep the key disabled
    and remove a retiring route but is rejected by the stable finalizer.
48. Tenant/Gateway decommission enumerates promoted, provisional and quarantined
    pair fences, removes every journal-proven partial object, and retains all
    fences through verified absence and final tombstone. Ambiguous ownership
    remains `cleanup_failed` and never becomes Gateway-only inventory.
49. A Platform-Admin-only deployment-key-binding handler adds only the
    server-derived route ID through the shared key-policy barrier and preserves
    administrative disable. Publish/retry/rollback route mutation never changes
    or enables the key; a preflight conflict exits that path and delegates only
    reversal of the earlier binding side effect to the separately authorized
    `binding_conflict_cleanup` writer. Route activation occurs only when the
    bound key is already verified eligible. Before the final write, a
    missing/disabled binding fails closed without Agent/route writes; after an
    operation-owned final write already landed, it blocks promotion but cannot
    block the guarded staging withdrawal and route-containment terminal.
50. Crash recovery from `containment_in_progress` and
    `containment_reconciling` idempotently verifies a live disable and reaches a
    containment terminal; invocation and decommission never wait permanently on
    an unhandled nonterminal state.
51. The complete supported Virtual Key writer set includes lifecycle, binding,
    ordinary-reconciliation, binding-conflict-cleanup retry, binding zero-write
    abandon, containment-reconciliation and
    quarantine-artifact-cleanup handlers plus internal binding-conflict cleanup,
    drift containment, containment recovery and decommission cleanup; every
    writer uses the common lease/journal/token guard and every other path is
    denied.
52. A disabled route created during publication uses an operation-unique
    non-public staging match and is a journaled provisional activation phase,
    not drift or a final-prefix black hole. Retry updates it in place and promotes only
    after the final enabled fingerprint verifies; rollback likewise stages the
    already claimed pair instead of applying the initial-absence gate.
53. Removing a deployment binding can never leave an enabled key with an empty
    allowlist. Final-route removal is rejected or verified as
    normalized `{disabled:true, allowed_route_ids:[]}` using Gateway's real wire
    field while accepting an omitted allowlist on read as empty, and an
    uncertain outcome retains the binding and cannot be reported safe.
54. Invocation repeats its complete epoch, subject, lifecycle and fence check
    after acquiring the key-policy lease. Deployment and compatibility mutations
    that can invalidate that decision hold the same lease through commit, so a
    waiting stale turn cannot forward after take-offline or rollback.
55. Initial publish alone applies the absent-ID create gate. Retry resumes the
    journaled pair and rollback updates the promoted pair in place; neither
    blindly recreates existing Agent or route objects.
56. Personal files, conversations and history require a human owner in the
    accepted slices; a service credential is denied regardless of Tenant role.
57. Every platform-managed Agent route has verified
    `auth_policy.require_virtual_key=true` in both disabled non-public staging and
    enabled-final fingerprints; a direct request without a bearer is denied.
58. Before a proposed deployment Agent/route write, the route-namespace preflight
    proves a final public route uniquely wins every supported ingress request
    over all Agent, LLM and MCP routes. A staging create proves no public request
    selects its reserved tuple and preserves selection. A staging move may
    withdraw its own expected final route and proves the resulting fallback/no
    match equals evaluation with that source route absent. A tie or winning
    foreign overlap fails with no remote write while the candidate final write
    has not landed. If recovery observes its own final write already landed, the
    same failed proof permits only the guarded write back to staging and route
    containment. Every route writer shares the lease through commit.
59. Platform invocation requires its own exact promoted pair claim and rejects
    provisional, quarantined, missing, mismatched or foreign conflicting claims;
    compatibility alone requires the pair to have no blocking claim at all.
60. Deployment creation first returns a local non-invocable
    `awaiting_key_binding` record and deterministic IDs without Gateway access or
    epoch advance; binding and apply are later separately authorized steps.
61. Initial binding reserves only a route ID proven absent across Agent/LLM/MCP
    families. Every route writer honors the reservation, and a later
    no-Agent/route-write conflict uses the declared binding-cleanup writer to
    reverse/verify the earlier key side effect and return to
    `awaiting_key_binding` before releasing it.
62. Observing an enabled operation-owned route with missing/false
    `require_virtual_key` moves the same route to its disabled non-public staging
    match, verifies closure and records the contained quarantine before an
    ordinary failure may return; unknown closure remains fenced with an incident.
63. A no-write precondition rejection leaves deployment state and invocation
    epoch unchanged; the applying transition occurs only after successful
    preflight and immediate reauthorization, just before the first remote write.
64. Binding-conflict cleanup and quarantine-artifact cleanup are explicit,
    token-guarded members of the exhaustive Virtual Key writer set with Platform
    Admin retry/resolve handlers; they never become unclassified drift writes.
65. Quarantine resolution works for active and `deleting` deployments, revokes
    and verifies route eligibility before journal-proven artifact removal, and
    leaves ambiguous or failed cleanup fenced.
66. A provisional route uses a non-public staging match, not the final ingress
    prefix. Disabled staging, take-offline and route containment cannot black-
    hole a shorter live route; tests prove existing traffic still selects it.
67. Activation writes a sequence-bound pre-final containment guard before
    exposing the final match. Startup recovery resumes an expected staging
    fingerprint and atomically retires the guard only when current phase-
    appropriate authority, bound-key eligibility, the exact protected final pair
    and repeated any-key allow-all and unique-winner proofs all verify. An
    enabled final match with lost authority, an ineligible bound key,
    missing/false `require_virtual_key` or either failed repeated safety proof
    enters containment and is withdrawn to staging before the operation can
    remain uncommitted. Dangerous closure reaches only
    `route_quarantined_contained` or `route_containment_failed`; the latter is
    retryable only through the explicit Platform Admin route-containment handler.
68. Rollback first moves the existing claimed route to its operation-unique
    non-public staging match, updates the Agent and restores the same route in
    place. It never disables the final match, so a shorter live ancestor keeps
    serving throughout pauses and crashes.
69. Take-offline retains the same claimed route ID at its staging fingerprint.
    Online/rollback restores that object in place and a missing claimed route is
    fenced rather than recreated. Only the explicit quarantine-artifact resolver
    that atomically creates the same operation's provisional retry authority, or
    remove-only decommission, may delete it.
70. Route preflight distinguishes a final-public unique-winner proof from a
    non-public staging non-selection proof. The move form explicitly permits
    withdrawal of its own exact final winner to the same fallback/no-match result
    as removing that source route. Initial staging, rollback, take-offline and
    containment therefore remain legal with or without a shorter live ancestor.
71. The durable key-writer operation kind selects the finalizer. Ordinary
    lifecycle/binding mutations and `quarantine_artifact_cleanup` against an
    ordinary key state may complete to `stable`/`reconciliation_required`, with
    reconciliation preserving the cleanup operation's postcondition and outer
    fence. Binding-conflict/zero-write-abandon failure remains only
    `binding_conflict_cleanup_failed`, while decommission failure remains only
    `deleting/cleanup_failed`; their own retry tokens are the sole exits.
    containment, recovery/reconciliation and containment-aware cleanup tokens
    reach only their dedicated terminals or cleanup receipt and are rejected by
    the ordinary finalizer.
72. Binding DELETE is prepublication-only and proves both deterministic remote
    IDs absent. Any pair claim or journaled write rejects unbind and cancel until
    explicit quarantine/decommission lifecycle cleanup has verified removal.
73. A verified take-offline pair is operation-stable but non-invocable. Online
    starts only from its exact promoted Agent/staging-route fingerprints and
    makes Test eligible only after the same route is restored in place and the
    final pair verifies; missing/mismatched objects are never recreated.
74. Rollback journals separate staged-before-Agent-update and
    Agent-updated-before-activation phases for both active and offline starts.
    Recovery resumes the exact phase, verifies the target Agent before restoring
    final ingress and never exposes the previous Agent.
75. Quarantine-artifact cleanup of an ordinary shared key has an accepted
    safety-revocation finalizer: verified narrowing returns the key to `stable`
    with unrelated routes preserved, unknown closure requires reconciliation,
    and containment-state keys use only the containment-cleanup receipt.
76. Take-offline and online persist `take_offline_pending_stage` or
    `online_pending_activation` before their route write. Recovery completes the
    recorded lifecycle goal before-write or after-write/before-commit only when
    its current safety proofs still pass. A failed protection, authority, key,
    allow-all or unique-winner proof after the final write invokes the recorded
    remove-only containment override instead; that route-containment terminal is
    not an inferred opposite lifecycle or a generic quarantine.
77. Active rollback persists `rollback_pending_stage` before its staging write.
    Recovery performs the pending move or verifies its already-applied result,
    then advances to the Agent-update phase; a crash between Gateway acceptance
    and the phase commit cannot lose the rollback goal.
78. Take-offline requires authority, the exact promoted pair and a safe staging
    proof, but not an eligible bound key. Disabled, expired, quarantined and
    `containment_failed` keys cannot prevent withdrawal of final ingress, and a
    direct bearer call fails after the verified move.
79. `quarantine_artifact_cleanup` never finalizes the last explicit route as an
    enabled empty allowlist. It atomically writes, or disable-verifies before
    writing, normalized `{disabled:true, allowed_route_ids:[]}` (including an
    omitted read field decoded as empty); direct bearer access to an unrelated
    route fails and no stable allow-all fingerprint is observable.
80. Online is covered by route containment. Every online final-match write has a
    sequence-bound pre-final guard with both normal resume/retirement branches,
    while live verification and crash recovery contain an absent/false
    `auth_policy.require_virtual_key` result before online can commit or a no-
    bearer request can succeed.
81. Active quarantine resolution retains the selected binding as
    `awaiting_key_restore`. Tenant retry remains denied while Platform Admin PUT
    restores only that operation's derived route ID under its provisional fence;
    separate enable and exact eligibility verification are required before only
    that operation becomes retry-ready.
82. Agent inventory field isolation has no live-context exception. A no-grant
    member who owns an active invocation context still receives only the
    membership-visible definition/draft/release facts and no deployment health
    or activity fields.
83. Online performs the same complete key preflight as publication, retry and
    rollback before entering its write-ahead phase. An ineligible bound key or
    any other enabled/unexpired allow-all key leaves the offline staging route
    unchanged and final ingress unmatched.
84. Overview, Calls and Usage apply only the deployment-read predicate. A
    no-grant member with a live invocation context receives no rows there; only
    the separate Agent-scoped session/run endpoint may return that Principal's
    minimal context metadata.
85. A containment-aware quarantine cleanup receipt never unlocks key restore.
    It records `key_restore_blocked_by_containment`; binding PUT and ordinary
    enable reject until dedicated containment reconciliation verifies a safe
    stable policy excluding the absent route and resolves the incident. If that
    was the final explicit route, the verified result is disabled with an empty
    list and a direct bearer call to any unrelated route still fails; only then
    does restore continue under the retained provisional pair fence.
86. A no-grant Principal's own live-context pending-permission entry appears in
    Workbench only, not Tenant or Agent Overview. Overview permission rows remain
    deployment observations and require `tenant_gateway:manage`.
87. A zero-write initial-apply reservation can be abandoned only by the Platform
    Admin binding-abandon handler. It reverses and verifies the derived key
    allowlist entry through the declared cleanup token before releasing any
    binding/fence; unknown cleanup remains retryably fenced.
88. Retry activation and rollback from offline, like initial activation and
    online, re-run both the complete any-key allow-all scan and final-route
    unique-winner proof immediately before the public-final write. Recovery does
    the same after reacquiring the lease. If it still observes expected staging,
    a failed proof leaves staging unchanged with no Gateway write; if it observes
    the already-final route, a failed proof follows criterion 89's containment
    branch and writes that route back to staging before returning.
89. A pre-final containment guard has a normal completion path. Before-write
    crash recovery resumes online/retry/rollback from the exact staging phase;
    after-write recovery retires the guard in the same stable/promotion commit
    only when current phase-appropriate authority, bound-key eligibility, the
    protected final pair and both repeated public-ingress safety proofs verify.
    Lost authority, an ineligible bound key, missing/false protection or a
    failed allow-all/unique-winner proof withdraws the already-final route to
    staging and enters containment; a second restart cannot quarantine a
    committed success.
90. Containment reconciliation never restores an enabled empty allowlist. A
    final-entry cleanup verifies `{disabled:true, allowed_route_ids:[]}`, a
    direct bearer call to an unrelated route fails, and only a later binding PUT
    may add the deployment route back.
91. Initial publish, retry, online and rollback all run the any-key enabled,
    unexpired allow-all scan while holding the key-policy lease before changing
    lifecycle state or public ingress. The online path cannot bypass the scan
    merely because it restores rather than creates a route.
92. An ordinary key write that ends in `reconciliation_required` can leave that
    state only through the tokened Platform Admin ordinary-reconciliation
    handler. Exact adoption, desired-policy retry and safe-disable outcomes are
    verified; an unknown result stays fenced and no path returns a bearer.
93. Binding zero-write abandon is a member of the exhaustive Virtual Key writer
    set and its token is covered by writer-continuity tests; every undeclared
    path remains denied before a Gateway write.
94. Ordinary reconciliation cannot adopt or retry-commit an enabled empty
    allowlist. It first obtains and verifies a disable, while an unverifiable
    result remains `reconciliation_required`; direct bearer calls cannot gain
    Gateway-wide authority through recovery.
95. Every public-final write, including online and crash recovery after
    `online_pending_activation`, repeats the any-key allow-all scan immediately
    beforehand under the key-policy lease. A pre-write failure leaves staging
    and the pending lifecycle fenced without a final-route write; if recovery
    instead observes that the earlier write landed, criterion 98 withdraws it
    through containment before returning.
96. Binding-conflict cleanup requires no eligible key and has no public-ingress
    write authority. The stable/enabled/unexpired/explicit-route requirement
    applies only to the publish/retry/online/rollback branch that creates or
    restores public ingress.
97. Binding-conflict cleanup/zero-write abandon and decommission cleanup use
    dedicated failure finalizers. Unknown results retain their respective
    `binding_conflict_cleanup_failed` or `deleting/cleanup_failed` fences and
    only the matching retry token may resume; ordinary reconciliation cannot
    adopt the live policy or release those fences.
98. If recovery finds the operation-owned route already at protected final but
    current authority, bound-key eligibility, the repeated any-key allow-all
    scan or unique-winner proof fails, it moves that route to non-public staging
    and verifies it is no longer selected before recording route containment.
    It cannot leave a public uncommitted route.
99. No-write admission failures are scoped to the expected pre-write
    fingerprint. Once the journal proves a public-final write landed, failed
    authority, binding/key, allow-all or route-selection proof blocks promotion
    but cannot block the internal remove-only containment write.
100. An enabled allow-all key or winning/tied foreign route discovered before a
     final write leaves staging unchanged; the same discovery after that final
     write forces guarded withdrawal to staging and a containment terminal.
101. A recorded online/rollback lifecycle goal completes only while its current
     safety proofs pass. Post-write safety failure does not infer another normal
     lifecycle; it follows the phase-bound containment override and remains
     non-invocable.
102. Route containment does not require the bound key to remain eligible. A
     disabled, expired, quarantined or otherwise ineligible key discovered after
     the final write cannot prevent withdrawal; recovery records a containment
     terminal and proves the operation-owned route is no longer selected.
