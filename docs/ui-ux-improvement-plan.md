# UI/UX Improvement Plan: From "Resource CRUD Console" to "Agent Console"

> Project: `agwmngr` (the web management frontend for agent-gateway)
> Scope: structural UI/UX direction, aligned with the backend Agents Control Plane design
> Alignment source: `agent-gateway/docs/design/agents-control-plane.md` (finalized, **P0+P1 implemented**, P2/P3 still design-only)
> Last updated: 2026-06-20

## 1. Core Assessment

Code quality is good (glass-morphic dark theme, complete UI primitives, clean `lib/api.ts` boundary). The problem is not the code — it is that **the UI as a whole is organized by API shape, not by product positioning**.

agent-gateway positions itself as "**manage / observe / orchestrate / schedule agents**", but the current manager is essentially a **protocol-grouped resource CRUD console**: navigation is `LLM / MCP / ACP × Services / Routes`, and every page is just "a list + a modal form". The user's mental model is "I want to run an agent and see what it's doing", yet the UI forces them to think "first create an ACP service → then configure an ACP route → then go to runtime to look". **The two core value propositions — "observe" and "orchestrate" — barely exist in the UI.**

### 1.1 Key fact #1: the observability foundation isn't missing, it's left idle

> **The backend observability layer (`/admin/metrics/*`) is already fully implemented** — event detail, time series, breakdown by route/key/provider/model, a **cross-protocol interactions view** (the agent call-chain dimension with `trace_id / span_id / parent_span_id / agent_depth`), plus Prometheus export.

But on the frontend: the Usage page is mock data, Recharts is installed but unused, and not a single metrics API is wired in. The core tension is not "should we add observability capability" but "**the ready-made observability data foundation is sitting completely idle**". This downgrades observability work from a "big project" to immediately-shippable "wire the API + draw the charts".

### 1.2 Key fact #2: the backend Agents Control Plane P0+P1 has landed

The backend no longer treats `agents` as a 501 placeholder stub; it has defined a **formal product direction and implemented it through P1** (`docs/design/agents-control-plane.md`): make `agent` a **first-class management object**, with LLM/MCP/ACP/metrics demoted to the "resource / runtime" layers it orchestrates. This is exactly the direction of this document — **it confirms the "agent-centric" refactor from the product side**. Key points:

- **agent ≠ ACP service**. An agent binds one backend via `runtime.type`, with two built-in kinds:
  - `acp`: the **gateway owns** the process lifecycle (process pool / sessions / permission flow / transcript). Local, embeddable agents take this path; a custom agent should be **wrapped to speak ACP** (like codex-acp) rather than getting a new runtime type.
  - `http`: the **agent owns** its own lifecycle; the gateway just hands a task to its endpoint and observes the result. For business agents that expose a network endpoint.
  - LLM/MCP are **resources, not runtime types** — their availability is governed by `resources`, independent of runtime.
- The design explicitly requires the frontend to **"not present the acp service as the primary product concept"**; the UI must speak in agent terms throughout.
- Phased delivery (see §5): **P0a** (agent CRUD) → **P0b** (workspace aggregation + bundle/CLI parity) → **P1** (per-agent observability + `agent_id` attribution) → **P2** (tasks/schedules) → **P3** (multi-agent workflows).
- **Current status: P0a + P0b + P1 are implemented and their endpoints are all available; P2 / P3 remain design-only.**

> Conclusion: the direction is endorsed by the backend, and the agent endpoints are ready. The frontend **can develop directly against the real `/admin/agents` endpoints** — there is no need for the "build a skeleton on ACP endpoints first, then swap the data source" step. Advance two tracks in parallel: (a) wire up the idle observability foundation; (b) build the IA around "agent as a first-class object", connecting straight to real agent data. The only things still blocked are P2 (tasks/schedules), P3 (workflows), and deep resource health.

---

## 2. Backend Capability Inventory (the basis for landing)

