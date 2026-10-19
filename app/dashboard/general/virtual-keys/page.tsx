"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useAgentAttribution } from "@/hooks/use-agent-attribution";
import { UsedByAgents } from "@/components/used-by-agents";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { HelpTooltip } from "@/components/ui/tooltip";
import { adminFetch, revealVirtualKey, type VirtualKeyRateLimits } from "@/lib/api";
import { useCurrentUser } from "@/components/current-user-context";
import { useI18n } from "@/components/i18n-provider";
import {
  RATE_LIMIT_PROTOCOLS,
  emptyRateLimitsForm,
  rateLimitsFromForm,
  rateLimitsToForm,
  type RateLimitProtocol,
  type RateLimitsFormValue,
} from "@/lib/virtual-key-rate-limits";

// The bearer never reaches the browser: the manager's Virtual Key handlers strip
// it from every list/get and leave key_set + a masked key_preview behind. The
// raw value appears exactly twice — in the create response, and in an explicit
// Platform-Admin-only reveal.
interface VirtualKey {
  id: string;
  key_set: boolean;
  key_preview?: string;
  user_id?: string;
  tag?: string;
  description?: string;
  disabled: boolean;
  allowed_route_ids?: string[];
  rate_limits?: VirtualKeyRateLimits;
  status_message?: string;
  created_at: string;
  updated_at: string;
  expires_at?: string;
  source?: string;
  read_only?: boolean;
}

type RouteProtocol = "llm" | "mcp" | "agent";

interface Route {
  id: string;
  name?: string;
  service_id?: string;
  /** Agent routes target an agent instead of a protocol service. */
  agent_id?: string;
  disabled?: boolean;
  protocol?: RouteProtocol;
}

interface CreateForm {
  id: string;
  tag: string;
  description: string;
  allowed_route_ids: string[];
  expires_at: string;
  rate_limits: RateLimitsFormValue;
}

interface EditForm {
  tag: string;
  description: string;
  allowed_route_ids: string[];
  expires_at: string;
  disabled: boolean;
  rate_limits: RateLimitsFormValue;
}

const emptyForm = (): CreateForm => ({
  id: "",
  tag: "",
  description: "",
  allowed_route_ids: [],
  expires_at: "",
  rate_limits: emptyRateLimitsForm(),
});

const emptyEditForm = (): EditForm => ({
  tag: "",
  description: "",
  allowed_route_ids: [],
  expires_at: "",
  disabled: false,
  rate_limits: emptyRateLimitsForm(),
});

const RATE_LIMIT_LABELS: Record<RateLimitProtocol, string> = {
  llm: "LLM",
  mcp: "MCP",
  agent: "Agent",
};

