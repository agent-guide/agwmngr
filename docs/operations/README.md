# Operational documentation

- Document type: **operational**
- Status: **current**
- Applies to: operational runbooks
- Last reviewed: 2026-10-20

This directory owns repeatable procedures for migrations, backups, recovery,
release verification and incident handling. A runbook must name its prerequisites,
destructive steps, rollback path, verification commands and supported storage or
runtime variants.

Release-specific sequencing belongs in `../plans/active/`; reusable procedures
belong here.

- [Database migrations](database-migrations.md) defines the frozen migration
  manifest and forward-only update procedure.
