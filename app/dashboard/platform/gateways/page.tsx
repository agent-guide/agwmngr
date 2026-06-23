"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useCurrentUser } from "@/components/current-user-context";
import {
  listGateways,
  createGateway,
  updateGateway,
  deleteGateway,
  testGatewayCredentials,
  testGatewayStored,
  listManagerUsers,
  listGatewayMembers,
  setGatewayMember,
  removeGatewayMember,
  type ManagerGateway,
  type ManagerUser,
  type GatewayMember,
  type GatewayWriteBody,
} from "@/lib/api";

function HealthBadge({ health }: { health: ManagerGateway["health_status"] }) {
  // Full class strings (no interpolation) so Tailwind's JIT keeps them.
  const map: Record<string, { cls: string; text: string }> = {
    ok: {
      cls: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
      text: "healthy",
    },
    credential_error: {
      cls: "bg-red-500/15 text-red-300 ring-red-500/30",
      text: "credential error",
    },
    encryption_unconfigured: {
      cls: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
      text: "no master key",
    },
  };
  const m = map[health] ?? { cls: "bg-slate-500/15 text-slate-300 ring-slate-500/30", text: health };
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${m.cls}`}>
      {m.text}
    </span>
  );
}

interface FormState {
  id: string;
  name: string;
  description: string;
  admin_addr: string;
  admin_user: string;
  admin_password: string;
  caddy_admin_addr: string;
  dataplane_addr: string;
  readonly_server_ids: string;
  status: "active" | "disabled";
}

const EMPTY_FORM: FormState = {
  id: "", name: "", description: "", admin_addr: "", admin_user: "", admin_password: "",
  caddy_admin_addr: "", dataplane_addr: "", readonly_server_ids: "", status: "active",
};

export default function GatewaysPage() {
  const { user: me, refresh: refreshUser } = useCurrentUser();
  const { showToast } = useToast();

  const [gateways, setGateways] = useState<ManagerGateway[]>([]);
  const [loading, setLoading] = useState(true);

  // Create/edit form (editId === null means create).
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<ManagerGateway | null>(null);

  // Members modal
  const [membersFor, setMembersFor] = useState<ManagerGateway | null>(null);
  const [members, setMembers] = useState<GatewayMember[]>([]);
  const [allUsers, setAllUsers] = useState<ManagerUser[]>([]);
  const [addUserId, setAddUserId] = useState<number | "">("");
  const [addRole, setAddRole] = useState<"operator" | "viewer">("operator");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setGateways(await listGateways());
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load gateways", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const setField = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const openCreate = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (g: ManagerGateway) => {
    setEditId(g.id);
    setForm({
      id: g.id,
      name: g.name,
      description: g.description ?? "",
      admin_addr: g.admin_addr,
      admin_user: g.admin_user,
      admin_password: "",
      caddy_admin_addr: g.caddy_admin_addr ?? "",
      dataplane_addr: g.dataplane_addr ?? "",
      readonly_server_ids: g.readonly_server_ids ?? "",
      status: g.status,
    });
    setFormOpen(true);
  };

  const handleTest = async () => {
    if (!form.admin_addr.trim() || !form.admin_user.trim()) {
      showToast("Admin address and user are required to test", "error");
      return;
    }
    if (!form.admin_password) {
      showToast("Enter the admin password to test connectivity", "error");
      return;
    }
    setTesting(true);
    try {
      const res = await testGatewayCredentials({
        admin_addr: form.admin_addr.trim(),
        admin_user: form.admin_user.trim(),
        admin_password: form.admin_password,
      });
      if (res.ok) showToast(`Connection OK (HTTP ${res.status})`, "success");
      else showToast(`Connection failed: ${res.reason ?? ""} ${res.message ?? ""}`.trim(), "error");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Test failed", "error");
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.admin_addr.trim() || !form.admin_user.trim()) {
      showToast("Name, admin address and admin user are required", "error");
      return;
    }
    if (editId === null) {
      if (!form.id.trim()) { showToast("Gateway id is required", "error"); return; }
      if (!form.admin_password) { showToast("Admin password is required", "error"); return; }
    }
    setSubmitting(true);
    try {
      const body: GatewayWriteBody = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        admin_addr: form.admin_addr.trim(),
        admin_user: form.admin_user.trim(),
        caddy_admin_addr: form.caddy_admin_addr.trim() || null,
        dataplane_addr: form.dataplane_addr.trim() || null,
        readonly_server_ids: form.readonly_server_ids.trim() || null,
        status: form.status,
      };
      if (form.admin_password) body.admin_password = form.admin_password;

      if (editId === null) {
        await createGateway({ ...body, id: form.id.trim(), admin_password: form.admin_password });
        showToast("Gateway created", "success");
      } else {
        await updateGateway(editId, body);
        showToast("Gateway updated", "success");
      }
      setFormOpen(false);
      await load();
      await refreshUser();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleTestStored = async (g: ManagerGateway) => {
    try {
      const res = await testGatewayStored(g.id);
      if (res.ok) showToast(`${g.name}: connection OK (HTTP ${res.status})`, "success");
      else showToast(`${g.name}: ${res.reason ?? "failed"} ${res.message ?? ""}`.trim(), "error");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Test failed", "error");
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteGateway(pendingDelete.id);
      showToast("Gateway deleted", "success");
      await load();
      await refreshUser();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Delete failed", "error");
    } finally {
      setPendingDelete(null);
    }
  };

  const openMembers = async (g: ManagerGateway) => {
    setMembersFor(g);
    setAddUserId("");
    setAddRole("operator");
    try {
      const [m, u] = await Promise.all([listGatewayMembers(g.id), listManagerUsers()]);
      setMembers(m);
      setAllUsers(u.filter((x) => !x.is_platform_admin)); // admins have implicit access
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load members", "error");
    }
  };

  const handleAddMember = async () => {
    if (!membersFor || addUserId === "") return;
    try {
      setMembers(await setGatewayMember(membersFor.id, Number(addUserId), addRole));
      setAddUserId("");
      showToast("Member assigned", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to assign member", "error");
    }
  };

  const handleChangeRole = async (userId: number, role: "operator" | "viewer") => {
    if (!membersFor) return;
    try {
      setMembers(await setGatewayMember(membersFor.id, userId, role));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to change role", "error");
    }
  };

  const handleRemoveMember = async (userId: number) => {
    if (!membersFor) return;
    try {
      setMembers(await removeGatewayMember(membersFor.id, userId));
      showToast("Member removed", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to remove member", "error");
    }
  };

  if (me && !me.is_platform_admin) {
    return (
      <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center text-sm text-slate-400">
        Platform administrator access is required to manage gateways.
      </div>
    );
  }

  const assignableUsers = allUsers.filter((u) => !members.some((m) => m.user_id === u.id));

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">Gateways</h1>
            <p className="mt-1 text-sm text-slate-400">Register and manage the agent-gateways this manager controls.</p>
          </div>
          <Button onClick={openCreate} className="px-2.5 py-1 text-xs">Add Gateway</Button>
        </div>
      </section>

      <section className="overflow-x-auto rounded-lg border border-slate-700/70 bg-slate-900/40">
        <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_110px_130px_minmax(0,1fr)] border-b border-slate-700/70 bg-slate-900/95 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          <span>Name</span><span>Admin Address</span><span>Status</span><span>Health</span><span>Actions</span>
        </div>

        {loading ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">Loading...</div>
        ) : gateways.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">No gateways registered.</div>
        ) : (
          gateways.map((g) => (
            <div
              key={g.id}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_110px_130px_minmax(0,1fr)] items-center border-b border-slate-700/60 px-3 py-2 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-slate-100">{g.name}</p>
                <p className="truncate text-[10px] text-slate-500 font-mono">{g.id}</p>
              </div>
              <span className="truncate text-xs text-slate-400 font-mono">{g.admin_addr}</span>
              <span className={`text-xs ${g.status === "active" ? "text-emerald-400" : "text-amber-400"}`}>{g.status}</span>
              <span><HealthBadge health={g.health_status} /></span>
              <div className="flex flex-wrap gap-1">
                <Button variant="ghost" onClick={() => handleTestStored(g)} className="px-2 py-1 text-xs">Test</Button>
                <Button variant="ghost" onClick={() => openMembers(g)} className="px-2 py-1 text-xs">Members</Button>
                <Button variant="ghost" onClick={() => openEdit(g)} className="px-2 py-1 text-xs">Edit</Button>
                <Button variant="danger" onClick={() => setPendingDelete(g)} className="px-2 py-1 text-xs">Delete</Button>
              </div>
            </div>
          ))
        )}
      </section>

      {/* Create / Edit Modal */}
      <Modal isOpen={formOpen} onClose={() => setFormOpen(false)}>
        <ModalHeader><ModalTitle>{editId === null ? "Add Gateway" : `Edit Gateway: ${editId}`}</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="space-y-3">
            {editId === null && (
              <Field label="ID (slug)">
                <Input name="id" value={form.id} onChange={(v) => setField("id", v)} placeholder="e.g. prod-us" autoComplete="off" />
              </Field>
            )}
            <Field label="Name">
              <Input name="name" value={form.name} onChange={(v) => setField("name", v)} placeholder="Production US" />
            </Field>
            <Field label="Description">
              <Input name="description" value={form.description} onChange={(v) => setField("description", v)} placeholder="Optional" />
            </Field>
            <Field label="Admin API Address">
              <Input name="admin_addr" value={form.admin_addr} onChange={(v) => setField("admin_addr", v)} placeholder="http://localhost:8019" autoComplete="off" />
            </Field>
            <Field label="Admin User">
              <Input name="admin_user" value={form.admin_user} onChange={(v) => setField("admin_user", v)} placeholder="default" autoComplete="off" />
            </Field>
            <Field label={editId === null ? "Admin Password" : "Admin Password (leave blank to keep)"}>
              <Input name="admin_password" type="password" value={form.admin_password} onChange={(v) => setField("admin_password", v)} placeholder={editId === null ? "required" : "unchanged"} autoComplete="new-password" />
            </Field>
            <Field label="Caddy Admin Address">
              <Input name="caddy_admin_addr" value={form.caddy_admin_addr} onChange={(v) => setField("caddy_admin_addr", v)} placeholder="http://localhost:2019" autoComplete="off" />
            </Field>
            <Field label="Data-plane Address">
              <Input name="dataplane_addr" value={form.dataplane_addr} onChange={(v) => setField("dataplane_addr", v)} placeholder="http://127.0.0.1:8080" autoComplete="off" />
            </Field>
            <Field label="Read-only Server IDs (CSV)">
              <Input name="readonly_server_ids" value={form.readonly_server_ids} onChange={(v) => setField("readonly_server_ids", v)} placeholder="srv0,srv1" autoComplete="off" />
            </Field>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => setField("status", e.target.value)}
                className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
              >
                <option value="active">active</option>
                <option value="disabled">disabled</option>
              </select>
            </Field>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={handleTest} disabled={testing || submitting}>{testing ? "Testing..." : "Test Connection"}</Button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>{submitting ? "Saving..." : "Save"}</Button>
        </ModalFooter>
      </Modal>

      {/* Members Modal */}
      <Modal isOpen={!!membersFor} onClose={() => setMembersFor(null)}>
        <ModalHeader><ModalTitle>Members: {membersFor?.name}</ModalTitle></ModalHeader>
        <ModalContent>
          <p className="mb-3 text-[11px] text-slate-500">
            Platform administrators implicitly have full access to every gateway and are not listed here.
          </p>
          <div className="space-y-2">
            {members.length === 0 ? (
              <p className="text-xs text-slate-500">No members assigned.</p>
            ) : (
              members.map((m) => (
                <div key={m.user_id} className="flex items-center gap-2 rounded-md border border-slate-700/60 px-3 py-2">
                  <span className="flex-1 truncate text-sm text-slate-200">{m.username}</span>
                  <select
                    value={m.role}
                    onChange={(e) => handleChangeRole(m.user_id, e.target.value as "operator" | "viewer")}
                    className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-100"
                  >
                    <option value="operator">operator</option>
                    <option value="viewer">viewer</option>
                  </select>
                  <Button variant="danger" onClick={() => handleRemoveMember(m.user_id)} className="px-2 py-1 text-xs">Remove</Button>
                </div>
              ))
            )}
          </div>

          <div className="mt-4 flex items-end gap-2 border-t border-slate-700/60 pt-3">
            <div className="flex-1">
              <label className="mb-1 block text-[11px] font-medium text-slate-400">Add member</label>
              <select
                value={addUserId}
                onChange={(e) => setAddUserId(e.target.value ? Number(e.target.value) : "")}
                className="w-full rounded-md border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
              >
                <option value="">Select a user…</option>
                {assignableUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.username}</option>
                ))}
              </select>
            </div>
            <select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value as "operator" | "viewer")}
              className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
            >
              <option value="operator">operator</option>
              <option value="viewer">viewer</option>
            </select>
            <Button onClick={handleAddMember} disabled={addUserId === ""} className="px-2.5 py-1.5 text-xs">Add</Button>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setMembersFor(null)}>Close</Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleDelete}
        title="Delete Gateway"
        message={`Delete gateway "${pendingDelete?.name}"? Memberships are removed. This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-300">{label}</label>
      {children}
    </div>
  );
}
