# Platform Identity Persistence

- Document type: **normative**
- Status: **current; Steps 2A–3 identity and administration surfaces implemented**
- Applies to: `feature/agent-resource-platform` identity, Tenant membership and service credentials
- Last reviewed: 2026-10-19

This document defines the implemented Principal, Tenant and Tenant-membership
foundation for the Agent Resource Platform. It does not grant resource,
publication or Gateway deployment access. The accepted authority model remains
in [Tenant Authorization Model](../architecture/tenant-authorization-design.md).

## 1. Identity authority

The manager `users` table remains the only editable human identity, password,
status and Platform Admin authority. A human Principal uses the stable ID
`user:<manager-user-id>`; the platform store keeps only that numeric reference
when a membership needs it. It never copies a username or password hash.

Manager user IDs are now permanently reserved. Deleting a user cannot cause a
later account to inherit retained membership references. The additive manager
migration preserves all existing user IDs, sessions and Gateway memberships and
also reserves IDs found in successful historical user-deletion audit entries.

A service Principal uses `service:<slug>` and authenticates with a separate
one-time bearer credential. Only its SHA-256 digest is stored. Disabling the
Principal revokes every active credential immediately. A disabled service ID is
retained and cannot be silently recreated with its old memberships.

Human manager sessions and service credentials prove identity only. They do not
contain cached Tenant roles.

## 2. Persisted model

```text
platform_principals
  id: user:<manager-id> | service:<slug>
  kind: human | service
  user_id | service_name
  status: active | disabled

platform_tenants
  id, name
  status: active | disabled

platform_tenant_memberships
  principal_id
  tenant_id
  role: admin | user
  PRIMARY KEY (principal_id, tenant_id)

platform_service_credentials
  id, principal_id
  token_digest
  expires_at, revoked_at

platform_tenant_gateway_grants
  principal_id, tenant_id, gateway_id
  access: view | manage
  principal/tenant/membership/gateway authority epochs

platform_issued_ids / manager_gateway_ids / manager_user_ids
  permanent deletion-surviving ID reservations

platform_authority_fences / manager_authority_fences
  monotonic authority epochs for every grant dependency

platform_membership_add_receipts
  digest-only, expiring, single-use Tenant Admin membership-add authorization
```

Principal and Tenant are many-to-many through a membership with exactly one
role. This relation is independent of current `user_gateways` memberships.
Neither Platform Admin nor Gateway `admin/member` creates a Tenant membership.

The implemented role semantics are:

- Tenant User proves active participation in one Tenant;
- Tenant Admin includes Tenant User participation and may list, change or remove
  that Tenant's memberships; adding a member uses the exact-resolver/receipt
  flow and never accepts a caller-supplied target ID; and
- Platform Admin may administer all Principals, Tenants and memberships but has
  no implicit Tenant membership or Tenant data access.

Human and service Tenant Admins use the same membership rule. Each may receive
its own `view|manage` grant for one exact Gateway. `manage` includes `view`, but
neither access level grants general Gateway proxy, credential, Caddy, raw
Virtual Key, shared-resource or Gateway-wide observability authority. Accepted
Step 4 capability slices define their own resource ownership; Agent ownership
and deployment operations remain later work.

## 3. Live authorization

`PlatformIdentityService` resolves every operation from live records:

1. a human actor reloads the manager user and rejects a missing or disabled
   account;
2. a service actor reloads the credential digest, expiry, revocation and
   Principal status;
3. Tenant authorization reloads the Tenant and rejects a disabled Tenant; and
4. the exact `(principal_id, tenant_id)` membership and current role are loaded
   for the operation.

Tenant Gateway authorization additionally reloads the named Gateway from the
manager store and compares the grant's captured Principal, Tenant, membership
and Gateway authority epochs with their current durable fences. All four
subjects must be live and the membership must still be `admin`. A retained stale
row is therefore inert even if best-effort cleanup fails. Disable/re-enable,
demote/re-promote, removal/recreation and deletion cannot revive it.

`PlatformActorReference` therefore carries identity references only. A caller
cannot present a role, Tenant ID or Principal ID as authority. Revocation,
membership removal, role demotion and Tenant disablement affect the next
operation, including a previously authenticated service actor.

## 4. Storage backends and migrations

Without `PLATFORM_DATABASE_URL`, platform identity tables share
`MANAGER_DB_PATH` while using their own `platform_schema_lock` version. Manager
`PRAGMA user_version` remains independent. With a PostgreSQL URL, only platform
identity tables use PostgreSQL; manager users, sessions, Gateway registry and
audit stay in SQLite.

The SQLite and PostgreSQL adapters implement the same repository contract.
SQLite uses `BEGIN IMMEDIATE`; PostgreSQL uses a row lock and an advisory
transaction lock for first migration. Writes never call the manager identity
directory while holding the platform database transaction.

Platform schema version 2 adds permanent Tenant/service-Principal issuance,
local authority fences and Tenant Gateway grants. Manager schema version 4 adds
permanent Gateway issuance, durable human/Gateway fences and scoped grant audit
fields. Tenant/service/membership invalidation advances its fence and removes
dependent grants in one platform-store transaction. Human/Gateway invalidation
advances the manager fence in its local transaction; authorization performs the
cross-store comparison and never claims a distributed transaction.

Platform schema version 3 adds digest-only membership-add receipts. Receipt
consumption and membership creation share one platform-store transaction;
manager-owned human epochs are checked before and after that transaction, with a
conditional membership rollback on detected cross-store drift.

Platform schema version 4 adds shared catalog offerings and Tenant availability.
Catalog and identity writes take the same `platform_schema_lock`, so Tenant
deletion cannot race an allowlist update. Explicit allowlist rows capture the
current Tenant authority epoch and are inert after disable/re-enable until a
Platform Admin saves availability again. The detailed ownership and source-
Gateway rules live in [Platform shared catalog](platform-catalog.md).

