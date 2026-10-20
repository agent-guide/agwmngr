# Platform Agent deployments

- Document type: **normative**
- Status: **Steps 6A–6B lifecycle API implemented; Access and invocation pending**
- Applies to: `rebuild/agent-resource-platform` deployment-intent APIs
- Last reviewed: 2026-10-21

## Implemented boundary

Platform schema version 12 adds Tenant-owned deployment intents, durable
operation journals, pair fences, per-Gateway lease records, deployment-key
bindings and route-ID reservations. Step 6A exposes the local allocation
boundary. Step 6B adds verified lifecycle operations over the server-only
Gateway adapter. Key-binding administration, invocation and observations remain
unavailable until their later Step 6 slices land.

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

## Deferred to the remaining Step 6 slices

The Gateway adapter is server-only and exposes narrow Agent, Agent-route and
Virtual-Key policy operations. Step 6C owns Platform Admin key binding and
server-managed invocation. Steps 6D–6E own scoped observations, runtime actions,
subject-wide remove-only decommission recovery and compatibility cutover. The
6B lifecycle is intentionally unreachable through normal setup until the 6C
binding handler can establish its verified non-secret key reservation.
