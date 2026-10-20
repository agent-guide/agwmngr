"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useAgentAttribution } from "@/hooks/use-agent-attribution";
import { UsedByAgents } from "@/components/used-by-agents";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { HelpTooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/components/i18n-provider";
import {
  ApiError,
  listProviders,
  listLLMRoutes,
  listLLMApiHandlerTypes,
  createLLMRoute,
  updateLLMRoute,
  deleteLLMRoute,
  enableLLMRoute,
  disableLLMRoute,
  type ProviderItem,
  type LLMRoute,
  type LLMRoutePayload,
  type RouteTargetPolicy,
  type RouteTargetPolicyKind,
  type RouteSelectionStrategy,
  type RouteMatchPolicy,
  type LLMApiHandlerEntry,
} from "@/lib/api";

// Route schema mirrors the gateway /admin/llm/routes view (see lib/api.ts).
type Route = LLMRoute;

// ── Draft types for form state ───────────────────────────────────────────────

interface CandidateDraft {
  provider_id: string;
  upstream_model: string;
  weight: string;
  priority: string;
}

interface ModelGroupDraft {
  name: string;
  candidates: CandidateDraft[];
}

const defaultCandidate = (): CandidateDraft => ({
  provider_id: "",
  upstream_model: "",
  weight: "100",
  priority: "0",
});

const defaultModelGroup = (): ModelGroupDraft => ({
  name: "default",
  candidates: [defaultCandidate()],
});

// ── Style maps ───────────────────────────────────────────────────────────────

const STRATEGY_COLORS: Record<string, string> = {
  auto: "bg-blue-500/15 text-blue-300",
  weighted: "bg-violet-500/15 text-violet-300",
  priority: "bg-amber-500/15 text-amber-300",
};

const KIND_COLORS: Record<string, string> = {
  "direct-provider": "bg-teal-500/15 text-teal-300",
  "logical-model": "bg-indigo-500/15 text-indigo-300",
};

function resolveKind(tp: RouteTargetPolicy): RouteTargetPolicyKind {
  if (tp?.type) return tp.type;
  if (tp?.provider_target?.provider_id || tp?.provider_id) return "direct-provider";
  return "logical-model";
}

// ── Section heading ──────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{children}</p>
  );
}

// ── Page component ───────────────────────────────────────────────────────────

