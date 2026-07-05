"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { MultiSelect, type MultiOption } from "@/components/ui/multi-select";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  ApiError,
  createAgent,
  updateAgent,
  listAgents,
  listACPServices,
  listACPRoutes,
  listLLMRoutes,
  listMCPRoutes,
  listMCPServices,
  listProviders,
  listVirtualKeys,
  type Agent,
  type AgentPayload,
} from "@/lib/api";

interface RefData {
  acpServices: { id: string; name?: string }[];
  acpRoutes: { id: string; service_id?: string; path_prefix?: string }[];
  llmRoutes: { id: string }[];
  mcpRoutes: { id: string }[];
  mcpServices: { id: string }[];
  providers: { id: string }[];
  virtualKeys: { id: string }[];
  claimedServices: Record<string, string>; // service_id -> agent_id that owns it
}

const EMPTY_REF: RefData = {
  acpServices: [], acpRoutes: [], llmRoutes: [], mcpRoutes: [], mcpServices: [], providers: [], virtualKeys: [], claimedServices: {},
};

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
  const [runtimeType, setRuntimeType] = useState(initial?.runtime.type ?? "acp");
  const [acpServiceId, setAcpServiceId] = useState(initial?.runtime.acp?.service_id ?? "");
  const [httpEndpoint, setHttpEndpoint] = useState(initial?.runtime.http?.endpoint ?? "");
  const [httpAuthRef, setHttpAuthRef] = useState(initial?.runtime.http?.auth_ref ?? "");
  const [acpRouteIds, setAcpRouteIds] = useState<string[]>(initial?.routes.acp_route_ids ?? []);
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
    const [services, acpRoutes, llmRoutes, mcpRoutes, mcpServices, providers, vkeys, agents] = await Promise.allSettled([
      listACPServices(), listACPRoutes(), listLLMRoutes(), listMCPRoutes(), listMCPServices(), listProviders(), listVirtualKeys(), listAgents(),
    ]);
    const claimed: Record<string, string> = {};
    if (agents.status === "fulfilled") {
      for (const a of agents.value) {
        const sid = a.runtime.acp?.service_id;
        if (sid && a.id !== initial?.id) claimed[sid] = a.id;
      }
    }
    setRef({
      acpServices: services.status === "fulfilled" ? services.value.map((s) => ({ id: s.id, name: s.name })) : [],
      acpRoutes: acpRoutes.status === "fulfilled" ? acpRoutes.value.map((r) => ({ id: r.id, service_id: r.service_id })) : [],
      llmRoutes: llmRoutes.status === "fulfilled" ? llmRoutes.value.map((r) => ({ id: r.id })) : [],
      mcpRoutes: mcpRoutes.status === "fulfilled" ? mcpRoutes.value.map((r) => ({ id: r.id })) : [],
      mcpServices: mcpServices.status === "fulfilled" ? mcpServices.value.map((s) => ({ id: s.id })) : [],
      providers: providers.status === "fulfilled" ? providers.value.map((p) => ({ id: p.id })) : [],
      virtualKeys: vkeys.status === "fulfilled" ? vkeys.value.map((k) => ({ id: k.id })) : [],
      claimedServices: claimed,
    });
  }, [initial?.id]);

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

  const serviceClaimedBy = acpServiceId ? ref.claimedServices[acpServiceId] : undefined;

  // ACP routes are only meaningful for the chosen runtime service.
  const acpRouteOptions: MultiOption[] = useMemo(
    () =>
      ref.acpRoutes
        .filter((r) => !acpServiceId || r.service_id === acpServiceId)
        .map((r) => ({ value: r.id, label: r.id })),
    [ref.acpRoutes, acpServiceId],
  );

  const buildPayload = (): AgentPayload => ({
    id: id.trim(),
    name: name.trim(),
    description: description.trim() || undefined,
    runtime:
      runtimeType === "acp"
        ? { type: "acp", acp: { service_id: acpServiceId.trim() } }
        : { type: "http", http: { endpoint: httpEndpoint.trim(), auth_ref: httpAuthRef.trim() || undefined } },
    routes: {
      acp_route_ids: acpRouteIds.length ? acpRouteIds : undefined,
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
      if (!name.trim()) return "Name is required";
    }
    if (s === 1) {
      if (runtimeType === "acp") {
        if (!acpServiceId.trim()) return "Select a backing ACP service";
        if (serviceClaimedBy) return `Service ${acpServiceId} is already bound to another agent`;
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

  const runtimeCard = (
    <Card>
      <CardHeader><CardTitle>Runtime</CardTitle></CardHeader>
      <div className="space-y-4">
        <Field label="Runtime type" required hint="acp = the gateway owns the process lifecycle; http = the agent owns its own lifecycle.">
          <Select
            name="runtime-type"
            value={runtimeType}
            onChange={setRuntimeType}
            options={[{ value: "acp", label: "acp — gateway-managed" }, { value: "http", label: "http — self-managed" }]}
          />
        </Field>

        {runtimeType === "acp" ? (
          <>
            <Field
              label="Backing ACP service"
              required
              hint="References an existing ACP service. Creating a service on the fly is not supported."
              action={<NewLink href="/dashboard/acp/services" />}
            >
              <Select
                name="acp-service"
                value={acpServiceId}
                onChange={setAcpServiceId}
                options={[{ value: "", label: "— select a service —" }, ...ref.acpServices.map((s) => ({ value: s.id, label: s.name ? `${s.id} (${s.name})` : s.id }))]}
              />
            </Field>
            {serviceClaimedBy && (
              <p className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
                Service <span className="font-mono">{acpServiceId}</span> is already bound to agent <span className="font-mono">{serviceClaimedBy}</span>. An ACP service can back only one agent (1:1).
              </p>
            )}
            {acpServiceId && !serviceClaimedBy && (
              <p className="text-xs text-slate-500">
                Operational policy (permission mode / allowed roots / cwd) is owned by the ACP service and edited there.
              </p>
            )}
          </>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Endpoint" required hint="The agent's HTTP task endpoint.">
              <Input name="http-endpoint" value={httpEndpoint} onChange={setHttpEndpoint} placeholder="https://agent.internal/run" />
            </Field>
            <Field label="Auth ref" hint="Optional credential reference.">
              <Input name="http-auth" value={httpAuthRef} onChange={setHttpAuthRef} placeholder="credential-id" />
            </Field>
          </div>
        )}
      </div>
    </Card>
  );

  const routesCard = (
    <Card>
      <CardHeader><CardTitle>Routes <span className="text-xs font-normal text-slate-500">(display / attribution only)</span></CardTitle></CardHeader>
      <div className="space-y-4">
        {runtimeType === "acp" && (
          <Field label="ACP routes" hint="Routes that resolve to the backing service." action={<NewLink href="/dashboard/acp/routes" />}>
            <MultiSelect options={acpRouteOptions} selected={acpRouteIds} onChange={setAcpRouteIds} emptyText="No ACP routes for this service." />
          </Field>
        )}
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

  const reviewCard = (
    <Card>
      <CardHeader><CardTitle>Review</CardTitle></CardHeader>
      <div className="space-y-0">
        {reviewRow("Agent ID", <span className="font-mono">{id || "—"}</span>)}
        {reviewRow("Name", name || "—")}
        {description && reviewRow("Description", description)}
        {reviewRow("Runtime", runtimeType === "acp"
          ? <span>acp → <span className="font-mono">{acpServiceId || "—"}</span></span>
          : <span>http → <span className="font-mono">{httpEndpoint || "—"}</span></span>)}
        {reviewRow("ACP routes", reviewList(acpRouteIds))}
        {reviewRow("LLM routes", reviewList(llmRouteIds))}
        {reviewRow("MCP routes", reviewList(mcpRouteIds))}
        {reviewRow("Providers", reviewList(providerIds))}
        {reviewRow("MCP services", reviewList(mcpServiceIds))}
        {reviewRow("Virtual keys", reviewList(virtualKeyIds))}
        {reviewRow("Disabled", disabled ? "Yes" : "No")}
      </div>
    </Card>
  );

  // ── Full edit form (unchanged single-page layout) ──
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
      <ol className="flex items-center gap-2">
        {WIZARD_STEPS.map((label, i) => {
          const state = i === step ? "current" : i < step ? "done" : "todo";
          return (
            <li key={label} className="flex flex-1 items-center gap-2">
              <button
                type="button"
                onClick={() => { if (i < step) setStep(i); }}
                disabled={i > step}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors",
                  i < step && "cursor-pointer hover:bg-slate-800/60",
                  i > step && "cursor-default",
                )}
              >
                <span className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  state === "current" && "bg-blue-600 text-white",
                  state === "done" && "bg-emerald-500/20 text-emerald-300",
                  state === "todo" && "bg-slate-700/60 text-slate-400",
                )}>
                  {state === "done" ? "✓" : i + 1}
                </span>
                <span className={cn(
                  "hidden text-sm font-medium sm:inline",
                  state === "current" ? "text-slate-100" : "text-slate-400",
                )}>{label}</span>
              </button>
              {i < WIZARD_STEPS.length - 1 && <span className="h-px flex-1 bg-slate-700/60" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="text-xs font-medium text-slate-400 transition-colors hover:text-slate-200 disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "↻ Refresh options"}
        </button>
      </div>

      {stepContent}

      {/* Footer nav */}
      <div className="flex items-center justify-between gap-1.5">
        <Button variant="ghost" onClick={() => router.push("/dashboard/agents")} disabled={saving}>Cancel</Button>
        <div className="flex gap-1.5">
          {step > 0 && <Button variant="ghost" onClick={() => setStep((s) => Math.max(s - 1, 0))} disabled={saving}>Back</Button>}
          {step < WIZARD_STEPS.length - 1
            ? <Button onClick={next}>Next</Button>
            : <Button onClick={() => void submit()} disabled={saving}>{saving ? "Creating…" : "Create Agent"}</Button>}
        </div>
      </div>
    </div>
  );
}
