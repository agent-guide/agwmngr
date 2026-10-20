# Agent Resource Platform Design

- Document type: **normative**
- Status: **accepted target; Steps 0–5 implemented, deployment pending**
- Applies to: `rebuild/agent-resource-platform`
- Last reviewed: 2026-10-20

The historical replay started from a release candidate named `v0.2.0`. That tag
was removed and its intermediate release commits were consolidated. As a
one-time history repair, the Step 0–4 implementation series was preserved and
rebased so that the final `main` tag `v0.1.0` is its ancestor. This records the
minimum release baseline from which the feature work evolved; it does not
require the feature branch to remain based exactly at the tag or to replay later
steps onto it. Subsequent steps advance from the current feature-branch head and
may synchronize with `dev` through the normal integration workflow.

This document defines the product and service boundaries for rebuilding the
Agent resource platform in `agwmngr`. It deliberately describes the target, not
the completed `v0.1.0` release baseline. The ordered migration and proof required for
each step live in
[the integration plan](../plans/active/agent-resource-platform-integration-plan.md).

The Bun runtime and shared contract/service boundaries described in Step 1,
the Principal/Tenant/membership/grant foundation in Step 2, the canonical
scope shell plus delivered administration pages in Step 3, all Step 4 resource
slices, and Step 5 Agent definitions and immutable releases are implemented on
the rebuild branch. Deployment remains pending; a completed release alone does
not create a Gateway Agent, route, key or executable endpoint.

## 1. Objective

`agwmngr` becomes the single management plane for creating, releasing, deploying,
operating and observing Agents. Agent Gateway remains a separate execution and
governance service.

The primary journey is:

```text
Tenant resources -> Agent draft -> immutable release -> Gateway deployment
                 -> endpoint + Virtual Key -> invocation -> observation
```

The Agent is the primary product object. Models, tools, Skills, instructions,
knowledge, files, credentials and Gateways support that lifecycle without
becoming competing product roots.

## 2. Locked implementation direction

- Platform server code and workers are Bun + TypeScript in this repository.
- Existing Next.js Route Handlers remain thin HTTP adapters over reusable domain
  services and repositories.
- `experts-backend` v2 supplies selected contracts, invariants and acceptance
  scenarios. FastAPI and Python services are not a target runtime.
- `experts-frontend` `feature/runtime-admin` supplies selected interaction and
  information-design references. Its proxy layer and product shell are not
  imported.
- Agent Gateway remains independently deployed. Its configuration store is not
  the platform business-resource database.
- Workflow engines are external callers. They invoke published Agents through
  Gateway endpoints and Virtual Keys; engine design, scheduling, adapters and
  workers are outside this platform.

Source selection is normative only through
[the source inventory](../plans/active/agent-resource-platform-source-inventory.md).

## 3. Bounded contexts and owners

| Context | Authoritative owner | Notes |
| --- | --- | --- |
| Human login and manager sessions | agwmngr manager store | Preserve existing users/session behavior during migration |
| Tenants and Tenant memberships | platform domain | Roles are Tenant Admin or Tenant User |
| Agent drafts and releases | platform domain | Tenant-owned; releases are immutable |
| Authored resources and revisions | platform domain | Tenant-owned or explicitly platform-shared |
| Personal files and conversations | platform domain | Tenant plus human owner; not inherited by Tenant Admin |
| Gateway registry and encrypted connection secrets | platform infrastructure | Platform Admin only |
| Agent deployments | platform domain | Maps one release to one explicit Gateway target |
| Gateway Agents, routes and runtime state | Agent Gateway | Applied and observed through a narrow adapter |
| Providers, upstream credentials and shared Gateway config | Agent Gateway | Platform infrastructure; secrets remain redacted |
| Direct invocation | Agent Gateway data plane | Authorized by route policy and Virtual Key |
| Workflow graph, schedule and engine state | external system | Never copied into platform authority |

There must be one mutable writer for every record family. A platform deployment
record may project Gateway state, but it must not pretend to own the Gateway's
runtime record. Conversely, a Gateway Agent does not acquire a Tenant owner or
release history by inference.

## 4. Agent lifecycle

The authoring and execution identities are separate:

```text
AgentDefinition (mutable Tenant draft)
  -> AgentRelease (immutable configuration + dependency snapshot)
    -> AgentDeployment (release + Gateway target + mapping + operation history)
      -> Gateway Agent + AgentRoute (observed execution state)
```

