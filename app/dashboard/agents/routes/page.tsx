"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { HelpTooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/components/i18n-provider";
import {
  ApiError,
  listAgentRoutes,
  listAgents,
  createAgentRoute,
  updateAgentRoute,
  deleteAgentRoute,
  type Agent,
  type AgentRoute,
  type AgentRoutePayload,
  type RouteMatchPolicy,
} from "@/lib/api";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{children}</p>;
}

/**
 * Unified Agent ingress routes. One route family serves every runtime: the route
 * targets a stable agent_id and the resolved Agent's runtime.type selects the
 * execution backend, so changing an Agent's runtime never changes its route, URL,
 * or VirtualKey allowlist (unified-agent-runtime.md §6.2).
 */
export default function AgentRoutesPage() {
  const [routes, setRoutes] = useState<AgentRoute[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [routesError, setRoutesError] = useState<string | null>(null);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editing, setEditing] = useState<AgentRoute | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();
  const { t } = useI18n();

  const [formId, setFormId] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formAgentId, setFormAgentId] = useState("");
  const [formProtocol, setFormProtocol] = useState<"agent" | "a2a">("agent");
  const [formMatchHost, setFormMatchHost] = useState("");
  const [formMatchPathPrefix, setFormMatchPathPrefix] = useState("");
  const [formMatchMethods, setFormMatchMethods] = useState("");
  const [formRequireVirtualKey, setFormRequireVirtualKey] = useState(true);

  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  // The two fetches are settled independently on purpose. They hit different
  // endpoints and either can fail alone — most visibly when the gateway predates
  // the unified agent runtime, where /admin/agents/routes resolves "routes" as an
  // agent id and 404s. Coupling them through Promise.all would blank the agent
  // picker as collateral and report the wrong cause.
  const load = useCallback(async () => {
    setLoading(true);
    const [routesResult, agentsResult] = await Promise.allSettled([listAgentRoutes(), listAgents()]);
    if (routesResult.status === "fulfilled") {
      setRoutes(routesResult.value);
      setRoutesError(null);
    } else {
      const err = routesResult.reason;
      setRoutesError(err instanceof ApiError ? err.message : t("agentRoutes.loadFailed"));
    }
    if (agentsResult.status === "fulfilled") {
      setAgents(agentsResult.value);
      setAgentsError(null);
    } else {
      const err = agentsResult.reason;
      setAgentsError(err instanceof ApiError ? err.message : t("agents.loadFailed"));
    }
    setLoading(false);
  }, [t]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const resetForm = () => {
    setFormId(""); setFormDesc(""); setFormAgentId("");
    setFormProtocol("agent");
    setFormMatchHost(""); setFormMatchPathPrefix("/agents"); setFormMatchMethods("POST");
    setFormRequireVirtualKey(true);
  };

  const openCreate = () => { resetForm(); setIsCreateOpen(true); };

  const openEdit = (route: AgentRoute) => {
    setEditing(route);
    setFormId(route.id);
    setFormDesc(route.description ?? "");
    setFormAgentId(route.agent_id);
    setFormProtocol(route.protocol ?? "agent");
    setFormMatchHost(route.match_policy?.host ?? "");
    setFormMatchPathPrefix(route.match_policy?.path_prefix ?? "");
    setFormMatchMethods((route.match_policy?.methods ?? []).join(" "));
    setFormRequireVirtualKey(route.auth_policy?.require_virtual_key ?? true);
    setIsEditOpen(true);
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

  const handleCreate = async () => {
    if (!formAgentId.trim()) { showToast(t("agentRoutes.agentRequired"), "error"); return; }
    const payload = {
      ...(formId.trim() && { id: formId.trim() }),
      ...(formDesc.trim() && { description: formDesc.trim() }),
      protocol: formProtocol,
      disabled: false,
      match_policy: buildMatchPolicy(),
      auth_policy: { require_virtual_key: formRequireVirtualKey },
      agent_id: formAgentId.trim(),
    } as AgentRoutePayload;
    setSaving(true);
    try {
      const created = await createAgentRoute(payload);
      setRoutes((prev) => [...prev, created]);
      setIsCreateOpen(false);
      showToast(t("agentRoutes.created"), "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : t("agentRoutes.createFailed"), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!editing) return;
    if (!formAgentId.trim()) { showToast(t("agentRoutes.agentRequired"), "error"); return; }
    const payload: AgentRoutePayload = {
      id: editing.id,
      description: formDesc.trim() || undefined,
      protocol: formProtocol,
      disabled: editing.disabled,
      match_policy: buildMatchPolicy(),
      auth_policy: { require_virtual_key: formRequireVirtualKey },
      agent_id: formAgentId.trim(),
    };
    setSaving(true);
    try {
      const updated = await updateAgentRoute(editing.id, payload);
      setRoutes((prev) => prev.map((r) => (r.id === editing.id ? updated : r)));
      setIsEditOpen(false);
      setEditing(null);
      showToast(t("agentRoutes.updated"), "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : t("agentRoutes.updateFailed"), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDeleteId) return;
    setSaving(true);
    try {
      await deleteAgentRoute(pendingDeleteId);
      setRoutes((prev) => prev.filter((r) => r.id !== pendingDeleteId));
      showToast(t("agentRoutes.deleted"), "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : t("agentRoutes.deleteFailed"), "error");
    } finally {
      setSaving(false);
      setShowConfirm(false);
      setPendingDeleteId(null);
    }
  };

  const renderFormBody = (readonlyId: boolean) => (
    <div className="space-y-5">
      <div className="space-y-3">
        <SectionHeading>{t("agentRoutes.basic")}</SectionHeading>
        {readonlyId ? (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">{t("agentRoutes.id")}</label>
            <p className="rounded-md border border-slate-700/60 bg-slate-900/70 px-2.5 py-1.5 font-mono text-xs text-slate-400">{formId}</p>
          </div>
        ) : (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              {t("agentRoutes.id")}
              <HelpTooltip content={t("agentRoutes.idHelp")} />
            </label>
            <Input name="id" value={formId} onChange={setFormId} placeholder="auto: agent:<agent>:<prefix>" />
          </div>
        )}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("common.description")}</label>
          <Input name="description" value={formDesc} onChange={setFormDesc} placeholder={t("agentRoutes.optionalDescription")} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            {t("agentRoutes.protocol")}
            <HelpTooltip content={t("agentRoutes.protocolHelp")} />
          </label>
          <select
            value={formProtocol}
            onChange={(event) => {
              const protocol = event.target.value as "agent" | "a2a";
              setFormProtocol(protocol);
              if (protocol === "a2a" && formMatchMethods.trim() === "POST") setFormMatchMethods("");
            }}
            className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-blue-500/60 focus:outline-none"
          >
            <option value="agent">{t("agentRoutes.commonIngress")}</option>
            <option value="a2a">{t("agentRoutes.nativeIngress")}</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            Agent <span className="text-red-400">*</span>
            <HelpTooltip content={t("agentRoutes.targetHelp")} />
          </label>
          <select
            value={formAgentId}
            onChange={(e) => setFormAgentId(e.target.value)}
            className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-blue-500/60 focus:outline-none"
          >
            <option value="">{t("agentRoutes.selectAgent")}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.runtime.type})</option>
            ))}
          </select>
          {/* An empty picker is indistinguishable from "no agents exist", so say
              which of the two it is — and let the fetch be retried in place
              rather than forcing a page reload. */}
          {agentsError ? (
            <div className="mt-1.5 flex items-start justify-between gap-2 rounded-md border border-rose-500/50 bg-rose-500/10 px-2.5 py-1.5">
              <p className="text-[11px] leading-4 text-rose-200">
                {t("agentRoutes.agentListFailed", { detail: agentsError })}
              </p>
              <Button variant="ghost" className="shrink-0 px-2 py-0.5 text-[10px]" onClick={() => void load()}>
                {t("common.retry")}
              </Button>
            </div>
          ) : (
            agents.length === 0 && (
              <p className="mt-1.5 text-[11px] leading-4 text-amber-300/90">
                {t("agentRoutes.noAgentsBefore")} <Link href="/dashboard/agents/new" className="underline hover:text-amber-200">{t("agentRoutes.createAgent")}</Link> {t("agentRoutes.noAgentsAfter")}
              </p>
            )
          )}
          {formAgentId && agentsById.get(formAgentId)?.capabilities?.executable === false && (
            <p className="mt-1.5 text-[11px] leading-4 text-rose-300/90">
              {t("agentRoutes.notExecutableForm")}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <SectionHeading>
          {t("agentRoutes.match")}
          <HelpTooltip content={t("agentRoutes.matchHelp")} />
        </SectionHeading>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("agentRoutes.host")}</label>
            <Input name="match-host" value={formMatchHost} onChange={setFormMatchHost} placeholder="api.example.com" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("agentRoutes.pathPrefix")}</label>
            <Input name="match-path-prefix" value={formMatchPathPrefix} onChange={setFormMatchPathPrefix} placeholder="/agents/codex" />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            {t("agentRoutes.methods")}
            <HelpTooltip content={t("agentRoutes.methodsHelp")} />
          </label>
          <Input name="match-methods" value={formMatchMethods} onChange={setFormMatchMethods} placeholder="POST" />
        </div>
      </div>

      <div className="space-y-2">
        <SectionHeading>{t("agentRoutes.authPolicy")}</SectionHeading>
        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={formRequireVirtualKey}
            onChange={(e) => setFormRequireVirtualKey(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 accent-blue-500"
          />
          <span className="text-sm text-slate-300">
            {t("agentRoutes.requireKey")}
            <HelpTooltip content={t("agentRoutes.requireKeyHelp")} />
          </span>
        </label>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">{t("agentRoutes.title")}</h1>
            <p className="mt-1 text-xs text-slate-400">
              {t("agentRoutes.description")}
              <HelpTooltip content={t("agentRoutes.descriptionHelp")} />
            </p>
          </div>
          <Button onClick={openCreate} className="px-2.5 py-1 text-xs">{t("agentRoutes.create")}</Button>
        </div>
      </section>

      {loading ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center">
          <p className="text-sm text-slate-400">{t("agentRoutes.loading")}</p>
        </div>
      ) : routesError ? (
        <div className="rounded-lg border border-rose-500/50 bg-rose-500/10 p-6" role="alert">
          <p className="text-sm font-semibold text-rose-200">{t("agentRoutes.loadFailed")}</p>
          <p className="mt-1 text-xs text-rose-300/90">{routesError}</p>
          <p className="mt-2 text-[11px] leading-4 text-rose-300/70">
            {t("agentRoutes.compatibilityHelp")}
          </p>
          <Button variant="ghost" className="mt-3 px-2.5 py-1 text-xs" onClick={() => void load()}>{t("common.retry")}</Button>
        </div>
      ) : routes.length === 0 ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center">
          <p className="text-sm text-slate-400">{t("agentRoutes.empty")}</p>
          <Button onClick={openCreate} className="mt-4 px-3 py-1.5 text-xs">{t("agentRoutes.create")}</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {routes.map((route) => {
            const target = agentsById.get(route.agent_id);
            // A route whose agent_id resolves to nothing is dangling — agent delete
            // is fail-closed, but a bundle apply or a direct API call can still
            // leave one behind. Only claim that when the agent list is actually
            // known: a failed agents fetch would otherwise flag every route.
            const dangling = !loading && !agentsError && !target;
            return (
              <section key={route.id} className="rounded-lg border border-slate-700/70 bg-slate-900/40 px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-100">{route.id}</span>
                      <span className="inline-flex rounded-sm border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 font-mono text-[10px] text-blue-300">
                        {route.protocol ?? "agent"}
                      </span>
                      {target || agentsError ? (
                        <Link
                          href={`/dashboard/agents/${encodeURIComponent(route.agent_id)}`}
                          className="inline-flex items-center gap-1 rounded-sm border border-slate-700/60 bg-slate-800/50 px-1.5 py-0.5 font-mono text-[10px] text-slate-300 hover:border-blue-500/60 hover:text-blue-300"
                        >
                          <span className="text-slate-600">agent:</span>{route.agent_id}
                        </Link>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-sm border border-rose-500/60 bg-rose-500/10 px-1.5 py-0.5 font-mono text-[10px] text-rose-300">
                          <span className="text-rose-500/80">agent:</span>{route.agent_id}
                        </span>
                      )}
                      {route.disabled && (
                        <span className="inline-flex rounded-sm bg-slate-700/40 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">{t("common.disabled")}</span>
                      )}
                      {route.read_only && (
                        <span className="inline-flex rounded-sm bg-slate-700/40 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">{t("agentRoutes.readOnly")}</span>
                      )}
                    </div>
                    {route.description && <p className="mt-0.5 truncate text-[11px] text-slate-500">{route.description}</p>}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {route.match_policy?.host && (
                        <span className="rounded-sm border border-slate-700/40 bg-slate-900/50 px-1.5 py-0.5 font-mono text-[10px] text-slate-400"><span className="text-slate-600">host:</span>{route.match_policy.host}</span>
                      )}
                      {route.match_policy?.path_prefix && (
                        <span className="rounded-sm border border-slate-700/40 bg-slate-900/50 px-1.5 py-0.5 font-mono text-[10px] text-slate-400"><span className="text-slate-600">prefix:</span>{route.match_policy.path_prefix}</span>
                      )}
                      {(route.match_policy?.methods ?? []).map((m: string, i: number) => (
                        <span key={i} className="rounded-sm border border-slate-700/40 bg-slate-900/50 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{m}</span>
                      ))}
                      {target && (
                        <span className="rounded-sm border border-slate-700/40 bg-slate-900/50 px-1.5 py-0.5 font-mono text-[10px] text-slate-400"><span className="text-slate-600">runtime:</span>{target.runtime.type}</span>
                      )}
                      <span className={`rounded-sm px-1.5 py-0.5 text-[10px] ${route.auth_policy?.require_virtual_key ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-700/40 text-slate-400"}`}>
                        {route.auth_policy?.require_virtual_key ? t("agentRoutes.keyRequired") : t("agentRoutes.open")}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span title={route.read_only ? t("agentRoutes.readOnlyTitle") : undefined}>
                      <Button variant="ghost" className="px-2 py-1 text-[10px]" disabled={!!route.read_only} onClick={() => openEdit(route)}>{t("common.edit")}</Button>
                    </span>
                    <span title={route.read_only ? t("agentRoutes.readOnlyTitle") : undefined}>
                      <Button variant="danger" className="px-2 py-1 text-[10px]" disabled={!!route.read_only} onClick={() => { setPendingDeleteId(route.id); setShowConfirm(true); }}>{t("common.delete")}</Button>
                    </span>
                  </div>
                </div>
                {dangling && (
                  <p className="mt-2 rounded-md border border-rose-500/50 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-200" role="alert">
                    {t("agentRoutes.dangling")}
                  </p>
                )}
                {target?.capabilities?.executable === false && !target.disabled && (
                  <p className="mt-2 rounded-md border border-rose-500/50 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-200" role="alert">
                    {t("agentRoutes.notExecutable")}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}

      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)}>
        <ModalHeader><ModalTitle>{t("agentRoutes.createTitle")}</ModalTitle></ModalHeader>
        <ModalContent>{renderFormBody(false)}</ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setIsCreateOpen(false)} disabled={saving}>{t("common.cancel")}</Button>
          <Button onClick={handleCreate} disabled={saving}>{saving ? t("common.creating") : t("agentRoutes.create")}</Button>
        </ModalFooter>
      </Modal>

      <Modal isOpen={isEditOpen} onClose={() => { setIsEditOpen(false); setEditing(null); }}>
        <ModalHeader><ModalTitle>{t("agentRoutes.editTitle", { id: editing?.id ?? "" })}</ModalTitle></ModalHeader>
        <ModalContent>{renderFormBody(true)}</ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => { setIsEditOpen(false); setEditing(null); }} disabled={saving}>{t("common.cancel")}</Button>
          <Button onClick={handleEdit} disabled={saving}>{saving ? t("common.saving") : t("common.saveChanges")}</Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={showConfirm}
        onClose={() => { setShowConfirm(false); setPendingDeleteId(null); }}
        onConfirm={handleDelete}
        title={t("agentRoutes.deleteTitle")}
        message={t("agentRoutes.deleteMessage")}
        confirmLabel={saving ? t("common.deleting") : t("common.delete")}
        variant="danger"
      />
    </div>
  );
}
