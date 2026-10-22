# Agent resource platform cutover

- Document type: **operational**
- Status: **current**
- Applies to: initial Agent resource/deployment delivery on `feature/agent-resource-platform`
- Last reviewed: 2026-10-22

This runbook moves the implemented platform into service without importing
business data from the two reference products. It keeps manager identities and
Gateway registration in SQLite, puts platform records in the configured
SQLite/PostgreSQL store, and preserves object bytes as a separate authoritative
backup unit.

## 1. Prerequisites and stop conditions

Before the maintenance window:

- pin the application revision and Agent Gateway v0.7.0 revision;
- make `MANAGER_SECRET_KEY` available to the replacement process without placing
  it in a backup or report;
- ensure `pg_dump` and `pg_restore` are installed when
  `PLATFORM_DATABASE_URL` is configured;
- allocate a private backup directory and, for PostgreSQL rehearsal, a new empty
  database; and
- notify callers that platform authoring, deployment, Test and Gateway
  infrastructure writes will be unavailable.

Stop all manager replicas and any maintenance process that writes the object
directory. Do not pass `--writers-stopped` while a writer is still running. A
schema mismatch, reference/object violation, failed checksum, failed restore,
failed real-Gateway gate or failed production startup is a cutover stop; do not
partially enable traffic.

## 2. Active-writer map

Exactly one service family is mutable for each domain after cutover:

| Domain | Authoritative store | Active writer |
| --- | --- | --- |
| Human users, password hashes, sessions, Gateway registry and manager audit | manager SQLite | manager auth/platform administration handlers |
| Service Principals, Tenants, memberships and Tenant Gateway grants | platform SQLite or PostgreSQL | `/api/platform/v1/identity` services |
| Catalog, authored resources, knowledge metadata, model/tool definitions, Agent drafts/releases and deployment journals | platform SQLite or PostgreSQL | their `/api/platform/v1` domain services |
| Document and personal-file bytes | private `PLATFORM_OBJECT_DIR` | platform storage services |
| Platform-managed Gateway Agent/route pair | Agent Gateway | deployment lifecycle adapter only |
| Unfenced Gateway-only Agents and reviewed LLM/MCP infrastructure | Agent Gateway | Platform Admin compatibility/infrastructure services |
| Provider credentials, Virtual Keys and runtime telemetry | Agent Gateway | reviewed Platform Admin handlers or Gateway runtime as defined by the capability contract |
| Workflow state and schedules | external engine | external engine; not this platform |

The old `user_gateways` rows are retained only as migration evidence and do not
grant content authority. They are not converted into Tenant membership or
`tenant_gateway` grants. Platform deployment records project Gateway state but
do not become a second writer for the Gateway database.

## 3. Source/account/resource mapping

The rehearsal report uses these mappings:

| Source record | Target treatment |
| --- | --- |
| manager `users.id` | referenced as `user:<id>`; username/password/status remain manager-owned and are not copied |
| manager Gateway registry | retained in manager SQLite with encrypted credentials and durable ID/authority fences |
| legacy Gateway membership | retained but grants no target Tenant or content authority |
| existing Gateway Agent/route | remains Gateway-only compatibility inventory unless fenced by a platform deployment; never auto-adopted |
| experts-backend/frontend records | no production data import; the pinned repositories supplied contract/design evidence only |
| Tenant resources created through Steps 2–7 | remain in the selected platform store with stable IDs and immutable revisions/releases |
| document/personal-file metadata | remains in the platform store; bytes are matched by `object_key`, size and SHA-256 under `PLATFORM_OBJECT_DIR` |

`bun run inspect:cutover` reports every table count, live/retained human and
Gateway mapping count, legacy membership/grant count, structural references and
object verification. Retained mappings can be non-zero after deletion; they are
reported separately because durable IDs and inaccessible rows are intentional.
Any entry under `violations` is blocking.

## 4. Backup and isolated restore rehearsal

With writers stopped, inspect and create a consistent backup:

```bash
bun run check:migrations
bun run migrate:platform
bun run inspect:cutover
bun run backup:platform --output /private/backup/agwmngr-cutover-YYYYMMDD --writers-stopped
```

Optional `--manager-db FILE` and `--objects DIR` arguments override the normal
environment-derived paths. The backup command:

1. requires current manager/platform schema versions and zero integrity
   violations;