Required invariants:

1. Saving a draft never deploys it.
2. Creating a release freezes the Agent configuration and exact supported
   dependency revisions or digests.
3. Deploying requires a Tenant Admin with `tenant_gateway:manage` for the same
   Tenant and Gateway.
4. A deployment stores the target Gateway, Gateway Agent ID, route mapping,
   desired hash, applied release, operation state and verification result.
5. A multi-object Gateway apply is treated as non-atomic. Partial failure is
   durable, visible and retryable with an idempotency key.
6. Rollback reapplies a recorded release and verifies observed Gateway state.
7. Existing Gateway-only Agents remain valid operational inventory but are not
   silently adopted as platform definitions. Their identity is always the
   `(gateway_id, agent_id)` pair. List/get/create/update/delete, redacted
   session/run metadata, diagnostics and capability-gated Test, permission and
   run-cancellation controls use a separate Platform Admin-only compatibility
   service that fails closed if any blocking deployment pair fence names that
   exact pair: an operation-bound provisional reservation, a promoted live or
   deletion-retained claim, or a quarantined collision. Inventory and route lists
   remove claimed entries before computing totals or pagination; they never
   regain general proxy authority.
8. The deployment service is the only writer for a platform-managed Gateway
   Agent and its ingress route. Every materialized platform route has
   `auth_policy.require_virtual_key=true`; that field is part of both the
   disabled non-public staging and final route fingerprints, and verification can
   never promote or return a deployment to `stable` when it is false or absent.
   If an operation observes its journal-proven route enabled with the field
   false/absent, it synchronously moves the same route to the non-public staging
   match with `disabled=true`, verifies final-ingress closure, and records
   `route_quarantined_contained` plus the blocking pair quarantine before
   returning a contained failure. The lifecycle operation never deletes the
   claimed route. This applies to initial activation, retry, online and rollback.
   Unknown
   closure remains `route_containment_failed`, fenced and incident-visible; it
   is never reported contained or successful. Every final-match mutation writes
   a sequence-bound pre-final containment guard before the Gateway write,
   including online activation. The guard records the lifecycle phase plus the
   expected safe staging and desired protected-final fingerprints. Recovery
   branches under the reacquired leases: expected staging resumes the recorded
   lifecycle after reauthorization, a complete any-key allow-all scan, bound-key
   eligibility and unique-winner preflight; an exact final fingerprint verifies
   the pair and atomically retires the guard in the same promotion/stable commit
   only while phase-appropriate reauthorization and bound-key eligibility still
   pass, `require_virtual_key=true`, and repeated any-key allow-all and unique-
   winner proofs pass; and an enabled final-match observation that loses
   authority or bound-key eligibility, has false/absent protection, or fails
   either repeated public-ingress safety proof adopts the guard into containment,
   moves the same route back to non-public staging and verifies that the claimed
   route is no longer publicly selected. Live success retires the guard in the
   same way. A dangerous observation
   reaches only verified `route_quarantined_contained` or
   `route_containment_failed`; other mismatches proceed to pair quarantine only
   after this classification. An explicit Platform Admin retry handler owns the
   latter terminal.
   Raw bundles reject Agent, Agent-route and Virtual
   Key records, and a global Agent-route write is available only through the
   Gateway-only compatibility service. Tenant or Gateway deletion cannot finish
   until a remove-only decommission operation has revoked route eligibility and
   verified removal of every promoted object plus every journal-proven object
   behind a provisional or quarantined fence. Partial-apply fences and journals
   survive until that verification and final tombstone; failed cleanup leaves
   the subject in a durable `deleting` state with all such pairs fenced.
9. Under the required leases, every deployment operation first completes its
   operation-specific no-write preconditions—current authority, immutable
   release/source where applicable, route namespace and expected object/journal
   state—while the prior deployment state/epoch remains unchanged. Publish,
   online, retry and rollback also require a live eligible binding/key.
   Take-offline deliberately does not: an authorized exact promoted final pair
   may be withdrawn to safe staging even when its bound key is disabled,
   expired, quarantined or `containment_failed`. While the operation observes
   its expected pre-write fingerprint, a rejection performs no Gateway write
   and no deployment state/epoch transition. If recovery instead observes that
   the public-final write already landed, the pre-final guard classifies safety
   first: a failed authority, key, allow-all or unique-winner proof blocks
   promotion but permits only the internal remove-only write back to staging and
   a route-containment terminal. After successful
   preflight it reauthorizes, then immediately before the first remote write
   atomically marks the deployment non-invocable, advances its invocation epoch
   and persists the operation kind, sequence, source/desired fingerprints and
   first write-ahead phase. Recovery follows that durable goal rather than
   inferring intent from the observed route. Context creation,
   turns and resumes require `operation_state=stable` plus an invocable lifecycle
   state. Only successful remote verification may restore a stable operation
   state and advance the epoch again; partial failure or worker crash remains
   non-invocable, so neither an old nor an apply-window context can forward
   against partially changed objects.
