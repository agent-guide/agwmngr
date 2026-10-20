# Platform Shared Catalog

- Document type: **normative**
- Status: **current; Step 4 catalog foundation and model/tool consumers implemented**
- Applies to: `rebuild/agent-resource-platform` shared model and tool offerings
- Last reviewed: 2026-10-19

The shared catalog is the Platform Admin-owned bridge between infrastructure
offerings and later Tenant model/tool definitions. It is not a provider,
credential or MCP-service store, and it does not grant general Gateway access.

## 1. Record and authority model

Every offering has an immutable stable `offering_id`, category (`model|tool`),
explicit creating human Principal, immutable version `1` and SHA-256 dependency
digest. A new materialization identity requires a new offering ID; records are
retired, not deleted or reused.

`platform-native` forbids infrastructure source fields. `gateway-backed`
requires a live `source_gateway_id` plus an opaque `upstream_stable_id` and
captures the source Gateway authority epoch. The stored record contains no
Gateway administrator password, provider/MCP credential, API key or bearer.
Disablement, deletion or an epoch-changing replacement of that Gateway makes
the offering unavailable to Tenants. Re-enabling infrastructure under a newer
epoch does not revive the old binding.

Catalog source health itself means a live registered Gateway with the captured
authority epoch. Steps 4D–4E additionally validate the exact model route or MCP
service/tool behind `upstream_stable_id` whenever a Tenant definition is
written, read for availability or resolved for a release reference. Catalog
list reads do not perform those category-specific calls and do not imply that a
Tenant definition exists.

Only a live human Platform Admin may list the infrastructure projection, create
a draft, approve it, retire it or change its availability. Platform Admin
status alone does not permit the Tenant projection: a caller still needs a live
membership in the path Tenant. Tenant Admin and Tenant User have the same
catalog-read projection, while service credentials use their own live Tenant
membership and receive no implicit privilege.

## 2. Availability and reference behavior

Availability is exactly one of:

- `all-active-tenants`; or
- `tenant-allowlist`, containing explicit active Tenant IDs.

Allowlist rows snapshot the Tenant authority epoch. A deleted Tenant is removed
from retained allowlists; a disable/re-enable cycle invalidates the prior row
until Platform Admin deliberately saves availability again. Permanently
reserved Tenant IDs prevent a replacement subject from inheriting old state.

Tenant list and internal reference resolution require an active offering,
current Tenant authority and a current source Gateway epoch. Tenant JSON exposes
only presentation metadata plus `offeringId`, `kind`, `version` and `digest`.
It never returns `sourceGatewayId`, `upstreamStableId` or owner Principal ID.
The internal `resolveReference` result adds those source fields for later
immutable Agent release snapshots; it is not an HTTP response contract.

Retirement is irreversible and blocks new Tenant references. It does not claim
to mutate future immutable releases, which will retain their own dependency
snapshots in Step 5.

## 3. HTTP and UI surface

All handlers are explicit `/api/platform/v1` routes and cannot reach the
Gateway catch-all:

| Method | Path | Authority and behavior |
| --- | --- | --- |
| GET/POST | `/catalog/offerings` | Platform Admin list/create draft |
| POST | `/catalog/offerings/{id}/approve` | Platform Admin; rechecks source and activates a draft |
| POST | `/catalog/offerings/{id}/retire` | Platform Admin; irreversible retirement |
| PUT | `/catalog/offerings/{id}/availability` | Platform Admin; replaces all/allowlist policy atomically |
| GET | `/tenants/{tenant_id}/catalog?category=model|tool` | Live member of that active Tenant; active redacted offerings only |

`/dashboard/platform/catalog` is the Platform Admin management surface. It
shows source binding and health because those fields are infrastructure
administration data. `/dashboard/resources/models` and
`/dashboard/resources/tools` are the Tenant-facing authored-definition and
authorized-offering surfaces.

Every request uses the existing manager session/service authentication wrapper,
returns `private, no-store`, and finalizes an audit entry with action, target,
decision, status and duration. Request bodies, credentials and upstream secrets
are not written to audit.

## 4. Persistence and verification

Platform schema version 4 adds `platform_catalog_offerings` and
`platform_catalog_tenant_availability`. The same schema lock serializes identity
and catalog writes. SQLite and PostgreSQL use the same SQL repository contract;
PostgreSQL parity remains exercised when `PLATFORM_TEST_POSTGRES_URL` is set.

Acceptance on 2026-10-19 passed 100 ordinary Bun tests (two opt-in PostgreSQL
suites skipped) and a separate real PostgreSQL 16 run with all 5 selected tests
passing. Typechecks, ESLint, package-boundary checks, production
build and isolated Bun development/production HTTP smoke also passed.

The accepted gate covers Platform Admin-only mutation, malformed source
discriminants, active/retired projection, Tenant isolation, epoch-stale Tenant
and Gateway subjects, secret-free Tenant responses, deletion isolation and
schema upgrade/restart behavior. The generic content/revision, object storage
and Tenant model/tool definition tables are intentionally not part of this
foundation.