Every recommendation must rest on the backend's real capabilities. Two categories:

**A. Ready — the frontend can use it immediately**

| Capability | Backend status | Representative API | Frontend implication |
|---|---|---|---|
| Metrics / Usage (events + time series + breakdown) | ✅ Complete | `/admin/metrics/llm/{events,timeseries,breakdown}`, mcp/acp isomorphic | Usage wires to real data, **no backend change needed** |
| Cross-protocol interactions + call chain | ✅ Complete | `/admin/metrics/interactions` (`trace_id`/`agent_depth`/`parent_span_id`) | **Runtime topology / orchestration view is shippable** |
| Live in-flight snapshot | ✅ Yes (polling) | `/admin/acp/runtime`, `/admin/mcp/runtime/{inflight,progress,history}` | Auto-refresh is enough; no general SSE but sufficient |
| ACP service/session/permission runtime state | ✅ Complete | `/admin/acp/services/{id}/sessions`, `/admin/acp/runtime/...` | Called when the agent workspace drills into sessions/transcripts (workspace only gives links) |
| Resource health | ⚠️ Shallow | Only `disabled` flag, `cliauth/refresher` toggle, ACP instance `state` | Health overview can only be shallow; deep (reachability/circuit-break/credential expiry) needs the backend |
| Config topology API (provider→route→key) | ❌ Not exposed | Must cross-reference `llm/routes` + `virtual_keys` + `providers` | Frontend joins itself; use interactions for **runtime topology** |

**B. Agents Control Plane**

| Phase | Endpoints | Status | Frontend capability unlocked |
|---|---|---|---|
| P0a | `GET/POST /admin/agents`, `GET/PUT/DELETE /admin/agents/{id}` | ✅ Implemented | Agents list + basic detail |
| P0b | `GET /admin/agents/{id}/workspace` (summary/index) | ✅ Implemented | Aggregated workspace (counts + runtime state + links, **not full content**) |
| P1 | `/{id}/{activity,usage,interactions,resources,health}` + `agent_id` attribution on event tables | ✅ Implemented | Reliable per-agent observability (activity feed / usage / health / call chain) |
| P2 | `/admin/agents/{id}/tasks`, `/{id}/schedules`, global `/admin/agent-tasks` | ❌ design-only | Task queue / schedule editor / cancel & retry |
| P3 | `/admin/agent-workflows`, `/{id}/runs` | ❌ design-only | Multi-agent orchestration graph / handoff timeline |

Legend: ✅ shippable now ｜ ⚠️ partly doable, deep part needs backend ｜ ❌ needs backend first

> Implementation details for the landed P0/P1 (from backend §11 — the frontend must align):
> - **No "create the backing service on the fly when creating an agent"**: auto-create is not implemented in P0 (the `OwnsService` flag exists but there is no write path). The create form can only **reference an existing ACP service**.
> - **The workspace has no "total session count"**: it only gives live runtime counts (pooled instances / in-flight / pending permission) + an ACP usage rollup + links; it does not compute a persisted distinct-session count. The session list is reached via links.
> - **`GET …/resources` returns resolved object summaries + an `exists` flag** (provider type / MCP transport / VirtualKey tag / route), not raw ids — render directly and highlight dangling references.
> - **Attribution fallback is ACP-service-level (unique) + MCP via owned routes**: per-agent usage/activity filters on `agent_id` OR owned routes OR ACP service; surface a caveat for untagged-but-mappable historical events.

---

## 3. Refactor Throughlines

In one sentence: **reorganize the IA from "protocol-grouped resource CRUD" into "observation + operations centered on agents as first-class objects", and wire up the idle metrics foundation immediately.**

Three throughlines:

