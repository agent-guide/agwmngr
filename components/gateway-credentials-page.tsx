"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useI18n } from "@/components/i18n-provider";
import {
  type CredentialCreatePayload,
  type CredentialItem,
  type CredentialUpdatePayload,
  type ProviderItem,
} from "@/lib/api";
import { loadFailureFrom, type LoadFailure } from "@/lib/ui-load-error";

const SOURCE_API_KEY = "api_key";

export interface GatewayCredentialsAdapter {
  listCredentials(): Promise<CredentialItem[]>;
  listProviders(): Promise<ProviderItem[]>;
  createCredential(payload: CredentialCreatePayload): Promise<CredentialItem>;
  updateCredential(id: string, payload: CredentialUpdatePayload): Promise<CredentialItem>;
  deleteCredential(id: string): Promise<void>;
}

interface GatewayCredentialsPageProps {
  api: GatewayCredentialsAdapter;
  scope?: { gatewayId: string; gatewayName?: string };
}

function AttributesEditor({
  value,
  onChange,
}: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const { t } = useI18n();
  const entries = Object.entries(value);

  const setKey = (idx: number, newKey: string) => {
    const next: Record<string, string> = {};
    entries.forEach(([k, v], i) => {
      next[i === idx ? newKey : k] = v;
    });
    onChange(next);
  };

  const setValue = (idx: number, newVal: string) => {
    const next: Record<string, string> = {};
    entries.forEach(([k, v], i) => {
      next[k] = i === idx ? newVal : v;
    });
    onChange(next);
  };

  const addRow = () => onChange({ ...value, "": "" });

  const removeRow = (idx: number) => {
    const next: Record<string, string> = {};
    entries.forEach(([k, v], i) => {
      if (i !== idx) next[k] = v;
    });
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {entries.map(([k, v], idx) => (
        <div key={idx} className="flex gap-1.5">
          <Input
            name={`attr-key-${idx}`}
            value={k}
            onChange={(val) => setKey(idx, val)}
            placeholder={t("credentials.attributeKey")}
          />
          <Input
            type={k.trim().toLowerCase() === "api_key" ? "password" : "text"}
            name={`attr-val-${idx}`}
            value={v}
            onChange={(val) => setValue(idx, val)}
            placeholder={t("credentials.attributeValue")}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <Button variant="ghost" onClick={() => removeRow(idx)} className="px-2 py-1 text-xs shrink-0">
            ✕
          </Button>
        </div>
      ))}
      <Button variant="ghost" onClick={addRow} className="px-2 py-1 text-xs">
        {t("credentials.addAttribute")}
      </Button>
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  const { t } = useI18n();
  const isApiKey = source === SOURCE_API_KEY;
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        isApiKey
          ? "bg-blue-900/40 text-blue-300"
          : "bg-slate-700/60 text-slate-400"
      }`}
    >
      {source || t("credentials.unknown")}
    </span>
  );
}

export function GatewayCredentialsPage({ api, scope }: GatewayCredentialsPageProps) {
  const { t } = useI18n();
  const [credentials, setCredentials] = useState<CredentialItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<LoadFailure | null>(null);
  const [providers, setProviders] = useState<ProviderItem[]>([]);

  // Add modal
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addProviderId, setAddProviderId] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const [addAttributes, setAddAttributes] = useState<Record<string, string>>({ api_key: "" });

  // Edit modal
  const [editItem, setEditItem] = useState<CredentialItem | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editLabel, setEditLabel] = useState("");
  const [editAttributes, setEditAttributes] = useState<Record<string, string>>({});
  const [editApiKey, setEditApiKey] = useState("");
  const [editDisabled, setEditDisabled] = useState(false);

  // Delete confirm
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const { showToast } = useToast();

  const loadCredentials = useCallback(async () => {
    setLoading(true);
    setLoadFailure(null);
    try {
      const [items, providerItems] = await Promise.all([
        api.listCredentials(),
        api.listProviders(),
      ]);
      setCredentials(items);
      setProviders(providerItems);
    } catch (err) {
      setLoadFailure(loadFailureFrom(err, t("credentials.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [api, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCredentials();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCredentials]);

  const resetAddForm = () => {
    setAddProviderId("");
    setAddLabel("");
    setAddAttributes({ api_key: "" });
  };

  const handleAdd = async () => {
    if (!addProviderId.trim()) {
      showToast(t("credentials.providerRequired"), "error");
      return;
    }
    setAddSubmitting(true);
    try {
      const attrs: Record<string, string> = {};
      Object.entries(addAttributes).forEach(([k, v]) => {
        if (k.trim()) attrs[k.trim()] = v;
      });
      const item = await api.createCredential({
        type: "api_key",
        provider_id: addProviderId.trim(),
        label: addLabel.trim() || undefined,
        attributes: Object.keys(attrs).length > 0 ? attrs : undefined,
      });
      setCredentials((prev) => [...prev, item]);
      showToast(t("credentials.created"), "success");
      setIsAddOpen(false);
      resetAddForm();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("credentials.createFailed"), "error");
    } finally {
      setAddSubmitting(false);
    }
  };

  const openEdit = (item: CredentialItem) => {
    setEditItem(item);
    setEditLabel(item.label ?? "");
    setEditAttributes(item.attributes ? { ...item.attributes } : {});
    setEditApiKey("");
    setEditDisabled(item.disabled ?? false);
  };

  const handleEdit = async () => {
    if (!editItem) return;
    setEditSubmitting(true);
    try {
      const attrs: Record<string, string> = {};
      Object.entries(editAttributes).forEach(([k, v]) => {
        if (k.trim()) attrs[k.trim()] = v;
      });
      if (editApiKey) attrs.api_key = editApiKey;
      const updated = await api.updateCredential(editItem.id, {
        label: editLabel.trim() || undefined,
        // Always send the editable non-secret map. The manager merges the raw
        // key server-side, so an empty map can intentionally remove all other
        // attributes without exposing or clearing the key.
        attributes: attrs,
        disabled: editDisabled,
      });
      setCredentials((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      showToast(t("credentials.updated"), "success");
      setEditItem(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("credentials.updateFailed"), "error");
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDeleteId) return;
    try {
      await api.deleteCredential(pendingDeleteId);
      setCredentials((prev) => prev.filter((c) => c.id !== pendingDeleteId));
      showToast(t("credentials.deleted"), "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("credentials.deleteFailed"), "error");
    } finally {
      setPendingDeleteId(null);
    }
  };

  const apiKeyCount = credentials.filter((c) => !c.read_only).length;
  const readOnlyCount = credentials.filter((c) => c.read_only).length;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            {scope && (
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                {t("gatewayScope.label")} · <span className="font-mono normal-case">{scope.gatewayId}</span>
              </p>
            )}
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">{t("credentials.title")}</h1>
            <p className="mt-1 text-sm text-slate-400">
              {scope?.gatewayName
                ? t("credentials.scopedDescription", { gateway: scope.gatewayName })
                : t("credentials.description")}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => setIsAddOpen(true)}
              disabled={loading || loadFailure !== null}
              className="px-2.5 py-1 text-xs"
            >
              {t("credentials.addApiKey")}
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-xs text-amber-200" role="note">
        <p className="font-semibold">{t("credentials.backupTitle")}</p>
        <p className="mt-1 leading-5 text-amber-300/90">
          {t("credentials.backupHelp")}
        </p>
      </section>

      {loadFailure ? (
        <section
          className={`rounded-lg border p-6 text-center ${
            loadFailure.kind === "forbidden"
              ? "border-amber-500/30 bg-amber-500/10"
              : "border-rose-500/30 bg-rose-500/10"
          }`}
          role="alert"
        >
          <h2 className={`text-sm font-semibold ${
            loadFailure.kind === "forbidden" ? "text-amber-200" : "text-rose-200"
          }`}>
            {loadFailure.kind === "forbidden"
              ? t("credentials.accessUnavailable")
              : t("credentials.couldNotLoad")}
          </h2>
          <p className="mt-2 text-xs text-slate-400">{loadFailure.message}</p>
          <Button
            variant="ghost"
            onClick={() => void loadCredentials()}
            className="mt-4 px-3 py-1.5 text-xs"
          >
            {t("common.retry")}
          </Button>
        </section>
      ) : (
        <>
          {!loading && (
            <section className="grid grid-cols-3 gap-2">
              {[
                { label: t("common.total"), value: credentials.length },
                { label: t("credentials.editable"), value: apiKeyCount },
                { label: t("credentials.readOnly"), value: readOnlyCount },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-lg border border-slate-700/70 bg-slate-900/40 px-2.5 py-2"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    {stat.label}
                  </p>
                  <p className="mt-0.5 text-xs font-semibold text-slate-100">{stat.value}</p>
                </div>
              ))}
            </section>
          )}

          <section className="overflow-x-auto rounded-lg border border-slate-700/70 bg-slate-900/40">
        <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_80px_minmax(0,1fr)_80px_140px] border-b border-slate-700/70 bg-slate-900/95 backdrop-blur-sm px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          <span>{t("credentials.idLabel")}</span>
          <span>{t("credentials.providerId")}</span>
          <span>{t("credentials.providerType")}</span>
          <span>{t("credentials.source")}</span>
          <span>{t("providers.apiKey")}</span>
          <span>{t("credentials.readOnly")}</span>
          <span>{t("common.actions")}</span>
        </div>

        {loading ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">{t("common.loading")}</div>
        ) : credentials.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">{t("credentials.empty")}</div>
        ) : (
          credentials.map((cred) => {
            const isEditable = !cred.read_only;
            const keyStatus = t(cred.api_key_set ? "credentials.configured" : "credentials.notSet");
            return (
              <div
                key={cred.id}
                className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_80px_minmax(0,1fr)_80px_140px] items-center border-b border-slate-700/60 px-3 py-2 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-slate-100 font-mono">{cred.id}</p>
                  {cred.label && (
                    <p className="truncate text-[10px] text-slate-500">{cred.label}</p>
                  )}
                  {cred.disabled && (
                    <span className="text-[10px] text-amber-400">{t("common.disabled")}</span>
                  )}
                </div>
                <span className="truncate text-xs text-slate-400 font-mono">{cred.provider_id ?? "—"}</span>
                <span className="truncate text-xs text-slate-400 font-mono">{cred.provider_type}</span>
                <span>
                  <SourceBadge source={cred.source} />
                </span>
                <span className="truncate text-xs text-slate-400">{keyStatus}</span>
                <span>
                  {cred.read_only && (
                    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-slate-700/60 text-slate-400">
                      {t("credentials.yes")}
                    </span>
                  )}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    onClick={() => openEdit(cred)}
                    disabled={!isEditable}
                    className="px-2 py-1 text-xs"
                  >
                    {t("common.edit")}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => setPendingDeleteId(cred.id)}
                    disabled={!isEditable}
                    className="px-2 py-1 text-xs"
                  >
                    {t("common.delete")}
                  </Button>
                </div>
              </div>
            );
          })
        )}
          </section>
        </>
      )}

      {/* Add Credential Modal */}
      <Modal isOpen={isAddOpen} onClose={() => { setIsAddOpen(false); resetAddForm(); }}>
        <ModalHeader>
          <ModalTitle>{t("credentials.addApiKey")}</ModalTitle>
        </ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">
                {t("credentials.providerId")} <span className="text-red-400">*</span>
              </label>
              <select
                value={addProviderId}
                onChange={(e) => setAddProviderId(e.target.value)}
                className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">{t("credentials.selectProvider")}</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id} ({p.provider_type})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("credentials.label")}</label>
              <Input
                name="label"
                value={addLabel}
                onChange={setAddLabel}
                placeholder={t("credentials.labelPlaceholder")}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("credentials.attributes")}</label>
              <p className="mb-2 text-[11px] text-slate-500">
                {t("credentials.attributesHelp")}
              </p>
              <AttributesEditor value={addAttributes} onChange={setAddAttributes} />
            </div>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button
            variant="ghost"
            onClick={() => { setIsAddOpen(false); resetAddForm(); }}
            disabled={addSubmitting}
          >
            {t("common.cancel")}
          </Button>
          <Button onClick={handleAdd} disabled={addSubmitting}>
            {addSubmitting ? t("common.adding") : t("credentials.addApiKey")}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Edit Credential Modal */}
      <Modal isOpen={!!editItem} onClose={() => setEditItem(null)}>
        <ModalHeader>
          <ModalTitle>{t("credentials.editTitle", { id: editItem?.id ?? "" })}</ModalTitle>
        </ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("credentials.label")}</label>
              <Input
                name="editLabel"
                value={editLabel}
                onChange={setEditLabel}
                placeholder={t("credentials.labelPlaceholder")}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("providers.apiKey")}</label>
              <Input
                type="password"
                name="editApiKey"
                value={editApiKey}
                onChange={setEditApiKey}
                placeholder={t(editItem?.api_key_set ? "providers.keyConfigured" : "providers.enterKey")}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <p className="mt-1 text-[11px] text-slate-500">{t("credentials.secretHelp")}</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("credentials.attributes")}</label>
              <p className="mb-2 text-[11px] text-slate-500">{t("credentials.nonSecretHelp")}</p>
              <AttributesEditor value={editAttributes} onChange={setEditAttributes} />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="editDisabled"
                type="checkbox"
                checked={editDisabled}
                onChange={(e) => setEditDisabled(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500"
              />
              <label htmlFor="editDisabled" className="text-sm text-slate-300">
                {t("common.disabledTitle")}
              </label>
            </div>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setEditItem(null)} disabled={editSubmitting}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleEdit} disabled={editSubmitting}>
            {editSubmitting ? t("common.saving") : t("common.save")}
          </Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={!!pendingDeleteId}
        onClose={() => setPendingDeleteId(null)}
        onConfirm={handleDelete}
        title={t("credentials.deleteTitle")}
        message={t("credentials.deleteMessage")}
        confirmLabel={t("common.delete")}
        variant="danger"
      />
    </div>
  );
}