export default function RoutesPage() {
  const { locale, t } = useI18n();
  const [routes, setRoutes] = useState<Route[]>([]);
  const attribution = useAgentAttribution();
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<Route | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  // Basic fields
  const [formId, setFormId] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formProtocol, setFormProtocol] = useState("");
  const [formMatchHost, setFormMatchHost] = useState("");
  const [formMatchPathPrefix, setFormMatchPathPrefix] = useState("");
  const [formMatchMethods, setFormMatchMethods] = useState("");

  // Target policy
  const [formTargetKind, setFormTargetKind] = useState<RouteTargetPolicyKind>("direct-provider");
  const [formDirectProviderId, setFormDirectProviderId] = useState("");
  const [formModelGroups, setFormModelGroups] = useState<ModelGroupDraft[]>([defaultModelGroup()]);
  const [formDefaultModel, setFormDefaultModel] = useState("");
  const [formModelStrategy, setFormModelStrategy] = useState<RouteSelectionStrategy>("auto");
  const [formFallbackEnabled, setFormFallbackEnabled] = useState(true);
  const [formFallbackMax, setFormFallbackMax] = useState("1");

  // Auth
  const [formRequireVirtualKey, setFormRequireVirtualKey] = useState(true);

  // Dependency data
  const [llmApiHandlers, setLlmApiHandlers] = useState<LLMApiHandlerEntry[]>([]);
  const [loadingHandlers, setLoadingHandlers] = useState(false);
  const [providerOptions, setProviderOptions] = useState<ProviderItem[]>([]);

  const loadRoutes = useCallback(async () => {
    setLoading(true);
    try {
      setRoutes(await listLLMRoutes());
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : t("llmRoutes.loadFailed"), "error");
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadRoutes(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadRoutes]);

  const resetForm = () => {
    setFormId(""); setFormDesc(""); setFormProtocol("");
    setFormMatchHost(""); setFormMatchPathPrefix(""); setFormMatchMethods("");
    setFormTargetKind("direct-provider"); setFormDirectProviderId("");
    setFormModelGroups([defaultModelGroup()]); setFormDefaultModel("");
    setFormModelStrategy("auto"); setFormFallbackEnabled(true); setFormFallbackMax("1");
    setFormRequireVirtualKey(true);
  };

  const loadFormDeps = async (setDefaultHandler = false) => {
    setLoadingHandlers(true);
    // Load each dependency independently so one failing call does not blank the other dropdown.
    const [handlersResult, providersResult] = await Promise.allSettled([
      listLLMApiHandlerTypes(),
      listProviders(),
    ]);
    if (handlersResult.status === "fulfilled") {
      const handlers = handlersResult.value;
      setLlmApiHandlers(handlers);
      if (setDefaultHandler) {
        const first = handlers[0];
        if (first) setFormProtocol(first.llm_api_handler_type);
      }
    } else {
      setLlmApiHandlers([]);
    }
    setProviderOptions(providersResult.status === "fulfilled" ? providersResult.value : []);
    setLoadingHandlers(false);
  };

  const openCreate = async () => {
    resetForm();
    setIsCreateOpen(true);
    await loadFormDeps(true);
  };

  const openEdit = async (route: Route) => {
    setEditingRoute(route);
    setFormId(route.id);
    setFormDesc(route.description ?? "");
    setFormProtocol(route.protocol ?? "");
    setFormMatchHost(route.match_policy?.host ?? "");
    setFormMatchPathPrefix(route.match_policy?.path_prefix ?? "");
    setFormMatchMethods((route.match_policy?.methods ?? []).join(" "));
    setFormRequireVirtualKey(route.auth_policy?.require_virtual_key ?? true);

    const tp = route.target_policy ?? {};
    const kind = resolveKind(tp);
    setFormTargetKind(kind);
    if (kind === "direct-provider") {
      setFormDirectProviderId(tp.provider_target?.provider_id ?? tp.provider_id ?? "");
    } else {
      setFormModelGroups(
        (tp.model_targets ?? []).length > 0
          ? tp.model_targets!.map((g) => ({
              name: g.name,
              candidates: (g.candidates ?? []).map((c) => ({
                provider_id: c.provider_id,
                upstream_model: c.upstream_model,
                weight: String(c.weight ?? 100),
                priority: String(c.priority ?? 0),
              })),
            }))
          : [defaultModelGroup()]
      );
      setFormDefaultModel(tp.default_model ?? "");
      setFormModelStrategy(tp.model_selector_strategy ?? "auto");
      setFormFallbackEnabled(tp.fallback?.enabled ?? true);
      setFormFallbackMax(String(tp.fallback?.max_num ?? 1));
    }

    setIsEditOpen(true);
    await loadFormDeps(false);
  };

  const buildMatchPolicy = (): RouteMatchPolicy => {
    const methods = formMatchMethods.trim()
      ? formMatchMethods.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean)
      : undefined;
    const m: RouteMatchPolicy = {};
    if (formMatchHost.trim()) m.host = formMatchHost.trim();
    if (formMatchPathPrefix.trim()) m.path_prefix = formMatchPathPrefix.trim();
    if (methods?.length) m.methods = methods;
    return m;
  };

  const buildTargetPolicy = (): RouteTargetPolicy => {
    if (formTargetKind === "direct-provider") {
      return { type: "direct-provider", provider_target: { provider_id: formDirectProviderId.trim() } };
    }
    return {
      type: "logical-model",
      model_targets: formModelGroups.map((g) => ({
        name: g.name.trim() || "default",
        candidates: g.candidates
          .filter((c) => c.provider_id.trim())
          .map((c) => ({
            provider_id: c.provider_id.trim(),
            upstream_model: c.upstream_model.trim(),
            ...(parseInt(c.weight, 10) !== 100 && { weight: parseInt(c.weight, 10) || 100 }),
            ...(parseInt(c.priority, 10) > 0 && { priority: parseInt(c.priority, 10) }),
          })),
      })),
      ...(formDefaultModel.trim() && { default_model: formDefaultModel.trim() }),
      model_selector_strategy: formModelStrategy,
      fallback: { enabled: formFallbackEnabled, max_num: parseInt(formFallbackMax, 10) || 1 },
    };
  };

  const validateForm = (): boolean => {
    if (!formId.trim()) { showToast(t("llmRoutes.idRequired"), "error"); return false; }
    if (!formProtocol) { showToast(t("llmRoutes.protocolRequired"), "error"); return false; }
    if (formTargetKind === "direct-provider" && !formDirectProviderId.trim()) {
      showToast(t("llmRoutes.providerRequired"), "error"); return false;
    }
    if (formTargetKind === "logical-model") {
      const hasCandidate = formModelGroups.some((g) => g.candidates.some((c) => c.provider_id.trim()));
      if (!hasCandidate) { showToast(t("llmRoutes.candidateRequired"), "error"); return false; }
    }
    return true;
  };

  const handleCreate = async () => {
    if (!validateForm()) return;
    const payload = {
      id: formId.trim(),
      ...(formDesc.trim() && { description: formDesc.trim() }),
      disabled: false,
      ...(formProtocol && { protocol: formProtocol }),
      match_policy: buildMatchPolicy(),
      target_policy: buildTargetPolicy(),
      auth_policy: { require_virtual_key: formRequireVirtualKey },
    };
    setSaving(true);
    try {
      const created = await createLLMRoute(payload);
      setRoutes((prev) => [...prev, created]);
      setIsCreateOpen(false);
      showToast(t("llmRoutes.created"), "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : t("llmRoutes.createFailed"), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!editingRoute) return;
    if (formTargetKind === "direct-provider" && !formDirectProviderId.trim()) {
      showToast(t("llmRoutes.providerRequired"), "error"); return;
    }
    // Build the payload from form state plus the preserved fields the edit form
    // does not expose (id, kind, disabled). Server-managed fields (created_at,
    // updated_at, source, read_only) are intentionally omitted — the gateway
    // rejects the update if they are present.
    const payload: LLMRoutePayload = {
      id: editingRoute.id,
      ...(editingRoute.kind && { kind: editingRoute.kind }),
      disabled: editingRoute.disabled,
      ...(formDesc.trim() && { description: formDesc.trim() }),
      ...(formProtocol && { protocol: formProtocol }),
      match_policy: buildMatchPolicy(),
      target_policy: buildTargetPolicy(),
      auth_policy: { require_virtual_key: formRequireVirtualKey },
    };
    setSaving(true);
    try {
      const updated = await updateLLMRoute(editingRoute.id, payload);
      setRoutes((prev) => prev.map((r) => r.id === editingRoute.id ? updated : r));
      setIsEditOpen(false);
      setEditingRoute(null);
      showToast(t("llmRoutes.updated"), "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : t("llmRoutes.updateFailed"), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleDisabled = async (id: string) => {
    const route = routes.find((r) => r.id === id);
    if (!route) return;
    const nextDisabled = !route.disabled;
    try {
      if (nextDisabled) {
        await disableLLMRoute(id);
      } else {
        await enableLLMRoute(id);
      }
      setRoutes((prev) => prev.map((r) => r.id === id ? { ...r, disabled: nextDisabled } : r));
      showToast(nextDisabled ? t("llmRoutes.routeDisabled") : t("llmRoutes.routeEnabled"), "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : t("llmRoutes.updateFailed"), "error");
    }
  };

  const handleDelete = async () => {
    if (!pendingDeleteId) return;
    setSaving(true);
    try {
      await deleteLLMRoute(pendingDeleteId);
      setRoutes((prev) => prev.filter((r) => r.id !== pendingDeleteId));
      setExpandedId(null);
      showToast(t("llmRoutes.deleted"), "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : t("llmRoutes.deleteFailed"), "error");
    } finally {
      setSaving(false);
      setShowConfirm(false);
      setPendingDeleteId(null);
    }
  };

  const updateGroup = (gIdx: number, patch: Partial<ModelGroupDraft>) =>
    setFormModelGroups((prev) => prev.map((g, i) => (i === gIdx ? { ...g, ...patch } : g)));

  const updateCandidate = (gIdx: number, cIdx: number, patch: Partial<CandidateDraft>) =>
    setFormModelGroups((prev) =>
      prev.map((g, i) =>
        i === gIdx ? { ...g, candidates: g.candidates.map((c, j) => (j === cIdx ? { ...c, ...patch } : c)) } : g
      )
    );

  const activeCount = routes.filter((r) => !r.disabled).length;
  const directCount = routes.filter((r) => resolveKind(r.target_policy ?? {}) === "direct-provider").length;
  const logicalCount = routes.filter((r) => resolveKind(r.target_policy ?? {}) === "logical-model").length;

  // ── Form sections (shared between create and edit modals) ─────────────────

  const FormBasicInfo = ({ readonlyId }: { readonlyId?: boolean }) => (
    <div className="space-y-3">
      <SectionHeading>{t("agentRoutes.basic")}</SectionHeading>
      {readonlyId ? (
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">{t("llmRoutes.id")}</label>
          <p className="rounded-md border border-slate-700/60 bg-slate-900/70 px-2.5 py-1.5 font-mono text-xs text-slate-400">
            {formId}
          </p>
        </div>
      ) : (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            {t("llmRoutes.id")} <span className="text-red-400">*</span>
          </label>
          <Input name="id" value={formId} onChange={setFormId} placeholder="e.g. openai-chat, default" />
        </div>
      )}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("common.description")}</label>
        <Input name="description" value={formDesc} onChange={setFormDesc} placeholder={t("agentRoutes.optionalDescription")} />
      </div>
    </div>
  );

  const FormMatch = () => (
    <div className="space-y-3">
      <SectionHeading>
        {t("agentRoutes.match")}
        <HelpTooltip content={t("llmRoutes.matchHelp")} />
      </SectionHeading>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("agentRoutes.host")}</label>
          <Input name="match-host" value={formMatchHost} onChange={setFormMatchHost} placeholder="api.example.com" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("agentRoutes.pathPrefix")}</label>
          <Input name="match-path-prefix" value={formMatchPathPrefix} onChange={setFormMatchPathPrefix} placeholder="/v1/" />
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">
          {t("agentRoutes.methods")}
          <HelpTooltip content={t("llmRoutes.methodsHelp")} />
        </label>
        <Input name="match-methods" value={formMatchMethods} onChange={setFormMatchMethods} placeholder="GET POST" />
      </div>
    </div>
  );

  const FormProtocol = () => (
    <div className="space-y-2">
      <SectionHeading>
        {t("agentRoutes.protocol")} <span className="text-red-400">*</span>
        <HelpTooltip content={t("llmRoutes.protocolHelp")} />
      </SectionHeading>
      <select
        value={formProtocol}
        onChange={(e) => setFormProtocol(e.target.value)}
        disabled={loadingHandlers}
        className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-blue-500/60 focus:outline-none disabled:opacity-50"
      >
        {loadingHandlers ? (
          <option value="">{t("common.loading")}</option>
        ) : (
          <>
            <option value="">{t("mcpServices.none")}</option>
            {llmApiHandlers.map((entry) => (
              <option key={entry.llm_api_handler_type} value={entry.llm_api_handler_type}>
                {entry.llm_api_handler_type}
              </option>
            ))}
          </>
        )}
      </select>
    </div>
  );

  const FormTargetPolicy = () => {
    // Default Model picks one of the defined model targets. Keep a stale/renamed
    // value visible so editing an existing route never silently drops it.
    const targetNames = formModelGroups.map((g) => g.name.trim()).filter(Boolean);
    const defaultModelOptions = Array.from(
      new Set(
        formDefaultModel && !targetNames.includes(formDefaultModel)
          ? [...targetNames, formDefaultModel]
          : targetNames
      )
    );
    return (
    <div className="space-y-3">
      <SectionHeading>
        {t("llmRoutes.targetPolicy")} <span className="text-red-400">*</span>
        <HelpTooltip content={t("llmRoutes.targetHelp")} />
      </SectionHeading>

      <div className="flex gap-3">
        {(["direct-provider", "logical-model"] as RouteTargetPolicyKind[]).map((kind) => (
          <label key={kind} className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="target-kind"
              value={kind}
              checked={formTargetKind === kind}
              onChange={() => setFormTargetKind(kind)}
              className="accent-blue-500"
            />
            <span className="text-xs text-slate-300">{kind}</span>
          </label>
        ))}
      </div>

      {formTargetKind === "direct-provider" ? (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("llmRoutes.provider")}</label>
          <select
            value={formDirectProviderId}
            onChange={(e) => setFormDirectProviderId(e.target.value)}
            className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-blue-500/60 focus:outline-none"
          >
            <option value="">{t("llmRoutes.selectProvider")}</option>
            {providerOptions.map((p) => (
              <option key={p.id} value={p.id}>{p.id}</option>
            ))}
          </select>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Strategy & fallback */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">
                {t("llmRoutes.selectionStrategy")}
                <HelpTooltip content={t("llmRoutes.strategyHelp")} />
              </label>
              <select
                value={formModelStrategy}
                onChange={(e) => setFormModelStrategy(e.target.value as RouteSelectionStrategy)}
                className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-blue-500/60 focus:outline-none"
              >
                <option value="auto">auto</option>
                <option value="weighted">weighted</option>
                <option value="priority">priority</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">
                {t("llmRoutes.defaultModel")}
                <HelpTooltip content={t("llmRoutes.defaultModelHelp")} />
              </label>
              <select
                value={formDefaultModel}
                onChange={(e) => setFormDefaultModel(e.target.value)}
                className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-blue-500/60 focus:outline-none"
              >
                <option value="">{t("mcpServices.none")}</option>
                {defaultModelOptions.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={formFallbackEnabled}
                onChange={(e) => setFormFallbackEnabled(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 accent-blue-500"
              />
              <span className="text-xs text-slate-300">{t("llmRoutes.enableFallback")}</span>
            </label>
            {formFallbackEnabled && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-400">{t("llmRoutes.maxFallbacks")}</label>
                <input
                  type="number"
                  min={1}
                  value={formFallbackMax}
                  onChange={(e) => setFormFallbackMax(e.target.value)}
                  className="w-16 rounded-md border border-slate-700/60 bg-slate-900/70 px-2 py-1 text-xs text-slate-200 focus:outline-none"
                />
              </div>
            )}
          </div>

          {/* Model targets */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">{t("llmRoutes.modelTargets")}</span>
              <button
                type="button"
                onClick={() => setFormModelGroups((prev) => [...prev, defaultModelGroup()])}
                className="rounded border border-slate-600/60 bg-slate-800/60 px-2 py-0.5 text-[10px] text-slate-300 hover:border-blue-500/40 hover:text-blue-300"
              >
                {t("llmRoutes.addTarget")}
              </button>
            </div>

            {formModelGroups.map((group, gIdx) => (
              <div key={gIdx} className="rounded-md border border-slate-700/60 bg-slate-900/50 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <input
                      value={group.name}
                      onChange={(e) => updateGroup(gIdx, { name: e.target.value })}
                      placeholder={t("llmRoutes.targetPlaceholder")}
                      className="w-full rounded-md border border-slate-700/60 bg-slate-900/70 px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none"
                    />
                  </div>
                  {formModelGroups.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setFormModelGroups((prev) => prev.filter((_, i) => i !== gIdx))}
                      className="rounded border border-slate-700/50 bg-slate-800/40 px-1.5 py-1 text-[10px] text-slate-500 hover:border-red-500/40 hover:text-red-400"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="space-y-1.5">
                  {group.candidates.map((c, cIdx) => (
                    <div key={cIdx} className="flex flex-wrap items-center gap-1.5">
                      <select
                        value={c.provider_id}
                        onChange={(e) => updateCandidate(gIdx, cIdx, { provider_id: e.target.value })}
                        className="rounded-md border border-slate-700/60 bg-slate-900/70 px-2 py-1 text-xs text-slate-100 focus:outline-none"
                      >
                        <option value="">{t("llmRoutes.providerPlaceholder")}</option>
                        {providerOptions.map((p) => (
                          <option key={p.id} value={p.id}>{p.id}</option>
                        ))}
                      </select>
                      <input
                        value={c.upstream_model}
                        onChange={(e) => updateCandidate(gIdx, cIdx, { upstream_model: e.target.value })}
                        placeholder={t("llmRoutes.upstreamModel")}
                        className="flex-1 rounded-md border border-slate-700/60 bg-slate-900/70 px-2 py-1 text-xs text-slate-200 placeholder-slate-600 focus:outline-none"
                      />
                      {formModelStrategy === "weighted" && (
                        <div className="flex items-center gap-1">
                          <label className="text-[10px] text-slate-500">w</label>
                          <input
                            type="number"
                            min={1}
                            value={c.weight}
                            onChange={(e) => updateCandidate(gIdx, cIdx, { weight: e.target.value })}
                            className="w-14 rounded-md border border-slate-700/60 bg-slate-900/70 px-1.5 py-1 text-xs text-slate-200 focus:outline-none"
                          />
                        </div>
                      )}
                      {formModelStrategy === "priority" && (
                        <div className="flex items-center gap-1">
                          <label className="text-[10px] text-slate-500">p</label>
                          <input
                            type="number"
                            min={0}
                            value={c.priority}
                            onChange={(e) => updateCandidate(gIdx, cIdx, { priority: e.target.value })}
                            className="w-14 rounded-md border border-slate-700/60 bg-slate-900/70 px-1.5 py-1 text-xs text-slate-200 focus:outline-none"
                          />
                        </div>
                      )}
                      {group.candidates.length > 1 && (
                        <button
                          type="button"
                          onClick={() => updateGroup(gIdx, {
                            candidates: group.candidates.filter((_, i) => i !== cIdx),
                          })}
                          className="text-[10px] text-slate-600 hover:text-red-400"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => updateGroup(gIdx, { candidates: [...group.candidates, defaultCandidate()] })}
                    className="text-[10px] text-slate-500 hover:text-blue-400"
                  >
                    {t("llmRoutes.addCandidate")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
    );
  };

  const FormAuthPolicy = () => (
    <div className="space-y-2">
      <SectionHeading>{t("llmRoutes.authPolicy")}</SectionHeading>
      <label className="flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          checked={formRequireVirtualKey}
          onChange={(e) => setFormRequireVirtualKey(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 accent-blue-500"
        />
        <span className="text-sm text-slate-300">
          {t("llmRoutes.requireKey")}
          <HelpTooltip content={t("llmRoutes.requireKeyHelp")} />
        </span>
      </label>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">{t("llmRoutes.title")}</h1>
            <p className="mt-1 text-xs text-slate-400">
              {t("llmRoutes.description")}
              <HelpTooltip content={t("llmRoutes.descriptionHelp")} />
            </p>
          </div>
          <Button onClick={openCreate} className="px-2.5 py-1 text-xs">{t("llmRoutes.create")}</Button>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          { label: t("llmRoutes.total"), value: routes.length },
          { label: t("common.active"), value: activeCount },
          { label: t("llmRoutes.directProvider"), value: directCount },
          { label: t("llmRoutes.logicalModel"), value: logicalCount },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-slate-700/70 bg-slate-900/40 px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{stat.label}</p>
            <p className="mt-0.5 text-xs font-semibold text-slate-100">{stat.value}</p>
          </div>
        ))}
      </section>

      {/* Route list */}
      {loading ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center">
          <p className="text-sm text-slate-400">{t("llmRoutes.loading")}</p>
        </div>
      ) : routes.length === 0 ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center">
          <p className="text-sm text-slate-400">{t("llmRoutes.empty")}</p>
          <Button onClick={openCreate} className="mt-4 px-3 py-1.5 text-xs">{t("llmRoutes.create")}</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {routes.map((route) => {
            const isExpanded = expandedId === route.id;
            const kind = resolveKind(route.target_policy ?? {});
            const strategy = route.target_policy?.model_selector_strategy;
            return (
              <section key={route.id} className="overflow-hidden rounded-lg border border-slate-700/70 bg-slate-900/40">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
                  <button
                    type="button"
                    className="min-w-0 text-left"
                    onClick={() => setExpandedId(isExpanded ? null : route.id)}
                    aria-expanded={isExpanded}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-100">{route.id}</span>
                      <span className={`inline-flex rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${KIND_COLORS[kind] ?? "bg-slate-700/40 text-slate-400"}`}>
                        {kind}
                      </span>
                      {strategy && (
                        <span className={`inline-flex rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${STRATEGY_COLORS[strategy] ?? ""}`}>
                          {strategy}
                        </span>
                      )}
                      {route.protocol && (
                        <span className="inline-flex rounded-sm bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-medium text-indigo-300">
                          {route.protocol}
                        </span>
                      )}
                      {route.disabled && (
                        <span className="inline-flex rounded-sm bg-slate-700/40 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                          {t("common.disabled")}
                        </span>
                      )}
                    </div>
                    {route.description && (
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">{route.description}</p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {kind === "direct-provider" ? (
                        <span className="inline-flex items-center gap-1 rounded-sm border border-slate-700/60 bg-slate-800/50 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                          {route.target_policy?.provider_target?.provider_id ?? route.target_policy?.provider_id ?? "—"}
                        </span>
                      ) : (
                        (route.target_policy?.model_targets ?? []).map((g, i) => (
                          <span key={i} className="inline-flex items-center gap-1 rounded-sm border border-slate-700/60 bg-slate-800/50 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                            {g.name}
                            <span className="text-slate-500">({(g.candidates ?? []).length})</span>
                          </span>
                        ))
                      )}
                    </div>
                    {(route.match_policy?.host || route.match_policy?.path_prefix || route.match_policy?.methods?.length) ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {route.match_policy?.host && (
                          <span className="inline-flex items-center gap-1 rounded-sm border border-slate-700/40 bg-slate-900/50 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                            <span className="text-slate-600">host:</span>{route.match_policy.host}
                          </span>
                        )}
                        {route.match_policy?.path_prefix && (
                          <span className="inline-flex items-center gap-1 rounded-sm border border-slate-700/40 bg-slate-900/50 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                            <span className="text-slate-600">prefix:</span>{route.match_policy.path_prefix}
                          </span>
                        )}
                        {(route.match_policy?.methods ?? []).map((m, i) => (
                          <span key={i} className="rounded-sm border border-slate-700/40 bg-slate-900/50 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                            {m}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </button>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      disabled={!!route.read_only}
                      onClick={() => handleToggleDisabled(route.id)}
                      className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        route.disabled
                          ? "border-slate-600/60 bg-slate-800/40 text-slate-400 hover:border-emerald-500/40 hover:text-emerald-300"
                          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:border-slate-600/60 hover:bg-slate-800/40 hover:text-slate-400"
                      }`}
                      title={route.read_only ? t("llmRoutes.readOnly") : route.disabled ? t("llmRoutes.enableTitle") : t("llmRoutes.disableTitle")}
                    >
                      {route.disabled ? t("llmRoutes.enable") : t("common.active")}
                    </button>
                    <span title={route.read_only ? t("llmRoutes.readOnly") : undefined}>
                      <Button variant="ghost" className="px-2 py-1 text-[10px]" disabled={!!route.read_only} onClick={() => openEdit(route)}>
                        {t("common.edit")}
                      </Button>
                    </span>
                    <span title={route.read_only ? t("llmRoutes.readOnly") : undefined}>
                      <Button
                        variant="danger"
                        className="px-2 py-1 text-[10px]"
                        disabled={!!route.read_only}
                        onClick={() => { setPendingDeleteId(route.id); setShowConfirm(true); }}
                      >
                        {t("common.delete")}
                      </Button>
                    </span>
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : route.id)}
                      className="rounded-md border border-slate-700/60 bg-slate-800/40 p-1 text-slate-400 transition-colors hover:bg-slate-700/60 hover:text-slate-200"
                      aria-label={isExpanded ? t("llmRoutes.collapse") : t("llmRoutes.expand")}
                    >
                      <svg className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Detail panel */}
                {isExpanded && (
                  <div className="border-t border-slate-700/60 bg-slate-950/30 px-3 py-3">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {/* Auth */}
                      <div>
                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t("llmRoutes.authPolicy")}</p>
                        <div className="space-y-1 text-[11px] text-slate-300">
                          <div className="flex justify-between">
                            <span className="text-slate-500">{t("llmRoutes.requireKey")}</span>
                            <span className={route.auth_policy?.require_virtual_key ? "text-emerald-300" : "text-slate-400"}>
                              {route.auth_policy?.require_virtual_key ? t("llmRoutes.yes") : t("llmRoutes.no")}
                            </span>
                          </div>
                          {route.protocol && (
                            <div className="flex justify-between">
                              <span className="text-slate-500">{t("agentRoutes.protocol")}</span>
                              <span className="font-mono text-slate-200">{route.protocol}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Target policy detail */}
                      <div>
                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t("llmRoutes.targetPolicy")}</p>
                        <div className="space-y-1 text-[11px]">
                          {kind === "direct-provider" ? (
                            <div className="flex justify-between">
                              <span className="text-slate-500">{t("llmRoutes.provider")}</span>
                              <span className="font-mono text-slate-200">
                                {route.target_policy?.provider_target?.provider_id ?? route.target_policy?.provider_id ?? "—"}
                              </span>
                            </div>
                          ) : (
                            <>
                              <div className="flex justify-between">
                                <span className="text-slate-500">{t("llmRoutes.strategy")}</span>
                                <span className={`rounded-sm px-1 py-px text-[10px] ${STRATEGY_COLORS[strategy ?? ""] ?? ""}`}>
                                  {strategy ?? "auto"}
                                </span>
                              </div>
                              {route.target_policy?.default_model && (
                                <div className="flex justify-between">
                                  <span className="text-slate-500">{t("llmRoutes.defaultModel")}</span>
                                  <span className="font-mono text-slate-200">{route.target_policy.default_model}</span>
                                </div>
                              )}
                              {route.target_policy?.fallback?.enabled && (
                                <div className="flex justify-between">
                                  <span className="text-slate-500">{t("llmRoutes.fallbackMax")}</span>
                                  <span>{route.target_policy.fallback.max_num ?? 1}</span>
                                </div>
                              )}
                              {(route.target_policy?.model_targets ?? []).map((g, i) => (
                                <div key={i} className="mt-1 rounded-sm border border-slate-700/50 bg-slate-900/40 px-2 py-1">
                                  <span className="font-mono text-[10px] font-semibold text-slate-300">{g.name}</span>
                                  {(g.candidates ?? []).map((c, j) => (
                                    <div key={j} className="mt-0.5 flex gap-2 text-[10px] text-slate-500">
                                      <span className="font-mono text-slate-400">{c.provider_id}</span>
                                      <span className="font-mono">{c.upstream_model}</span>
                                      {c.weight != null && <span>w={c.weight}</span>}
                                      {c.priority != null && c.priority > 0 && <span>p={c.priority}</span>}
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                      </div>

                      {/* Match */}
                      <div>
                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t("agentRoutes.match")}</p>
                        {(!route.match_policy?.host && !route.match_policy?.path_prefix && !route.match_policy?.methods?.length) ? (
                          <p className="text-[11px] text-slate-600">{t("llmRoutes.matchAll")}</p>
                        ) : (
                          <div className="space-y-1 text-[11px]">
                            {route.match_policy?.host && (
                              <div className="flex justify-between">
                                <span className="text-slate-500">{t("agentRoutes.host")}</span>
                                <span className="font-mono text-slate-200">{route.match_policy.host}</span>
                              </div>
                            )}
                            {route.match_policy?.path_prefix && (
                              <div className="flex justify-between">
                                <span className="text-slate-500">{t("agentRoutes.pathPrefix")}</span>
                                <span className="font-mono text-slate-200">{route.match_policy.path_prefix}</span>
                              </div>
                            )}
                            {route.match_policy?.methods?.length ? (
                              <div className="flex justify-between">
                                <span className="text-slate-500">{t("agentRoutes.methods")}</span>
                                <span className="flex gap-1">
                                  {route.match_policy.methods.map((m, i) => (
                                    <span key={i} className="rounded-sm bg-slate-800/60 px-1.5 py-px font-mono text-[10px] text-slate-300">{m}</span>
                                  ))}
                                </span>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-slate-700/50 pt-2">
                      <span className="text-[10px] text-slate-600">
                        ID: <span className="font-mono text-slate-500">{route.id}</span>
                        {" · "}{t("common.created")} {new Date(route.created_at).toLocaleDateString(locale)}
                        {" · "}{t("common.updated")} {new Date(route.updated_at).toLocaleDateString(locale)}
                      </span>
                      <UsedByAgents agentIds={attribution?.llmRoute[route.id]} source="gateway" />
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* Create modal */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)}>
        <ModalHeader><ModalTitle>{t("llmRoutes.create")}</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="space-y-5">
            {FormBasicInfo({ readonlyId: false })}
            {FormMatch()}
            {FormProtocol()}
            {FormTargetPolicy()}
            {FormAuthPolicy()}
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setIsCreateOpen(false)} disabled={saving}>{t("common.cancel")}</Button>
          <Button onClick={handleCreate} disabled={saving}>{saving ? t("common.creating") : t("llmRoutes.create")}</Button>
        </ModalFooter>
      </Modal>

      {/* Edit modal */}
      <Modal isOpen={isEditOpen} onClose={() => { setIsEditOpen(false); setEditingRoute(null); }}>
        <ModalHeader><ModalTitle>{t("llmRoutes.editTitle", { id: editingRoute?.id ?? "" })}</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="space-y-5">
            {FormBasicInfo({ readonlyId: true })}
            {FormMatch()}
            {FormProtocol()}
            {FormTargetPolicy()}
            {FormAuthPolicy()}
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => { setIsEditOpen(false); setEditingRoute(null); }} disabled={saving}>{t("common.cancel")}</Button>
          <Button onClick={handleEdit} disabled={saving}>{saving ? t("common.saving") : t("common.saveChanges")}</Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={showConfirm}
        onClose={() => { setShowConfirm(false); setPendingDeleteId(null); }}
        onConfirm={handleDelete}
        title={t("llmRoutes.deleteTitle")}
        message={t("llmRoutes.deleteMessage")}
        confirmLabel={saving ? t("common.deleting") : t("common.delete")}
        variant="danger"
      />
    </div>
  );
}
