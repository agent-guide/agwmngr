"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { HelpTooltip } from "@/components/ui/tooltip";
import { adminFetch } from "@/lib/api";

interface VirtualKey {
  id: string;
  key: string;
  user_id?: string;
  tag?: string;
  description?: string;
  disabled: boolean;
  allowed_route_ids?: string[];
  status_message?: string;
  created_at: string;
  updated_at: string;
  expires_at?: string;
  source?: string;
  read_only?: boolean;
}

interface Route {
  id: string;
  name?: string;
  disabled?: boolean;
}

interface CreateForm {
  id: string;
  tag: string;
  description: string;
  allowed_route_ids: string[];
  expires_at: string;
}

interface EditForm {
  tag: string;
  description: string;
  allowed_route_ids: string[];
  expires_at: string;
  disabled: boolean;
}

const emptyForm = (): CreateForm => ({
  id: "",
  tag: "",
  description: "",
  allowed_route_ids: [],
  expires_at: "",
});

const emptyEditForm = (): EditForm => ({
  tag: "",
  description: "",
  allowed_route_ids: [],
  expires_at: "",
  disabled: false,
});

function keyPreview(key: string): string {
  if (key.length <= 8) return key;
  return `${key.substring(0, 8)}...${key.substring(key.length - 4)}`;
}

function dateInputValue(value?: string): string {
  if (!value || value === "0001-01-01T00:00:00Z") return "";
  return value.split("T")[0] ?? "";
}

