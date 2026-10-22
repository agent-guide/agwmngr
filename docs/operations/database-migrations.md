# Database migrations

- Document type: **operational**
- Status: **current**
- Applies to: manager schema v4 and platform schema v14
- Last reviewed: 2026-10-22

Manager identity/session/Gateway data remains in SQLite. Platform records use
that same SQLite database unless `PLATFORM_DATABASE_URL` selects PostgreSQL.
Changing that variable does not move data between stores.

## Frozen manifest

[`packages/platform/migrations/manifest.json`](../../packages/platform/migrations/manifest.json)
records the ordered migration names, statement counts and SHA-256 digests for
both executable migration series. It is generated from the exact SQL executed
by the application; it is not a second migration source.

After deliberately adding a forward-only migration, run:

```bash
bun run generate:migrations
bun run check:migrations
bun test scripts/migration-manifest.test.ts lib/db-migration.test.ts lib/platform-persistence.test.ts
```

Never edit an accepted migration in place. Append a named migration, regenerate
the manifest and rehearse the upgrade from the prior schema version on both
SQLite and PostgreSQL. `check:migrations` fails when SQL, ordering, names or the
checked-in manifest diverge.

## Applying the platform schema

Initialize the manager database first, then run a transactional dry run before
apply:

```bash
bun run migrate:platform
bun run migrate:platform --apply
```

The platform migrator takes a write transaction (plus a PostgreSQL advisory
transaction lock), validates references and rolls the dry run back. Back up all
authoritative stores and stop platform writers before a production apply. The
Step 8 cutover runbook owns that sequence and its rollback criteria.