1. **Observability becomes a first-class citizen**: wire up metrics so "how is the system right now" is visible at a glance, with a "live" real-time feel. **Depends on no new backend — start immediately.**
2. **Agent becomes a first-class object**: organize navigation and detail around the agent; **demote the ACP service to one of the agent's runtime backends**, no longer presented as the primary product concept. Develop directly against the real `/admin/agents` + `/workspace` endpoints (P0 is ready). Generalize the model by `runtime.type` (acp / http); do not hard-code ACP fields.
3. **Make runtime events that need human intervention surface proactively**: pending permissions, provider anomalies, etc. — push them into the nav / a global banner instead of burying them in a tab.

Keep the visual baseline (glass dark + blue accent); only polish for consistency, do not rebuild from scratch.

---

## 4. Layered Recommendations (by ROI)

### 🔴 Do now: make "observability" a real thing

The biggest gap from the positioning, and **immediately shippable** because the backend is ready — zero new backend dependency.

**4.1 Wire Usage to real metrics** 【Backend: ✅ supported】
- Replace `MOCK_DATA / MOCK_KEYS`; wire `/admin/metrics/llm/timeseries`, `/breakdown`, `/events`.
- Metrics: request volume / error rate / latency P50·P95 / token · cost; drill down by route / virtual-key / provider / model.
- Use the already-installed Recharts for line, bar, and donut charts.

**4.2 Real-time feel** 【Backend: ✅ in-flight supported (polling)】
- ACP/MCP Runtime polls automatically by default (`/admin/{acp,mcp}/runtime`); give the UI an `Auto-refresh: 5s ▾` toggle + last-updated timestamp.
- Implement with SWR `refreshInterval`, replacing the site-wide `useState/useEffect/loading` boilerplate along the way.
- Add a "recent requests / activity feed" panel: `/admin/metrics/llm/events?limit=N` (with the isomorphic mcp/acp endpoints) — this is the soul of a console.
- Note: the backend has no general SSE (except ACP chat); polling is fine.

**4.3 Upgrade Overview into a "health dashboard"** 【Backend: ⚠️ shallow doable】
- Expand the top gateway status pill into aggregate health: provider `disabled`, whether the refresher is running, ACP instance pool `state`, pending permission count.
- Dead counters → live metrics with sparklines (using the 4.1 time series).
- Deep health (reachability / circuit-break / credential expiry time) is not exposed by the backend — **mark it "pending backend", do not pretend it exists in the UI**.

### 🟠 IA refactor: agent as a first-class object

**4.4 Agents list + per-agent workspace** 【Backend: ✅ P0a/P0b ready, wire to real endpoints】
- Add a top-level **Agents** entry (list + detail page); the detail tabs align with the backend design: **Overview / Runtime / Sessions / Routes / Configuration** (+ Activity / Usage, whose P1 endpoints are also ready).
- **Data source**: list/detail wire directly to `GET /admin/agents`, `GET /admin/agents/{id}`; the aggregated view wires directly to `GET /admin/agents/{id}/workspace`. **The UI speaks in agent terms and does not expose "acp service" as the primary concept.**
- **Honor workspace = summary/index**: the workspace shows only counts + runtime state + links; **there is no "total session count" field** (the backend does not compute a persisted session count); the session list and full transcript go through their own paginated endpoints (`GET /<acp-route>/sessions`, `/sessions/{id}/transcript`) on demand, never pulled all at once into the workspace.
- **Generalize by `runtime.type`**: an `http`-runtime agent has no instance pool/sessions/ACP permissions, so the workspace must degrade gracefully to "agent object + resources + tasks + metrics"; do not make ACP fields required.
- **Create/edit form** aligns with the agent model: `runtime.acp.service_id` is the authoritative binding (**it can only reference an existing ACP service — P0 does not support creating a service on the fly**); `routes.acp_route_ids` is display/attribution only; handle the **1:1 constraint** — give a clear error when an ACP service is already claimed by another agent, or when routes are inconsistent with the runtime service. `permission_mode / allowed_roots / cwd` are owned by the ACP service; the workspace shows them **read-through**, and the edit entry points to that service.

