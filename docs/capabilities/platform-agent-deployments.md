# Platform Agent deployments

- Document type: **normative**
- Status: **Steps 6A–6E implemented; real-Gateway release acceptance and Step 7 UI projection passed**
- Applies to: `feature/agent-resource-platform` deployment-intent APIs
- Last reviewed: 2026-10-22

## Implemented boundary

Platform schema version 14 adds Tenant-owned deployment intents, durable
operation journals, pair fences, per-Gateway lease records, deployment-key
bindings, route-ID reservations, manager-owned Virtual Key policy state and
expiring Tenant and Platform Admin compatibility invocation contexts. Step 6A exposes the local allocation boundary,
Step 6B adds verified lifecycle operations over the server-only Gateway adapter,
and Step 6C supplies the binding and invocation boundary needed to use a
verified deployment without disclosing its bearer. Step 6D adds grant-filtered
Tenant observations, redacted operational metadata/runtime actions, Tenant
audit, and path-qualified Platform Admin diagnostics and Gateway-only Agent
compatibility. Step 6E retires user-facing Gateway roles, denies unknown legacy
proxy families before forwarding, and adds recovery, reconciliation and
remove-only decommission workflows.

Step 7 consumes these APIs from the canonical Agent workspace, Access,
Workbench and Tenant Observability pages. It does not add browser authority:
deployment observations remain filtered by the exact read predicate, runtime
actions remain `manage`-only, and membership-scoped Access/Test continues to use
opaque server-managed invocation contexts.

An active Tenant Admin with a live `tenant_gateway:manage` grant may create an
intent for one immutable Agent release and one explicit active Gateway. Platform
Admin status alone and Tenant User membership are insufficient. Allocation:

- validates the release belongs to the path Tenant;
- requires every Gateway-backed model/tool dependency to name the selected
  Gateway and the captured Gateway authority epoch;
- derives the deployment ID, Gateway Agent ID, Gateway Agent-route ID and path
  prefix server-side from the Tenant, release, Gateway and idempotency key;
- materializes a secret-free builtin Agent payload plus protected staging/final
  route fingerprints and stores their desired digest; and
- returns `awaiting_key_binding`, `operation_state=stable` and the initial
  invocation epoch without opening an operation journal, claiming a pair or
  reading/writing the Gateway.

The same Tenant request key is idempotent only for the same release, Gateway and
desired materialization. Reuse for another target fails with a conflict. An
unbound intent may be cancelled; an intent with any binding, reservation,
operation or pair fence is retained for its explicit cleanup lifecycle.

Tenant deployment list/get requires an active Tenant Admin membership plus
`tenant_gateway:view|manage` for each returned deployment's exact
Tenant/Gateway pair. Responses do not expose internal offering source bindings,
upstream stable IDs, administrative credentials or bearer values.