10. Gateway-only compatibility Agent/route mutations and ordinary manager-owned
    Virtual Key lifecycle/binding policy mutations use the same
    `stable -> mutating -> stable` or `reconciliation_required` barrier. Only a
    tokened Platform Admin ordinary-reconciliation handler may leave
    `reconciliation_required`: under the same lease it advances the epoch,
    re-reads the live policy and either adopts an exactly verified live policy
    that is not enabled with an empty allowlist, or writes and verifies the
    recorded desired policy subject to the same rule or a safe disable. An
    enabled-empty live document is never adoptable: the handler must first
    disable and verify it. Adoption must also satisfy the originating writer's
    durable operation-specific postcondition; reconciliation never releases an
    outer deployment fence or completes another operation. An unknown result remains fenced in
    `reconciliation_required`, no old
    context survives, and the handler never returns a bearer. Each
    key writer selects its finalizer by durable operation kind before mutation;
    binding-conflict cleanup (including zero-write abandon) and decommission
    cleanup have dedicated finalizers and cannot enter ordinary reconciliation.
    Binding cleanup reaches success only after the derived route is verified
    excluded or safely final-entry-disabled and both remote IDs satisfy its
    no-write proof; otherwise it remains
    `binding_conflict_cleanup_failed` for only its retry token, with every fence
    retained. Decommission cleanup reaches its receipt only after verified key
    revocation and object absence; an unknown/failed key edit remains
    `deleting/cleanup_failed` for only the decommission retry token. Neither
    cleanup failure may become `stable` or `reconciliation_required` through the
    generic finalizer. Containment, containment recovery/reconciliation and
    containment-aware cleanup tokens likewise cannot enter the ordinary
    finalizer. Ordinary-state quarantine-artifact safety revocation may use the
    generic key-state finalizer, but its reconciliation postcondition still
    requires the quarantined route excluded or the key safely disabled and its
    outer fence remains until resolver completion. Test context creation/use requires
    `stable`; expected manager writes are not classified as external drift.
    An ordinary-state safety-revocation finalizer may never commit an enabled
    empty allowlist. If removal consumes the last explicit route, it first
    obtains and verifies normalized `{disabled:true, allowed_route_ids:[]}`;
    shared-list
    narrowing preserves unrelated routes and the prior `disabled` value.
    Both platform-scoped and Gateway-only compatibility invocation acquire the
    per-Gateway key-policy lease before their final authorization decision. With
    that lease held they reload every captured Principal, Tenant, membership,
    deployment or compatibility-pair, Gateway and selected-key authority epoch,
    lifecycle/fence state, manager operation state, expected/observed
    fingerprint and live Gateway policy. They retain the lease through
    eligibility, bearer resolution and outbound forward acceptance. Every
    lifecycle or compatibility mutation capable of changing one of those
    dependencies also takes the same key-policy lease after the object lease,
    even if it does not edit the key. Any mismatch denies without forwarding. A
    stable-state key mismatch enters a distinct
    `containment_in_progress` transition under that lease. Verified disable
    finishes in `quarantined_contained`; failed or unknown disable finishes in
    `containment_failed`. Normal mutation completion cannot overwrite either
    containment terminal state. A crash-safe containment recovery token may
    adopt stale `containment_in_progress` or `containment_reconciling`, repeat the
    disable idempotently and finish in a terminal state. A dedicated Platform
    Admin reconciliation token is the only eligibility-restoring exit from a
    terminal: it must first obtain a verified live disable and may restore
    `stable` only after an explicit reviewed policy rewrite, exact verification
    and incident resolution. A stable empty allowlist remains disabled; an
    enabled restored policy must have a non-empty explicit allowlist, so
    reconciliation of a removed final entry cannot create Gateway allow-all.
    A separate decommission cleanup token may verify
    disable/remove a retiring route and record a cleanup receipt, but the stable
    finalizer rejects it and it can never restore eligibility. Failed
    containment is a visible security incident and keeps every affected
    deployment non-invocable.