Run:

```bash
bun run migrate:platform          # transactional dry run
bun run migrate:platform --apply  # apply additive platform schema
```

The command requires an initialized manager database and reports only backend,
schema version and manager-user count. It does not expose passwords, service
tokens or credential digests. Switching `PLATFORM_DATABASE_URL` does not copy
records between SQLite and PostgreSQL.

## 5. HTTP surface

Explicit handlers live under `/api/platform/v1`; they cannot fall through the
Gateway `/api/admin/*` proxy. All responses are `private, no-store` and use a
manager session or service bearer in `Authorization`.

The Tenant-qualified membership family is the Tenant Admin self-service surface
and requires an active membership in that Tenant. The `identity`-prefixed family
backs platform identity administration and bootstrap; its shared member
operations may also accept that active Tenant's Admin, but it remains a
distinct adapter rather than a duplicate fallback.

| Method | Path | Authority |
| --- | --- | --- |
| GET | `/api/platform/v1/access` | Any live human/service Principal; returns active memberships |
| GET/POST | `/api/platform/v1/tenants/{id}/members` | That active Tenant's Admin; list members or consume a receipt |
| POST | `/api/platform/v1/tenants/{id}/member-resolutions` | That active Tenant's Admin; exact namespace resolution |
| PUT/DELETE | `/api/platform/v1/tenants/{id}/members/{principalId}` | That active Tenant's Admin; existing memberships only |
| GET/POST | `/api/platform/v1/identity/tenants` | Platform Admin |
| PUT | `/api/platform/v1/identity/tenants/{id}` | Platform Admin |
| GET | `/api/platform/v1/identity/principals` | Platform Admin |
| GET | `/api/platform/v1/identity/tenants/{id}/members` | Platform Admin or that active Tenant's Admin |
| POST | `/api/platform/v1/identity/tenants/{id}/member-resolutions` | That active Tenant's Admin; exact human username or service Principal ID, returning minimal confirmation plus a one-time receipt |
| POST | `/api/platform/v1/identity/tenants/{id}/members` | That active Tenant's Admin; consumes a receipt and creates one membership |
| POST | `/api/platform/v1/identity/tenants/{id}/members/bootstrap` | Platform Admin only; creates a membership from an exact stable Principal ID |
| PUT/DELETE | `/api/platform/v1/identity/tenants/{id}/members/{principalId}` | Platform Admin or that active Tenant's Admin; existing memberships only |
| POST | `/api/platform/v1/identity/service-principals` | Platform Admin; token returned once |
| DELETE | `/api/platform/v1/identity/service-principals/{id}` | Platform Admin; disables Principal and credentials |
| GET | `/api/platform/v1/identity/tenant-gateway-grants` | Platform Admin; exact optional filters; returns only grants matching current live authority epochs |
| PUT/DELETE | `/api/platform/v1/identity/tenant-gateway-grants` | Platform Admin; set highest `view|manage` access or revoke one exact tuple |
| DELETE | `/api/platform/v1/identity/tenants/{id}` | Platform Admin; remove the subject while retaining its ID reservation and authority fence |

The receipt endpoint, bootstrap endpoint and existing-member update are separate operations. The
update performs an atomic `UPDATE ... RETURNING` and never upserts, so a
concurrent removal cannot turn a Tenant Admin's role change into creation. A
Tenant Admin cannot pass a caller-supplied stable Principal ID to create a new
membership. Resolver input chooses exactly one namespace, returns no stable
target ID, and persists only a receipt digest. Consumption repeats live checks
and rejects expiry, replay, caller/Tenant mismatch and authority-epoch drift.

Identity calls are written to the existing manager audit log without request
bodies, bearer values or credential digests. Tenant Gateway grant outcomes also
record actor Principal, Tenant, Gateway, requested access and exact target tuple.

## 6. Explicit limits

- Tenant Gateway grants authorize only the scoped deployment and observation
  services documented in the Step 6 capability; they never grant general
  Gateway forwarding or infrastructure authority.
- Identity records do not themselves define Agent ownership or CRUD. Resource,
  publication and deployment services revalidate their own Tenant ownership and
  exact grant requirements.
- The Step 3 Tenant Members, Platform Tenants and Service accounts pages are
  implemented. Service credentials are displayed only in the create response;
  subsequent Principal projections expose no token or credential identifier.
- The Step 3 Gateway access page administers only Tenant Gateway grants. It
  exposes no general Gateway proxy access, administrator credential or secret.
- Step 6E retires Gateway `admin/member` as content authority. The explicitly
  named `requireGatewayCompatibilityAccess`/`withGatewayCompatibilityAccess`
  surface now requires Platform Admin and remains independent of Tenant Gateway
  grants.
- The Step 3 identity administration pages project only implemented Step 2
  authority: active Tenant memberships, Platform identity administration and
  Tenant Gateway grants. Later Resource pages project the policies of their own
  accepted capability slices. Neither surface infers publication, deployment or
  general Gateway proxy authority from identity roles alone.
- PostgreSQL verification is conditional on an isolated
  `PLATFORM_TEST_POSTGRES_URL`; ordinary tests skip it when unavailable.

## 7. Steps 2A–2B verification

The accepted slices pass all ordinary Bun tests, lint, project and isolated
contract typechecks, package-boundary checks, production build and the isolated
dev/build/start runtime smoke. Verification covers Principal/Tenant membership
and grant persistence, audit redaction and grant scope, restart, immediate
service revocation, all four epoch races, permanent ID reuse rejection and
fail-closed stale-row cleanup. The PostgreSQL migration/repository contract uses
the same suite through `PLATFORM_TEST_POSTGRES_URL`.
