# Platform authored resources

- Document type: **normative**
- Status: **current; Step 4A implemented**
- Applies to: `feature/agent-resource-platform` Skill and instruction resources
- Last reviewed: 2026-10-20

This slice implements Skills and instructions as authored resources with immutable
content revisions. It deliberately does not give Tenant actors Gateway authority
and does not store provider, credential or Gateway identifiers.

## Ownership and visibility

- Tenant-owned resources carry the Tenant ID and Tenant authority epoch that was
  live when the resource was created. Any active Tenant Admin or Tenant User may
  author them. Every operation rechecks active membership.
- Platform-shared resources are created and administered only by a human Platform
  Admin. Their `all-active-tenants|tenant-allowlist` projection uses the same
  active-Tenant and authority-epoch fencing as the model/tool Catalog.
- A deleted or replaced Tenant cannot inherit retained resources or allowlist
  entries. Tenant IDs are tombstoned and stale authority epochs fail closed.
- Selecting a shared resource in a Tenant view never grants mutation authority.

The canonical APIs are:

- `/api/platform/v1/tenants/{tenantId}/skills`
- `/api/platform/v1/tenants/{tenantId}/instructions`
- `/api/platform/v1/catalog/skills`
- `/api/platform/v1/catalog/instructions`

Collection `POST`, item `GET|PUT|DELETE`, revision `POST`, and revision-status
`PUT` are explicit Route Handlers. Platform `DELETE` archives the stable shared
record; Tenant `DELETE` removes an unreferenced Tenant-owned record.

## Content and revision rules

- Names are 1–200 characters and descriptions are at most 2,000 characters.
- Instructions contain non-empty text and no package files.
- Skill packages require a root `SKILL.md`. Paths are relative and reject
  empty/dot segments, backslashes, control characters and colons.
- Packages accept at most 500 files, 10 MiB per text/file value and 50 MiB total
  expanded content. File bytes use canonical base64. Tags are normalized,
  deduplicated and sorted.
- Content is canonicalized before a SHA-256 hash is stored. A change always adds
  a new numbered draft revision; revision content is never updated in place.
- Draft revisions may be published or archived. Archived revisions cannot be
  republished. `platform_authored_revision_refs` prevents revision archive and
  resource archive/delete while a reference exists.

The canonical UI routes are `/dashboard/resources/skills` and
`/dashboard/resources/instructions`. Each has an explicit Tenant/Platform scope
selector, failure/forbidden/empty states, metadata editor, content editor and
revision lifecycle controls.

## Persistence

Schema version 5 adds:

- `platform_authored_resources`
- `platform_authored_resource_availability`
- `platform_authored_resource_revisions`
- `platform_authored_revision_refs`

The repository contract is shared by SQLite and PostgreSQL. Tenant ownership is
represented by retained IDs plus authority epochs: immutable history may remain
after identity deletion, while every domain read fails closed when the live
Tenant/fence is absent.
