# Platform personal files

- Document type: **normative**
- Status: **current; Step 4C implemented**
- Applies to: `rebuild/agent-resource-platform` human-owned Tenant personal files
- Last reviewed: 2026-10-20

Personal files are permanent platform resources owned by one human Principal
inside one Tenant. They are not knowledge documents, temporary chat attachments,
Gateway resources or shared Tenant assets.

## Authorization

Every list, upload, completion, read and delete checks all of the following:

1. the authenticated Principal is human;
2. the Tenant is active and the Principal has a current Tenant membership;
3. the file's `tenant_id` and Tenant authority epoch still match; and
4. `owner_principal_id` equals the current human Principal.

Tenant Admin does not grant access to another human's files. Service Principals
are rejected even when their membership role is Tenant User or Tenant Admin.
Platform Admin status is not personal-file authority.

The canonical metadata API is
`/api/platform/v1/tenants/{tenantId}/files`. It supports list, upload-session,
completion, preview/download ticket and soft-delete operations. Object transfer
uses `/api/platform/v1/storage/files?token=...`; tickets are stored only as
digests, are bound to the owner Principal and operation, require the normal
authenticated bearer, and do not appear in the audited URL path.

## Lifecycle and storage

- Files are permanent uploads of 1 byte–25 MiB. A server-generated immutable
  object key prevents path traversal and byte replacement.
- The request key makes initiation idempotent inside the current Tenant
  authority epoch. Failed size, MIME, hash or completion validation can be
  retried with the same key and intent; a stale-epoch key fails closed.
- Completion validates durable size/hash and is idempotent once active.
- Preview is limited to PNG/JPEG/GIF/WebP, PDF, JSON, plain text, CSV and
  Markdown. Responses use `nosniff` and a sandbox Content Security Policy.
  Other types remain downloadable but cannot be previewed.
- Delete writes a tombstone only after reference checks and revokes outstanding
  tickets. `collectPersonalFileGarbage` removes object bytes and records
  `object_deleted_at`, and purges expired object tickets; repeated GC passes are
  idempotent. Knowledge-document GC uses the same durable marker from schema
  version 7.

`PLATFORM_OBJECT_DIR` is the shared private object root. No public URL, S3/MinIO
adapter, temporary attachment promotion or chat lifecycle is claimed.

The sole canonical UI is `/dashboard/resources/files`; the account panel links
to it. The page has an explicit Tenant selector, owner-only list, upload recovery,
safe preview, download, deletion and distinct forbidden/failure/empty states.

Schema version 7 adds personal-file metadata, tickets and references and the
durable object-GC marker. SQLite and PostgreSQL share the repository contract.
