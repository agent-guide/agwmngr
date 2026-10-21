# Platform knowledge bases and documents

- Document type: **normative**
- Status: **current; Step 4B implemented**
- Applies to: `feature/agent-resource-platform` Tenant knowledge bases and documents
- Last reviewed: 2026-10-20

Knowledge bases are Tenant-owned metadata containers. Documents are durable
private objects attached to one active knowledge base. Uploading a document does
not imply parsing, indexing or retrieval capability: every response explicitly
reports those states as `unavailable`.

## Authority and API

Every operation requires a live Platform Principal, active Tenant and current
Tenant membership. Tenant Admin and Tenant User have the same authoring rights
in this slice. Tenant IDs and their authority epochs are stored on knowledge
bases and documents so deleted/replaced authority fails closed. No active
Gateway, Gateway membership, provider or credential participates.

The explicit API is rooted at
`/api/platform/v1/tenants/{tenantId}/knowledge-bases`:

- collection and item CRUD manages knowledge metadata;
- `/{id}/documents` lists retained documents;
- `/{id}/documents/upload-sessions` accepts up to 20 file intents and returns an
  independent success/error result per file;
- `/{id}/documents/{documentId}/complete` verifies durable object size and hash
  and is idempotent after activation;
- `/{id}/documents/{documentId}/download-url` creates a five-minute download
  ticket; and
- document `DELETE` writes a tombstone after reference checks.

Object transfer uses `/api/platform/v1/storage/documents?token=...`. The token is
random, stored only as a digest, scoped to one operation and Principal, and
expires after ten minutes for upload or five minutes for download. The query is
not included in the audit path. The normal session/service bearer is still
required, so the ticket is not standalone authority.

## Upload and failure behavior

- Supported extensions are PDF, Office document formats, Markdown, text, HTML,
  CSV and JSON. A file is 1 byte–25 MiB.
- A request key is unique per knowledge base and creating Principal. Repeating
  the same key and metadata returns the same document; a different intent is a
  conflict.
- Size, MIME and optional SHA-256 are checked before activation. A validation
  failure marks only that document failed. Repeating the same request key resets
  a failed session so it can be uploaded again.
- Object keys are server-generated and immutable. A repeated PUT may contain
  only identical bytes. A successful object write followed by an interrupted
  response can therefore be retried safely.
- Completion checks both repository metadata and the durable object. Calling it
  again for an active document returns that document without mutation.
- Document and knowledge-base reference tables prevent unsafe delete/archive.
  A knowledge base must have no retained documents before archive.

`PLATFORM_OBJECT_DIR` selects the private local object root and defaults to
`data/objects`. All application replicas must share that durable directory;
S3/MinIO is not implemented. `collectKnowledgeDocumentGarbage` is a trusted
maintenance entry point for tombstoned objects and expired object tickets, not
an HTTP endpoint.

The canonical `/dashboard/resources/knowledge-bases` page supplies Tenant
selection, metadata CRUD, multi-file upload with per-file results, download and
deletion. Its UI always shows indexing and retrieval as unavailable.

Schema version 6 adds knowledge bases, documents, digested object tickets and
reference tables. SQLite and PostgreSQL use the same repository contract.
