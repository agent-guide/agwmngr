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
import { agentPayload, agentPayloadYaml, parseAgentPayloadYaml } from "@/lib/agent-yaml";
import {
  bindBuiltinDependencies,
  collectBuiltinReferences,
  diagnoseBuiltinDependencies,
  findStaleBuiltinLlmBindings,
  stripBuiltinDependencies,
} from "@/lib/agent-bindings";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n-provider";
import { httpAgentConfigFromForm, httpAgentFormValues } from "@/lib/agent-http";
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
import {
  createPlatformGatewayAgent,
  updatePlatformGatewayAgent,
} from "@/lib/platform-api";

interface RefData {
  llmRoutes: { id: string }[];
  mcpRoutes: { id: string }[];
  mcpServices: { id: string }[];
  providers: { id: string }[];
  virtualKeys: { id: string }[];
}

type RefStatus = "loading" | "ok" | "error";

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
 * docs/plans/archive/gateway-v0.5-alignment-plan.md D1). JSON — not YAML — is the canonical form here
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
  const { t } = useI18n();
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-blue-400 hover:underline">
      {t("agentForm.newLink")}
    </a>
  );
}

const TEXTAREA_CLASS = "w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 font-mono text-xs text-slate-100 focus:border-blue-500/60 focus:outline-none";

const WIZARD_STEPS = ["Basics", "Runtime", "Resources", "Review"] as const;
type EditorMode = "form" | "yaml";