async function fetchRoutes(): Promise<Route[]> {
  const data = await adminFetch<{ items: Route[] }>("/admin/llm/routes");
  return data.items ?? [];
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
  const routeIds = new Set(routes.map((route) => route.id));
  const missingSelectedRoutes = value
    .filter((id) => !routeIds.has(id))
    .map((id) => ({ id, name: "Unavailable route", disabled: true }));
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
          {value.length === 0 ? "All routes allowed" : `${value.length} selected`}
        </span>
        <button
          type="button"
          onClick={clearAll}
          disabled={value.length === 0}
          className="text-xs font-medium text-blue-300 hover:text-blue-200 disabled:cursor-not-allowed disabled:text-slate-600"
        >
          Clear
        </button>
      </div>
      <div className="max-h-48 overflow-y-auto p-1.5">
        {loading ? (
          <p className="px-2 py-2 text-xs text-slate-500">Loading routes...</p>
        ) : options.length === 0 ? (
          <p className="px-2 py-2 text-xs text-slate-500">No routes available.</p>
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
                  <span className="block truncate font-mono text-xs">{route.id}</span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">
                    {route.name || "Unnamed route"}
                    {route.disabled ? " · disabled" : ""}
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
  const [loading, setLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>(emptyForm());
  const [editForm, setEditForm] = useState<EditForm>(emptyEditForm());
  const [editingKey, setEditingKey] = useState<VirtualKey | null>(null);
  const [showNewKey, setShowNewKey] = useState(false);
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [routesLoading, setRoutesLoading] = useState(false);
  const { showToast } = useToast();

  async function fetchKeys() {
    setLoading(true);
    try {
      const data = await adminFetch<{ items: VirtualKey[] }>("/admin/virtual_keys");
      setApiKeys(data.items ?? []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load virtual keys", "error");
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
      showToast(err instanceof Error ? err.message : "Failed to load routes", "error");
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
    });
    setIsEditModalOpen(true);
    void loadRoutes();
  };

  const handleCreateKey = async () => {
    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        id: form.id.trim(),
      };
      if (form.tag.trim()) body.tag = form.tag.trim();
      if (form.description.trim()) body.description = form.description.trim();
      if (form.allowed_route_ids.length > 0) body.allowed_route_ids = form.allowed_route_ids;
      if (form.expires_at) body.expires_at = new Date(form.expires_at).toISOString();

      const created = await adminFetch<VirtualKey>("/admin/virtual_keys", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setApiKeys((prev) => [...prev, created]);
      setNewKeyValue(created.key);
      setIsCreateModalOpen(false);
      setShowNewKey(true);
      showToast("Virtual key created", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to create virtual key", "error");
    } finally {
      setCreating(false);
    }
  };

  const handleUpdateKey = async () => {
    if (!editingKey) return;
    setUpdating(true);
    try {
      const body: Record<string, unknown> = {
        id: editingKey.id,
        tag: editForm.tag.trim(),
        description: editForm.description.trim(),
        disabled: editForm.disabled,
        allowed_route_ids: editForm.allowed_route_ids,
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
      showToast("Virtual key updated", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update virtual key", "error");
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDeleteId) return;
    const pendingVK = apiKeys.find((apiKey) => apiKey.id === pendingDeleteId);
    if (pendingVK?.read_only) {
      setShowConfirm(false);
      setPendingDeleteId(null);
      showToast("Read-only virtual key cannot be deleted", "error");
      return;
    }
    setDeleting(true);
    try {
      await adminFetch(`/admin/virtual_keys/${encodeURIComponent(pendingDeleteId)}`, {
        method: "DELETE",
      });
      setApiKeys((prev) => prev.filter((k) => k.id !== pendingDeleteId));
      showToast("Virtual key deleted", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to delete virtual key", "error");
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
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">Virtual Keys</h1>
            <p className="mt-1 text-xs text-slate-400">
              Manage gateway access keys for clients and integrations.
              <HelpTooltip content="Virtual keys authenticate requests to the agent gateway" />
            </p>
          </div>
          <Button onClick={openCreateModal} className="px-2.5 py-1 text-xs">
            Create Virtual Key
          </Button>
        </div>
      </section>

      {loading ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center">
          <p className="text-sm text-slate-400">Loading...</p>
        </div>
      ) : apiKeys.length === 0 ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center">
          <p className="text-sm text-slate-400">No virtual keys yet. Create one to get started.</p>
          <Button onClick={openCreateModal} className="mt-4 px-3 py-1.5 text-xs">Create Virtual Key</Button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <section className="min-w-[700px] overflow-hidden rounded-lg border border-slate-700/70 bg-slate-900/40">
            <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_180px_160px_230px] border-b border-slate-700/70 bg-slate-900/95 backdrop-blur-sm px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              <span>Name</span><span>Created</span><span>Expires</span><span>Actions</span>
            </div>
            {apiKeys.map((apiKey) => (
              <div key={apiKey.id} className="grid grid-cols-[minmax(0,1fr)_180px_160px_230px] items-center border-b border-slate-700/60 px-3 py-2 last:border-b-0">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs font-medium text-slate-100">{apiKey.id}</p>
                  <p className="mt-0.5 truncate font-mono text-xs text-slate-400">{keyPreview(apiKey.key)}</p>
                </div>
                <span className="text-xs text-slate-400">{new Date(apiKey.created_at).toLocaleDateString()}</span>
                <span className="text-xs text-slate-400">
                  {apiKey.expires_at && apiKey.expires_at !== "0001-01-01T00:00:00Z"
                    ? new Date(apiKey.expires_at).toLocaleDateString()
                    : "Never"}
                </span>
                <div className="flex justify-end gap-1.5">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      void navigator.clipboard.writeText(apiKey.key).then(() => {
                        showToast("Key copied to clipboard", "success");
                      });
                    }}
                    className="px-2.5 py-1 text-xs"
                    title="Copy key"
                  >
                    Copy
                  </Button>
                  <span title={apiKey.read_only ? "Read-only virtual key is not editable" : undefined}>
                    <Button
                      variant="ghost"
                      onClick={() => openEditModal(apiKey)}
                      disabled={!!apiKey.read_only}
                      className="px-2.5 py-1 text-xs"
                    >
                      Edit
                    </Button>
                  </span>
                  <span title={apiKey.read_only ? "Read-only virtual key cannot be deleted" : undefined}>
                    <Button
                      variant="danger"
                      onClick={() => { setPendingDeleteId(apiKey.id); setShowConfirm(true); }}
                      disabled={!!apiKey.read_only}
                      className="px-2.5 py-1 text-xs"
                    >
                      Delete
                    </Button>
                  </span>
                </div>
              </div>
            ))}
          </section>
        </div>
      )}

      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)}>
        <ModalHeader><ModalTitle>Create Virtual Key</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-300">
                ID <span className="text-slate-500 font-normal">(required)</span>
              </label>
              <Input
                name="key-id"
                value={form.id}
                onChange={(v) => setForm((f) => ({ ...f, id: v }))}
                placeholder="e.g. development, production"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-300">
                Tag
                <HelpTooltip content="Optional label to associate this key with a user or group." />
              </label>
              <Input
                name="key-tag"
                value={form.tag}
                onChange={(v) => setForm((f) => ({ ...f, tag: v }))}
                placeholder="e.g. user-123, team-alpha"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-300">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Optional description for this key"
                rows={2}
                className="w-full resize-none rounded-md border border-slate-600/60 bg-slate-800/60 px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/30"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-300">
                Allowed Route IDs
                <HelpTooltip content="Restrict this key to specific routes. Leave empty to allow all routes." />
              </label>
              <AllowedRouteSelect
                value={form.allowed_route_ids}
                routes={routes}
                loading={routesLoading}
                onChange={(v) => setForm((f) => ({ ...f, allowed_route_ids: v }))}
              />
              <p className="mt-1 text-xs text-slate-500">Select one or more routes. Leave empty to allow all routes.</p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-300">
                Expiration Date
                <HelpTooltip content="Leave empty for a non-expiring key." />
              </label>
              <input
                type="date"
                value={form.expires_at}
                onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
                min={new Date().toISOString().split("T")[0]}
                className="w-full rounded-md border border-slate-600/60 bg-slate-800/60 px-3 py-2 text-sm text-white outline-none focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/30 [color-scheme:dark]"
              />
              <p className="mt-1 text-xs text-slate-500">Leave empty for a non-expiring key.</p>
            </div>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setIsCreateModalOpen(false)} disabled={creating}>Cancel</Button>
          <Button onClick={handleCreateKey} disabled={creating || !form.id.trim()}>
            {creating ? "Creating..." : "Create Virtual Key"}
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        isOpen={isEditModalOpen && editingKey !== null}
        onClose={() => { setIsEditModalOpen(false); setEditingKey(null); }}
      >
        <ModalHeader><ModalTitle>Edit Virtual Key</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-300">
                Tag
                <HelpTooltip content="Optional label to associate this key with a user or group." />
              </label>
              <Input
                name="edit-key-tag"
                value={editForm.tag}
                onChange={(v) => setEditForm((f) => ({ ...f, tag: v }))}
                placeholder="e.g. user-123, team-alpha"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-300">Description</label>
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Optional description for this key"
                rows={2}
                className="w-full resize-none rounded-md border border-slate-600/60 bg-slate-800/60 px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/30"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-300">
                Allowed Route IDs
                <HelpTooltip content="Restrict this key to specific routes. Leave empty to allow all routes." />
              </label>
              <AllowedRouteSelect
                value={editForm.allowed_route_ids}
                routes={routes}
                loading={routesLoading}
                onChange={(v) => setEditForm((f) => ({ ...f, allowed_route_ids: v }))}
              />
              <p className="mt-1 text-xs text-slate-500">Select one or more routes. Leave empty to allow all routes.</p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-300">
                Expiration Date
                <HelpTooltip content="Leave empty for a non-expiring key." />
              </label>
              <input
                type="date"
                value={editForm.expires_at}
                onChange={(e) => setEditForm((f) => ({ ...f, expires_at: e.target.value }))}
                min={new Date().toISOString().split("T")[0]}
                className="w-full rounded-md border border-slate-600/60 bg-slate-800/60 px-3 py-2 text-sm text-white outline-none focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/30 [color-scheme:dark]"
              />
              <p className="mt-1 text-xs text-slate-500">Leave empty for a non-expiring key.</p>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={editForm.disabled}
                onChange={(e) => setEditForm((f) => ({ ...f, disabled: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-500"
              />
              Disabled
            </label>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button
            variant="ghost"
            onClick={() => { setIsEditModalOpen(false); setEditingKey(null); }}
            disabled={updating}
          >
            Cancel
          </Button>
          <Button onClick={handleUpdateKey} disabled={updating}>
            {updating ? "Saving..." : "Save Changes"}
          </Button>
        </ModalFooter>
      </Modal>

      <Modal isOpen={showNewKey && newKeyValue !== null} onClose={() => { setShowNewKey(false); setNewKeyValue(null); }}>
        <ModalHeader><ModalTitle>New Virtual Key</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="rounded-sm border border-slate-700/70 bg-slate-900/40 p-4 text-sm">
            <div className="mb-2 font-medium text-slate-100">Copy this key now</div>
            <div className="break-all rounded-sm border border-slate-700/70 bg-slate-900/40 p-3 font-mono text-xs text-slate-200">{newKeyValue}</div>
          </div>
          <div className="mt-3 rounded-sm border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <span className="text-amber-200">This key will only be shown once. Store it securely.</span>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button onClick={() => { setShowNewKey(false); setNewKeyValue(null); }}>I have saved it</Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={showConfirm}
        onClose={() => { setShowConfirm(false); setPendingDeleteId(null); }}
        onConfirm={handleDelete}
        title="Delete Virtual Key"
        message="Are you sure you want to delete this virtual key?"
        confirmLabel={deleting ? "Deleting..." : "Delete"}
        variant="danger"
      />
    </div>
  );
}