11. For an initial deployment, a durable pair claim is promoted only after an
    exclusive per-Gateway reservation has verified that the server-derived Agent
    and route IDs were absent and both operation-owned objects reached their
    final desired fingerprints and relationship. The per-object journal records
    the final enabled-route fingerprint—including
    `auth_policy.require_virtual_key=true`—plus an allowed disabled non-public
    staging-route intermediate whose operation-unique reserved match cannot
    select any supported public ingress request or displace an existing route.
    A crash after staging creation keeps the reservation
    provisional; retry activates that same route in place, while a crash after
    activation may verify the final fingerprint and promote. Recovery reconciles
    the Agent/route pair as one unit: a matching proper subset remains
    provisional and retryable, and retry creates only its absent object under
    the same operation; it never promotes a one-object or staging-route claim.
    Rollback accepts either the active final fingerprint or the promoted offline
    staging fingerprint. Before an active route move it records
    `rollback_pending_stage` with the expected final and desired staging
    fingerprints plus target release; recovery either performs that move or
    verifies its already-applied result. From offline it verifies and retains
    the same staging object. Its journal then records
    `rollback_staged_awaiting_agent_update` with the target release,
    updates/verifies the Agent, records
    `rollback_agent_updated_awaiting_activation`, and only then restores final
    match+`disabled=false`. Recovery resumes the recorded phase and never exposes
    the previous Agent through the final route. Rollback never disables on the
    final match or applies the initial-absence rule. Take-offline retains the same claimed
    route ID at that staging fingerprint and commits a stable but non-invocable
    offline lifecycle. Before the staging move, take-offline records
    `take_offline_pending_stage`; recovery completes or verifies the move and
    can finish only in the non-invocable offline lifecycle. A separate online
    operation starts only from that exact promoted offline Agent/staging-route
    pair, reauthorizes and proves the complete any-key allow-all gate, bound-key
    eligibility plus final-route unique selection, marks the deployment
    applying and records `online_pending_activation` before its route write,
    then moves the same route in place to final match+`disabled=false` and
    commits an invocable stable lifecycle only after final-pair verification.
    Recovery completes/verifies that activation and cannot quarantine the
    expected staging fingerprint merely because the write had not started.
    Ordinary lifecycle transitions never
    remove it; only the explicit quarantine-artifact resolver, which first
    converts the contained quarantine to the same operation's provisional
    retry authority, or remove-only decommission may delete it. A later
    authorized online/rollback transition therefore never recreates a missing
    claimed route. Only a verified final pair is promoted or enters invocable
    `stable`; the verified offline staging pair may be operation-stable only with
    its lifecycle non-invocable.
    A collision is never adopted or overwritten. If an initial binding already
    added the reserved route ID to a key, a verified no-Agent/route-write
    conflict uses the declared `binding_conflict_cleanup` key-writer token to
    remove/verify that entry (or disable a final-entry key), then releases the
    binding and reservations and returns the intent to `awaiting_key_binding`.
    Failed/unknown cleanup retains them in a retryable fenced incident. The same object lease
    spans every deploy/retry/rollback/take-offline/online/recovery/decommission remote
    mutation through verification and authoritative state commit, and is shared
    with compatibility writers. A mismatched recovery converts the provisional
    reservation into a durable blocking quarantine fence; compatibility remains
    denied until an explicit resolver verifies the operation wrote nothing and
    safely clears or otherwise resolves the collision. A durable per-object
    journal records verified pre-write absence and the operation's write attempt.
    Under the same object/key leases, a remove-only resolver may revoke route
    eligibility and delete only artifacts whose operation ownership that journal
    proves, then verify absence. For an otherwise active deployment it atomically
    converts the quarantine back into the same operation's provisional
    reservation and marks `partial_failure`, so only that operation can retry and
    compatibility remains denied. During decommission it instead retains the
    cleanup fence until final tombstone. Ambiguous provenance stays quarantined;
    retry and compatibility cannot edit it.
    For active cleanup, the deployment-specific binding remains recorded as
    `awaiting_key_restore`. If cleanup used a containment-aware token, the
    binding also records `key_restore_blocked_by_containment`: binding PUT and
    ordinary enable reject until the dedicated Platform Admin containment-
    reconciliation operation verifies a safe stable policy excluding the absent
    route and resolves the incident. Only its receipt clears that blocker; the
    cleanup receipt cannot. The Platform Admin binding PUT may then re-add only that
    server-derived route ID after proving the exact resolver-created provisional
    reservation and remote Agent/route absence, without releasing the fence or
    exposing/enabling the key. After a separate enable when needed and exact
    eligibility verification, only that operation may retry publication.
