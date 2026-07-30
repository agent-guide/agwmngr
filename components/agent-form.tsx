"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { MultiSelect } from "@/components/ui/multi-select";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  ApiError,
  createAgent,
  updateAgent,
  listLLMRoutes,
  listMCPRoutes,
  listMCPServices,
  listProviders,
  listVirtualKeys,
  RESERVED_AGENT_ID,
  type ACPAgentType,
  type ACPPermissionMode,
  type Agent,
  type AgentPayload,
  type AgentRuntime,
  type AgentRuntimeBuiltin,
  type AgentRuntimeType,
} from "@/lib/api";

interface RefData {
  llmRoutes: { id: string }[];
  mcpRoutes: { id: string }[];
  mcpServices: { id: string }[];
  providers: { id: string }[];
  virtualKeys: { id: string }[];
}

const EMPTY_REF: RefData = {
  llmRoutes: [], mcpRoutes: [], mcpServices: [], providers: [], virtualKeys: [],
};

// Accept Unix absolute paths (/foo), Windows drive paths (C:\foo or C:/foo), and
// UNC paths (\\server\share). The path is validated against the OS where the
// agent-gateway runs, not the browser, so both styles are allowed.
const ABSOLUTE_PATH_RE = /^(\/|[A-Za-z]:[\\/]|\\\\)/;
function isAbsolutePath(p: string): boolean {
  return ABSOLUTE_PATH_RE.test(p.trim());
}

const NANOS_PER_SECOND = 1_000_000_000;

function parseKeyValueLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function formatKeyValueLines(record: Record<string, string> | undefined): string {
  return Object.entries(record ?? {}).map(([k, v]) => `${k}=${v}`).join("\n");
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Starting point for a builtin definition. The builtin runtime is edited as raw
 * JSON in v0.5.0: its topology carries recursive inline sub-agents plus
 * middleware/permission/limit blocks, so a full visual editor is deferred (see
 * docs/v0.5-alignment-plan.md D1). JSON — not YAML — is the canonical form here
 * because it is exactly the `POST /admin/agents` wire shape, and a bundle's
 * `agents:` entry decodes to the same structure.
 */
const BUILTIN_TEMPLATE = `{
  "model": {
    "llm_route_id": ""
  },
  "system_prompt": "",
  "topology": {
    "kind": "single"
  }
}`;

function Field({ label, hint, required, action, children }: { label: string; hint?: string; required?: boolean; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="block text-sm font-medium text-slate-300">
          {label} {required && <span className="text-rose-400">*</span>}
        </label>
        {action}
      </div>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Deep link to a resource's own page so the user can create it without losing
 *  the in-progress wizard draft. Opens in a new tab; pair with the Refresh
 *  control to pull the newly-created resource into the selectors. */
function NewLink({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-blue-400 hover:underline">
      + New ↗
    </a>
  );
}

const TEXTAREA_CLASS = "w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 font-mono text-xs text-slate-100 focus:border-blue-500/60 focus:outline-none";

const WIZARD_STEPS = ["Basics", "Runtime", "Resources", "Review"] as const;

export function AgentForm({ initial, wizard = false }: { initial?: Agent; wizard?: boolean }) {
  const isEdit = !!initial;
  const router = useRouter();
  const { showToast } = useToast();

  const [ref, setRef] = useState<RefData>(EMPTY_REF);
  const [refreshing, setRefreshing] = useState(false);
  const [step, setStep] = useState(0);
  const [id, setId] = useState(initial?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [runtimeType, setRuntimeType] = useState<AgentRuntimeType>(initial?.runtime.type ?? "acp");

  // ── ACP runtime (inlined on the agent since v0.5.0) ──
  const [acpAgentType, setAcpAgentType] = useState<ACPAgentType>(initial?.runtime.acp?.agent_type ?? "codex");
  const [acpCwd, setAcpCwd] = useState(initial?.runtime.acp?.cwd ?? "");
  const [acpAllowedRoots, setAcpAllowedRoots] = useState((initial?.runtime.acp?.allowed_roots ?? []).join("\n"));
  const [acpDefaultModel, setAcpDefaultModel] = useState(initial?.runtime.acp?.default_model ?? "");
  const [acpEnv, setAcpEnv] = useState(formatKeyValueLines(initial?.runtime.acp?.env));
  const [acpConfigOverrides, setAcpConfigOverrides] = useState(formatKeyValueLines(initial?.runtime.acp?.config_overrides));
  const [acpPermissionMode, setAcpPermissionMode] = useState<ACPPermissionMode>(initial?.runtime.acp?.permission_mode ?? "deny");
  const [acpIdleTtl, setAcpIdleTtl] = useState(
    initial?.runtime.acp?.idle_ttl ? String(Math.round(initial.runtime.acp.idle_ttl / NANOS_PER_SECOND)) : "0",
  );
  const [acpMaxInstances, setAcpMaxInstances] = useState(
    initial?.runtime.acp?.max_instances ? String(initial.runtime.acp.max_instances) : "",
  );
  const [acpCodexMode, setAcpCodexMode] = useState(initial?.runtime.acp?.codex?.mode ?? "adapter");
  const [acpCodexCommand, setAcpCodexCommand] = useState(initial?.runtime.acp?.codex?.adapter_command ?? "");
  const [acpCodexArgs, setAcpCodexArgs] = useState((initial?.runtime.acp?.codex?.adapter_args ?? []).join("\n"));

  // ── HTTP runtime ──
  const [httpEndpoint, setHttpEndpoint] = useState(initial?.runtime.http?.endpoint ?? "");
  const [httpAuthRef, setHttpAuthRef] = useState(initial?.runtime.http?.auth_ref ?? "");

  // ── Builtin runtime (raw JSON) ──
  const [builtinJson, setBuiltinJson] = useState(
    initial?.runtime.builtin ? JSON.stringify(initial.runtime.builtin, null, 2) : BUILTIN_TEMPLATE,
  );

  const [llmRouteIds, setLlmRouteIds] = useState<string[]>(initial?.routes.llm_route_ids ?? []);
  const [mcpRouteIds, setMcpRouteIds] = useState<string[]>(initial?.routes.mcp_route_ids ?? []);
  const [providerIds, setProviderIds] = useState<string[]>(initial?.resources.provider_ids ?? []);
  const [mcpServiceIds, setMcpServiceIds] = useState<string[]>(initial?.resources.mcp_service_ids ?? []);
  const [virtualKeyIds, setVirtualKeyIds] = useState<string[]>(initial?.resources.virtual_key_ids ?? []);
  const [maxAgentDepth, setMaxAgentDepth] = useState(initial?.policy.max_agent_depth ? String(initial.policy.max_agent_depth) : "");
  const [maxTurns, setMaxTurns] = useState(initial?.policy.budget?.max_turns_per_day ? String(initial.policy.budget.max_turns_per_day) : "");
  const [maxTokens, setMaxTokens] = useState(initial?.policy.budget?.max_tokens_per_day ? String(initial.policy.budget.max_tokens_per_day) : "");
  const [disabled, setDisabled] = useState(initial?.disabled ?? false);
  const [saving, setSaving] = useState(false);

  const loadRef = useCallback(async () => {
    const [llmRoutes, mcpRoutes, mcpServices, providers, vkeys] = await Promise.allSettled([
      listLLMRoutes(), listMCPRoutes(), listMCPServices(), listProviders(), listVirtualKeys(),
    ]);
    setRef({
      llmRoutes: llmRoutes.status === "fulfilled" ? llmRoutes.value.map((r) => ({ id: r.id })) : [],
      mcpRoutes: mcpRoutes.status === "fulfilled" ? mcpRoutes.value.map((r) => ({ id: r.id })) : [],
      mcpServices: mcpServices.status === "fulfilled" ? mcpServices.value.map((s) => ({ id: s.id })) : [],
      providers: providers.status === "fulfilled" ? providers.value.map((p) => ({ id: p.id })) : [],
      virtualKeys: vkeys.status === "fulfilled" ? vkeys.value.map((k) => ({ id: k.id })) : [],
    });
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await loadRef();
      if (!alive) return;
    })();
    return () => { alive = false; };
  }, [loadRef]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await loadRef();
      showToast("Options refreshed", "success");
    } finally {
      setRefreshing(false);
    }
  };

  // Parse the builtin JSON once per keystroke so both validation and the review
  // step read the same result.
  const builtinParse = useMemo((): { value?: AgentRuntimeBuiltin; error?: string } => {
    if (runtimeType !== "builtin") return {};
    try {
      const parsed = JSON.parse(builtinJson) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { error: "Builtin definition must be a JSON object" };
      }
      return { value: parsed as AgentRuntimeBuiltin };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Invalid JSON" };
    }
  }, [runtimeType, builtinJson]);

  const buildRuntime = (): AgentRuntime => {
    if (runtimeType === "acp") {
      const roots = splitLines(acpAllowedRoots);
      const env = parseKeyValueLines(acpEnv);
      const overrides = parseKeyValueLines(acpConfigOverrides);
      const idleSeconds = parseInt(acpIdleTtl, 10) || 0;
      const codexArgs = splitLines(acpCodexArgs);
      return {
        type: "acp",
        acp: {
          agent_type: acpAgentType,
          cwd: acpCwd.trim(),
          permission_mode: acpPermissionMode,
          ...(idleSeconds > 0 && { idle_ttl: idleSeconds * NANOS_PER_SECOND }),
          ...(roots.length && { allowed_roots: roots }),
          ...(acpDefaultModel.trim() && { default_model: acpDefaultModel.trim() }),
          ...(Object.keys(env).length && { env }),
          ...(Object.keys(overrides).length && { config_overrides: overrides }),
          ...(acpMaxInstances.trim() && { max_instances: Number(acpMaxInstances) }),
          ...(acpAgentType === "codex" && {
            codex: {
              mode: acpCodexMode,
              ...(acpCodexCommand.trim() && { adapter_command: acpCodexCommand.trim() }),
              ...(codexArgs.length && { adapter_args: codexArgs }),
            },
          }),
        },
      };
    }
    if (runtimeType === "builtin") {
      // Validated before submit; a parse failure never reaches here.
      return { type: "builtin", builtin: builtinParse.value as AgentRuntimeBuiltin };
    }
    return {
      type: "http",
      http: { endpoint: httpEndpoint.trim(), auth_ref: httpAuthRef.trim() || undefined },
    };
  };

  const buildPayload = (): AgentPayload => ({
    id: id.trim(),
    name: name.trim(),
    description: description.trim() || undefined,
    runtime: buildRuntime(),
    routes: {
      llm_route_ids: llmRouteIds.length ? llmRouteIds : undefined,
      mcp_route_ids: mcpRouteIds.length ? mcpRouteIds : undefined,
    },
    resources: {
      provider_ids: providerIds.length ? providerIds : undefined,
      mcp_service_ids: mcpServiceIds.length ? mcpServiceIds : undefined,
      virtual_key_ids: virtualKeyIds.length ? virtualKeyIds : undefined,
    },
    policy: {
      max_agent_depth: maxAgentDepth ? Number(maxAgentDepth) : undefined,
      budget:
        maxTurns || maxTokens
          ? {
              max_turns_per_day: maxTurns ? Number(maxTurns) : undefined,
              max_tokens_per_day: maxTokens ? Number(maxTokens) : undefined,
            }
          : undefined,
    },
    disabled,
  });

  // Returns an error message if the given wizard step is incomplete, else null.
  const validateStep = (s: number): string | null => {
    if (s === 0) {
      if (!id.trim()) return "Agent ID is required";
      // The gateway routes /admin/agents/routes* to a separate mux ahead of
      // /admin/agents/{id}, so an agent with this id would be unreachable.
      if (id.trim() === RESERVED_AGENT_ID) return `"${RESERVED_AGENT_ID}" is a reserved agent ID`;
      if (!name.trim()) return "Name is required";
    }
    if (s === 1) {
      if (runtimeType === "acp") {
        if (!acpCwd.trim()) return "Working directory is required";
        if (!isAbsolutePath(acpCwd)) return "Working directory must be an absolute path";
        if (splitLines(acpAllowedRoots).some((r) => !isAbsolutePath(r))) {
          return "Allowed roots must each be an absolute path";
        }
      }
      if (runtimeType === "builtin") {
        if (builtinParse.error) return `Builtin definition: ${builtinParse.error}`;
        if (!builtinParse.value?.model?.llm_route_id?.trim()) {
          return "Builtin definition requires model.llm_route_id";
        }
        if (!builtinParse.value?.topology?.kind) {
          return "Builtin definition requires topology.kind";
        }
      }
      if (runtimeType === "http" && !httpEndpoint.trim()) return "HTTP runtime requires an endpoint";
    }
    return null;
  };

  const submit = async () => {
    for (let s = 0; s <= 1; s++) {
      const err = validateStep(s);
      if (err) { showToast(err, "error"); if (wizard) setStep(s); return; }
    }
    setSaving(true);
    try {
      const payload = buildPayload();
      const saved = isEdit ? await updateAgent(initial!.id, payload) : await createAgent(payload);
      showToast(isEdit ? "Agent updated" : "Agent created", "success");
      router.push(`/dashboard/agents/${encodeURIComponent(saved.id)}`);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to save agent", "error");
    } finally {
      setSaving(false);
    }
  };

  const next = () => {
    const err = validateStep(step);
    if (err) { showToast(err, "error"); return; }
    setStep((s) => Math.min(s + 1, WIZARD_STEPS.length - 1));
  };

  // ── Card sections (shared between wizard steps and the full edit form) ──

  const identityCard = (
    <Card>
      <CardHeader><CardTitle>Identity</CardTitle></CardHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Agent ID" required hint={isEdit ? "Immutable." : "Stable identifier, e.g. coding-agent."}>
          <Input name="agent-id" value={id} onChange={setId} disabled={isEdit} placeholder="coding-agent" />
        </Field>
        <Field label="Name" required>
          <Input name="agent-name" value={name} onChange={setName} placeholder="Coding Agent" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description">
            <Input name="agent-desc" value={description} onChange={setDescription} placeholder="Codex-backed development agent" />
          </Field>
        </div>
      </div>
    </Card>
  );

  const acpRuntimeFields = (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Agent type" required>
          <Select
            name="acp-agent-type"
            value={acpAgentType}
            onChange={(v) => setAcpAgentType(v as ACPAgentType)}
            options={[{ value: "codex", label: "codex" }, { value: "opencode", label: "opencode" }]}
          />
        </Field>
        <Field label="Permission mode" hint="deny rejects tool calls; auto_approve runs them; interactive asks for a decision.">
          <Select
            name="acp-permission-mode"
            value={acpPermissionMode}
            onChange={(v) => setAcpPermissionMode(v as ACPPermissionMode)}
            options={[
              { value: "deny", label: "deny" },
              { value: "auto_approve", label: "auto_approve" },
              { value: "interactive", label: "interactive" },
            ]}
          />
        </Field>
      </div>
      <Field label="Working directory (cwd)" required hint="Absolute path. The agent runs here by default; every turn cwd must sit under an allowed root.">
        <Input name="acp-cwd" value={acpCwd} onChange={setAcpCwd} placeholder="/tmp/acp-codex  or  C:\\acp\\workspace" />
      </Field>
      <Field label="Allowed roots" hint="One absolute path per line. Defaults to the working directory when empty.">
        <textarea value={acpAllowedRoots} onChange={(e) => setAcpAllowedRoots(e.target.value)} rows={2} className={TEXTAREA_CLASS} placeholder={"/tmp/acp-codex"} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Default model">
          <Input name="acp-default-model" value={acpDefaultModel} onChange={setAcpDefaultModel} placeholder="optional" />
        </Field>
        <Field label="Idle TTL (seconds)" hint="0 disables idle expiry.">
          <Input type="number" name="acp-idle-ttl" value={acpIdleTtl} onChange={setAcpIdleTtl} placeholder="0" />
        </Field>
        <Field label="Max instances" hint="Pool ceiling. Blank uses the gateway default.">
          <Input type="number" name="acp-max-instances" value={acpMaxInstances} onChange={setAcpMaxInstances} placeholder="optional" />
        </Field>
      </div>
      <Field label="Environment variables" hint="One KEY=VALUE per line, merged over the gateway process environment. Use it for a per-agent home, e.g. CODEX_HOME.">
        <textarea value={acpEnv} onChange={(e) => setAcpEnv(e.target.value)} rows={2} className={TEXTAREA_CLASS} placeholder={"CODEX_HOME=/tmp/acp-codex/.codex"} />
      </Field>
      <Field label="Config overrides" hint="One KEY=VALUE per line, applied as ACP config options on the session.">
        <textarea value={acpConfigOverrides} onChange={(e) => setAcpConfigOverrides(e.target.value)} rows={2} className={TEXTAREA_CLASS} placeholder={"model=gpt-5"} />
      </Field>
      {acpAgentType === "codex" && (
        <div className="space-y-4 rounded-md border border-slate-700/60 bg-slate-900/30 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Codex settings</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mode">
              <Select
                name="acp-codex-mode"
                value={acpCodexMode}
                onChange={setAcpCodexMode}
                options={[{ value: "adapter", label: "adapter" }, { value: "app_server", label: "app_server" }]}
              />
            </Field>
            <Field label="Adapter command">
              <Input name="acp-codex-command" value={acpCodexCommand} onChange={setAcpCodexCommand} placeholder="codex-acp" />
            </Field>
          </div>
          <Field label="Adapter args" hint="One argument per line.">
            <textarea value={acpCodexArgs} onChange={(e) => setAcpCodexArgs(e.target.value)} rows={2} className={TEXTAREA_CLASS} placeholder={"--flag"} />
          </Field>
        </div>
      )}
    </div>
  );

  const builtinRuntimeFields = (
    <div className="space-y-3">
      <Field
        label="Builtin definition (JSON)"
        required
        hint="The in-process ADK definition: model.llm_route_id, topology.kind, tools[], middlewares, permissions, limits. Recursive sub-agents live under topology.sub_agents."
        action={<NewLink href="/dashboard/llm/routes" />}
      >
        <textarea
          value={builtinJson}
          onChange={(e) => setBuiltinJson(e.target.value)}
          rows={18}
          spellCheck={false}
          className={cn(TEXTAREA_CLASS, builtinParse.error && "border-rose-500/70")}
        />
      </Field>
      {builtinParse.error ? (
        <p className="rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-2 font-mono text-xs text-rose-300">
          {builtinParse.error}
        </p>
      ) : (
        <p className="text-xs text-slate-500">
          Valid JSON. This is the same structure a gateway bundle&apos;s <span className="font-mono">agents[].runtime.builtin</span> carries,
          so an <span className="font-mono">agwctl gateway export</span> fragment can be pasted here directly.
        </p>
      )}
      <p className="text-xs text-slate-500">
        Available topologies: single, sequential, parallel, loop, supervisor, planexecute, deep, custom.
        A model resolves through an LLM route, never a raw provider.
      </p>
    </div>
  );

  const httpRuntimeFields = (
    <div className="space-y-4">
      <div className="rounded-md border-2 border-amber-500/60 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200" role="alert">
        <p className="font-semibold">HTTP runtime is not executable in v0.5.0</p>
        <p className="mt-1 leading-5 text-amber-300/90">
          The agent will validate, persist, appear in workspace, and accept virtual key assignment, and its
          route will match and authenticate normally — but a turn returns 501 runtime_not_executable until
          the HTTP backend ships. This is expected, not a matcher or credential fault.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Endpoint" required hint="The agent's HTTP task endpoint.">
          <Input name="http-endpoint" value={httpEndpoint} onChange={setHttpEndpoint} placeholder="https://agent.internal/run" />
        </Field>
        <Field label="Auth ref" hint="Optional credential reference. Secret material never lives on the agent object.">
          <Input name="http-auth" value={httpAuthRef} onChange={setHttpAuthRef} placeholder="credential-id" />
        </Field>
      </div>
    </div>
  );

  const runtimeCard = (
    <Card>
      <CardHeader><CardTitle>Runtime</CardTitle></CardHeader>
      <div className="space-y-4">
        <Field
          label="Runtime type"
          required
          hint="acp = the gateway pools an external agent process; builtin = an in-process ADK definition, no separate process; http = the agent owns its own lifecycle."
        >
          <Select
            name="runtime-type"
            value={runtimeType}
            onChange={(v) => setRuntimeType(v as AgentRuntimeType)}
            options={[
              { value: "acp", label: "acp — gateway-managed process" },
              { value: "builtin", label: "builtin — in-process ADK" },
              { value: "http", label: "http — self-managed (not executable yet)" },
            ]}
          />
        </Field>
        {isEdit && initial && initial.runtime.type !== runtimeType && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
            Changing the runtime keeps this agent&apos;s id, its ingress routes, their URLs, and every virtual key
            allowlist entry. Clients keep the common <span className="font-mono">/turn</span> call but must refresh
            optional capabilities — sessions, transcript, and permission support can differ.
          </p>
        )}

        {runtimeType === "acp" && acpRuntimeFields}
        {runtimeType === "builtin" && builtinRuntimeFields}
        {runtimeType === "http" && httpRuntimeFields}
      </div>
    </Card>
  );

  const routesCard = (
    <Card>
      <CardHeader><CardTitle>Routes <span className="text-xs font-normal text-slate-500">(display / attribution only)</span></CardTitle></CardHeader>
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          Ingress is not configured here. An agent route names its own <span className="font-mono">agent_id</span>, so
          create it on the <Link href="/dashboard/agents/routes" className="text-blue-400 hover:underline">Agent Routes</Link> page.
        </p>
        <Field label="LLM routes" action={<NewLink href="/dashboard/llm/routes" />}>
          <MultiSelect options={ref.llmRoutes.map((r) => ({ value: r.id, label: r.id }))} selected={llmRouteIds} onChange={setLlmRouteIds} emptyText="No LLM routes." />
        </Field>
        <Field label="MCP routes" action={<NewLink href="/dashboard/mcp/routes" />}>
          <MultiSelect options={ref.mcpRoutes.map((r) => ({ value: r.id, label: r.id }))} selected={mcpRouteIds} onChange={setMcpRouteIds} emptyText="No MCP routes." />
        </Field>
      </div>
    </Card>
  );

  const resourcesCard = (
    <Card>
      <CardHeader><CardTitle>Resources <span className="text-xs font-normal text-slate-500">(allowed to use — not data-plane enforced)</span></CardTitle></CardHeader>
      <div className="space-y-4">
        <Field label="Providers" action={<NewLink href="/dashboard/llm/providers" />}>
          <MultiSelect options={ref.providers.map((p) => ({ value: p.id, label: p.id }))} selected={providerIds} onChange={setProviderIds} emptyText="No providers." />
        </Field>
        <Field label="MCP services" action={<NewLink href="/dashboard/mcp/services" />}>
          <MultiSelect options={ref.mcpServices.map((s) => ({ value: s.id, label: s.id }))} selected={mcpServiceIds} onChange={setMcpServiceIds} emptyText="No MCP services." />
        </Field>
        <Field label="Virtual keys" action={<NewLink href="/dashboard/general/virtual-keys" />}>
          <MultiSelect options={ref.virtualKeys.map((k) => ({ value: k.id, label: k.id }))} selected={virtualKeyIds} onChange={setVirtualKeyIds} emptyText="No virtual keys." />
        </Field>
      </div>
    </Card>
  );

  const policyCard = (
    <Card>
      <CardHeader><CardTitle>Policy</CardTitle></CardHeader>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Max agent depth" hint="Nested-agent call limit.">
          <Input type="number" name="max-depth" value={maxAgentDepth} onChange={setMaxAgentDepth} placeholder="3" />
        </Field>
        <Field label="Max turns / day">
          <Input type="number" name="max-turns" value={maxTurns} onChange={setMaxTurns} placeholder="500" />
        </Field>
        <Field label="Max tokens / day">
          <Input type="number" name="max-tokens" value={maxTokens} onChange={setMaxTokens} placeholder="2000000" />
        </Field>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" checked={disabled} onChange={(e) => setDisabled(e.target.checked)} className="h-4 w-4 rounded border-slate-600 bg-slate-800" />
        Disabled
      </label>
    </Card>
  );

  const reviewRow = (label: string, value: React.ReactNode) => (
    <div className="flex items-start justify-between gap-4 border-b border-slate-700/50 py-2 last:border-b-0">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <span className="min-w-0 text-right text-sm text-slate-200">{value}</span>
    </div>
  );
  const reviewList = (ids: string[]) => (ids.length ? <span className="font-mono text-xs">{ids.join(", ")}</span> : <span className="text-slate-500">—</span>);

  const runtimeReview = () => {
    if (runtimeType === "acp") {
      return <span>acp → <span className="font-mono">{acpAgentType}</span> @ <span className="font-mono">{acpCwd || "—"}</span></span>;
    }
    if (runtimeType === "builtin") {
      if (builtinParse.error) return <span className="text-rose-300">builtin → invalid JSON</span>;
      const b = builtinParse.value;
      return (
        <span>
          builtin → <span className="font-mono">{b?.topology?.kind || "—"}</span> via{" "}
          <span className="font-mono">{b?.model?.llm_route_id || "—"}</span>
        </span>
      );
    }
    return <span>http → <span className="font-mono">{httpEndpoint || "—"}</span></span>;
  };

  const reviewCard = (
    <Card>
      <CardHeader><CardTitle>Review</CardTitle></CardHeader>
      <div className="space-y-0">
        {reviewRow("Agent ID", <span className="font-mono">{id || "—"}</span>)}
        {reviewRow("Name", name || "—")}
        {description && reviewRow("Description", description)}
        {reviewRow("Runtime", runtimeReview())}
        {reviewRow("LLM routes", reviewList(llmRouteIds))}
        {reviewRow("MCP routes", reviewList(mcpRouteIds))}
        {reviewRow("Providers", reviewList(providerIds))}
        {reviewRow("MCP services", reviewList(mcpServiceIds))}
        {reviewRow("Virtual keys", reviewList(virtualKeyIds))}
        {reviewRow("Disabled", disabled ? "Yes" : "No")}
      </div>
      {runtimeType === "http" && (
        <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
          Reminder: an HTTP agent is not executable in v0.5.0 — turns return 501 runtime_not_executable.
        </p>
      )}
      <p className="mt-3 text-xs text-slate-500">
        After creating the agent, add an ingress route on the{" "}
        <Link href="/dashboard/agents/routes" className="text-blue-400 hover:underline">Agent Routes</Link> page to make it callable.
      </p>
    </Card>
  );

  // ── Full edit form (single-page layout) ──
  if (!wizard) {
    return (
      <div className="space-y-4">
        {identityCard}
        {runtimeCard}
        {routesCard}
        {resourcesCard}
        {policyCard}
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" onClick={() => router.back()} disabled={saving}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving}>{saving ? "Saving…" : isEdit ? "Save Changes" : "Create Agent"}</Button>
        </div>
      </div>
    );
  }

  // ── Wizard (create) ──
  const stepContent = [
    <div key="basics">{identityCard}</div>,
    <div key="runtime">{runtimeCard}</div>,
    <div key="resources" className="space-y-4">{routesCard}{resourcesCard}{policyCard}</div>,
    <div key="review">{reviewCard}</div>,
  ][step];

  return (
    <div className="space-y-4">
      {/* Stepper header */}
      <div className="flex items-center gap-1.5">
        {WIZARD_STEPS.map((label, i) => {
          const state = i === step ? "current" : i < step ? "done" : "todo";
          return (
            <div key={label} className="flex flex-1 items-center gap-1.5">
              <button
                type="button"
                onClick={() => { if (i < step) setStep(i); }}
                disabled={i > step}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                  i < step && "cursor-pointer hover:bg-slate-800/60",
                  i > step && "cursor-default",
                  state === "current" && "bg-blue-500/15 text-blue-300",
                  state === "done" && "text-slate-300",
                  state === "todo" && "text-slate-500",
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold",
                    state === "current" && "bg-blue-500 text-white",
                    state === "done" && "bg-emerald-500/20 text-emerald-300",
                    state === "todo" && "bg-slate-700/60 text-slate-400",
                  )}
                >
                  {state === "done" ? "✓" : i + 1}
                </span>
                {label}
              </button>
              {i < WIZARD_STEPS.length - 1 && <span className="h-px flex-1 bg-slate-700/60" aria-hidden="true" />}
            </div>
          );
        })}
      </div>

      {/* Resource steps get a refresh control, since "+ New" opens in a new tab. */}
      {(step === 1 || step === 2) && (
        <div className="flex justify-end">
          <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh options"}
          </Button>
        </div>
      )}

      {stepContent}

      <div className="flex items-center justify-between gap-1.5">
        <Button variant="ghost" onClick={() => router.back()} disabled={saving}>Cancel</Button>
        <div className="flex gap-1.5">
          {step > 0 && <Button variant="ghost" onClick={() => setStep((s) => Math.max(s - 1, 0))} disabled={saving}>Back</Button>}
          {step < WIZARD_STEPS.length - 1 ? (
            <Button onClick={next} disabled={saving}>Next</Button>
          ) : (
            <Button onClick={() => void submit()} disabled={saving}>{saving ? "Creating…" : "Create Agent"}</Button>
          )}
        </div>
      </div>
    </div>
  );
}
