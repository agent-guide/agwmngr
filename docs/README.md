# Documentation map

- Document type: **normative**
- Status: **current**
- Applies to: repository documentation
- Last reviewed: 2026-10-22

The documentation is organized by authority and lifecycle. A delivery plan can
record how a capability is built, but it does not override the current code or
the normative and capability documents.

## Document classes

| Directory | Document type | Lifecycle and authority |
| --- | --- | --- |
| [`architecture/`](architecture/) | Normative | Current architecture or an explicitly accepted target. Update in place when the governing design changes. |
| [`capabilities/`](capabilities/) | Normative | Implemented capability contracts, authorization rules and known limits. Keep aligned with code. |
| [`operations/`](operations/) | Operational | Repeatable migration, backup, recovery, release and incident procedures. |
| [`plans/active/`](plans/active/) | Delivery | Work in progress, ordered gates and pinned migration evidence. It does not establish runtime authority by itself. |
| [`plans/archive/`](plans/archive/) | Delivery history | Completed, abandoned or superseded plans. These are evidence only and are not current instructions. |
| [`decisions/`](decisions/) | Decision | Immutable architectural decision records. Later decisions supersede rather than rewrite accepted history. |

## Current architecture and accepted target documents

Each document is authoritative only for the branch and lifecycle named by its
`Status` and `Applies to` metadata. Presence in `architecture/` does not claim
that an accepted target is implemented on `dev`.

Accepted resource-platform target and rebuild architecture:

- [Agent resource platform design](architecture/agent-resource-platform-design.md)
- [API ownership and service boundaries](architecture/agent-resource-platform-api-ownership.md)
- [Tenant authorization model](architecture/tenant-authorization-design.md)
- [Dashboard information architecture](architecture/dashboard-information-architecture.md)

Current `dev` compatibility architecture:

- [Multi-user and multi-Gateway design](architecture/multi-tenant-design.md)
- [Hierarchical resource RBAC design](architecture/resource-rbac-design.md)

## Verified feature-branch capability documents

These documents describe implementations on `feature/agent-resource-platform`;
they do not claim the same code is present on `dev` until that branch is merged
into `dev` or `dev` otherwise advances to contain it.

- [Platform identity persistence](capabilities/platform-identity-persistence.md)
- [Platform shared catalog](capabilities/platform-catalog.md)
- [Platform authored resources](capabilities/platform-authored-resources.md)
- [Knowledge bases and documents](capabilities/platform-knowledge-documents.md)
- [Personal files](capabilities/platform-personal-files.md)
- [Tenant model definitions](capabilities/platform-tenant-models.md)
- [Tenant tool definitions](capabilities/platform-tenant-tools.md)
- [Platform Agent definitions and publication](capabilities/platform-agent-publication.md)
- [Platform Agent deployments](capabilities/platform-agent-deployments.md)

## Active delivery documents

- [Approved migration source inventory](plans/active/agent-resource-platform-source-inventory.md)
- [Manager v0.1.0 release plan](plans/active/v0.1.0-release-plan.md)

## Operational runbooks

- [Database migrations](operations/database-migrations.md)
- [Agent resource platform cutover](operations/platform-cutover-runbook.md)

## Archived delivery documents

- [Gateway v0.5.0 alignment plan](plans/archive/gateway-v0.5-alignment-plan.md)
- [Agent resource platform rebuild plan](plans/archive/agent-resource-platform-integration-plan.md)

## Required metadata

Every document must state:

- `Document type`: `normative`, `operational`, `delivery` or `decision`;
- `Status`: `current`, `accepted target`, `active`, `completed`, `superseded` or
  `archived`;
- `Applies to`: the relevant branch, version, subsystem or capability; and
- `Last reviewed`: the last date on which code and links were checked.

A superseded or archived document must name its replacement when one exists.
Moving a document requires updating `AGENTS.md`, this index and every repository
link in the same change.