export function AgentForm({
  initial,
  wizard = false,
  gatewayId,
}: {
  initial?: Agent;
  wizard?: boolean;
  gatewayId?: string;
}) {
  const isEdit = !!initial;
  const router = useRouter();
  const { showToast } = useToast();
  const { t } = useI18n();
  const initialPayload = useMemo(() => initial ? agentPayload(initial) : undefined, [initial]);
  const initialFormPayload = useMemo(
    () => initialPayload ? stripBuiltinDependencies(initialPayload) : undefined,
    [initialPayload],
  );
  const initialBuiltinReferences = useMemo(
    () => collectBuiltinReferences(initialPayload?.runtime.builtin),
    [initialPayload],
  );

  const [ref, setRef] = useState<RefData>(EMPTY_REF);
  const [refStatus, setRefStatus] = useState<{ llmRoutes: RefStatus; mcpServices: RefStatus }>({
    llmRoutes: "loading",
    mcpServices: "loading",
  });
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
  const [httpValues, setHttpValues] = useState(() => httpAgentFormValues(initial?.runtime.http));

  // ── Builtin runtime (raw JSON) ──
  const [builtinJson, setBuiltinJson] = useState(
    initial?.runtime.builtin ? JSON.stringify(initial.runtime.builtin, null, 2) : BUILTIN_TEMPLATE,
  );

  const [llmRouteIds, setLlmRouteIds] = useState<string[]>(initialFormPayload?.routes.llm_route_ids ?? []);
  const [mcpRouteIds, setMcpRouteIds] = useState<string[]>(initial?.routes.mcp_route_ids ?? []);
  const [providerIds, setProviderIds] = useState<string[]>(initial?.resources.provider_ids ?? []);
  const [mcpServiceIds, setMcpServiceIds] = useState<string[]>(initialFormPayload?.resources.mcp_service_ids ?? []);
  const [virtualKeyIds, setVirtualKeyIds] = useState<string[]>(initial?.resources.virtual_key_ids ?? []);
  const [maxAgentDepth, setMaxAgentDepth] = useState(initial?.policy.max_agent_depth ? String(initial.policy.max_agent_depth) : "");
  const [maxTurns, setMaxTurns] = useState(initial?.policy.budget?.max_turns_per_day ? String(initial.policy.budget.max_turns_per_day) : "");
  const [maxTokens, setMaxTokens] = useState(initial?.policy.budget?.max_tokens_per_day ? String(initial.policy.budget.max_tokens_per_day) : "");
  const [disabled, setDisabled] = useState(initial?.disabled ?? false);
  const [saving, setSaving] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>(initial?.runtime.type === "builtin" ? "yaml" : "form");
  const [yamlText, setYamlText] = useState(() => initialPayload ? agentPayloadYaml(initialPayload) : "");
  const [yamlDerivedLlmRouteIds, setYamlDerivedLlmRouteIds] = useState<string[]>(
    () => initialBuiltinReferences.llmRouteIDs,
  );
  const [detachedBuiltinReferences, setDetachedBuiltinReferences] = useState({
    llmRouteIDs: [] as string[],
    mcpServiceIDs: [] as string[],
  });

  const localizedHttpError = (error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("Unsupported runtime.http fields: ")) {
      return t("agentForm.httpUnsupported", { fields: message.slice("Unsupported runtime.http fields: ".length) });
    }
    const messages: Record<string, ReturnType<typeof t>> = {
      "runtime.http.card_url is required": t("agentForm.httpCardRequired"),
      "runtime.http.card_url must be an absolute HTTP(S) URL": t("agentForm.httpCardAbsolute"),
      "runtime.http.card_url must not contain userinfo or a fragment": t("agentForm.httpCardNoUserinfo"),
      "runtime.http.card_url must use HTTPS except for loopback HTTP": t("agentForm.httpHttps"),
      "runtime.http.protocol must be a2a": t("agentForm.httpProtocol"),
      "runtime.http.auth_ref must be a string": t("agentForm.httpAuthString"),
      "runtime.http.timeout_seconds must be a non-negative integer": t("agentForm.httpTimeoutInteger"),
    };
    return messages[message] ?? message;
  };

  const loadRef = useCallback(async () => {
    setRefStatus({ llmRoutes: "loading", mcpServices: "loading" });
    const [llmRoutes, mcpRoutes, mcpServices, providers, vkeys] = await Promise.allSettled([
      listLLMRoutes(gatewayId),
      listMCPRoutes(gatewayId),
      listMCPServices(gatewayId),
      listProviders(undefined, gatewayId),
      listVirtualKeys(gatewayId),
    ]);
    setRef({
      llmRoutes: llmRoutes.status === "fulfilled" ? llmRoutes.value.map((r) => ({ id: r.id })) : [],
      mcpRoutes: mcpRoutes.status === "fulfilled" ? mcpRoutes.value.map((r) => ({ id: r.id })) : [],
      mcpServices: mcpServices.status === "fulfilled" ? mcpServices.value.map((s) => ({ id: s.id })) : [],
      providers: providers.status === "fulfilled" ? providers.value.map((p) => ({ id: p.id })) : [],
      virtualKeys: vkeys.status === "fulfilled" ? vkeys.value.map((k) => ({ id: k.id })) : [],
    });
    const nextStatus = {
      llmRoutes: llmRoutes.status === "fulfilled" ? "ok" : "error",
      mcpServices: mcpServices.status === "fulfilled" ? "ok" : "error",
    } satisfies { llmRoutes: RefStatus; mcpServices: RefStatus };
    setRefStatus(nextStatus);
    return nextStatus;
  }, [gatewayId]);

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
      const status = await loadRef();
      if (status.llmRoutes === "error" || status.mcpServices === "error") {
        showToast(t("agentForm.optionsPartial"), "error");
      } else {
        showToast(t("agentForm.optionsRefreshed"), "success");
      }
    } finally {
      setRefreshing(false);
    }
  };

  const retryDependencyCheck = (
    <Button
      variant="ghost"
      className="shrink-0 border-amber-400/30 px-2 py-0.5 text-[11px] text-amber-100"
      onClick={() => void refresh()}
      disabled={refreshing}
    >
      {refreshing ? t("agentForm.retrying") : t("common.retry")}
    </Button>
  );

  // Parse the builtin JSON once per keystroke so both validation and the review
  // step read the same result.
  const builtinParse = useMemo((): { value?: AgentRuntimeBuiltin; error?: string } => {
    if (runtimeType !== "builtin") return {};
    try {
      const parsed = JSON.parse(builtinJson) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { error: t("agentForm.builtinObject") };
      }
      return { value: parsed as AgentRuntimeBuiltin };
    } catch (e) {
      return { error: e instanceof Error ? e.message : t("agentForm.invalidJson") };
    }
  }, [runtimeType, builtinJson, t]);

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
      http: httpAgentConfigFromForm(httpValues),
    };
  };

  const buildPayload = (runtime = buildRuntime()): AgentPayload => ({
    id: id.trim(),
    name: name.trim(),
    description: description.trim() || undefined,
    runtime,
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

  // The editor is intentionally friendlier than GatewayBundle import: bundle
  // apply treats its input as a complete artifact, while this form derives the
  // bindings required by an inline builtin definition.
  const buildBoundPayload = (): AgentPayload => bindBuiltinDependencies(buildPayload());

  const yamlParse = useMemo((): { value?: AgentPayload; error?: string } => {
    if (!yamlText.trim()) return { error: t("agentForm.yamlEmpty") };
    try {
      const value = parseAgentPayloadYaml(yamlText);
      if (isEdit && value.id !== initial?.id) return { error: t("agentForm.idImmutable", { id: initial?.id ?? "" }) };
      return { value };
    } catch (error) {
      return { error: error instanceof Error ? error.message : t("agentForm.invalidYaml") };
    }
  }, [initial, isEdit, yamlText, t]);

  const formBuiltinReferences = useMemo(
    () => collectBuiltinReferences(builtinParse.value),
    [builtinParse.value],
  );
  const yamlBuiltinReferences = useMemo(
    () => collectBuiltinReferences(
      yamlParse.value?.runtime.type === "builtin" ? yamlParse.value.runtime.builtin : undefined,
    ),
    [yamlParse.value],
  );
  const builtinReferences = editorMode === "yaml" ? yamlBuiltinReferences : formBuiltinReferences;
  const unretainedDetachedLlmRouteIds = detachedBuiltinReferences.llmRouteIDs.filter(
    (routeID) => !llmRouteIds.includes(routeID),
  );
  const unretainedDetachedMcpServiceIds = detachedBuiltinReferences.mcpServiceIDs.filter(
    (serviceID) => !mcpServiceIds.includes(serviceID),
  );
  const effectiveLlmRouteIds = useMemo(
    () => [...new Set([...llmRouteIds, ...formBuiltinReferences.llmRouteIDs])],
    [llmRouteIds, formBuiltinReferences.llmRouteIDs],
  );
  const effectiveMcpServiceIds = useMemo(
    () => [...new Set([...mcpServiceIds, ...formBuiltinReferences.mcpServiceIDs])],
    [mcpServiceIds, formBuiltinReferences.mcpServiceIDs],
  );
  const missingBuiltinLlmRoutes = useMemo(
    () => refStatus.llmRoutes === "ok"
      ? builtinReferences.llmRouteIDs.filter((id) => !ref.llmRoutes.some((route) => route.id === id))
      : [],
    [builtinReferences.llmRouteIDs, ref.llmRoutes, refStatus.llmRoutes],
  );
  const missingBuiltinMcpServices = useMemo(
    () => refStatus.mcpServices === "ok"
      ? builtinReferences.mcpServiceIDs.filter((id) => !ref.mcpServices.some((service) => service.id === id))
      : [],
    [builtinReferences.mcpServiceIDs, ref.mcpServices, refStatus.mcpServices],
  );
  const staleYamlLlmRouteIds = useMemo(
    () => editorMode === "yaml" && yamlParse.value
      ? findStaleBuiltinLlmBindings(yamlParse.value, yamlDerivedLlmRouteIds)
      : [],
    [editorMode, yamlDerivedLlmRouteIds, yamlParse.value],
  );

  const applyPayloadToForm = (payload: AgentPayload) => {
    const formPayload = stripBuiltinDependencies(payload);
    setId(formPayload.id);
    setName(formPayload.name);
    setDescription(formPayload.description ?? "");
    setRuntimeType(formPayload.runtime.type);

    const acp = formPayload.runtime.acp;
    if (acp) {
      setAcpAgentType(acp.agent_type);
      setAcpCwd(acp.cwd);
      setAcpAllowedRoots((acp.allowed_roots ?? []).join("\n"));
      setAcpDefaultModel(acp.default_model ?? "");
      setAcpEnv(formatKeyValueLines(acp.env));
      setAcpConfigOverrides(formatKeyValueLines(acp.config_overrides));
      setAcpPermissionMode(acp.permission_mode ?? "deny");
      setAcpIdleTtl(acp.idle_ttl ? String(Math.round(acp.idle_ttl / NANOS_PER_SECOND)) : "0");
      setAcpMaxInstances(acp.max_instances ? String(acp.max_instances) : "");
      setAcpCodexMode(acp.codex?.mode ?? "adapter");
      setAcpCodexCommand(acp.codex?.adapter_command ?? "");
      setAcpCodexArgs((acp.codex?.adapter_args ?? []).join("\n"));
    }
    if (formPayload.runtime.builtin) setBuiltinJson(JSON.stringify(formPayload.runtime.builtin, null, 2));
    if (formPayload.runtime.http) {
      setHttpValues(httpAgentFormValues(formPayload.runtime.http));
    }

    setLlmRouteIds(formPayload.routes.llm_route_ids ?? []);
    setMcpRouteIds(formPayload.routes.mcp_route_ids ?? []);
    setProviderIds(formPayload.resources.provider_ids ?? []);
    setMcpServiceIds(formPayload.resources.mcp_service_ids ?? []);
    setVirtualKeyIds(formPayload.resources.virtual_key_ids ?? []);
    setMaxAgentDepth(formPayload.policy.max_agent_depth ? String(formPayload.policy.max_agent_depth) : "");
    setMaxTurns(formPayload.policy.budget?.max_turns_per_day ? String(formPayload.policy.budget.max_turns_per_day) : "");
    setMaxTokens(formPayload.policy.budget?.max_tokens_per_day ? String(formPayload.policy.budget.max_tokens_per_day) : "");
    setDisabled(formPayload.disabled);
  };

  const switchToYaml = () => {
    if (runtimeType === "http") {
      try { httpAgentConfigFromForm(httpValues); } catch (error) {
        showToast(localizedHttpError(error), "error");
        return;
      }
    }
    if (runtimeType === "builtin" && builtinParse.error) {
      showToast(t("agentForm.builtinError", { detail: builtinParse.error }), "error");
      return;
    }
    const payload = buildBoundPayload();
    setYamlDerivedLlmRouteIds(collectBuiltinReferences(payload.runtime.builtin).llmRouteIDs);
    setYamlText(agentPayloadYaml(payload));
    setEditorMode("yaml");
  };

  const switchToForm = () => {
    if (yamlParse.error || !yamlParse.value) {
      showToast(yamlParse.error ?? t("agentForm.invalidYaml"), "error");
      return;
    }
    applyPayloadToForm(yamlParse.value);
    setEditorMode("form");
  };

  const validateBuiltinDependencies = (payload: AgentPayload): string | null => {
    if (payload.runtime.type !== "builtin") return null;
    const references = collectBuiltinReferences(payload.runtime.builtin);

    if ((references.llmRouteIDs.length > 0 && refStatus.llmRoutes === "loading")
      || (references.mcpServiceIDs.length > 0 && refStatus.mcpServices === "loading")) {
      return t("agentForm.waitDependencies");
    }
    if ((references.llmRouteIDs.length > 0 && refStatus.llmRoutes === "error")
      || (references.mcpServiceIDs.length > 0 && refStatus.mcpServices === "error")) {
      return t("agentForm.dependenciesUnverified");
    }

    const diagnostics = diagnoseBuiltinDependencies(payload, {
      llmRouteIDs: ref.llmRoutes.map((route) => route.id),
      mcpServiceIDs: ref.mcpServices.map((service) => service.id),
    });
    const missing = [
      ...diagnostics.missingLlmRouteIDs.map((id) => `LLM route "${id}"`),
      ...diagnostics.missingMcpServiceIDs.map((id) => `MCP service "${id}"`),
    ];
    return missing.length > 0
      ? t("agentForm.missingDependencies", { noun: missing.length === 1 ? t("agentForm.dependency") : t("agentForm.dependencies"), items: missing.join(", ") })
      : null;
  };

  // Returns an error message if the given wizard step is incomplete, else null.
  const validateStep = (s: number): string | null => {
    if (s === 0) {
      if (!id.trim()) return t("agentForm.idRequired");
      // The gateway routes /admin/agents/routes* to a separate mux ahead of
      // /admin/agents/{id}, so an agent with this id would be unreachable.
      if (id.trim() === RESERVED_AGENT_ID) return t("agentForm.idReserved", { id: RESERVED_AGENT_ID });
      if (!name.trim()) return t("agentForm.nameRequired");
    }
    if (s === 1) {
      if (runtimeType === "acp") {
        if (!acpCwd.trim()) return t("agentForm.cwdRequired");
        if (!isAbsolutePath(acpCwd)) return t("agentForm.cwdAbsolute");
        if (splitLines(acpAllowedRoots).some((r) => !isAbsolutePath(r))) {
          return t("agentForm.rootsAbsolute");
        }
      }
      if (runtimeType === "builtin") {
        if (builtinParse.error) return t("agentForm.builtinError", { detail: builtinParse.error });
        if (!builtinParse.value?.model?.llm_route_id?.trim()) {
          return t("agentForm.builtinModelRequired");
        }
        if (!builtinParse.value?.topology?.kind) {
          return t("agentForm.builtinTopologyRequired");
        }
      }
      if (runtimeType === "http") {
        try { httpAgentConfigFromForm(httpValues); } catch (error) { return localizedHttpError(error); }
      }
    }
    if (s === 2) return validateBuiltinDependencies(buildPayload());
    return null;
  };

  const submit = async () => {
    if (editorMode === "yaml") {
      if (yamlParse.error || !yamlParse.value) {
        showToast(yamlParse.error ?? t("agentForm.invalidYaml"), "error");
        return;
      }
      const dependencyError = validateBuiltinDependencies(yamlParse.value);
      if (dependencyError) {
        showToast(dependencyError, "error");
        return;
      }
    } else {
      for (let s = 0; s <= 2; s++) {
        const err = validateStep(s);
        if (err) { showToast(err, "error"); if (wizard) setStep(s); return; }
      }
    }
    const payload = editorMode === "yaml" ? bindBuiltinDependencies(yamlParse.value!) : buildBoundPayload();
    const submittedBuiltinReferences = collectBuiltinReferences(
      payload.runtime.type === "builtin" ? payload.runtime.builtin : undefined,
    );
    setSaving(true);
    try {
      const saved = gatewayId
        ? isEdit
          ? await updatePlatformGatewayAgent(gatewayId, initial!.id, payload)
          : await createPlatformGatewayAgent(gatewayId, payload)
        : isEdit
          ? await updateAgent(initial!.id, payload)
          : await createAgent(payload);
      showToast(isEdit ? t("agentForm.updated") : t("agentForm.created"), "success");
      router.push(gatewayId
        ? `/dashboard/platform/gateways/${encodeURIComponent(gatewayId)}/agents/${encodeURIComponent(saved.id)}`
        : `/dashboard/agents/${encodeURIComponent(saved.id)}`);
    } catch (err) {
      let message = err instanceof ApiError ? err.message : t("agentForm.saveFailed");
      const conflict = err instanceof ApiError
        // Upstream source: agent-gateway/pkg/agent/manager.go:219.
        ? /^route "([^"]+)" is already bound by agent "([^"]+)"$/.exec(err.message)
        : null;
      if (conflict && submittedBuiltinReferences.llmRouteIDs.includes(conflict[1])) {
        message = t("agentForm.bindingConflict", { route: conflict[1], agent: conflict[2] });
      }
      showToast(message, "error");
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
      <CardHeader><CardTitle>{t("agentForm.identity")}</CardTitle></CardHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("agentForm.agentId")} required hint={isEdit ? t("agentForm.immutable") : t("agentForm.stableId")}>
          <Input name="agent-id" value={id} onChange={setId} disabled={isEdit} placeholder="coding-agent" />
        </Field>
        <Field label={t("common.name")} required>
          <Input name="agent-name" value={name} onChange={setName} placeholder="Coding Agent" />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t("common.description")}>
            <Input name="agent-desc" value={description} onChange={setDescription} placeholder={t("agentForm.descriptionPlaceholder")} />
          </Field>
        </div>
      </div>
    </Card>
  );

  const acpRuntimeFields = (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("agentForm.agentType")} required>
          <Select
            name="acp-agent-type"
            value={acpAgentType}
            onChange={(v) => setAcpAgentType(v as ACPAgentType)}
            options={[{ value: "codex", label: "codex" }, { value: "opencode", label: "opencode" }]}
          />
        </Field>
        <Field label={t("agentForm.permissionMode")} hint={t("agentForm.permissionModeHelp")}>
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
      <Field label={t("agentForm.cwd")} required hint={t("agentForm.cwdHelp")}>
        <Input name="acp-cwd" value={acpCwd} onChange={setAcpCwd} placeholder="/tmp/acp-codex  or  C:\\acp\\workspace" />
      </Field>
      <Field label={t("agentForm.allowedRoots")} hint={t("agentForm.allowedRootsHelp")}>
        <textarea value={acpAllowedRoots} onChange={(e) => setAcpAllowedRoots(e.target.value)} rows={2} className={TEXTAREA_CLASS} placeholder={"/tmp/acp-codex"} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("agentForm.defaultModel")}>
          <Input name="acp-default-model" value={acpDefaultModel} onChange={setAcpDefaultModel} placeholder={t("agentForm.optional")} />
        </Field>
        <Field label={t("agentForm.idleTtl")} hint={t("agentForm.idleTtlHelp")}>
          <Input type="number" name="acp-idle-ttl" value={acpIdleTtl} onChange={setAcpIdleTtl} placeholder="0" />
        </Field>
        <Field label={t("agentForm.maxInstances")} hint={t("agentForm.maxInstancesHelp")}>
          <Input type="number" name="acp-max-instances" value={acpMaxInstances} onChange={setAcpMaxInstances} placeholder={t("agentForm.optional")} />
        </Field>
      </div>
      <Field label={t("agentForm.environment")} hint={t("agentForm.environmentHelp")}>
        <textarea value={acpEnv} onChange={(e) => setAcpEnv(e.target.value)} rows={2} className={TEXTAREA_CLASS} placeholder={"CODEX_HOME=/tmp/acp-codex/.codex"} />
      </Field>
      <Field label={t("agentForm.configOverrides")} hint={t("agentForm.configOverridesHelp")}>
        <textarea value={acpConfigOverrides} onChange={(e) => setAcpConfigOverrides(e.target.value)} rows={2} className={TEXTAREA_CLASS} placeholder={"model=gpt-5"} />
      </Field>
      {acpAgentType === "codex" && (
        <div className="space-y-4 rounded-md border border-slate-700/60 bg-slate-900/30 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t("agentForm.codexSettings")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("agentForm.mode")}>
              <Select
                name="acp-codex-mode"
                value={acpCodexMode}
                onChange={setAcpCodexMode}
                options={[{ value: "adapter", label: "adapter" }, { value: "app_server", label: "app_server" }]}
              />
            </Field>
            <Field label={t("agentForm.adapterCommand")}>
              <Input name="acp-codex-command" value={acpCodexCommand} onChange={setAcpCodexCommand} placeholder="codex-acp" />
            </Field>
          </div>
          <Field label={t("agentForm.adapterArgs")} hint={t("agentForm.oneArgLine")}>
            <textarea value={acpCodexArgs} onChange={(e) => setAcpCodexArgs(e.target.value)} rows={2} className={TEXTAREA_CLASS} placeholder={"--flag"} />
          </Field>
        </div>
      )}
    </div>
  );

  const builtinRuntimeFields = (
    <div className="space-y-3">
      <Field
        label={t("agentForm.builtinDefinition")}
        required
        hint={t("agentForm.builtinDefinitionHelp")}
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
          {t("agentForm.validBuiltinHelp")}
        </p>
      )}
      <p className="text-xs text-slate-500">
        {t("agentForm.topologiesHelp")}
      </p>
    </div>
  );

  const httpRuntimeFields = (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        {t("agentForm.httpHelp")}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("agentForm.agentCardUrl")} required hint={t("agentForm.httpsHelp")}>
          <Input name="http-card-url" value={httpValues.cardUrl} onChange={(cardUrl) => setHttpValues((v) => ({ ...v, cardUrl }))} placeholder="https://agent.internal/.well-known/agent-card.json" />
        </Field>
        <Field label={t("agentForm.protocol")} required hint={t("agentForm.protocolHelp")}>
          <Select name="http-protocol" value={httpValues.protocol} onChange={(protocol) => setHttpValues((v) => ({ ...v, protocol }))} options={[{ value: "a2a", label: "a2a" }]} />
        </Field>
        <Field label={t("agentForm.authRef")} hint={t("agentForm.authRefHelp")}>
          <Input name="http-auth" value={httpValues.authRef} onChange={(authRef) => setHttpValues((v) => ({ ...v, authRef }))} placeholder="credential-id" />
        </Field>
        <Field label={t("agentForm.timeout")} hint={t("agentForm.timeoutHelp")}>
          <Input name="http-timeout" type="number" value={httpValues.timeoutSeconds} onChange={(timeoutSeconds) => setHttpValues((v) => ({ ...v, timeoutSeconds }))} placeholder="120" />
        </Field>
      </div>
    </div>
  );

  const runtimeCard = (
    <Card>
      <CardHeader><CardTitle>{t("agentForm.stepRuntime")}</CardTitle></CardHeader>
      <div className="space-y-4">
        <Field
          label={t("agentForm.runtimeType")}
          required
          hint={t("agentForm.runtimeTypeHelp")}
        >
          <Select
            name="runtime-type"
            value={runtimeType}
            onChange={(v) => {
              const nextType = v as AgentRuntimeType;
              if (runtimeType === "builtin" && nextType !== "builtin") {
                setDetachedBuiltinReferences(formBuiltinReferences);
              } else if (nextType === "builtin") {
                setDetachedBuiltinReferences({ llmRouteIDs: [], mcpServiceIDs: [] });
              }
              if (nextType === "builtin" && runtimeType !== "builtin") {
                const builtin = JSON.parse(BUILTIN_TEMPLATE) as AgentRuntimeBuiltin;
                const payload = bindBuiltinDependencies(buildPayload({ type: "builtin", builtin }));
                setYamlDerivedLlmRouteIds(collectBuiltinReferences(builtin).llmRouteIDs);
                setYamlText(agentPayloadYaml(payload));
                setEditorMode("yaml");
              }
              setRuntimeType(nextType);
            }}
            options={[
              { value: "acp", label: t("agentForm.acpOption") },
              { value: "builtin", label: t("agentForm.builtinOption") },
              { value: "http", label: t("agentForm.httpOption") },
            ]}
          />
        </Field>
        {isEdit && initial && initial.runtime.type !== runtimeType && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
            {t("agentForm.runtimeChangeHelp")}
          </p>
        )}
        {runtimeType !== "builtin"
          && (unretainedDetachedLlmRouteIds.length > 0 || unretainedDetachedMcpServiceIds.length > 0) && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-300" role="alert">
            {t("agentForm.detachHelp")}
            {unretainedDetachedLlmRouteIds.length > 0 && (
              <> {t("agentForm.reselectLlm", { noun: unretainedDetachedLlmRouteIds.length === 1 ? t("agentForm.route") : t("agentForm.routes"), items: unretainedDetachedLlmRouteIds.join(", "), pronoun: unretainedDetachedLlmRouteIds.length === 1 ? t("agentForm.it") : t("agentForm.them") })}</>
            )}
            {unretainedDetachedMcpServiceIds.length > 0 && (
              <> {t("agentForm.reselectMcp", { noun: unretainedDetachedMcpServiceIds.length === 1 ? t("agentForm.service") : t("agentForm.services"), items: unretainedDetachedMcpServiceIds.join(", "), pronoun: unretainedDetachedMcpServiceIds.length === 1 ? t("agentForm.it") : t("agentForm.them") })}</>
            )}
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
      <CardHeader><CardTitle>{t("agentForm.bindings")} <span className="text-xs font-normal text-slate-500">{t("agentForm.bindingsSuffix")}</span></CardTitle></CardHeader>
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          {t("agentForm.bindingsHelp")}
        </p>
        {runtimeType === "builtin" && (
          <p className="rounded-md border border-slate-700/60 bg-slate-950/30 px-2.5 py-1.5 text-[11px] text-slate-400">
            {t("agentForm.derivedHelp")}
          </p>
        )}
        <Field label={t("agentForm.llmRoutes")} action={<NewLink href="/dashboard/llm/routes" />}>
          <MultiSelect
            options={[
              ...ref.llmRoutes.map((r) => ({
                value: r.id,
                label: r.id,
                disabled: formBuiltinReferences.llmRouteIDs.includes(r.id),
                disabledStyle: "normal" as const,
                hint: formBuiltinReferences.llmRouteIDs.includes(r.id) ? t("agentForm.requiredBuiltin") : undefined,
              })),
              ...missingBuiltinLlmRoutes.map((id) => ({ value: id, label: id, disabled: true, disabledStyle: "normal" as const, invalid: true, hint: t("agentForm.dangling") })),
            ]}
            selected={effectiveLlmRouteIds}
            onChange={(next) => setLlmRouteIds(next.filter((id) => !formBuiltinReferences.llmRouteIDs.includes(id)))}
            emptyText={t("agentForm.noLlmRoutes")}
          />
          {formBuiltinReferences.llmRouteIDs.length > 0 && (
            <p className="mt-1 text-xs text-slate-500">
              {t("agentForm.boundFromBuiltin", { items: formBuiltinReferences.llmRouteIDs.join(", ") })}
            </p>
          )}
          {missingBuiltinLlmRoutes.length > 0 && (
            <p className="mt-2 rounded-md border border-rose-500/50 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-200" role="alert">
              {t("agentForm.missingLlm", { noun: missingBuiltinLlmRoutes.length === 1 ? t("agentForm.route") : t("agentForm.routes"), pronoun: missingBuiltinLlmRoutes.length === 1 ? t("agentForm.it") : t("agentForm.them") })}
            </p>
          )}
          {formBuiltinReferences.llmRouteIDs.length > 0 && refStatus.llmRoutes === "loading" && (
            <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-200" role="status">
              {t("agentForm.checkingLlm")}
            </p>
          )}
          {formBuiltinReferences.llmRouteIDs.length > 0 && refStatus.llmRoutes === "error" && (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-200" role="alert">
              <span>{t("agentForm.llmUnverified")}</span>
              {retryDependencyCheck}
            </div>
          )}
        </Field>
        <Field label={t("agentForm.mcpRoutes")} action={<NewLink href="/dashboard/mcp/routes" />}>
          <MultiSelect options={ref.mcpRoutes.map((r) => ({ value: r.id, label: r.id }))} selected={mcpRouteIds} onChange={setMcpRouteIds} emptyText={t("agentForm.noMcpRoutes")} />
        </Field>
      </div>
    </Card>
  );

  const resourcesCard = (
    <Card>
      <CardHeader><CardTitle>{t("agentForm.resources")} <span className="text-xs font-normal text-slate-500">{t("agentForm.resourcesSuffix")}</span></CardTitle></CardHeader>
      <div className="space-y-4">
        <Field label={t("agentForm.providers")} action={<NewLink href="/dashboard/llm/providers" />}>
          <MultiSelect options={ref.providers.map((p) => ({ value: p.id, label: p.id }))} selected={providerIds} onChange={setProviderIds} emptyText={t("agentForm.noProviders")} />
        </Field>
        <Field label={t("agentForm.mcpServices")} action={<NewLink href="/dashboard/mcp/services" />}>
          <MultiSelect
            options={[
              ...ref.mcpServices.map((s) => ({
                value: s.id,
                label: s.id,
                disabled: formBuiltinReferences.mcpServiceIDs.includes(s.id),
                disabledStyle: "normal" as const,
                hint: formBuiltinReferences.mcpServiceIDs.includes(s.id) ? t("agentForm.requiredBuiltin") : undefined,
              })),
              ...missingBuiltinMcpServices.map((id) => ({ value: id, label: id, disabled: true, disabledStyle: "normal" as const, invalid: true, hint: t("agentForm.dangling") })),
            ]}
            selected={effectiveMcpServiceIds}
            onChange={(next) => setMcpServiceIds(next.filter((id) => !formBuiltinReferences.mcpServiceIDs.includes(id)))}
            emptyText={t("agentForm.noMcpServices")}
          />
          {formBuiltinReferences.mcpServiceIDs.length > 0 && (
            <p className="mt-1 text-xs text-slate-500">
              {t("agentForm.declaredFromBuiltin", { items: formBuiltinReferences.mcpServiceIDs.join(", ") })}
            </p>
          )}
          {missingBuiltinMcpServices.length > 0 && (
            <p className="mt-2 rounded-md border border-rose-500/50 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-200" role="alert">
              {t("agentForm.missingMcp", { noun: missingBuiltinMcpServices.length === 1 ? t("agentForm.service") : t("agentForm.services"), pronoun: missingBuiltinMcpServices.length === 1 ? t("agentForm.it") : t("agentForm.them") })}
            </p>
          )}
          {formBuiltinReferences.mcpServiceIDs.length > 0 && refStatus.mcpServices === "loading" && (
            <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-200" role="status">
              {t("agentForm.checkingMcp")}
            </p>
          )}
          {formBuiltinReferences.mcpServiceIDs.length > 0 && refStatus.mcpServices === "error" && (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-200" role="alert">
              <span>{t("agentForm.mcpUnverified")}</span>
              {retryDependencyCheck}
            </div>
          )}
        </Field>
        <Field label={t("agentForm.virtualKeys")} action={<NewLink href="/dashboard/general/virtual-keys" />}>
          <MultiSelect options={ref.virtualKeys.map((k) => ({ value: k.id, label: k.id }))} selected={virtualKeyIds} onChange={setVirtualKeyIds} emptyText={t("agentForm.noVirtualKeys")} />
        </Field>
      </div>
    </Card>
  );

  const policyCard = (
    <Card>
      <CardHeader><CardTitle>{t("agentForm.policy")}</CardTitle></CardHeader>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("agentForm.maxDepth")} hint={t("agentForm.maxDepthHelp")}>
          <Input type="number" name="max-depth" value={maxAgentDepth} onChange={setMaxAgentDepth} placeholder="3" />
        </Field>
        <Field label={t("agentForm.maxTurns")}>
          <Input type="number" name="max-turns" value={maxTurns} onChange={setMaxTurns} placeholder="500" />
        </Field>
        <Field label={t("agentForm.maxTokens")}>
          <Input type="number" name="max-tokens" value={maxTokens} onChange={setMaxTokens} placeholder="2000000" />
        </Field>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" checked={disabled} onChange={(e) => setDisabled(e.target.checked)} className="h-4 w-4 rounded border-slate-600 bg-slate-800" />
        {t("common.disabledTitle")}
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
      if (builtinParse.error) return <span className="text-rose-300">builtin → {t("agentForm.invalidJsonShort")}</span>;
      const b = builtinParse.value;
      return (
        <span>
          builtin → <span className="font-mono">{b?.topology?.kind || "—"}</span> {t("agentForm.via")}{" "}
          <span className="font-mono">{b?.model?.llm_route_id || "—"}</span>
        </span>
      );
    }
    return <span>http → <span className="font-mono">{httpValues.cardUrl || "—"}</span></span>;
  };

  const reviewCard = (
    <Card>
      <CardHeader><CardTitle>{t("agentForm.stepReview")}</CardTitle></CardHeader>
      <div className="space-y-0">
        {reviewRow(t("agentForm.agentId"), <span className="font-mono">{id || "—"}</span>)}
        {reviewRow(t("common.name"), name || "—")}
        {description && reviewRow(t("common.description"), description)}
        {reviewRow(t("agentForm.stepRuntime"), runtimeReview())}
        {reviewRow(t("agentForm.llmRoutes"), reviewList(effectiveLlmRouteIds))}
        {reviewRow(t("agentForm.mcpRoutes"), reviewList(mcpRouteIds))}
        {reviewRow(t("agentForm.providers"), reviewList(providerIds))}
        {reviewRow(t("agentForm.mcpServices"), reviewList(effectiveMcpServiceIds))}
        {reviewRow(t("agentForm.virtualKeys"), reviewList(virtualKeyIds))}
        {reviewRow(t("common.disabledTitle"), disabled ? t("agentDetail.yes") : t("agentDetail.no"))}
      </div>
      {runtimeType === "http" && (
        <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
          {t("agentForm.remoteCardHelp")}
        </p>
      )}
      <p className="mt-3 text-xs text-slate-500">
        {t("agentForm.afterCreateBefore")} {" "}
        <Link href="/dashboard/agents/routes" className="text-blue-400 hover:underline">{t("agentDetail.agentRoutes")}</Link> {t("agentForm.afterCreateAfter")}
      </p>
    </Card>
  );

  const modeToggle = (
    <div className="flex items-center justify-between gap-3 rounded-md border border-slate-700/60 bg-slate-900/30 px-3 py-2">
      <div>
        <p className="text-sm font-medium text-slate-200">{t("agentForm.editor")}</p>
        <p className="text-xs text-slate-500">{t("agentForm.editorHelp")}</p>
      </div>
      <div className="flex rounded-md border border-slate-700/70 bg-slate-950/50 p-0.5" role="group" aria-label={t("agentForm.editorAria")}>
        <Button variant={editorMode === "form" ? "secondary" : "ghost"} className="border-0 px-3 py-1 text-xs" onClick={editorMode === "yaml" ? switchToForm : undefined}>{t("agentForm.form")}</Button>
        <Button variant={editorMode === "yaml" ? "secondary" : "ghost"} className="border-0 px-3 py-1 text-xs" onClick={editorMode === "form" ? switchToYaml : undefined}>YAML</Button>
      </div>
    </div>
  );

  const yamlDependencyPanel = yamlParse.value?.runtime.type === "builtin" ? (
    <div className="mt-3 space-y-2 rounded-md border border-slate-700/70 bg-slate-950/35 px-3 py-2.5 text-xs">
      <p className="font-medium text-slate-200">{t("agentForm.dependencyCheck")}</p>
      <p className="text-slate-400">
        {t("agentForm.requiredLlm")}: <span className="font-mono text-slate-200">{builtinReferences.llmRouteIDs.join(", ") || "—"}</span>
      </p>
      <p className="text-slate-400">
        {t("agentForm.requiredMcp")}: <span className="font-mono text-slate-200">{builtinReferences.mcpServiceIDs.join(", ") || "—"}</span>
      </p>
      <p className="text-slate-500">{t("agentForm.autoBindings")}</p>
      {((builtinReferences.llmRouteIDs.length > 0 && refStatus.llmRoutes === "loading")
        || (builtinReferences.mcpServiceIDs.length > 0 && refStatus.mcpServices === "loading")) && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5 text-amber-200" role="status">
          {t("agentForm.checkingResources")}
        </p>
      )}
      {((builtinReferences.llmRouteIDs.length > 0 && refStatus.llmRoutes === "error")
        || (builtinReferences.mcpServiceIDs.length > 0 && refStatus.mcpServices === "error")) && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-rose-500/50 bg-rose-500/10 px-2.5 py-1.5 text-rose-200" role="alert">
          <span>{t("agentForm.resourcesUnverified")}</span>
          {retryDependencyCheck}
        </div>
      )}
      {missingBuiltinLlmRoutes.length > 0 && (
        <p className="rounded-md border border-rose-500/50 bg-rose-500/10 px-2.5 py-1.5 text-rose-200" role="alert">
          {t("agentForm.missingLlmNamed", { noun: missingBuiltinLlmRoutes.length === 1 ? t("agentForm.route") : t("agentForm.routes"), items: missingBuiltinLlmRoutes.join(", "), pronoun: missingBuiltinLlmRoutes.length === 1 ? t("agentForm.it") : t("agentForm.them") })}
        </p>
      )}
      {missingBuiltinMcpServices.length > 0 && (
        <p className="rounded-md border border-rose-500/50 bg-rose-500/10 px-2.5 py-1.5 text-rose-200" role="alert">
          {t("agentForm.missingMcpNamed", { noun: missingBuiltinMcpServices.length === 1 ? t("agentForm.service") : t("agentForm.services"), items: missingBuiltinMcpServices.join(", "), pronoun: missingBuiltinMcpServices.length === 1 ? t("agentForm.it") : t("agentForm.them") })}
        </p>
      )}
      {staleYamlLlmRouteIds.length > 0 && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5 text-amber-200" role="alert">
          {t("agentForm.staleBindings", { items: staleYamlLlmRouteIds.join(", "), pronoun: staleYamlLlmRouteIds.length === 1 ? t("agentForm.it") : t("agentForm.them") })}
        </p>
      )}
      {(builtinReferences.llmRouteIDs.length === 0 || refStatus.llmRoutes === "ok")
        && (builtinReferences.mcpServiceIDs.length === 0 || refStatus.mcpServices === "ok")
        && missingBuiltinLlmRoutes.length === 0
        && missingBuiltinMcpServices.length === 0 && (
        <p className="text-emerald-400">{t("agentForm.dependenciesValid")}</p>
      )}
    </div>
  ) : null;

  const yamlEditor = (
    <div className="space-y-4">
      {modeToggle}
      <Card>
        <CardHeader><CardTitle>{t("agentDetail.yaml")}</CardTitle></CardHeader>
        <p className="mb-3 text-xs leading-5 text-slate-500">
          {t("agentForm.yamlHelp")}
        </p>
        <textarea
          value={yamlText}
          onChange={(event) => setYamlText(event.target.value)}
          rows={28}
          spellCheck={false}
          aria-label={t("agentForm.yamlAria")}
          className={cn(TEXTAREA_CLASS, "min-h-[32rem] resize-y", yamlParse.error && "border-rose-500/70")}
        />
        {yamlParse.error ? (
          <p className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-2 font-mono text-xs text-rose-300" role="alert">
            {yamlParse.error}
          </p>
        ) : (
          <p className="mt-3 text-xs text-emerald-400">
            {t("agentForm.validYaml", { runtime: yamlParse.value?.runtime.type ?? "" })}
          </p>
        )}
        {yamlDependencyPanel}
      </Card>
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" onClick={() => router.back()} disabled={saving}>{t("common.cancel")}</Button>
        <Button onClick={() => void submit()} disabled={saving || !!yamlParse.error}>
          {saving ? t("common.saving") : isEdit ? t("common.saveChanges") : t("agentForm.createAgent")}
        </Button>
      </div>
    </div>
  );

  if (editorMode === "yaml") return yamlEditor;

  // ── Full edit form (single-page layout) ──
  if (!wizard) {
    return (
      <div className="space-y-4">
        {modeToggle}
        {identityCard}
        {runtimeCard}
        {routesCard}
        {resourcesCard}
        {policyCard}
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" onClick={() => router.back()} disabled={saving}>{t("common.cancel")}</Button>
          <Button onClick={() => void submit()} disabled={saving}>{saving ? t("common.saving") : isEdit ? t("common.saveChanges") : t("agentForm.createAgent")}</Button>
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
      {modeToggle}
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
                {label === "Basics" ? t("agentForm.stepBasics")
                  : label === "Runtime" ? t("agentForm.stepRuntime")
                    : label === "Resources" ? t("agentForm.stepResources")
                      : t("agentForm.stepReview")}
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
            {refreshing ? t("common.refreshing") : t("agentForm.refreshOptions")}
          </Button>
        </div>
      )}

      {stepContent}

      <div className="flex items-center justify-between gap-1.5">
        <Button variant="ghost" onClick={() => router.back()} disabled={saving}>{t("common.cancel")}</Button>
        <div className="flex gap-1.5">
          {step > 0 && <Button variant="ghost" onClick={() => setStep((s) => Math.max(s - 1, 0))} disabled={saving}>{t("agentForm.back")}</Button>}
          {step < WIZARD_STEPS.length - 1 ? (
            <Button onClick={next} disabled={saving}>{t("agentForm.next")}</Button>
          ) : (
            <Button onClick={() => void submit()} disabled={saving}>{saving ? t("common.creating") : t("agentForm.createAgent")}</Button>
          )}
        </div>
      </div>
    </div>
  );
}
