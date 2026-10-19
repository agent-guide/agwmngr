"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  listProviders,
  listProviderTypes,
  createProvider,
  updateProvider,
  deleteProvider,
  enableProvider,
  disableProvider,
  type ProviderItem,
} from "@/lib/api";
import { useAgentAttribution } from "@/hooks/use-agent-attribution";
import { UsedByAgents } from "@/components/used-by-agents";
import { useI18n } from "@/components/i18n-provider";
import {
  ProviderAdvancedFields,
  buildNetworkConfig,
  emptyNetworkDraft,
  networkDraftFromConfig,
  parseProviderOptions,
  type NetworkDraft,
} from "@/components/provider-advanced-fields";

function getBaseUrl(item: ProviderItem): string {
  return item.base_url ?? "";
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

export default function ProvidersPage() {
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [enabledProviderTypes, setEnabledProviderTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const attribution = useAgentAttribution();

  // Add modal state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addId, setAddId] = useState("");
  const [addType, setAddType] = useState("");
  const [addBaseUrl, setAddBaseUrl] = useState("");
  const [addApiKey, setAddApiKey] = useState("");
  const [addDefaultModel, setAddDefaultModel] = useState("");
  const [addDisabled, setAddDisabled] = useState(false);
  const [addNetwork, setAddNetwork] = useState<NetworkDraft>(emptyNetworkDraft);
  const [addOptionsRaw, setAddOptionsRaw] = useState("{}");

  // Edit modal state
  const [editItem, setEditItem] = useState<ProviderItem | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editBaseUrl, setEditBaseUrl] = useState("");
  const [editApiKey, setEditApiKey] = useState("");
  const [editDefaultModel, setEditDefaultModel] = useState("");
  const [editDisabled, setEditDisabled] = useState(false);
  const [editNetwork, setEditNetwork] = useState<NetworkDraft>(emptyNetworkDraft);
  const [editOptionsRaw, setEditOptionsRaw] = useState("{}");

  // Delete confirm state
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [togglingProviderId, setTogglingProviderId] = useState<string | null>(null);

  const { showToast } = useToast();
  const { t } = useI18n();

  const loadProviders = useCallback(async () => {
    setLoading(true);
    try {
      const [items, names] = await Promise.all([listProviders(), listProviderTypes()]);
      setProviders(items);
      const enabled = names.filter((n) => n.enabled).map((n) => n.provider_type);
      setEnabledProviderTypes(enabled);
      setAddType((prev) => (prev === "" ? (enabled[0] ?? "") : prev));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("providers.loadFailed"), "error");
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProviders();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProviders]);

  const handleAdd = async () => {
    if (!addId.trim()) { showToast(t("providers.idRequired"), "error"); return; }
    const id = slugify(addId);
    if (!id) { showToast(t("providers.idInvalid"), "error"); return; }

    setAddSubmitting(true);
    try {
      const payload: Parameters<typeof createProvider>[0] = { id, provider_type: addType };
      if (addBaseUrl.trim()) payload.base_url = addBaseUrl.trim();
      if (addApiKey.trim()) payload.api_key = addApiKey.trim();
      if (addDefaultModel.trim()) payload.default_model = addDefaultModel.trim();
      if (addDisabled) payload.disabled = true;
      const network = buildNetworkConfig(addNetwork);
      if (network) payload.network = network;
      const options = parseProviderOptions(addOptionsRaw);
      if (options) payload.options = options;
      const item = await createProvider(payload);
      setProviders((prev) => [...prev, item]);
      showToast(t("providers.added"), "success");
      setIsAddOpen(false);
      setAddId(""); setAddType(enabledProviderTypes[0] ?? ""); setAddBaseUrl(""); setAddApiKey("");
      setAddDefaultModel(""); setAddDisabled(false); setAddNetwork(emptyNetworkDraft()); setAddOptionsRaw("{}");
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("providers.addFailed"), "error");
    } finally {
      setAddSubmitting(false);
    }
  };

  const openEdit = (item: ProviderItem) => {
    setEditItem(item);
    setEditBaseUrl(item.base_url ?? "");
    setEditDefaultModel(item.default_model ?? "");
    setEditDisabled(item.disabled ?? false);
    setEditNetwork(networkDraftFromConfig(item.network));
    setEditOptionsRaw(JSON.stringify(item.options ?? {}, null, 2));
    // Secret reads are redacted by the manager. The edit field is write-only:
    // blank preserves the current key, a value replaces it.
    setEditApiKey("");
  };

  const handleEdit = async () => {
    if (!editItem) return;

    const payload: Parameters<typeof updateProvider>[1] = {
      provider_type: editItem.provider_type,
      disabled: editDisabled,
      base_url: editBaseUrl.trim(),
      default_model: editDefaultModel.trim(),
    };
    if (editApiKey.trim()) payload.api_key = editApiKey.trim();

    setEditSubmitting(true);
    try {
      // Visible network fields are a complete edit snapshot: blank values clear
      // overrides and restore gateway defaults. Write-only headers remain
      // omitted when blank, so the server-side merge preserves them.
      payload.network = buildNetworkConfig(editNetwork, { includeEmpty: true });
      const options = parseProviderOptions(editOptionsRaw);
      if (options !== undefined) payload.options = options;
      const updated = await updateProvider(editItem.id, payload);
      setProviders((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      showToast(t("providers.updated"), "success");
      setEditItem(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("providers.updateFailed"), "error");
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDeleteId) return;
    try {
      await deleteProvider(pendingDeleteId);
      setProviders((prev) => prev.filter((p) => p.id !== pendingDeleteId));
      showToast(t("providers.deleted"), "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("providers.deleteFailed"), "error");
    } finally {
      setPendingDeleteId(null);
    }
  };

  const handleToggleDisabled = async (provider: ProviderItem) => {
    if (provider.read_only || togglingProviderId) return;
    setTogglingProviderId(provider.id);
    try {
      const updated = provider.disabled
        ? await enableProvider(provider.id)
        : await disableProvider(provider.id);
      setProviders((prev) => prev.map((item) => (item.id === provider.id ? updated : item)));
      showToast(provider.disabled ? t("providers.enabled") : t("providers.disabled"), "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("providers.updateFailed"), "error");
    } finally {
      setTogglingProviderId(null);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">{t("providers.title")}</h1>
            <p className="mt-1 text-sm text-slate-400">{t("providers.description")}</p>
          </div>
          <Button onClick={() => setIsAddOpen(true)} className="px-2.5 py-1 text-xs">{t("providers.add")}</Button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-2">
        {[
          { label: t("providers.total"), value: providers.length },
          { label: t("providers.types"), value: new Set(providers.map((p) => p.provider_type)).size },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-slate-700/70 bg-slate-900/40 px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{stat.label}</p>
            <p className="mt-0.5 text-xs font-semibold text-slate-100">{stat.value}</p>
          </div>
        ))}
      </section>

      <section className="overflow-x-auto rounded-lg border border-slate-700/70 bg-slate-900/40">
        <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_120px_minmax(0,1.5fr)_80px_120px] border-b border-slate-700/70 bg-slate-900/95 backdrop-blur-sm px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          <span>ID</span><span>{t("providers.type")}</span><span>{t("providers.baseUrl")}</span><span>{t("providers.status")}</span><span>{t("common.actions")}</span>
        </div>

        {loading ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">{t("providers.loading")}</div>
        ) : providers.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">{t("providers.empty")}</div>
        ) : (
          providers.map((provider) => (
            <div
              key={provider.id}
              className="grid grid-cols-[minmax(0,1fr)_120px_minmax(0,1.5fr)_80px_120px] items-center border-b border-slate-700/60 px-3 py-2 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-slate-100">{provider.id}</p>
                <div className="mt-0.5"><UsedByAgents agentIds={attribution?.provider[provider.id]} /></div>
              </div>
              <span className="text-xs text-slate-400 font-mono">{provider.provider_type}</span>
              <span className="truncate text-xs text-slate-400 font-mono">{getBaseUrl(provider)}</span>
              <button
                type="button"
                disabled={!!provider.read_only || togglingProviderId !== null}
                onClick={() => void handleToggleDisabled(provider)}
                className={`w-fit rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  provider.disabled
                    ? "border-slate-600/60 bg-slate-800/40 text-slate-400 hover:border-emerald-500/40 hover:text-emerald-300"
                    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:border-slate-600/60 hover:bg-slate-800/40 hover:text-slate-400"
                }`}
                title={provider.read_only ? t("providers.readOnly") : provider.disabled ? t("providers.enable") : t("providers.disable")}
              >
                {togglingProviderId === provider.id ? t("common.saving") : provider.disabled ? t("providers.enableLabel") : t("common.active")}
              </button>
              <div className="flex gap-1">
                <Button variant="ghost" onClick={() => openEdit(provider)} disabled={provider.read_only} className="px-2 py-1 text-xs">{t("common.edit")}</Button>
                <Button variant="danger" onClick={() => setPendingDeleteId(provider.id)} disabled={provider.read_only} className="px-2 py-1 text-xs">{t("common.delete")}</Button>
              </div>
            </div>
          ))
        )}
      </section>

      {/* Add Provider Modal */}
      <Modal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)}>
        <ModalHeader><ModalTitle>{t("providers.add")}</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">ID</label>
              <Input name="name" value={addId} onChange={setAddId} placeholder="e.g. my-openai" />
              {addId && (
                <p className="mt-1 text-[10px] text-slate-500">{t("providers.willStore")}: <span className="font-mono text-slate-400">{slugify(addId) || t("providers.invalid")}</span></p>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("providers.type")}</label>
              <select
                value={addType}
                onChange={(e) => { setAddType(e.target.value); setAddOptionsRaw("{}"); }}
                className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
              >
                {enabledProviderTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("providers.baseUrl")}</label>
              <Input name="baseUrl" value={addBaseUrl} onChange={setAddBaseUrl} placeholder="https://api.openai.com/v1" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("providers.apiKey")}</label>
              <Input
                type="password"
                name="apiKey"
                value={addApiKey}
                onChange={setAddApiKey}
                placeholder="sk-..."
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <ProviderAdvancedFields
              idPrefix="addProvider"
              providerType={addType}
              defaultModel={addDefaultModel}
              onDefaultModelChange={setAddDefaultModel}
              disabled={addDisabled}
              onDisabledChange={setAddDisabled}
              network={addNetwork}
              onNetworkChange={setAddNetwork}
              optionsRaw={addOptionsRaw}
              onOptionsRawChange={setAddOptionsRaw}
            />
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setIsAddOpen(false)} disabled={addSubmitting}>{t("common.cancel")}</Button>
          <Button onClick={handleAdd} disabled={addSubmitting}>{addSubmitting ? t("common.adding") : t("providers.add")}</Button>
        </ModalFooter>
      </Modal>

      {/* Edit Provider Modal */}
      <Modal isOpen={!!editItem} onClose={() => setEditItem(null)}>
        <ModalHeader><ModalTitle>{t("providers.editTitle", { id: editItem?.id ?? "" })}</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("providers.baseUrl")}</label>
              <Input name="editBaseUrl" value={editBaseUrl} onChange={setEditBaseUrl} placeholder="https://api.openai.com/v1" />
              <p className="mt-1 text-[11px] text-slate-500">{t("providers.restoreDefault")}</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("providers.apiKey")}</label>
              <Input
                type="password"
                name="editApiKey"
                value={editApiKey}
                onChange={setEditApiKey}
                placeholder={editItem?.api_key_set ? t("providers.keyConfigured") : t("providers.enterKey")}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <ProviderAdvancedFields
              idPrefix="editProvider"
              providerType={editItem?.provider_type ?? ""}
              defaultModel={editDefaultModel}
              onDefaultModelChange={setEditDefaultModel}
              disabled={editDisabled}
              onDisabledChange={setEditDisabled}
              network={editNetwork}
              onNetworkChange={setEditNetwork}
              configuredHeaderNames={editItem?.network?.extra_headers_set}
              optionsRaw={editOptionsRaw}
              onOptionsRawChange={setEditOptionsRaw}
            />
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setEditItem(null)} disabled={editSubmitting}>{t("common.cancel")}</Button>
          <Button onClick={handleEdit} disabled={editSubmitting}>{editSubmitting ? t("common.saving") : t("common.save")}</Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={!!pendingDeleteId}
        onClose={() => setPendingDeleteId(null)}
        onConfirm={handleDelete}
        title={t("providers.deleteTitle")}
        message={t("providers.deleteMessage")}
        confirmLabel={t("common.delete")}
        variant="danger"
      />
    </div>
  );
}