12. The pinned Gateway Virtual Key wire field is `disabled`; this design's
    shorthand “enabled” always means `disabled=false`, and every desired/observed
    fingerprint serializes/verifies `disabled` rather than inventing an
    `enabled` field. Gateway omits `allowed_route_ids` on reads when the list is
    empty, so verification normalizes an absent field and `[]` to the same empty
    list before comparing fingerprints; it never requires the omitted field to
    be physically present. An enabled Virtual Key with an empty `allowed_route_ids` list is Gateway
    allow-all, never a platform deployment key. It blocks every public-ingress
    activation—initial publish, retry, online and rollback—while a platform-
    managed route may exist. Platform Admin configures a non-secret
    deployment-specific binding to a manager-controlled key. The Platform Admin
    binding handler derives and adds/removes the route ID through the normal
    key-policy barrier. Add and non-final removal preserve the key's
    `disabled` value.
    Removing a binding may never persist an enabled empty allowlist. If the
    derived route is the final entry, the handler first writes/verifies
    `disabled=true` and removes the entry only while disabled (or performs an
    equivalent verified atomic `{disabled:true, allowed_route_ids:[]}` update),
    and finalizes the unbind only after observing that normalized safe Gateway
    fingerprint. Failure retains the binding and either the prior policy or a
    verified `disabled=true` state. An `enabled=false` payload is forbidden
    because Gateway does not define that field.
    Binding DELETE is a prepublication cancel only: it requires that the
    deployment has never promoted or journaled an Agent/route write and proves
    both deterministic remote IDs absent. Once any pair claim or journaled
    object exists, DELETE returns a conflict and cannot regress the deployment
    to `awaiting_key_binding`; only the explicit quarantine/decommission
    lifecycle may remove those objects and release their claim.
    A disabled empty key is permitted as bootstrap, but remains disabled after
    binding until a separate explicit Platform Admin enable. The
    publish/retry/online/rollback route-mutation branches only read the verified
    binding and never enable or otherwise mutate the key. Before creating or
    restoring public ingress, each such branch requires the key already stable,
    enabled, unexpired and explicitly allowing the derived route; the first
    publish is therefore satisfiable without exposing a bearer, while an
    administrative disable remains in force across retry and rollback.
    A preflight conflict instead exits that route-mutation path and delegates
    only the narrowly authorized reversal of the earlier binding side effect to
    `binding_conflict_cleanup`; cleanup does not require an eligible key and
    never creates or restores public ingress.
    Explicit lifecycle/binding, ordinary-reconciliation,
    binding-conflict-cleanup retry, binding zero-write abandon,
    containment-reconciliation and quarantine-artifact-cleanup handlers plus
    internal binding-conflict cleanup, drift containment, containment recovery
    and decommission cleanup are the complete supported Virtual Key writer set;
    every one uses the same lease, journal and operation-token guard.
    Decommission enumerates every Gateway key, including legacy/unmanaged
    records. Ordinary states use the normal barrier; containment states use
    their recovery/cleanup tokens. Cleanup disables an already-empty allow-all
    key and disables a key rather than producing an empty allow-all list when
    its final route is removed. Every initial publish, retry, online and rollback
    holds that key-policy lease from preflight through verified route activation
    and durable recording. It repeats the any-key allow-all scan immediately
    before every public-final write, including after crash recovery reacquires
    the lease, closing both the initial and recovery insertion windows.
13. Scoped context creation/use and deployment mutation require live `active`
    Tenant and Gateway subjects. An authority epoch captured after either enters
    `deleting` does not authorize new or continued invocation while cleanup is
    pending or failed.
