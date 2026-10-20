# Tenant tool definitions

- Document type: **normative**
- Status: **current; Step 4E implemented**
- Applies to: `rebuild/agent-resource-platform` Tenant tool definitions
- Last reviewed: 2026-10-19

This slice adds Tenant-owned tool authoring records above the Platform shared
catalog. A definition supplies a Tenant-facing name and description and binds to
exactly one approved tool `offering_id`; MCP services and their credentials stay
in the infrastructure layer.

## Authority and capability boundary

- A live Tenant Admin or Tenant User may list, create and version definitions in
  a Tenant where that Principal has a live membership. Service Principals use
  the same live Tenant-membership rule.
- Tenant authority epochs fence every retained row. Tenant deletion makes
  history inaccessible and reserved IDs prevent a replacement from inheriting
  it.
- Input accepts only `name`, `description` and `offering_id`. MCP service IDs,
  credential IDs, Gateway IDs, upstream stable IDs, API keys and other secret or
  infrastructure fields are rejected and absent from responses.
- The catalog reference must be active, Tenant-authorized and category `tool`.
  `platform-native` offerings need no infrastructure lookup. A
  `gateway-backed` tool uses the internal stable form
  `mcp:{service_id}:{tool_name}`; the server-only adapter loads that exact
  service's current tool list and requires the exact tool name. Gateway
  credentials never enter the domain contract or browser response.
- Every read and release-reference resolution repeats catalog and capability
  validation. Missing services/tools, stale source Gateways and retired or
  fenced offerings produce an explicit unavailable definition and block new
  release references. Live Gateway capability probes have a bounded request
  budget, so a hung source is reported as unavailable instead of blocking the
  Tenant collection.

## Versions and references

Creation writes immutable version 1. Editing appends the next version while
prior versions remain unchanged. A canonical SHA-256 digest covers the
definition identity/version, authored fields and the exact offering
ID/version/digest.

`resolveReference` returns that definition tuple and offering tuple for Step 5
Agent release snapshots. `platform_tenant_tool_definition_refs` points to an
exact immutable version and prevents archival while referenced. Internal
Gateway/MCP binding fields are intentionally absent from this Tenant contract;
the catalog reference remains their server-side authority.

## HTTP and UI surface

The explicit collection is
`/api/platform/v1/tenants/{tenant_id}/tools`:

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` / `POST` | collection | List Tenant definitions / create version 1 |
| `GET` / `PUT` | `/{definition_id}` | Read current version / append a new version |
| `DELETE` | `/{definition_id}` | Archive when no exact-version reference exists |

These handlers cannot fall through the Gateway proxy and do not accept active-
Gateway context. `/dashboard/resources/tools` combines definitions and
authorized shared tool offerings, labels Tenant ownership and Platform/Gateway
source, and includes explicit loading, forbidden, failure and empty states.
“Used by Agents” stays zero until Step 5 creates platform Agent references.

## Persistence and verification

Platform schema version 9 adds tool definition, immutable-version and exact-
reference tables with the same SQLite/PostgreSQL repository contract. Tests
cover cross-Tenant and deleted-Tenant isolation, category and live-capability
rejection, forbidden infrastructure fields, immutable versions, deterministic
references, missing-capability state, offering retirement and reference-safe
archival.
