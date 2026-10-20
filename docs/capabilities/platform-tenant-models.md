# Tenant model definitions

- Document type: **normative**
- Status: **current; Step 4D implemented**
- Applies to: `rebuild/agent-resource-platform` Tenant model definitions
- Last reviewed: 2026-10-19

This slice adds Tenant-owned model authoring records above the Platform shared
catalog. A definition is a Tenant-facing name and description bound to exactly
one approved model `offering_id`; it is not a provider, credential, route or
Gateway configuration record.

## Authority and boundary

- A live Tenant Admin or Tenant User may list, create and version definitions in
  a Tenant where that Principal has a live membership. Service Principals use
  the same live Tenant-membership rule.
- Every stored definition is fenced by the Tenant authority epoch. Retained rows
  become inaccessible after Tenant deletion and cannot be inherited by a new
  subject.
- Input accepts only `name`, `description` and `offering_id`. Provider IDs,
  credentials, API keys, Gateway IDs, upstream object IDs and administrator
  secrets are rejected and never appear in the response.
- The referenced catalog record must be active, authorized for the Tenant and
  have category `model`. `platform-native` offerings need no infrastructure
  lookup. A `gateway-backed` offering is checked server-side against its exact
  current Gateway model route; credentials stay inside the manager adapter.
- Catalog availability and source capability are rechecked on reads and
  reference resolution. A retired, fenced or missing offering remains visible
  as an unavailable definition but cannot enter a new release snapshot. Live
  Gateway capability probes have a bounded request budget, so a hung source is
  reported as unavailable instead of blocking the Tenant collection.

## Versions and references

Creation writes immutable definition version 1. Editing inserts the next
version; prior rows are never updated. Each version has a canonical SHA-256
digest over its definition identity, version, authored fields and exact catalog
offering ID/version/digest.

`resolveReference` returns the current definition ID/version/digest and exact
offering ID/version/digest. This is the deterministic dependency tuple Step 5
Agent releases will snapshot. `platform_tenant_model_definition_refs` targets an
exact immutable definition version and prevents archival while any reference
exists. It does not expose the catalog's internal Gateway binding.

## HTTP and UI surface

The explicit collection is
`/api/platform/v1/tenants/{tenant_id}/models`:

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` / `POST` | collection | List Tenant definitions / create version 1 |
| `GET` / `PUT` | `/{definition_id}` | Read current version / append a new version |
| `DELETE` | `/{definition_id}` | Archive when no exact-version reference exists |

These handlers never reach `/api/admin/*` or accept active-Gateway context.
`/dashboard/resources/models` combines Tenant definitions with the model
offerings authorized for the selected Tenant, and labels Tenant ownership and
Platform/Gateway source. “Used by Agents” remains zero until Step 5 supplies
actual platform Agent references; Gateway Agent attribution is deliberately not
substituted.

## Persistence and verification

Platform schema version 8 adds definition, immutable-version and exact-reference
tables. The repository and migration contract is shared by SQLite and
PostgreSQL. Tests cover cross-Tenant isolation, deleted-Tenant fencing,
category/capability rejection, forbidden input fields, immutable versions,
deterministic references, retirement behavior and reference-safe archival.