14. Every Gateway route writer shares the per-Gateway route/object lease and,
    before any Agent or route write, evaluates the intended route mutation
    against a complete, paginated snapshot of Agent, LLM and MCP routes using
    the Gateway's effective host, path-prefix and method match/score semantics.
    A final public route must be the unique selected route for every concrete
    ingress request supported by the materialized Agent. An equal-score tie or
    a foreign ancestor/descendant prefix that wins any such request is a stable
    conflict with no remote write while the proposed final write has not landed.
    If recovery observes its operation-owned route already at final, the same
    failed proof authorizes only the guarded staging withdrawal and containment.
    A non-public staging write is deliberately
    exempt from that winner requirement: under the same snapshot and lease it
    instead proves that no supported public request can select the reserved
    staging tuple. A staging create preserves public selection. A staging move
    may withdraw only its own exact expected final route; after excluding that
    source route, the selected unrelated route—or no match—must equal the result
    of evaluating the inventory with the source route absent. Thus the sole
    allowed selection change is the intended withdrawal to an existing fallback
    or no match. Containment is never rejected merely because that withdrawal
    makes an ancestor win or leaves no match. Every public-final write or restore
    (initial activation, retry activation, online, either rollback path and
    crash recovery) re-runs both the complete any-key allow-all scan and the
    final-route unique-winner proof immediately
    before that write under the reacquired/retained lease; a prior staging proof
    is never a substitute. Retry/rollback may match only their own journaled route ID and
    fingerprint. The lease remains held through route
    verification and authoritative state commit, closing the preflight race.
15. Platform invocation does not require the deployment pair to be globally
    unfenced: it requires the exact deployment's expected promoted live claim,
    matching Agent/route relationship and captured claim epoch/fingerprint.
    A provisional or quarantined claim, a missing/mismatched own claim, or a
    conflicting claim from another operation denies. The global no-blocking-
    fence predicate remains exclusive to Gateway-only compatibility authority.
16. Deployment allocation precedes publication. A Tenant Admin with matching
    `tenant_gateway:manage` creates a local, non-invocable
    `awaiting_key_binding` record and receives its server-derived deployment,
    Agent and route IDs without any Gateway read/write or apply-epoch advance.
    Platform Admin can then bind and explicitly enable a key for that existing
    deployment. Only a later authorized apply enters the remote state machine.
17. Initial binding takes route/object then key-policy lease, proves the
    deterministic route ID absent across every Gateway route family and records
    a durable prepublication route-ID reservation before allowlisting it. Every
    route writer honors that reservation. If a later no-Agent/route-write create
    conflict discovers an out-of-band foreign object, the declared
    `binding_conflict_cleanup` key writer reverses/verifies the earlier binding
    side effect without entering deployment applying, then returns the intent to
    `awaiting_key_binding`. Unknown cleanup remains retryably fenced and
    incident-visible, never knowingly authorizing the foreign route.
    The same token with `reason=zero_write_abandon` is the only abandon path
    after apply has converted the prepublication reservation to an operation-
    bound provisional pair but both remote IDs still verify absent. A Platform
    Admin handler removes or safely final-entry-disables and verifies the derived
    allowlist entry before releasing the binding/reservations; unknown cleanup
    retains them. Binding DELETE or a raw fence release cannot perform this
    transition.

Product language distinguishes **Create release** from **Deploy**. “Publish” may
remain only as a compatibility API term during migration.

## 5. Resource model

Resources are classified by authority, not by navigation placement.

### 5.1 Tenant-authored resources

Tenant Admins and Tenant Users may author resources in an active Tenant:

- Agent definitions and releases;
- Skills and immutable Skill revisions;
- instructions and immutable revisions;
- knowledge-base and document metadata;
- Tenant-owned model/tool definitions that reference approved infrastructure;
  and
- other resource types added through an explicit ownership contract.

Every Tenant resource carries `tenant_id`; repository queries and mutation
guards include it. A Tenant resource may reference a platform-shared offering,
but that reference does not grant permission to edit the shared record or reveal
its credential.

### 5.2 Personal resources

Personal files and conversations carry both `tenant_id` and `owner_principal_id`.
In the accepted slices the owner must be a human Principal. Tenant Admin does
not automatically grant access to another person's files or conversation
history, and a service Principal has no personal-file or conversation authority.
Service access requires a separately documented workflow.

### 5.3 Gateway and infrastructure resources

Gateway Agents, routes, Virtual Keys, providers, credentials, Caddy configuration
and raw bundles remain Gateway/infrastructure records. Tenant-authored definitions
are materialized only through scoped deployment services. Ordinary Tenant
Principals never receive the stored Gateway administrator credential or general
catch-all proxy authority.

## 6. Authorization boundaries

