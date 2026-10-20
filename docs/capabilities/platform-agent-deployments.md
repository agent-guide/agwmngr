# Platform Agent deployments

- Document type: **normative**
- Status: **Steps 6A–6C deployment, scoped Access and invocation APIs implemented**
- Applies to: `rebuild/agent-resource-platform` deployment-intent APIs
- Last reviewed: 2026-10-21

## Implemented boundary

Platform schema version 13 adds Tenant-owned deployment intents, durable
operation journals, pair fences, per-Gateway lease records, deployment-key
bindings, route-ID reservations, manager-owned Virtual Key policy state and
expiring invocation contexts. Step 6A exposes the local allocation boundary,
Step 6B adds verified lifecycle operations over the server-only Gateway adapter,
and Step 6C supplies the binding and invocation boundary needed to use a
verified deployment without disclosing its bearer. Deployment observations and
runtime administration remain unavailable until their later Step 6 slices land.

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
| `GET` | `/api/platform/v1/gateways/{gateway_id}/deployment-key-bindings` | Platform Admin binding state and eligible deployment candidates |
| `PUT/DELETE` | `/api/platform/v1/gateways/{gateway_id}/deployment-key-bindings/{deployment_id}` | Bind or safely unbind the deployment's derived route ID |
| `POST` | `/api/platform/v1/gateways/{gateway_id}/deployment-key-bindings/{deployment_id}/abandon` | Safely abandon a zero-write provisional binding |

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

## Deferred to the remaining Step 6 slices

The Gateway adapter is server-only and exposes narrow Agent, Agent-route and
Virtual-Key policy operations. Steps 6D–6E own scoped observations, runtime
actions, subject-wide remove-only decommission/startup recovery, the remaining
specialized reconciliation paths and compatibility cutover. The final Step 6
gate therefore does not pass yet.