2. creates a transactionally consistent SQLite snapshot with `VACUUM INTO`;
3. runs a PostgreSQL custom-format `pg_dump` when configured;
4. copies only regular object files and rejects symbolic links;
5. records row, mapping, reference and object counts; and
6. writes per-artifact SHA-256 hashes to private `backup.json`.

If any step fails, the command removes the incomplete output directory so the
same path can be retried after correcting the cause. Only a directory containing
the final `backup.json` is a completed backup.

Restore only into new paths and, for PostgreSQL, a new empty database:

```bash
MANAGER_DB_PATH=/private/rehearsal/manager.db \
PLATFORM_OBJECT_DIR=/private/rehearsal/objects \
bun run restore:platform \
  --backup /private/backup/agwmngr-cutover-YYYYMMDD \
  --manager-db /private/rehearsal/manager.db \
  --objects /private/rehearsal/objects \
  --apply --writers-stopped
```

Set `PLATFORM_DATABASE_URL` to the empty rehearsal database for a PostgreSQL
backup. An explicitly exported value for this and the path variables overrides
`.env.local` for the inspect, migrate, backup and restore package commands.
Those commands disable Bun's automatic env-file loading and parse `.env.local`
raw, so `$` characters are not expanded; direct script execution must likewise
include `bun --no-env-file`. Restore
refuses existing SQLite/object targets or a PostgreSQL target
containing `platform_%` tables. The manager file and object directory must be
separate, non-overlapping paths. It verifies backup hashes before writing, uses a
single PostgreSQL restore transaction, ignores source ownership/ACL metadata so
objects belong to the target connection role, then requires the restored
inventory to match the source exactly. Manager SQLite and object files are
staged beside their final targets and published only after PostgreSQL restore
and inventory verification succeed. A failed `pg_restore` therefore leaves the
final paths absent and, because the restore is transactional, the same empty
database can be retried. A later validation failure still makes that PostgreSQL
database a failed target; preserve it for analysis and retry with another empty
database. The scripts never print the PostgreSQL URL, password hashes, encrypted
Gateway secrets, service-token digests or Virtual Key values.

Start a production build against the restored targets and run the release gate
in section 6 before accepting the backup. Keep this rehearsal separate from the
live cutover; it proves recoverability without overwriting production state.

## 5. Cutover and rollback

After the rehearsal passes:

1. stop writers again and create a final uniquely named backup;
2. run the migration dry run, inspect report and final backup checksum check;
3. apply migrations only if the target is behind the manifest;
4. start exactly one replacement manager replica and run the production/runtime
   and real-Gateway acceptance gates;
5. enable remaining replicas only after the first is healthy; and
6. record revision, backup path, schema versions, row/reference counts and gate
   results in the release record.

For rollback, stop every replacement writer first. Preserve the failed cutover
stores for incident analysis, then point the previous application revision at a
new restore of the accepted backup. Do not reverse forward-only SQL or overwrite
the failed stores in place. Re-run checksum/inventory verification and the
previous revision's startup/health gate before restoring traffic. Gateway
objects changed after the backup require the explicit deployment recovery or
decommission paths; never edit claimed Agent/route pairs directly.

## 6. Release acceptance

The initial delivery is accepted only when all commands pass at the same
revision:

```bash
bun run check:migrations
bun test
bun run lint
bun run typecheck
bun run typecheck:contracts
bun run check:boundaries
bun run build
bun run smoke:runtime
PLATFORM_TEST_POSTGRES_URL=... bun test lib/platform-persistence.test.ts
bun run smoke:step6-gateway
```

In addition, archive the successful isolated restore report described above.
The PostgreSQL URL must identify a disposable administrative database because
the persistence test creates and drops a temporary database.

## 7. Accepted, deferred and excluded capability record

Accepted in the initial delivery: platform identities/Tenants/grants; the
selected resource slices; Agent definitions and immutable releases; scoped
deployment/key binding/invocation/observation; Gateway-only operational
compatibility; canonical Agent, Tenant and Platform Admin UI; migration,
backup/restore and release gates.

Deferred to optional Step 9: product chat/history, temporary attachments and a
separately designed durable controlled-Agent-work contract.

Excluded: Teams, project/task or Work Management bindings, subscriptions and
pricing, duplicate Platform User identity, workflow-engine adapters/schedulers,
business branding/workflows, fake retrieval/indexing/runtime capabilities and
automatic adoption of Gateway-only resources.