The target authority model is defined in
[Tenant Authorization Model](tenant-authorization-design.md). Its core separation
is:

```text
Platform Admin       -> platform identities, Tenants and infrastructure
Tenant membership    -> Tenant authoring and use
tenant_gateway grant -> one Tenant's deployment view/management on one Gateway
Virtual Key          -> Gateway data-plane invocation
service credential   -> platform API identity, never data-plane authority
```

No arrow implies another. In particular:

- Platform Admin alone is not Tenant membership.
- Tenant Admin alone is not Gateway deployment access.
- a Tenant Gateway grant is not general Gateway Admin API access.
- a Virtual Key is not a platform management credential.
- a service credential is not a Virtual Key.

Authorization is enforced in domain services from live identity, membership,
grant and ownership records. UI visibility is only a projection of those checks.

## 7. Runtime and module boundaries

The intended dependency direction is:

```text
contracts <- domain services <- adapters/repositories <- Route Handlers and UI
```

- Contracts contain framework-neutral values and validation.
- Domain services contain authorization decisions and business invariants.
- Repository and Gateway ports describe required effects.
- SQLite/PostgreSQL, object storage and Gateway HTTP clients implement ports.
- Route Handlers authenticate, parse, call one service and map the response.
- Browser clients do not own canonical domain types.

Domain modules must not import React, Next.js requests, browser APIs or Gateway
implementation internals. Gateway calls occur through a narrow adapter that does
not expose stored administrative credentials to callers.

The Web process handles synchronous APIs and streaming test/chat requests.
Durable background work is introduced only with a persisted job contract,
claim/lease recovery, idempotency, cancellation and shutdown drain. An in-memory
promise is not a worker implementation.

## 8. Persistence and storage

- Keep the existing manager identity/session/Gateway registry store stable until
  an explicit migration step changes it.
- Platform repositories must support SQLite for local/test and PostgreSQL for
  shared production use before claiming parity.
- Schema migrations are additive and forward-only during rollout. Identity maps,
  ownership, row counts and references are verified before cutover.
- File and Skill package metadata lives in the database; bytes live behind an
  object-store port.
- Upload completion is explicit and idempotent. Size, path, content type/hash,
  ownership, soft deletion and garbage collection are server enforced.
- Knowledge-base CRUD is not evidence of indexing or retrieval. Those controls
  stay disabled until a real contract and implementation exist.

## 9. Observability and correlation

Gateway traces remain the execution source of truth. Platform records add
Tenant, definition, release, deployment and operation correlation. Correlation is
not authorization and does not promise workflow-level exactly-once behavior.

Tenant-scoped deployment observations use one exact read predicate: a Tenant
Admin must hold live `tenant_gateway:view|manage` for the deployment's owning
Tenant and Gateway. Without that exact grant, every Overview, Calls, Usage,
activity and health response is empty even when the caller owns a live context.
Minimal context status and session/run metadata are available only from the
separate Agent-scoped session/run read. Ownership or membership alone is
insufficient before querying or projecting shared Gateway observations.
Unfiltered Gateway-wide runtime and
metrics views remain Platform Admin infrastructure surfaces.

## 10. Explicit exclusions

The rebuild does not include:

- Agent Teams, Team membership, project/task bindings or source work items;
- external Work Management/workbench connections, identity mapping or webhooks;
- workflow graphs, schedules, engine SDKs, adapters or engine workers;
- subscriptions, plans, pricing, entitlements or commercial marketplace rules;
- legacy Platform User invitation/activation APIs or duplicate identity stores;
- source branding, product content or business-specific workflows; or
- fake settings, retrieval, runtime support or health signals without a backend
  contract.

Generic durable Agent execution may be considered later only after it has an
independent contract with none of the excluded dependency closure.

## 11. Document precedence

For the rebuild:

1. this document owns product and service boundaries;
2. `tenant-authorization-design.md` owns target authority;
3. `dashboard-information-architecture.md` owns navigation and page responsibility;
4. `../plans/active/agent-resource-platform-source-inventory.md` owns source selection; and
5. `../plans/active/agent-resource-platform-integration-plan.md` owns delivery order and gates.

Current `dev` behavior remains authoritative for `dev` until `dev` contains the
corresponding migration step through a merge or another deliberate advance.
Implementation and acceptance on the rebuild branch do not change `dev`
runtime behavior, and no target document alone changes runtime behavior.