function RateLimitsEditor({
  value,
  onChange,
}: {
  value: RateLimitsFormValue;
  onChange: (value: RateLimitsFormValue) => void;
}) {
  const { t } = useI18n();
  const { errors } = rateLimitsFromForm(value);

  const update = (protocol: RateLimitProtocol, patch: Partial<RateLimitsFormValue[RateLimitProtocol]>) => {
    onChange({
      ...value,
      [protocol]: { ...value[protocol], ...patch },
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <label className="text-sm font-semibold text-slate-300">{t("virtualKeys.rateLimits")}</label>
        <HelpTooltip content={t("virtualKeys.rateLimitsHelp")} />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {RATE_LIMIT_PROTOCOLS.map((protocol) => {
          const entry = value[protocol];
          return (
            <div
              key={protocol}
              className={`rounded-md border p-3 ${
                entry.enabled
                  ? "border-blue-400/40 bg-blue-500/5"
                  : "border-slate-700/70 bg-slate-800/40"
              }`}
            >
              <label className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <input
                  type="checkbox"
                  checked={entry.enabled}
                  onChange={(event) => update(protocol, { enabled: event.target.checked })}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-500"
                />
                {RATE_LIMIT_LABELS[protocol]}
              </label>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  RPM
                  <input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={entry.requestsPerMinute}
                    disabled={!entry.enabled}
                    onChange={(event) => update(protocol, { requestsPerMinute: event.target.value })}
                    className="mt-1 w-full rounded-md border border-slate-600/60 bg-slate-900/60 px-2 py-1.5 text-sm font-normal text-slate-50 outline-none focus:border-blue-400/50 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </label>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("virtualKeys.burst")}
                  <input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={entry.burst}
                    disabled={!entry.enabled}
                    onChange={(event) => update(protocol, { burst: event.target.value })}
                    className="mt-1 w-full rounded-md border border-slate-600/60 bg-slate-900/60 px-2 py-1.5 text-sm font-normal text-slate-50 outline-none focus:border-blue-400/50 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </label>
              </div>
              {errors[protocol] && <p className="mt-2 text-xs text-red-300">{t("virtualKeys.rateInvalid")}</p>}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-500">
        {t("virtualKeys.rateHelp")}
      </p>
    </div>
  );
}

function rateLimitSummary(rateLimits: VirtualKeyRateLimits | undefined, burstLabel: string): string | null {
  if (!rateLimits) return null;
  const parts = RATE_LIMIT_PROTOCOLS.flatMap((protocol) => {
    const limit = rateLimits[protocol];
    return limit ? [`${RATE_LIMIT_LABELS[protocol]} ${limit.requests_per_minute}/min · ${burstLabel} ${limit.burst}`] : [];
  });
  return parts.length > 0 ? parts.join("  ·  ") : null;
}

function keyLabel(apiKey: VirtualKey, noKey: string, hidden: string): string {
  if (!apiKey.key_set) return noKey;
  return apiKey.key_preview || hidden;
}

function dateInputValue(value?: string): string {
  if (!value || value === "0001-01-01T00:00:00Z") return "";
  return value.split("T")[0] ?? "";
}

// Virtual keys gate every route family (LLM, MCP, and the unified Agent ingress),
// so the picker must offer all of them — not just LLM routes. A failure in one
// family must not hide the others.
async function fetchRoutes(): Promise<Route[]> {
  const sources: { path: string; protocol: RouteProtocol }[] = [
    { path: "/admin/llm/routes", protocol: "llm" },
    { path: "/admin/mcp/routes", protocol: "mcp" },
    { path: "/admin/agents/routes", protocol: "agent" },
  ];
  const order: Record<RouteProtocol, number> = { llm: 0, mcp: 1, agent: 2 };
  const results = await Promise.allSettled(
    sources.map((s) => adminFetch<{ items: Route[] }>(s.path)),
  );
  const routes: Route[] = [];
  results.forEach((res, i) => {
    if (res.status !== "fulfilled") return;
    const { protocol } = sources[i];
    for (const r of res.value.items ?? []) routes.push({ ...r, protocol });
  });
  return routes.sort(
    (a, b) =>
      order[a.protocol ?? "llm"] - order[b.protocol ?? "llm"] || a.id.localeCompare(b.id),
  );
}

function AllowedRouteSelect({
  value,
  routes,
  loading,
  onChange,
}: {
  value: string[];
  routes: Route[];
  loading: boolean;
  onChange: (v: string[]) => void;
}) {
  const { t } = useI18n();
  const routeIds = new Set(routes.map((route) => route.id));
  const missingSelectedRoutes: Route[] = value
    .filter((id) => !routeIds.has(id))
    .map((id) => ({ id, name: t("virtualKeys.unavailableRoute"), disabled: true }));
  const options = [...routes, ...missingSelectedRoutes];

  const toggle = (id: string, checked: boolean) => {
    if (checked) {
      if (!value.includes(id)) onChange([...value, id]);
      return;
    }
    onChange(value.filter((selectedId) => selectedId !== id));
  };

  const clearAll = () => onChange([]);

  return (
    <div className="rounded-md border border-slate-600/60 bg-slate-800/60">
      <div className="flex min-h-[38px] items-center justify-between gap-3 border-b border-slate-700/60 px-3 py-2">
        <span className="text-xs text-slate-400">
          {value.length === 0 ? t("virtualKeys.allRoutes") : t("virtualKeys.selected", { count: value.length })}
        </span>
        <button
          type="button"
          onClick={clearAll}
          disabled={value.length === 0}
          className="text-xs font-medium text-blue-300 hover:text-blue-200 disabled:cursor-not-allowed disabled:text-slate-600"
        >
          {t("virtualKeys.clear")}
        </button>
      </div>
      <div className="max-h-48 overflow-y-auto p-1.5">
        {loading ? (
          <p className="px-2 py-2 text-xs text-slate-500">{t("virtualKeys.loadingRoutes")}</p>
        ) : options.length === 0 ? (
          <p className="px-2 py-2 text-xs text-slate-500">{t("virtualKeys.noRoutes")}</p>
        ) : (
          options.map((route) => {
            const checked = value.includes(route.id);
            return (
              <label
                key={route.id}
                className="flex cursor-pointer items-start gap-2 rounded px-2 py-2 text-sm text-slate-200 hover:bg-slate-700/50"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => toggle(route.id, e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-500"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    {route.protocol && (
                      <span className="shrink-0 rounded bg-slate-700/70 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-300">
                        {route.protocol}
                      </span>
                    )}
                    <span className="block truncate font-mono text-xs">{route.id}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">
                    {route.name || route.agent_id || route.service_id || t("virtualKeys.unnamedRoute")}
                    {route.disabled ? ` · ${t("common.disabled")}` : ""}
                  </span>
                </span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function ApiKeysPage() {
  const [apiKeys, setApiKeys] = useState<VirtualKey[]>([]);
  const attribution = useAgentAttribution();
  const [loading, setLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>(emptyForm());
  const [editForm, setEditForm] = useState<EditForm>(emptyEditForm());
  const [editingKey, setEditingKey] = useState<VirtualKey | null>(null);
  const [showNewKey, setShowNewKey] = useState(false);
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  // The same one-time disclosure surface serves creation and the platform-admin
  // reveal; only the wording differs.
  const [newKeySource, setNewKeySource] = useState<"created" | "revealed">("created");
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [routesLoading, setRoutesLoading] = useState(false);
  const { showToast } = useToast();
  const { user } = useCurrentUser();
  const { locale, t } = useI18n();
  const canReveal = Boolean(user?.is_platform_admin);

  async function fetchKeys() {
    setLoading(true);
    try {
      const data = await adminFetch<{ items: VirtualKey[] }>("/admin/virtual_keys");
      setApiKeys(data.items ?? []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("virtualKeys.loadFailed"), "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchKeys();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRoutes() {
    setRoutesLoading(true);
    try {
      setRoutes(await fetchRoutes());
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("virtualKeys.routesLoadFailed"), "error");
    } finally {
      setRoutesLoading(false);
    }
  }

  const openCreateModal = () => {
    setForm(emptyForm());
    setIsCreateModalOpen(true);
    void loadRoutes();
  };

  const openEditModal = (apiKey: VirtualKey) => {
    if (apiKey.read_only) return;
    setEditingKey(apiKey);
    setEditForm({
      tag: apiKey.tag ?? "",
      description: apiKey.description ?? "",
      allowed_route_ids: apiKey.allowed_route_ids ?? [],
      expires_at: dateInputValue(apiKey.expires_at),
      disabled: apiKey.disabled,
      rate_limits: rateLimitsToForm(apiKey.rate_limits),
    });
    setIsEditModalOpen(true);
    void loadRoutes();
  };

  const handleCreateKey = async () => {
    const { rateLimits, errors } = rateLimitsFromForm(form.rate_limits);
    if (Object.keys(errors).length > 0) {
      showToast(t("virtualKeys.fixRatesCreate"), "error");
      return;
    }
    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        id: form.id.trim(),
      };
      if (form.tag.trim()) body.tag = form.tag.trim();
      if (form.description.trim()) body.description = form.description.trim();
      if (form.allowed_route_ids.length > 0) body.allowed_route_ids = form.allowed_route_ids;
      if (form.expires_at) body.expires_at = new Date(form.expires_at).toISOString();
      if (rateLimits) body.rate_limits = rateLimits;

      const created = await adminFetch<VirtualKey & { key?: string }>("/admin/virtual_keys", {
        method: "POST",
        body: JSON.stringify(body),
      });
      // Keep the one-time bearer out of the list state — the row only ever needs
      // the redacted projection.
      const { key, ...listed } = created;
      setApiKeys((prev) => [...prev, listed]);
      setIsCreateModalOpen(false);
      if (key) {
        setNewKeyValue(key);
        setNewKeySource("created");
        setShowNewKey(true);
      }
      showToast(t("virtualKeys.created"), "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("virtualKeys.createFailed"), "error");
    } finally {
      setCreating(false);
    }
  };

  const handleUpdateKey = async () => {
    if (!editingKey) return;
    const { rateLimits, errors } = rateLimitsFromForm(editForm.rate_limits);
    if (Object.keys(errors).length > 0) {
      showToast(t("virtualKeys.fixRatesSave"), "error");
      return;
    }
    setUpdating(true);
    try {
      const body: Record<string, unknown> = {
        id: editingKey.id,
        tag: editForm.tag.trim(),
        description: editForm.description.trim(),
        disabled: editForm.disabled,
        allowed_route_ids: editForm.allowed_route_ids,
        // null explicitly removes a previously configured policy on PUT.
        rate_limits: rateLimits ?? null,
      };
      if (editForm.expires_at) {
        body.expires_at = new Date(editForm.expires_at).toISOString();
      }

      const updated = await adminFetch<VirtualKey>(`/admin/virtual_keys/${encodeURIComponent(editingKey.id)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      setApiKeys((prev) => prev.map((item) => (item.id === editingKey.id ? updated : item)));
      setIsEditModalOpen(false);
      setEditingKey(null);
      showToast(t("virtualKeys.updated"), "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("virtualKeys.updateFailed"), "error");
    } finally {
      setUpdating(false);
    }
  };

  const handleReveal = async (id: string) => {
    setRevealingId(id);
    try {
      const { key } = await revealVirtualKey(id);
      setNewKeyValue(key);
      setNewKeySource("revealed");
      setShowNewKey(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("virtualKeys.revealFailed"), "error");
    } finally {
      setRevealingId(null);
    }
  };

  const handleDelete = async () => {
    if (!pendingDeleteId) return;
    const pendingVK = apiKeys.find((apiKey) => apiKey.id === pendingDeleteId);
    if (pendingVK?.read_only) {
      setShowConfirm(false);
      setPendingDeleteId(null);
      showToast(t("virtualKeys.readOnlyDelete"), "error");
      return;
    }
    setDeleting(true);
    try {
      await adminFetch(`/admin/virtual_keys/${encodeURIComponent(pendingDeleteId)}`, {
        method: "DELETE",
      });
      setApiKeys((prev) => prev.filter((k) => k.id !== pendingDeleteId));
      showToast(t("virtualKeys.deleted"), "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("virtualKeys.deleteFailed"), "error");
    } finally {
      setDeleting(false);
      setShowConfirm(false);
      setPendingDeleteId(null);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">{t("virtualKeys.title")}</h1>
            <p className="mt-1 text-xs text-slate-400">
              {t("virtualKeys.description")}
              <HelpTooltip content={t("virtualKeys.help")} />
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {t("virtualKeys.disclosure")} {" "}
              {canReveal
                ? t("virtualKeys.revealHelp")
                : t("virtualKeys.adminRevealHelp")}
            </p>
          </div>
          <Button onClick={openCreateModal} className="px-2.5 py-1 text-xs">
            {t("virtualKeys.create")}
          </Button>
        </div>
      </section>

      {loading ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center">
          <p className="text-sm text-slate-400">{t("virtualKeys.loading")}</p>
        </div>
      ) : apiKeys.length === 0 ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center">
          <p className="text-sm text-slate-400">{t("virtualKeys.empty")}</p>
          <Button onClick={openCreateModal} className="mt-4 px-3 py-1.5 text-xs">{t("virtualKeys.create")}</Button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <section className="min-w-[700px] overflow-hidden rounded-lg border border-slate-700/70 bg-slate-900/40">
            <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_180px_160px_230px] border-b border-slate-700/70 bg-slate-900/95 backdrop-blur-sm px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              <span>{t("virtualKeys.name")}</span><span>{t("common.created")}</span><span>{t("virtualKeys.expires")}</span><span>{t("common.actions")}</span>
            </div>
            {apiKeys.map((apiKey) => (
              <div key={apiKey.id} className="grid grid-cols-[minmax(0,1fr)_180px_160px_230px] items-center border-b border-slate-700/60 px-3 py-2 last:border-b-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-mono text-xs font-medium text-slate-100">{apiKey.id}</p>
                    <UsedByAgents agentIds={attribution?.virtualKey[apiKey.id]} />
                  </div>
                  <p className="mt-0.5 truncate font-mono text-xs text-slate-400">{keyLabel(apiKey, t("virtualKeys.noStoredKey"), t("virtualKeys.keyHidden"))}</p>
                  {rateLimitSummary(apiKey.rate_limits, t("virtualKeys.burst")) && (
                    <p className="mt-1 truncate text-[11px] text-blue-300/80">
                      {rateLimitSummary(apiKey.rate_limits, t("virtualKeys.burst"))}
                    </p>
                  )}
                </div>
                <span className="text-xs text-slate-400">{new Date(apiKey.created_at).toLocaleDateString(locale)}</span>
                <span className="text-xs text-slate-400">
                  {apiKey.expires_at && apiKey.expires_at !== "0001-01-01T00:00:00Z"
                    ? new Date(apiKey.expires_at).toLocaleDateString(locale)
                    : t("virtualKeys.never")}
                </span>
                <div className="flex justify-end gap-1.5">
                  {canReveal && (
                    <Button
                      variant="ghost"
                      onClick={() => void handleReveal(apiKey.id)}
                      disabled={!apiKey.key_set || revealingId !== null}
                      className="px-2.5 py-1 text-xs"
                      title={t("virtualKeys.revealTitle")}
                    >
                      {revealingId === apiKey.id ? t("virtualKeys.revealing") : t("virtualKeys.reveal")}
                    </Button>
                  )}
                  <span title={apiKey.read_only ? t("virtualKeys.readOnlyEdit") : undefined}>
                    <Button
                      variant="ghost"
                      onClick={() => openEditModal(apiKey)}
                      disabled={!!apiKey.read_only}
                      className="px-2.5 py-1 text-xs"
                    >
                      {t("common.edit")}
                    </Button>
                  </span>
                  <span title={apiKey.read_only ? t("virtualKeys.readOnlyDelete") : undefined}>
                    <Button
                      variant="danger"
                      onClick={() => { setPendingDeleteId(apiKey.id); setShowConfirm(true); }}
                      disabled={!!apiKey.read_only}
                      className="px-2.5 py-1 text-xs"
                    >
                      {t("common.delete")}
                    </Button>
                  </span>
                </div>
              </div>
            ))}
          </section>
        </div>
      )}

      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)}>
        <ModalHeader><ModalTitle>{t("virtualKeys.create")}</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-300">
                ID <span className="text-slate-500 font-normal">({t("virtualKeys.required")})</span>
              </label>
              <Input
                name="key-id"
                value={form.id}
                onChange={(v) => setForm((f) => ({ ...f, id: v }))}
                placeholder={t("virtualKeys.idPlaceholder")}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-300">
                {t("virtualKeys.tag")}
                <HelpTooltip content={t("virtualKeys.tagHelp")} />
              </label>
              <Input
                name="key-tag"
                value={form.tag}
                onChange={(v) => setForm((f) => ({ ...f, tag: v }))}
                placeholder={t("virtualKeys.tagPlaceholder")}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-300">{t("common.description")}</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder={t("virtualKeys.descriptionPlaceholder")}
                rows={2}
                className="w-full resize-none rounded-md border border-slate-600/60 bg-slate-800/60 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 outline-none focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/30"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-300">
                {t("virtualKeys.allowedRoutes")}
                <HelpTooltip content={t("virtualKeys.allowedRoutesHelp")} />
              </label>
              <AllowedRouteSelect
                value={form.allowed_route_ids}
                routes={routes}
                loading={routesLoading}
                onChange={(v) => setForm((f) => ({ ...f, allowed_route_ids: v }))}
              />
              <p className="mt-1 text-xs text-slate-500">{t("virtualKeys.selectRoutesHelp")}</p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-300">
                {t("virtualKeys.expiration")}
                <HelpTooltip content={t("virtualKeys.expirationHelp")} />
              </label>
              <input
                type="date"
                value={form.expires_at}
                onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
                min={new Date().toISOString().split("T")[0]}
                className="w-full rounded-md border border-slate-600/60 bg-slate-800/60 px-3 py-2 text-sm text-slate-50 outline-none focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/30"
              />
              <p className="mt-1 text-xs text-slate-500">{t("virtualKeys.expirationHelp")}</p>
            </div>

            <RateLimitsEditor
              value={form.rate_limits}
              onChange={(rate_limits) => setForm((current) => ({ ...current, rate_limits }))}
            />
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setIsCreateModalOpen(false)} disabled={creating}>{t("common.cancel")}</Button>
          <Button
            onClick={handleCreateKey}
            disabled={
              creating ||
              !form.id.trim() ||
              Object.keys(rateLimitsFromForm(form.rate_limits).errors).length > 0
            }
          >
            {creating ? t("common.creating") : t("virtualKeys.create")}
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        isOpen={isEditModalOpen && editingKey !== null}
        onClose={() => { setIsEditModalOpen(false); setEditingKey(null); }}
      >
        <ModalHeader><ModalTitle>{t("virtualKeys.edit")}</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-300">
                {t("virtualKeys.tag")}
                <HelpTooltip content={t("virtualKeys.tagHelp")} />
              </label>
              <Input
                name="edit-key-tag"
                value={editForm.tag}
                onChange={(v) => setEditForm((f) => ({ ...f, tag: v }))}
                placeholder={t("virtualKeys.tagPlaceholder")}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-300">{t("common.description")}</label>
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                placeholder={t("virtualKeys.descriptionPlaceholder")}
                rows={2}
                className="w-full resize-none rounded-md border border-slate-600/60 bg-slate-800/60 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 outline-none focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/30"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-300">
                {t("virtualKeys.allowedRoutes")}
                <HelpTooltip content={t("virtualKeys.allowedRoutesHelp")} />
              </label>
              <AllowedRouteSelect
                value={editForm.allowed_route_ids}
                routes={routes}
                loading={routesLoading}
                onChange={(v) => setEditForm((f) => ({ ...f, allowed_route_ids: v }))}
              />
              <p className="mt-1 text-xs text-slate-500">{t("virtualKeys.selectRoutesHelp")}</p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-300">
                {t("virtualKeys.expiration")}
                <HelpTooltip content={t("virtualKeys.expirationHelp")} />
              </label>
              <input
                type="date"
                value={editForm.expires_at}
                onChange={(e) => setEditForm((f) => ({ ...f, expires_at: e.target.value }))}
                min={new Date().toISOString().split("T")[0]}
                className="w-full rounded-md border border-slate-600/60 bg-slate-800/60 px-3 py-2 text-sm text-slate-50 outline-none focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/30"
              />
              <p className="mt-1 text-xs text-slate-500">{t("virtualKeys.expirationHelp")}</p>
            </div>

            <RateLimitsEditor
              value={editForm.rate_limits}
              onChange={(rate_limits) => setEditForm((current) => ({ ...current, rate_limits }))}
            />

            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={editForm.disabled}
                onChange={(e) => setEditForm((f) => ({ ...f, disabled: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-500"
              />
              {t("common.disabledTitle")}
            </label>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button
            variant="ghost"
            onClick={() => { setIsEditModalOpen(false); setEditingKey(null); }}
            disabled={updating}
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleUpdateKey}
            disabled={
              updating || Object.keys(rateLimitsFromForm(editForm.rate_limits).errors).length > 0
            }
          >
            {updating ? t("common.saving") : t("common.saveChanges")}
          </Button>
        </ModalFooter>
      </Modal>

      <Modal isOpen={showNewKey && newKeyValue !== null} onClose={() => { setShowNewKey(false); setNewKeyValue(null); }}>
        <ModalHeader>
          <ModalTitle>{newKeySource === "created" ? t("virtualKeys.new") : t("virtualKeys.value")}</ModalTitle>
        </ModalHeader>
        <ModalContent>
          <div className="rounded-sm border border-slate-700/70 bg-slate-900/40 p-4 text-sm">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="font-medium text-slate-100">{t("virtualKeys.copyNow")}</span>
              <Button
                variant="ghost"
                onClick={() => {
                  if (!newKeyValue) return;
                  void navigator.clipboard.writeText(newKeyValue).then(() => {
                    showToast(t("virtualKeys.copied"), "success");
                  });
                }}
                className="px-2.5 py-1 text-xs"
              >
                {t("virtualKeys.copy")}
              </Button>
            </div>
            <div className="break-all rounded-sm border border-slate-700/70 bg-slate-900/40 p-3 font-mono text-xs text-slate-200">{newKeyValue}</div>
          </div>
          <div className="mt-3 rounded-sm border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <span className="text-amber-200">
              {newKeySource === "created"
                ? t("virtualKeys.once")
                : t("virtualKeys.auditDisclosure")}
            </span>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button onClick={() => { setShowNewKey(false); setNewKeyValue(null); }}>{t("virtualKeys.saved")}</Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={showConfirm}
        onClose={() => { setShowConfirm(false); setPendingDeleteId(null); }}
        onConfirm={handleDelete}
        title={t("virtualKeys.deleteTitle")}
        message={t("virtualKeys.deleteMessage")}
        confirmLabel={deleting ? t("common.deleting") : t("common.delete")}
        variant="danger"
      />
    </div>
  );
}
