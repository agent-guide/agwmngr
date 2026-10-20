# Platform Agent definitions and publication

- Document type: **normative**
- Status: **Step 5A definition authoring implemented; releases pending**
- Applies to: `rebuild/agent-resource-platform` Agent definition APIs
- Last reviewed: 2026-10-20

## Implemented definition contract

Platform schema version 10 adds Tenant-owned `AgentDefinition` records. An
active Tenant Admin or Tenant User may create, list, read, update and archive a
definition in their own Tenant. Platform Admin status alone grants no access.
Service Principals use the same live membership rule. Retained rows become
inaccessible when the owning Tenant is no longer live.

Definitions are mutable optimistic drafts. Create requires
`expected_version: 0`; update requires the exact current positive version. A
stale writer receives a conflict and must reload. The server owns the stable
platform identity `agent:{tenant_id}:{slug}`, while a later deployment will own
its separate Gateway Agent identity. Saving a definition never reads or writes a
Gateway.

The draft separates a runtime-neutral core—name, description, system prompt,
resource selections and policy—from strictly validated runtime-specific
advanced configuration. Builtin, ACP and HTTP drafts are representable. The
server rejects unknown fields, unsafe HTTP card URLs, invalid runtime bounds and
secret-bearing keys recursively. Supporting a draft shape does not imply that a
release or deployment supports that runtime/resource combination.

## Exact references

Every save resolves accessible resources and records a deterministic dependency
snapshot:

- the current Tenant model/tool definition version and digest plus its
  Tenant-redacted offering tuple;
- exact Skill and instruction revision IDs, numbers and content hashes; and
- active Tenant knowledge-base IDs and their current update marker.

The same transaction rechecks those records against the live Tenant epoch and
writes the existing resource reference tables. A referenced model/tool version,
authored revision or knowledge base cannot be archived. Replacing a mutable
draft releases only its superseded draft references; immutable release
references will be independent in Step 5B.

## HTTP API

All endpoints are explicit handlers under
`/api/platform/v1/tenants/{tenant_id}/agents` and never reach the Gateway
catch-all:

| Method | Path suffix | Behavior |
| --- | --- | --- |
| `GET` | `` | List definitions in the owning live Tenant |
| `POST` | `` | Create `{slug, expected_version: 0, draft}` |
| `GET` | `/{definition_id}` | Read one membership-visible definition |
| `PUT` | `/{definition_id}` | Save `{expected_version, draft}` |
| `DELETE` | `/{definition_id}` | Archive an editable definition |

The response includes the normalized draft, exact Tenant-redacted dependency
snapshot, SHA-256 draft digest, version and server-computed `editable` flag.

## Pending Step 5B boundary

No immutable `AgentRelease` exists yet. Definition dependencies may therefore
include draft authored revisions and knowledge references, but Step 5B must
re-resolve them at release time, require published content, capture internal
Gateway-backed offering bindings only in the secret-redacted immutable release,
reject stale/missing dependencies and reject unsupported runtime/resource
combinations. The Agent wizard, inventory, Configuration and Releases UI also
remain pending until that server contract lands.
