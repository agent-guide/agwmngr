# Platform Agent deployments

- Document type: **normative**
- Status: **Step 6A implemented; remote lifecycle pending**
- Applies to: `rebuild/agent-resource-platform` deployment-intent APIs
- Last reviewed: 2026-10-21

## Implemented boundary

Platform schema version 12 adds Tenant-owned deployment intents, durable
operation journals, pair fences, per-Gateway lease records, deployment-key
bindings and route-ID reservations. Step 6A exposes only the local allocation
boundary. It does not yet expose apply, key binding, invocation or observation.

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

## Deferred to the remaining Step 6 slices

The Gateway adapter is server-only and exposes narrow Agent, Agent-route and
Virtual-Key policy operations. Step 6B owns leases, preflight, remote writes,
verification, lifecycle recovery and rollback. Step 6C owns Platform Admin key
binding and server-managed invocation. Steps 6D–6E own scoped observations,
runtime actions and compatibility cutover. Until those slices land, an intent
cannot become invocable.
