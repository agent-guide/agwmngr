# Platform Agent definitions and publication

- Document type: **normative**
- Status: **Step 5 implemented; Step 6 scoped deployment and cutover implemented**
- Applies to: `rebuild/agent-resource-platform` Agent definition and release APIs
- Last reviewed: 2026-10-21

## Implemented definition contract

Platform schema version 10 adds Tenant-owned `AgentDefinition` records and
version 11 adds immutable `AgentRelease` records. An
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
draft releases only its superseded draft references. Every immutable release
adds independent permanent references, so later draft edits cannot make its
model/tool versions or authored revisions removable.

## Immutable release contract

Creating a release re-authorizes the Tenant actor and re-resolves every exact
dependency against current state in the same serialized write. It rejects a
stale draft, missing/unavailable model or tool, unpublished/archived authored
revision, inactive Tenant, and unsupported runtime/resource combination.

The currently executable publication subset is deliberately narrow: builtin
runtime, `single` topology, one available model, zero or more available tools,
published root-`SKILL.md` Skill revisions, published instruction revisions and
no knowledge base. ACP, HTTP, other builtin topologies and knowledge retrieval
remain valid draft shapes but are not releasable until their safe execution
contracts exist.

The release freezes the normalized draft, Tenant-visible dependency snapshot,
runtime type, deterministic digest, author and creation time. Its internal
execution snapshot additionally records exact Gateway-backed offering source
Gateway IDs, upstream stable IDs and authority epochs. Those internal bindings
are server-only: list/get/create Tenant projections never return them or any
credential/secret value.

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
| `GET` | `/{definition_id}/releases` | List immutable releases newest first |
| `POST` | `/{definition_id}/releases` | Create from `{expected_version}` after publication validation |
| `GET` | `/{definition_id}/releases/{release_id}` | Read one immutable Tenant-redacted snapshot |

The response includes the normalized draft, exact Tenant-redacted dependency
snapshot, SHA-256 draft digest, version and server-computed `editable` flag.

## Delivered UI and remaining boundary

The default New Agent flow is a Tenant-aware Identity → Runtime → Resources →
Review wizard. The Agent inventory labels platform definitions separately from
legacy Gateway-managed instances; the detail surface exposes Configuration and
Releases without treating a release as a deployment. Workbench shows recently
edited accessible definitions/releases, and resource pages derive “Used by
Agents” links from Tenant-readable definitions. Advanced direct Gateway Agent
creation remains an explicitly labelled compatibility entry.

No release is deployed or made invocable by Step 5. Step 6A allocates a local,
grant-scoped deployment intent with deterministic Gateway Agent/route mapping
and no Gateway call; Step 6B provides the verified remote lifecycle once a
later binding path has established its required key policy. Virtual-Key
administration, invocation and operational attention remain later Step 6
responsibilities. See
[Platform Agent deployments](platform-agent-deployments.md).
