# Agent Resource Platform Source Inventory

- Document type: **delivery**
- Status: **active approved migration allowlist**
- Applies to: `rebuild/agent-resource-platform`
- Last reviewed: 2026-10-20

This document records what may be learned from each source and what must not be
ported. An allowlisted item authorizes contract-level reuse, not wholesale file
copying. Every implementation still needs a TypeScript domain boundary, target
authorization and target tests.

## 1. Pinned source baselines

| Repository | Branch/tag | Commit | Role |
| --- | --- | --- | --- |
| agwmngr | `v0.1.0` release baseline | `v0.1.0^{commit}` | Minimum compatibility baseline and ancestor established by the one-time Step 0–4 history repair; later feature work advances from the branch head |
| old agwmngr work | `feature/agent-resource-platform` | `7cb32848158682060129474a1a1808e85bc786ba` | Evidence and patch source only; never merge or cherry-pick wholesale |
| experts-backend | `v2` | `de05ef771610c9f6d7acb5cbd97ef50e0881e355` | Contract, persistence and failure-semantics source |
| experts-frontend | `feature/runtime-admin` | `5f5e69da49046c961b5d897b3156cb9961cd15c5` | Interaction and field-requirement reference |
| agent-gateway | `v0.7.0` | `3d04b7a0207a6d31746a1b196ae9d82097c2087c` | Execution and governance integration baseline |

Do not silently follow a moving source branch. Updating a pin requires reviewing
its diff and this allowlist.

## 2. Allowed backend contracts

| Capability | Source references | Reuse | Required adaptation |
| --- | --- | --- | --- |
| Skills and revisions | `domain/skills.py`, `domain/skill_revisions.py`, `services/skill_service.py`, `skill_repository.py`, `skill_storage.py` | Metadata validation, bounded ZIP/path rules, content hash, immutable revisions, publish/archive lifecycle | Implement in TypeScript; replace deployment-wide System Administrator authoring with target Tenant/platform ownership |
| Knowledge bases and documents | `domain/knowledge.py`, `knowledge_base_service.py`, `document_service.py`, repositories, `object_store.py` | Upload-session/completion contract, per-item batch errors, metadata, soft delete and GC semantics | Keep indexing/retrieval unavailable until implemented; replace operator-only ownership with target Tenant ownership |
| Personal files | `domain/library.py`, `library_service.py`, `library_repository.py`, `object_store.py`, `docs/LIBRARY_FILE_LIFECYCLE.md` | Tenant+user ownership, upload completion, preview/download capability, temporary/permanent lifecycle and GC | Start with permanent personal files; chat binding/promotion belongs to the later chat slice |
| Agent configuration | `domain/experts.py`, `expert_service.py` | Generic identity, prompt/instruction, Skill/knowledge/model/tool reference validation and secret-field rejection | Do not copy categories, market, guide/summon copy, task history or source routing model as the target Agent schema |
| Release/deployment mechanics | `domain/agent_builds.py`, `agent_build_service.py`, `agent_build_repository.py`, `clients/gateway_admin_client.py` | Stable desired hash, validate/apply/verify/fail/retry/rollback behavior and operation history | Split mutable definition, immutable release and per-Gateway deployment; apply target Tenant Gateway authorization |
| Tenant identity patterns | `domain/auth.py`, `domain/tenants.py`, `api/deps.py`, `USER_TENANT_RBAC_DESIGN.md` | Live user/membership revalidation, exact Tenant ownership filtering, operator-vs-Tenant separation | Use the accepted target roles and manager identities; do not copy the configured bearer System Administrator or source permission strings |
| Chat ownership | `domain/chat.py`, `chat_service.py`, `chat_repository.py` | Session ownership, persistence, streaming event translation, attachment validation and cancellation concepts | Deferred; remove Expert market/task dependencies and use Gateway capability contracts |
| Durable Agent work | `agent_run_*`, `runtime_execution_*`, human-interaction contracts | Failure/retry, durable event, lease and human-wait scenarios only | Deferred and blocked until an independent Agent-run contract is extracted from Team, Work Management and workflow dependencies |

The source's Skills and knowledge bases are deployment-owned catalogs. The target
intentionally changes that authority, so their authorization code is evidence of
what not to copy. Data validation and lifecycle semantics remain useful.

## 3. Allowed frontend references

