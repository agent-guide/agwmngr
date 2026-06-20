"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { MultiSelect, type MultiOption } from "@/components/ui/multi-select";
import { useToast } from "@/components/ui/toast";
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

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-300">
        {label} {required && <span className="text-rose-400">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function AgentForm({ initial }: { initial?: Agent }) {
  const isEdit = !!initial;
  const router = useRouter();
  const { showToast } = useToast();

  const [ref, setRef] = useState<RefData>(EMPTY_REF);
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

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [services, acpRoutes, llmRoutes, mcpRoutes, mcpServices, providers, vkeys, agents] = await Promise.allSettled([
        listACPServices(), listACPRoutes(), listLLMRoutes(), listMCPRoutes(), listMCPServices(), listProviders(), listVirtualKeys(), listAgents(),
      ]);
      if (!alive) return;
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
    })();
    return () => { alive = false; };
  }, [initial?.id]);

  const serviceClaimedBy = acpServiceId ? ref.claimedServices[acpServiceId] : undefined;

  // ACP routes are only meaningful for the chosen runtime service.
  const acpRouteOptions: MultiOption[] = useMemo(
    () =>
      ref.acpRoutes
        .filter((r) => !acpServiceId || r.service_id === acpServiceId)
        .map((r) => ({ value: r.id, label: r.id })),
    [ref.acpRoutes, acpServiceId],
  );

  const buildPayload = (): AgentPayload => {
    const payload: AgentPayload = {
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
    };
    return payload;
  };

  const submit = async () => {
    if (!id.trim() || !name.trim()) {
      showToast("ID and name are required", "error");
      return;
    }
    if (runtimeType === "acp" && !acpServiceId.trim()) {
      showToast("Select a backing ACP service", "error");
      return;
    }
    if (runtimeType === "http" && !httpEndpoint.trim()) {
      showToast("HTTP runtime requires an endpoint", "error");
      return;
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

  return (
    <div className="space-y-4">
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
              <Field label="Backing ACP service" required hint="References an existing ACP service. Creating a service on the fly is not supported.">
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
              {acpServiceId && (
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

      <Card>
        <CardHeader><CardTitle>Routes <span className="text-xs font-normal text-slate-500">(display / attribution only)</span></CardTitle></CardHeader>
        <div className="space-y-4">
          {runtimeType === "acp" && (
            <Field label="ACP routes" hint="Routes that resolve to the backing service.">
              <MultiSelect options={acpRouteOptions} selected={acpRouteIds} onChange={setAcpRouteIds} emptyText="No ACP routes for this service." />
            </Field>
          )}
          <Field label="LLM routes">
            <MultiSelect options={ref.llmRoutes.map((r) => ({ value: r.id, label: r.id }))} selected={llmRouteIds} onChange={setLlmRouteIds} emptyText="No LLM routes." />
          </Field>
          <Field label="MCP routes">
            <MultiSelect options={ref.mcpRoutes.map((r) => ({ value: r.id, label: r.id }))} selected={mcpRouteIds} onChange={setMcpRouteIds} emptyText="No MCP routes." />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader><CardTitle>Resources <span className="text-xs font-normal text-slate-500">(allowed to use — not data-plane enforced)</span></CardTitle></CardHeader>
        <div className="space-y-4">
          <Field label="Providers">
            <MultiSelect options={ref.providers.map((p) => ({ value: p.id, label: p.id }))} selected={providerIds} onChange={setProviderIds} emptyText="No providers." />
          </Field>
          <Field label="MCP services">
            <MultiSelect options={ref.mcpServices.map((s) => ({ value: s.id, label: s.id }))} selected={mcpServiceIds} onChange={setMcpServiceIds} emptyText="No MCP services." />
          </Field>
          <Field label="Virtual keys">
            <MultiSelect options={ref.virtualKeys.map((k) => ({ value: k.id, label: k.id }))} selected={virtualKeyIds} onChange={setVirtualKeyIds} emptyText="No virtual keys." />
          </Field>
        </div>
      </Card>

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

      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" onClick={() => router.back()} disabled={saving}>Cancel</Button>
        <Button onClick={() => void submit()} disabled={saving}>{saving ? "Saving…" : isEdit ? "Save Changes" : "Create Agent"}</Button>
      </div>
    </div>
  );
}
