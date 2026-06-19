"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  ApiError,
  listManagedModels,
  createManagedModel,
  updateManagedModel,
  deleteManagedModel,
  listProviders,
  type ManagedConcreteModel,
  type ManagedModelPayload,
  type ProviderItem,
} from "@/lib/api";

export default function ModelsPage() {
  const [models, setModels] = useState<ManagedConcreteModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<ManagedConcreteModel | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ provider_id: string; upstream_model: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  // Form state
  const [formProviderId, setFormProviderId] = useState("");
  const [formUpstreamModel, setFormUpstreamModel] = useState("");
  const [formCredentialScope, setFormCredentialScope] = useState("");
  const [formEnabled, setFormEnabled] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [m, p] = await Promise.all([listManagedModels(), listProviders()]);
      setModels(m);
      setProviders(p);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : `Failed to load models: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadData(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const openCreate = () => {
    setFormProviderId(providers[0]?.id ?? "");
    setFormUpstreamModel("");
    setFormCredentialScope("");
    setFormEnabled(true);
    setIsCreateOpen(true);
  };

  const openEdit = (model: ManagedConcreteModel) => {
    setEditingModel(model);
    setFormProviderId(model.provider_id);
    setFormUpstreamModel(model.upstream_model);
    setFormCredentialScope(model.credential_scope ?? "");
    setFormEnabled(model.enabled);
    setIsEditOpen(true);
  };

  const handleCreate = async () => {
    if (!formProviderId.trim()) { showToast("Provider is required", "error"); return; }
    if (!formUpstreamModel.trim()) { showToast("Upstream model is required", "error"); return; }
    const payload: ManagedModelPayload = {
      provider_id: formProviderId.trim(),
      upstream_model: formUpstreamModel.trim(),
      ...(formCredentialScope.trim() && { credential_scope: formCredentialScope.trim() }),
      enabled: formEnabled,
    };
    setSaving(true);
    try {
      const created = await createManagedModel(payload);
      setModels((prev) => [...prev, created]);
      setIsCreateOpen(false);
      showToast("Model added", "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to add model", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!editingModel) return;
    const payload: ManagedModelPayload = {
      provider_id: editingModel.provider_id,
      upstream_model: editingModel.upstream_model,
      ...(formCredentialScope.trim() && { credential_scope: formCredentialScope.trim() }),
      enabled: formEnabled,
    };
    setSaving(true);
    try {
      const updated = await updateManagedModel(editingModel.provider_id, editingModel.upstream_model, payload);
      setModels((prev) => prev.map((m) =>
        m.provider_id === editingModel.provider_id && m.upstream_model === editingModel.upstream_model ? updated : m
      ));
      setIsEditOpen(false);
      setEditingModel(null);
      showToast("Model updated", "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to update model", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setSaving(true);
    try {
      await deleteManagedModel(pendingDelete.provider_id, pendingDelete.upstream_model);
      setModels((prev) => prev.filter(
        (m) => !(m.provider_id === pendingDelete.provider_id && m.upstream_model === pendingDelete.upstream_model)
      ));
      showToast("Model removed", "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to remove model", "error");
    } finally {
      setSaving(false);
      setShowConfirm(false);
      setPendingDelete(null);
    }
  };

  const enabledCount = models.filter((m) => m.enabled).length;
  const providerCount = new Set(models.map((m) => m.provider_id)).size;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">Models</h1>
            <p className="mt-1 text-sm text-slate-400">Manage which upstream models are available through the gateway.</p>
          </div>
          <Button onClick={openCreate} className="px-2.5 py-1 text-xs">Add Model</Button>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          { label: "Total Models", value: models.length },
          { label: "Enabled", value: enabledCount },
          { label: "Providers", value: providerCount },
          { label: "Disabled", value: models.length - enabledCount },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-slate-700/70 bg-slate-900/40 px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{stat.label}</p>
            <p className="mt-0.5 text-xs font-semibold text-slate-100">{stat.value}</p>
          </div>
        ))}
      </div>

      <section className="overflow-x-auto rounded-lg border border-slate-700/70 bg-slate-900/40">
        {loading ? (
          <p className="p-6 text-center text-sm text-slate-400">Loading models…</p>
        ) : models.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-400">No managed models. Add one to get started.</p>
        ) : (
          <table className="min-w-[700px] w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/70 bg-slate-900/95">
                {["Provider", "Upstream Model", "Display Name", "Capabilities", "Snapshot", "Status", ""].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {models.map((model) => (
                <tr
                  key={`${model.provider_id}/${model.upstream_model}`}
                  className="border-b border-slate-700/60 last:border-b-0 hover:bg-slate-800/30 transition-colors"
                >
                  <td className="px-3 py-2 font-mono text-xs text-slate-300">{model.provider_id}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-100">{model.upstream_model}</td>
                  <td className="px-3 py-2 text-xs text-slate-400">{model.display_name ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      {model.capabilities?.streaming && (
                        <span className="rounded-sm bg-blue-500/15 px-1 py-0.5 text-[9px] text-blue-300">stream</span>
                      )}
                      {model.capabilities?.tools && (
                        <span className="rounded-sm bg-purple-500/15 px-1 py-0.5 text-[9px] text-purple-300">tools</span>
                      )}
                      {!model.capabilities?.streaming && !model.capabilities?.tools && (
                        <span className="text-[10px] text-slate-600">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${
                      model.snapshot_status === "ok"
                        ? "bg-emerald-500/15 text-emerald-300"
                        : model.snapshot_status === "error"
                          ? "bg-red-500/15 text-red-300"
                          : "bg-slate-700/40 text-slate-400"
                    }`}>
                      {model.snapshot_status ?? "unknown"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${
                      model.enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-700/40 text-slate-400"
                    }`}>
                      {model.enabled ? "enabled" : "disabled"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <Button variant="ghost" className="px-2 py-0.5 text-[10px]" onClick={() => openEdit(model)}>
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        className="px-2 py-0.5 text-[10px]"
                        onClick={() => { setPendingDelete({ provider_id: model.provider_id, upstream_model: model.upstream_model }); setShowConfirm(true); }}
                      >
                        Remove
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Create modal */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)}>
        <ModalHeader><ModalTitle>Add Managed Model</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Provider <span className="text-red-400">*</span></label>
              <select
                value={formProviderId}
                onChange={(e) => setFormProviderId(e.target.value)}
                className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-blue-500/60 focus:outline-none"
              >
                <option value="">— select provider —</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.id}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Upstream Model <span className="text-red-400">*</span></label>
              <input
                value={formUpstreamModel}
                onChange={(e) => setFormUpstreamModel(e.target.value)}
                placeholder="e.g. gpt-4.1, claude-sonnet-4-6"
                className="w-full rounded-md border border-slate-700/60 bg-slate-900/70 px-2.5 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Credential Scope</label>
              <input
                value={formCredentialScope}
                onChange={(e) => setFormCredentialScope(e.target.value)}
                placeholder="Optional — leave blank for provider default"
                className="w-full rounded-md border border-slate-700/60 bg-slate-900/70 px-2.5 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={formEnabled}
                onChange={(e) => setFormEnabled(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 accent-blue-500"
              />
              <span className="text-sm text-slate-300">Enabled</span>
            </label>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setIsCreateOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving}>{saving ? "Adding…" : "Add Model"}</Button>
        </ModalFooter>
      </Modal>

      {/* Edit modal */}
      <Modal isOpen={isEditOpen} onClose={() => { setIsEditOpen(false); setEditingModel(null); }}>
        <ModalHeader><ModalTitle>Edit Model — {editingModel?.upstream_model}</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Provider</label>
                <p className="rounded-md border border-slate-700/60 bg-slate-900/70 px-2.5 py-1.5 font-mono text-xs text-slate-400">
                  {editingModel?.provider_id}
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Upstream Model</label>
                <p className="rounded-md border border-slate-700/60 bg-slate-900/70 px-2.5 py-1.5 font-mono text-xs text-slate-400">
                  {editingModel?.upstream_model}
                </p>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Credential Scope</label>
              <input
                value={formCredentialScope}
                onChange={(e) => setFormCredentialScope(e.target.value)}
                placeholder="Optional — leave blank for provider default"
                className="w-full rounded-md border border-slate-700/60 bg-slate-900/70 px-2.5 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={formEnabled}
                onChange={(e) => setFormEnabled(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 accent-blue-500"
              />
              <span className="text-sm text-slate-300">Enabled</span>
            </label>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => { setIsEditOpen(false); setEditingModel(null); }} disabled={saving}>Cancel</Button>
          <Button onClick={handleEdit} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={showConfirm}
        onClose={() => { setShowConfirm(false); setPendingDelete(null); }}
        onConfirm={handleDelete}
        title="Remove Model"
        message={`Remove ${pendingDelete?.upstream_model} from ${pendingDelete?.provider_id}? This does not delete the model from the provider.`}
        confirmLabel={saving ? "Removing…" : "Remove"}
        variant="danger"
      />
    </div>
  );
}