| Capability | Source references | Reusable interaction | Do not copy |
| --- | --- | --- | --- |
| Skill management | `app/admin/(console)/skillsManage/page.tsx`, `lib/api/skills.ts` | Search/list/editor, manual content vs archive upload, revision visibility, publish/archive feedback | Source shell, backend proxy handlers, source roles and styling wholesale |
| Agent authoring | `app/admin/(console)/experts/page.tsx`, `lib/api/experts.ts` | Resource pickers, validation summary, build status/history and retry/rollback affordances | Market/category/task fields, one-page 962-line component, source routing assumptions |
| Knowledge/documents | `app/admin/(console)/knowledge/page.tsx`, `documents/page.tsx`, `lib/api/knowledge.ts` | Master/detail flow, batch upload progress, partial failure and document actions | Operator-only navigation and claims of completed retrieval |
| Personal files | `app/(user)/library/page.tsx`, `lib/api/library.ts` | Upload, filtering, preview/download/delete and lifecycle explanation | Product styling, promotion/chat coupling in the first file slice |
| Chat/test | `app/(user)/dialogue/page.tsx`, chat API modules, attachment helpers | Streaming rendering, permission prompts, history and attachment interaction ideas | The 1,500-line page, board/task coupling, direct source auth and proxy stack |
| Tenant administration | Tenant member pages and API clients | Membership list/editor and disabled-state feedback | Legacy Platform User activation and platform-role endpoints |

Frontend source pages are interaction studies, not components to transplant. New
pages use agwmngr primitives, authentication, API clients, scope rules and the
canonical IA.

## 4. Explicit exclusions

| Excluded domain | Examples | Reason |
| --- | --- | --- |
| Agent Teams and project/task bindings | `runtime_teams.py`, `agent_team_runtime.py`, frontend `agent-teams/` | Business/work orchestration domain, not Agent resource management |
| External Work Management connections | `runtime_connections.py`, `work_management_*`, frontend connection wizard/routes | External system integration and identity mapping are outside scope |
| Workflow engines | `workflow_*`, Airflow/Temporal adapters, engine connection and workflow UI | Engines are external callers through Gateway |
| Commercial product | plans, subscriptions, pricing, Expert market entitlements | Business-specific authority and product behavior |
| Legacy Platform User | `/users/platform`, activation and platform-role proxies | Conflicts with manager identity and accepted Tenant model |
| Product-specific shell/content | source navigation, branding, home/account marketing | agwmngr retains its own shell and product vocabulary |
| Source categories and task history | Expert categories, guide questions, summon copy, bound plans/tasks | Not required by the target Agent definition |

An excluded module may not enter indirectly through a shared import. Mixed source
modules must be decomposed before any generic behavior is reused.

## 5. Treatment of the old feature branch

The old branch contains useful implementation experiments but its 33 commits are
not the new delivery history.

| Old commits | Area | Decision |
| --- | --- | --- |
| `19d84c1`, `ad9c636` | Runtime smoke and Gateway v0.7 alignment | Re-derive as small patches and rerun against the pinned baseline |
| `ca12d55` | Shared contracts and Gateway client extraction | Reuse design and tests selectively after dependency review |
| `f9c0f01`–`c4994fd` | Explicit per-action resource grants and identity APIs | Do not port as target authorization; it conflicts with Tenant Admin/User policy. Reuse only repository/credential techniques after review |
| `71d4b0b`, `3f3ae94` | Skill/document/file services | Selectively port pure validation, lifecycle and repository behavior under new Tenant ownership |
| `064b431`–`85612aa` | Definition/release/deployment services | Selectively port invariants and tests after target authorization lands |
| `6a24c19`–`51c12b3` | Identity UI and UI-A route/page consolidation | Use as visual/behavior evidence only; rebuild in smaller route/page slices |
| `9c38263`–`f469ff0` | Generated migrations, cutover and backup tooling | Recreate after the final schema stabilizes; do not front-load them |
| `c5baa95` | P5 acceptance record | Historical evidence only; it does not certify the rebuilt branch |
| `44a2c3d`, `f2807f6` | My files discoverability fixes | Preserve the resolved IA decision in the target UI; do not port as standalone cleanup |
| `7cb3284` | Tenant authorization target | Superseded by the clarified target document on this branch, including the service-Principal grant rule |

No old feature commit is cherry-picked without first listing the exact files,
removing obsolete authority/UI assumptions and proving the resulting slice on the
new branch.

## 6. Per-slice source record

Every implementation PR/commit must state:

1. source files and pinned revisions inspected;
2. target contracts or behavior reused;
3. excluded fields/dependencies removed;
4. target authority and data owner;
5. tests ported or newly written; and
6. unsupported behavior left visibly unavailable.

Repository proximity, copied types, mock handlers or rendered pages do not count
as capability completion.
