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
  type ProviderItem,
} from "@/lib/api";

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

  // Add modal state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addId, setAddId] = useState("");
  const [addType, setAddType] = useState("");
  const [addBaseUrl, setAddBaseUrl] = useState("");
  const [addApiKey, setAddApiKey] = useState("");

  // Edit modal state
  const [editItem, setEditItem] = useState<ProviderItem | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editBaseUrl, setEditBaseUrl] = useState("");
  const [editApiKey, setEditApiKey] = useState("");

  // Delete confirm state
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const { showToast } = useToast();

  const loadProviders = useCallback(async () => {
    setLoading(true);
    try {
      const [items, names] = await Promise.all([listProviders(), listProviderTypes()]);
      setProviders(items);
      const enabled = names.filter((n) => n.enabled).map((n) => n.provider_type);
      setEnabledProviderTypes(enabled);
      setAddType((prev) => (prev === "" ? (enabled[0] ?? "") : prev));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load providers", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProviders();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProviders]);

  const handleAdd = async () => {
    if (!addId.trim()) { showToast("Provider ID is required", "error"); return; }
    const id = slugify(addId);
    if (!id) { showToast("Invalid provider ID", "error"); return; }

    setAddSubmitting(true);
    try {
      const payload: Parameters<typeof createProvider>[0] = { id, provider_type: addType };
      if (addBaseUrl.trim()) payload.base_url = addBaseUrl.trim();
      if (addApiKey.trim()) payload.api_key = addApiKey.trim();
      const item = await createProvider(payload);
      setProviders((prev) => [...prev, item]);
      showToast("Provider added", "success");
      setIsAddOpen(false);
      setAddId(""); setAddType(enabledProviderTypes[0] ?? ""); setAddBaseUrl(""); setAddApiKey("");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to add provider", "error");
    } finally {
      setAddSubmitting(false);
    }
  };

  const openEdit = (item: ProviderItem) => {
    setEditItem(item);
    setEditBaseUrl(item.base_url ?? "");
    setEditApiKey(item.api_key ?? "");
  };

  const handleEdit = async () => {
    if (!editItem) return;

    const payload: Parameters<typeof updateProvider>[1] = { provider_type: editItem.provider_type };
    if (editBaseUrl.trim()) payload.base_url = editBaseUrl.trim();
    if (editApiKey.trim()) payload.api_key = editApiKey.trim();

    setEditSubmitting(true);
    try {
      const updated = await updateProvider(editItem.id, payload);
      setProviders((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      showToast("Provider updated", "success");
      setEditItem(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update provider", "error");
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDeleteId) return;
    try {
      await deleteProvider(pendingDeleteId);
      setProviders((prev) => prev.filter((p) => p.id !== pendingDeleteId));
      showToast("Provider deleted", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to delete provider", "error");
    } finally {
      setPendingDeleteId(null);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">AI Providers</h1>
            <p className="mt-1 text-sm text-slate-400">Manage LLM provider backends and API keys.</p>
          </div>
          <Button onClick={() => setIsAddOpen(true)} className="px-2.5 py-1 text-xs">Add Provider</Button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-2">
        {[
          { label: "Total Providers", value: providers.length },
          { label: "Types", value: new Set(providers.map((p) => p.provider_type)).size },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-slate-700/70 bg-slate-900/40 px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{stat.label}</p>
            <p className="mt-0.5 text-xs font-semibold text-slate-100">{stat.value}</p>
          </div>
        ))}
      </section>

      <section className="overflow-x-auto rounded-lg border border-slate-700/70 bg-slate-900/40">
        <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_120px_minmax(0,1.5fr)_120px] border-b border-slate-700/70 bg-slate-900/95 backdrop-blur-sm px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          <span>ID</span><span>Type</span><span>Base URL</span><span>Actions</span>
        </div>

        {loading ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">Loading...</div>
        ) : providers.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">No providers configured.</div>
        ) : (
          providers.map((provider) => (
            <div
              key={provider.id}
              className="grid grid-cols-[minmax(0,1fr)_120px_minmax(0,1.5fr)_120px] items-center border-b border-slate-700/60 px-3 py-2 last:border-b-0"
            >
              <p className="truncate text-xs font-medium text-slate-100">{provider.id}</p>
              <span className="text-xs text-slate-400 font-mono">{provider.provider_type}</span>
              <span className="truncate text-xs text-slate-400 font-mono">{getBaseUrl(provider)}</span>
              <div className="flex gap-1">
                <Button variant="ghost" onClick={() => openEdit(provider)} disabled={provider.read_only} className="px-2 py-1 text-xs">Edit</Button>
                <Button variant="danger" onClick={() => setPendingDeleteId(provider.id)} disabled={provider.read_only} className="px-2 py-1 text-xs">Delete</Button>
              </div>
            </div>
          ))
        )}
      </section>

      {/* Add Provider Modal */}
      <Modal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)}>
        <ModalHeader><ModalTitle>Add Provider</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">ID</label>
              <Input name="name" value={addId} onChange={setAddId} placeholder="e.g. my-openai" />
              {addId && (
                <p className="mt-1 text-[10px] text-slate-500">Will be stored as: <span className="font-mono text-slate-400">{slugify(addId) || "invalid"}</span></p>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Type</label>
              <select
                value={addType}
                onChange={(e) => setAddType(e.target.value)}
                className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
              >
                {enabledProviderTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Base URL</label>
              <Input name="baseUrl" value={addBaseUrl} onChange={setAddBaseUrl} placeholder="https://api.openai.com/v1" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">API Key</label>
              <Input
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
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setIsAddOpen(false)} disabled={addSubmitting}>Cancel</Button>
          <Button onClick={handleAdd} disabled={addSubmitting}>{addSubmitting ? "Adding..." : "Add Provider"}</Button>
        </ModalFooter>
      </Modal>

      {/* Edit Provider Modal */}
      <Modal isOpen={!!editItem} onClose={() => setEditItem(null)}>
        <ModalHeader><ModalTitle>Edit Provider: {editItem?.id}</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Base URL</label>
              <Input name="editBaseUrl" value={editBaseUrl} onChange={setEditBaseUrl} placeholder="https://api.openai.com/v1" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">API Key</label>
              <Input
                name="editApiKey"
                value={editApiKey}
                onChange={setEditApiKey}
                placeholder="Leave empty to clear"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setEditItem(null)} disabled={editSubmitting}>Cancel</Button>
          <Button onClick={handleEdit} disabled={editSubmitting}>{editSubmitting ? "Saving..." : "Save"}</Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={!!pendingDeleteId}
        onClose={() => setPendingDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Provider"
        message="Are you sure you want to delete this provider?"
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