**4.5 Contextual actions, no re-typing** 【Backend: ✅ supported】
- Runtime's Close Thread should be a "Close" button directly on each instance row (`DELETE /admin/acp/runtime/threads/{service_id}/{thread_id}`), not a modal where you type the ID by hand.
- Same for permission resolve — inline Approve/Reject.

**4.6 Command palette (⌘K)** 【Backend: ✅ reuse existing list endpoints】
- Quick jump / search any agent / resource. Low effort, big lift for power users.

**4.7 Round out lists with search / filter / sort / empty-state guidance** 【Backend: ✅ frontend-only】
- Pair empty states with a CTA (cf. the Overview setup checklist).

### 🟡 Consistency and visual polish

**4.8 Extract `<Card>` / `<PageHeader>` primitives**: eliminate the per-page hand-written `rounded-lg border ... bg-slate-900/40`, reusing `components/ui/card.tsx` consistently.

**4.9 Define a type scale**: reduce `text-[10px]/[11px]`; body text no smaller than 12px.

**4.10 Move complex forms out of modals**: ACP service / agent configs have many fields — use a side panel or full-page editor; reserve modals for simple resources.

**4.11 Run protocol/runtime color coding throughout**: give LLM / MCP / ACP (and acp/http runtime) each a low-saturation accent color for faster scanning.

### 🟢 Orchestration / scheduling visibility (partly doable now)

**4.12 Runtime call-chain / topology view** 【Backend: ✅ supported, overlooked】
- `/admin/metrics/interactions` carries `trace_id / span_id / parent_span_id / agent_depth`, enough to draw the call chain of a request across agents. This best conveys the "orchestration" identity, and the data is ready. The P3 workflow view also uses interaction traces as its runtime-topology source.

**4.13 Config topology graph (provider → route → key)** 【Backend: ⚠️ needs frontend join】
- No dedicated topology API; the frontend cross-joins the lists itself. Read-only is fine; medium effort.

**4.14 Task / schedule panel** 【Backend: ❌ only in P2】
- The backend's P2 plans `/admin/agents/{id}/tasks`, `/{id}/schedules`, and global `/admin/agent-tasks` (note the naming: the global collection uses the `agent-tasks` prefix to avoid colliding with `/admin/agents/{id}`).
- **Shelved for now**, pending backend P2; then build the task queue / task detail / schedule editor / cancel & retry. **No vaporware up front.**

---

## 5. Alignment with the Backend Agents Control Plane

This is the core of this update: bucket frontend work by "**whether it depends on new backend**" and map it to backend phases, so the two roadmaps can be reconciled.

### 5.1 Frontend tier × backend phase dependency map

| Frontend work | Dependency | When doable |
|---|---|---|
| Observability everywhere (Usage real data / Runtime self-refresh / activity feed / shallow health board) | Ready metrics + runtime | **Now** |
| Infrastructure (SWR takeover + auto-refresh + `<Card>`/`<PageHeader>` + type scale) | None | **Now** |
| Call-chain / config-topology view | Ready interactions / list join | **Now** |
| Agents list + basic detail (direct to `/admin/agents`) | Ready **P0a** | **Now** |
| Workspace aggregation (direct to `/admin/agents/{id}/workspace`) | Ready **P0b** | **Now** |
| Per-agent observability (`/{id}/usage,activity,health,interactions,resources`) | Ready **P1** (incl. `agent_id` attribution) | **Now** |
| Task queue / schedule editor | Backend **P2** | After backend P2 |
| Multi-agent workflow graph / handoff timeline | Backend **P3** | After backend P3 |

> Conclusion: **observability + infrastructure + the full agent console (through per-agent observability) are all doable now**, developed directly against real endpoints, with no ACP fallback transition. Only P2 (tasks/schedules) and P3 (workflows) remain blocked.

### 5.2 Constraints the frontend must honor (from the design doc)