## HTTP API

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/api/platform/v1/tenants/{tenant_id}/deployments` | List only grant-visible deployment intents |
| `POST` | `/api/platform/v1/tenants/{tenant_id}/deployments` | Allocate from `{release_id, gateway_id, request_key}` with zero Gateway calls |
| `GET` | `/api/platform/v1/tenants/{tenant_id}/deployments/{deployment_id}` | Read one deployment after exact grant evaluation |
| `DELETE` | `/api/platform/v1/tenants/{tenant_id}/deployments/{deployment_id}` | Cancel only a never-bound, never-applied intent |
| `GET` | `/api/platform/v1/tenants/{tenant_id}/deployments/{deployment_id}/operations` | Read the durable operation journal with exact-pair view authority |
| `POST` | `/api/platform/v1/tenants/{tenant_id}/deployments/{deployment_id}/apply` | Apply a ready intent using `{request_key}` |
| `POST` | `/api/platform/v1/tenants/{tenant_id}/deployments/{deployment_id}/retry` | Resume a journal-proven partial initial publication |
| `POST` | `/api/platform/v1/tenants/{tenant_id}/deployments/{deployment_id}/take-offline` | Move the claimed route to its disabled non-public staging match |
| `POST` | `/api/platform/v1/tenants/{tenant_id}/deployments/{deployment_id}/online` | Restore a verified offline pair to its protected final match |
| `POST` | `/api/platform/v1/tenants/{tenant_id}/deployments/{deployment_id}/rollback` | Restore a journal-verified release using `{release_id,request_key}` |
| `POST` | `/api/platform/v1/tenants/{tenant_id}/deployments/{deployment_id}/verify` | Compare the claimed Agent/route pair to its journaled desired state |
| `GET` | `/api/platform/v1/tenants/{tenant_id}/endpoints` | Project invocable endpoints and eligible non-secret key references to active Tenant members |
| `POST` | `/api/platform/v1/tenants/{tenant_id}/deployments/{deployment_id}/invocations` | Create an opaque expiring invocation context for an eligible bound key |
| `POST` | `/api/platform/v1/tenants/{tenant_id}/invocations/{context_id}/turn` | Reauthorize the captured context and forward a streaming turn server-side |
| `POST` | `/api/platform/v1/tenants/{tenant_id}/invocations/{context_id}/permission` | Reauthorize the captured context and forward a permission response server-side |
| `GET/POST` | `/api/platform/v1/gateways/{gateway_id}/virtual-keys` | Platform Admin list/create; creation permits only the disabled-empty safe bootstrap or a non-empty allowlist |
| `GET/PUT/DELETE` | `/api/platform/v1/gateways/{gateway_id}/virtual-keys/{key_id}` | Platform Admin path-scoped key lifecycle under the policy barrier |
| `POST` | `/api/platform/v1/gateways/{gateway_id}/virtual-keys/{key_id}/enable` | Explicitly enable a safe non-empty policy |
| `POST` | `/api/platform/v1/gateways/{gateway_id}/virtual-keys/{key_id}/disable` | Explicitly disable a key |
| `POST` | `/api/platform/v1/gateways/{gateway_id}/virtual-keys/{key_id}/reveal` | Audited Platform Admin bearer recovery; never used by Tenant clients |
| `POST` | `/api/platform/v1/gateways/{gateway_id}/virtual-keys/{key_id}/containment/reconcile` | Restore the last reviewed safe policy after verified drift containment |
| `POST` | `/api/platform/v1/gateways/{gateway_id}/virtual-keys/{key_id}/reconcile` | Resolve an ordinary uncertain key write by applying the reviewed desired policy or adopting an exactly verified safe live policy |
| `GET` | `/api/platform/v1/gateways/{gateway_id}/deployment-key-bindings` | Platform Admin binding state and eligible deployment candidates |
| `PUT/DELETE` | `/api/platform/v1/gateways/{gateway_id}/deployment-key-bindings/{deployment_id}` | Bind or safely unbind the deployment's derived route ID |
| `POST` | `/api/platform/v1/gateways/{gateway_id}/deployment-key-bindings/{deployment_id}/abandon` | Safely abandon a zero-write provisional binding |
| `POST` | `/api/platform/v1/gateways/{gateway_id}/deployment-key-bindings/{deployment_id}/cleanup` | Retry journaled key cleanup after an initial Agent/route identity collision |
| `GET/POST` | `/api/platform/v1/gateways/{gateway_id}/deployments/{deployment_id}/decommission` | Inspect or retry remove-only cleanup of one deployment |
| `GET/POST` | `/api/platform/v1/gateways/{gateway_id}/decommission` | Inspect or run remove-only cleanup for every deployment targeting one Gateway |
| `GET/POST` | `/api/platform/v1/tenants/{tenant_id}/decommission` | Inspect or run remove-only cleanup for every deployment owned by one Tenant |
| `POST` | `/api/platform/v1/gateways/{gateway_id}/recovery` | Retry incomplete decommission recovery after startup |
| `POST` | `/api/platform/v1/gateways/{gateway_id}/deployment-route-containment/{operation_id}/retry` | Retry the same fenced route-containment operation token |
| `POST` | `/api/platform/v1/gateways/{gateway_id}/deployment-quarantines/{operation_id}/resolve` | Verify the contained journal-owned artifacts, restore the same operation's provisional authority and resume it; ambiguous provenance remains quarantined |
| `GET` | `/api/platform/v1/tenants/{tenant_id}/observations/{activity\|usage\|interactions\|health}` | Aggregate only deployments visible through the exact Tenant/Gateway view predicate |
| `GET` | `/api/platform/v1/tenants/{tenant_id}/deployments/{deployment_id}/{activity\|usage\|interactions\|health}` | Read one authorized deployment observation |
| `GET` | `/api/platform/v1/tenants/{tenant_id}/deployments/{deployment_id}/operational` | Read redacted session/run/permission metadata with exact view authority |
| `POST` | `/api/platform/v1/tenants/{tenant_id}/deployments/{deployment_id}/permissions/{request_id}` | Resolve after an immediate manage and capability recheck |
| `DELETE` | `/api/platform/v1/tenants/{tenant_id}/deployments/{deployment_id}/runs/{run_id}` | Cancel after an immediate manage and advertised-mode recheck |
| `GET` | `/api/platform/v1/tenants/{tenant_id}/runtime-attention` | Union the caller's minimal live contexts with manage-visible pending work |
| `GET` | `/api/platform/v1/tenants/{tenant_id}/audit` | Tenant Admin-only redacted Tenant audit |
| `GET/DELETE` | `/api/platform/v1/gateways/{gateway_id}/runtime/*` | Platform Admin-only path-scoped runtime diagnostics/recovery |
| `GET/POST/PUT/DELETE` | `/api/platform/v1/gateways/{gateway_id}/agents/*` | Platform Admin Gateway-only Agent compatibility, filtered against deployment pair fences; `GET /agents?include_claimed=true` adds only a minimized reference projection for deployment-owned Agents so attribution can count them without exposing Tenant-authored runtime content or making them mutable |
| `POST` | `/api/platform/v1/gateways/{gateway_id}/agents/{agent_id}/invocations` | Create a Platform Admin Test context for an unfenced compatibility Agent/route and stable manager-controlled key |
| `POST` | `/api/platform/v1/gateways/{gateway_id}/agent-invocations/{context_id}/{turn\|permission}` | Reauthorize and forward a compatibility Test turn/resume without returning the bearer |
| `GET` | `/api/platform/v1/gateways/{gateway_id}/observability/*` | Platform Admin-only read-only Gateway metrics projection |

All mutation endpoints require a live Tenant Admin membership and the exact
`tenant_gateway:manage` grant. Platform Admin status does not imply this
authority. Operations acquire the Gateway object lease before the key-policy
lease, revalidate the immutable release source and current authority, reject an
enabled/unexpired allow-all key, prove that no Agent/LLM/MCP route can win the
new public match, and journal the write-ahead phase before remote mutation.

Initial apply creates the Agent, creates the same claimed route at a disabled
`.staging.invalid` match with Virtual-Key protection, verifies it, then updates
that route in place to the protected final match. Only observed Agent/final-
route equality promotes the provisional pair and returns the deployment to a
stable invocable state. A partial result remains fenced and non-invocable;
`retry` can create only the missing journal-proven object. Offline/online retain
the promoted pair and move the same route between its staging and final
fingerprints. Rollback stages ingress before changing the Agent and restores
the final route only after rechecking key and namespace safety. Reusing an
operation request key returns its original result without another Gateway
write.

If an activation observes an enabled route without
`auth_policy.require_virtual_key=true`, the lifecycle path attempts a remove-
only move back to the non-public staging fingerprint and records either a
contained quarantine or an unresolved containment failure. No lifecycle
failure is reported as successful publication.

## Scoped Access and invocation

Any active member of the owning Tenant, including a Tenant User, may discover
the Tenant's invocable endpoints and create an invocation context. This does not
grant deployment observations or deployment administration and does not require
a `tenant_gateway` grant. Platform Admin status alone is not Tenant membership.

Platform Admin owns the Gateway-qualified Virtual Key lifecycle and non-secret
deployment binding. An enabled key with an empty allowlist is rejected, removal
of a bound route is rejected, and removing a final binding first verifies a
disabled empty policy. The legacy active-Gateway Virtual Key writers fail closed
after a platform reservation, binding or policy record claims that Gateway.

An invocation context contains references and captured authority epochs only.
Every turn or permission request reloads the Principal, Tenant membership,
deployment, Gateway, pair claim, binding and live key policy while holding the
Gateway object/key-policy leases. The bearer is resolved only inside that
server-side critical section and retained through outbound acceptance; it is
never returned to the browser or stored in the context. A live policy fingerprint
mismatch synchronously disables and verifies the key, fences related deployments
and leaves a Platform Admin-reviewed containment reconciliation as the only path
back to eligibility.

## Step 6E cutover and recovery

The legacy catch-all now uses a reviewed Platform Admin allowlist and rejects
unknown families before any Gateway call. Legacy ACP chat endpoints return
`410`; scoped Tenant and compatibility invocation contexts are the only browser
turn/resume paths. Gateway-root membership rows remain only as historical
manager data and no longer authorize Gateway content. Retained Agent/route
compatibility is Platform Admin-only, path-qualified, pair-fenced and backed by
manager epochs; configuration bundles reject Agent, Agent-route, Virtual Key,
LLM-route and MCP-route sections whose shared lease/conflict proof cannot be
preserved by that import path.

The first platform request performs idempotent recovery for interrupted
lifecycle and decommission journals. Before restoring final ingress, recovery
revalidates the Tenant and Gateway authority epochs plus all key/route safety
proofs. A failed pre-write proof at the expected staging fingerprint remains
pending without a final write; an already-final or ambiguous write first records
`route_containment_in_progress`, withdraws to staging and then commits the
contained quarantine. Quarantine resolution retains its origin across rollback
subphases so a crash followed by another failed proof returns to the same
retryable quarantine instead of sticking in `applying`. Tenant/Gateway deletion
is blocked while live deployment records remain; the operator must complete the
explicit subject-wide remove-only workflow. Specialized retry routes retain
their original operation token and authority instead of turning recovery into a
general editing or redeployment API.

The checked-in Step 6 implementation and its release gate are complete.
`bun run smoke:step6-gateway` passed on 2026-10-21 against the exact Agent
Gateway v0.7.0 commit `3d04b7a0207a6d31746a1b196ae9d82097c2087c`.
It covers real create/invoke/observe/rollback, two-Tenant shared-Gateway
isolation, differing grants, revocation before retry, recovery from a partial
remote write, and Virtual-Key/service-credential separation. The delivery plan
records the detailed acceptance evidence; only Step 8 operational acceptance
remains in the initial delivery plan.
