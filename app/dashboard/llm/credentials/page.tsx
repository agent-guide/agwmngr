"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  listCredentials,
  listProviders,
  createCredential,
  updateCredential,
  deleteCredential,
  type CredentialItem,
  type ProviderItem,
} from "@/lib/api";

const SOURCE_API_KEY = "api_key";

function AttributesEditor({
  value,
  onChange,
}: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
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
            placeholder="key"
          />
          <Input
            name={`attr-val-${idx}`}
            value={v}
            onChange={(val) => setValue(idx, val)}
            placeholder="value"
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
        + Add attribute
      </Button>
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  const isApiKey = source === SOURCE_API_KEY;
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        isApiKey
          ? "bg-blue-900/40 text-blue-300"
          : "bg-slate-700/60 text-slate-400"
      }`}
    >
      {source || "unknown"}
    </span>
  );
}

export default function CredentialsPage() {
  const [credentials, setCredentials] = useState<CredentialItem[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [editDisabled, setEditDisabled] = useState(false);

  // Delete confirm
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const { showToast } = useToast();

  const loadCredentials = useCallback(async () => {
    setLoading(true);
    try {
      const [items, providerItems] = await Promise.all([listCredentials(), listProviders()]);
      setCredentials(items);
      setProviders(providerItems);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load credentials", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

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
      showToast("Provider is required", "error");
      return;
    }
    setAddSubmitting(true);
    try {
      const attrs: Record<string, string> = {};
      Object.entries(addAttributes).forEach(([k, v]) => {
        if (k.trim()) attrs[k.trim()] = v;
      });
      const item = await createCredential({
        type: "api_key",
        provider_id: addProviderId.trim(),
        label: addLabel.trim() || undefined,
        attributes: Object.keys(attrs).length > 0 ? attrs : undefined,
      });
      setCredentials((prev) => [...prev, item]);
      showToast("Credential created", "success");
      setIsAddOpen(false);
      resetAddForm();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to create credential", "error");
    } finally {
      setAddSubmitting(false);
    }
  };

  const openEdit = (item: CredentialItem) => {
    setEditItem(item);
    setEditLabel(item.label ?? "");
    setEditAttributes(item.attributes ? { ...item.attributes } : {});
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
      const updated = await updateCredential(editItem.id, {
        label: editLabel.trim() || undefined,
        attributes: Object.keys(attrs).length > 0 ? attrs : undefined,
        disabled: editDisabled,
      });
      setCredentials((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      showToast("Credential updated", "success");
      setEditItem(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update credential", "error");
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDeleteId) return;
    try {
      await deleteCredential(pendingDeleteId);
      setCredentials((prev) => prev.filter((c) => c.id !== pendingDeleteId));
      showToast("Credential deleted", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to delete credential", "error");
    } finally {
      setPendingDeleteId(null);
    }
  };

  const apiKeyCount = credentials.filter((c) => !c.read_only).length;
  const cliauthCount = credentials.filter((c) => c.read_only).length;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">Credentials</h1>
            <p className="mt-1 text-sm text-slate-400">
              Manage upstream credentials. API key credentials can be created and edited directly.
              Authenticator-sourced credentials are read-only here.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setIsAddOpen(true)} className="px-2.5 py-1 text-xs">
              Add API Key
            </Button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-3 gap-2">
        {[
          { label: "Total", value: credentials.length },
          { label: "Editable", value: apiKeyCount },
          { label: "Read-only", value: cliauthCount },
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

      <section className="overflow-x-auto rounded-lg border border-slate-700/70 bg-slate-900/40">
        <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_80px_minmax(0,1fr)_80px_140px] border-b border-slate-700/70 bg-slate-900/95 backdrop-blur-sm px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          <span>ID / Label</span>
          <span>Provider ID</span>
          <span>Provider Type</span>
          <span>Source</span>
          <span>API Key</span>
          <span>Read-only</span>
          <span>Actions</span>
        </div>

        {loading ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">Loading...</div>
        ) : credentials.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">No credentials configured.</div>
        ) : (
          credentials.map((cred) => {
            const isEditable = !cred.read_only;
            const rawKey = cred.attributes?.api_key ?? "";
            const maskedKey = rawKey
              ? rawKey.length > 8
                ? rawKey.slice(0, 4) + "••••" + rawKey.slice(-4)
                : "••••••••"
              : "—";
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
                    <span className="text-[10px] text-amber-400">disabled</span>
                  )}
                </div>
                <span className="truncate text-xs text-slate-400 font-mono">{cred.provider_id ?? "—"}</span>
                <span className="truncate text-xs text-slate-400 font-mono">{cred.provider_type}</span>
                <span>
                  <SourceBadge source={cred.source} />
                </span>
                <span className="truncate text-xs text-slate-400 font-mono">{maskedKey}</span>
                <span>
                  {cred.read_only && (
                    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-slate-700/60 text-slate-400">
                      yes
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
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => setPendingDeleteId(cred.id)}
                    disabled={!isEditable}
                    className="px-2 py-1 text-xs"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </section>

      {/* Add Credential Modal */}
      <Modal isOpen={isAddOpen} onClose={() => { setIsAddOpen(false); resetAddForm(); }}>
        <ModalHeader>
          <ModalTitle>Add API Key</ModalTitle>
        </ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">
                Provider ID <span className="text-red-400">*</span>
              </label>
              <select
                value={addProviderId}
                onChange={(e) => setAddProviderId(e.target.value)}
                className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Select a provider…</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id} ({p.provider_type})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Label</label>
              <Input
                name="label"
                value={addLabel}
                onChange={setAddLabel}
                placeholder="Human-readable label"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Attributes</label>
              <p className="mb-2 text-[11px] text-slate-500">
                Set <code className="font-mono">api_key</code>,{" "}
                <code className="font-mono">base_url</code>, or any other provider attribute.
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
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={addSubmitting}>
            {addSubmitting ? "Adding..." : "Add API Key"}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Edit Credential Modal */}
      <Modal isOpen={!!editItem} onClose={() => setEditItem(null)}>
        <ModalHeader>
          <ModalTitle>Edit Credential: {editItem?.id}</ModalTitle>
        </ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Label</label>
              <Input
                name="editLabel"
                value={editLabel}
                onChange={setEditLabel}
                placeholder="Human-readable label"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Attributes</label>
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
                Disabled
              </label>
            </div>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setEditItem(null)} disabled={editSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleEdit} disabled={editSubmitting}>
            {editSubmitting ? "Saving..." : "Save"}
          </Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={!!pendingDeleteId}
        onClose={() => setPendingDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Credential"
        message="Are you sure you want to delete this credential? This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