1. **Do not treat the ACP service as the primary product concept**. The UI speaks in agent terms throughout; the ACP service appears only in a "config / runtime binding" context.
2. **Generalize by `runtime.type`**, both acp/http forms; do not hard-code ACP fields as required, and degrade the http-agent workspace.
3. **The workspace is an index, not content**: show only counts + runtime state + links; full transcript/session content goes through paginated endpoints on demand.
4. **1:1 binding**: one agent ↔ one ACP service (both directions). The create/update form must handle the "service already claimed" and "routes inconsistent with runtime service" errors.
5. **Resources is a management view; P0/P1 does no data-plane enforcement**: the UI presents it as "resources this agent is allowed to use" without implying per-request enforcement; the data plane is still gated by VirtualKey + route policy.
6. **Per-agent observability attribution**: from P1 the backend stamps `agent_id` at write time; on ambiguity (a route/service mapping to 0 or multiple agents) it falls back to service/route mapping — **the frontend must surface this ambiguity caveat, not pretend precision**.
7. **Separate policy from runtime config**: `permission_mode / allowed_roots / cwd` belong to the ACP service (workspace read-through, edit points to the service); only `max_agent_depth / budget` etc. live on the agent's `policy`.
8. **Memory is not in agent resources for P0–P1**; deleting an agent does not cascade-delete its backing service/route (non-cascading by default).

---

## 6. Landing Roadmap

| Phase | Content | Dependency |
|---|---|---|
| 0 | Extract `<Card>` / `<PageHeader>` primitives + define type scale | None (pure refactor groundwork) |
| 1 | SWR takes over the data layer + global auto-refresh toggle | None (infrastructure) |
| 2 | Wire Usage to real metrics + Overview health dashboard (Recharts) | Ready metrics |
| 3 | ACP/MCP Runtime auto-refresh + inline actions + permission alert promoted | Ready runtime |
| 4 | Agents list + detail (direct to `/admin/agents` + `/workspace`, runtime.type generalized) | Ready **P0a / P0b** |
| 5 | Per-agent observability (usage/activity/health/resources) | Ready **P1** |
| 6 | Runtime call-chain view (interactions) + config topology graph | Ready interactions / join |
| 7 | Task / schedule panel | Backend P2 |
| 8 | Multi-agent workflow graph | Backend P3 |
| — | Deep resource health (reachability/circuit-break/credential expiry) | Pending backend |

Phases 0–6 are all ready and can proceed immediately — the agent console develops directly against real endpoints, **with no ACP fallback transition shell**. Only 7 (tasks/schedules) and 8 (workflows) wait on backend P2/P3.

---

## 7. Check Against the Positioning (self-audit)

| Positioning keyword | Current UI | After refactor | Backend support |
|---|---|---|---|
| Manage | ✅ Complete CRUD | Consolidated into an agent-centric workspace | ✅ existing / P0 |
| Observe | ❌ mock | Real Usage + health board + activity feed + per-agent observability | ✅ existing / P1 closed out |
| Orchestrate | ❌ none | Call chain + config topology + workflow graph | ✅ existing / ⚠️ / P3 |
| Schedule | ❌ none | Task queue + schedule editor | ❌ P2 |

---

## 8. One-Sentence Summary

The backend has set "agent as a first-class object" as the direction from the product side (acp/http dual runtime, phased P0a→P3), and **P0+P1 have landed with all endpoints available**. The right cadence for the frontend is **two tracks in parallel**: (1) **wire up the idle metrics/interactions observability foundation** so the product immediately turns from a "config console" into an "observable console"; (2) **build the IA around the agent model and connect directly to the real `/admin/agents` + `/workspace` + per-agent observability endpoints** (generalized by runtime.type, workspace as an index), with no ACP fallback transition. Only tasks/schedules (P2) and multi-agent workflows (P3) wait on the backend — explicitly shelved, no vaporware.
