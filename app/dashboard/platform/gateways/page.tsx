"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
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
import { useI18n } from "@/components/i18n-provider";

function HealthBadge({ health }: { health: ManagerGateway["health_status"] }) {
  const { t } = useI18n();
  // Full class strings (no interpolation) so Tailwind's JIT keeps them.
  const map: Record<string, { cls: string; text: string }> = {
    ok: {
      cls: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
      text: t("health.healthy"),
    },
    credential_error: {
      cls: "bg-red-500/15 text-red-300 ring-red-500/30",
      text: t("health.credentialError"),
    },
    encryption_unconfigured: {
      cls: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
      text: t("health.noMasterKey"),
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
  const { t } = useI18n();

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
  const [addRole, setAddRole] = useState<"admin" | "member">("member");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setGateways(await listGateways());
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("gateways.loadFailed"), "error");
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

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
      showToast(t("gateways.testFieldsRequired"), "error");
      return;
    }
    if (!form.admin_password) {
      showToast(t("gateways.testPasswordRequired"), "error");
      return;
    }
    setTesting(true);
    try {
      const res = await testGatewayCredentials({
        admin_addr: form.admin_addr.trim(),
        admin_user: form.admin_user.trim(),
        admin_password: form.admin_password,
      });
      if (res.ok) showToast(t("gateways.connectionOk", { status: res.status ?? "—" }), "success");
      else showToast(t("gateways.connectionFailed", { detail: `${res.reason ?? ""} ${res.message ?? ""}`.trim() }), "error");
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("gateways.testFailed"), "error");
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.admin_addr.trim() || !form.admin_user.trim()) {
      showToast(t("gateways.fieldsRequired"), "error");
      return;
    }
    if (editId === null) {
      if (!form.id.trim()) { showToast(t("gateways.idRequired"), "error"); return; }
      if (!form.admin_password) { showToast(t("gateways.passwordRequired"), "error"); return; }
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
        showToast(t("gateways.created"), "success");
      } else {
        await updateGateway(editId, body);
        showToast(t("gateways.updated"), "success");
      }
      setFormOpen(false);
      await load();
      await refreshUser();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("gateways.saveFailed"), "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleTestStored = async (g: ManagerGateway) => {
    try {
      const res = await testGatewayStored(g.id);
      if (res.ok) showToast(t("gateways.namedConnectionOk", { name: g.name, status: res.status ?? "—" }), "success");
      else showToast(t("gateways.namedConnectionFailed", { name: g.name, detail: `${res.reason ?? "failed"} ${res.message ?? ""}`.trim() }), "error");
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("gateways.testFailed"), "error");
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteGateway(pendingDelete.id);
      showToast(t("gateways.deleted"), "success");
      await load();
      await refreshUser();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("gateways.deleteFailed"), "error");
    } finally {
      setPendingDelete(null);
    }
  };

  const openMembers = async (g: ManagerGateway) => {
    setMembersFor(g);
    setAddUserId("");
    setAddRole("member");
    try {
      const [m, u] = await Promise.all([listGatewayMembers(g.id), listManagerUsers()]);
      setMembers(m);
      setAllUsers(u.filter((x) => !x.is_platform_admin)); // admins have implicit access
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("gateways.membersLoadFailed"), "error");
    }
  };

  const handleAddMember = async () => {
    if (!membersFor || addUserId === "") return;
    try {
      setMembers(await setGatewayMember(membersFor.id, Number(addUserId), addRole));
      setAddUserId("");
      showToast(t("gateways.memberAssigned"), "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("gateways.memberAssignFailed"), "error");
    }
  };

  const handleChangeRole = async (userId: number, role: "admin" | "member") => {
    if (!membersFor) return;
    try {
      setMembers(await setGatewayMember(membersFor.id, userId, role));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("gateways.roleChangeFailed"), "error");
    }
  };

  const handleRemoveMember = async (userId: number) => {
    if (!membersFor) return;
    try {
      setMembers(await removeGatewayMember(membersFor.id, userId));
      showToast(t("gateways.memberRemoved"), "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("gateways.memberRemoveFailed"), "error");
    }
  };

  if (me && !me.is_platform_admin) {
    return (
      <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center text-sm text-slate-400">
        {t("gateways.adminRequired")}
      </div>
    );
  }

  const assignableUsers = allUsers.filter((u) => !members.some((m) => m.user_id === u.id));

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">{t("gateways.title")}</h1>
            <p className="mt-1 text-sm text-slate-400">{t("gateways.description")}</p>
          </div>
          <Button onClick={openCreate} className="px-2.5 py-1 text-xs">{t("gateways.add")}</Button>
        </div>
      </section>

      <section className="overflow-x-auto rounded-lg border border-slate-700/70 bg-slate-900/40">
        <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_110px_130px_minmax(0,1fr)] border-b border-slate-700/70 bg-slate-900/95 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          <span>{t("common.name")}</span><span>{t("gateways.adminAddress")}</span><span>{t("interactions.status")}</span><span>{t("common.health")}</span><span>{t("common.actions")}</span>
        </div>

        {loading ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">{t("common.loading")}</div>
        ) : gateways.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">{t("gateways.empty")}</div>
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
              <span className={`text-xs ${g.status === "active" ? "text-emerald-400" : "text-amber-400"}`}>{g.status === "active" ? t("common.active") : t("common.disabled")}</span>
              <span><HealthBadge health={g.health_status} /></span>
              <div className="flex flex-wrap gap-1">
                <Link
                  href={`/dashboard/platform/gateways/${encodeURIComponent(g.id)}/providers`}
                  className="rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-xs font-medium text-blue-300 transition-colors hover:text-blue-100"
                >
                  {t("gateways.openWorkspace")}
                </Link>
                <Link
                  href={`/dashboard/platform/gateways/${encodeURIComponent(g.id)}/credentials`}
                  className="rounded-md border border-slate-600/60 bg-slate-800/40 px-2 py-1 text-xs font-medium text-slate-300 transition-colors hover:text-slate-100"
                >
                  {t("credentials.title")}
                </Link>
                <Link
                  href={`/dashboard/platform/gateways/${encodeURIComponent(g.id)}/virtual-keys`}
                  className="rounded-md border border-slate-600/60 bg-slate-800/40 px-2 py-1 text-xs font-medium text-slate-300 transition-colors hover:text-slate-100"
                >
                  {t("virtualKeys.title")}
                </Link>
                <Link
                  href={`/dashboard/platform/gateways/${encodeURIComponent(g.id)}/runtime`}
                  className="rounded-md border border-slate-600/60 bg-slate-800/40 px-2 py-1 text-xs font-medium text-slate-300 transition-colors hover:text-slate-100"
                >
                  {t("nav.runtimes")}
                </Link>
                <Link
                  href={`/dashboard/platform/gateways/${encodeURIComponent(g.id)}/agents`}
                  className="rounded-md border border-slate-600/60 bg-slate-800/40 px-2 py-1 text-xs font-medium text-slate-300 transition-colors hover:text-slate-100"
                >
                  {t("nav.agents")}
                </Link>
                <Link
                  href={`/dashboard/platform/gateways/${encodeURIComponent(g.id)}/observability`}
                  className="rounded-md border border-slate-600/60 bg-slate-800/40 px-2 py-1 text-xs font-medium text-slate-300 transition-colors hover:text-slate-100"
                >
                  {t("nav.observability")}
                </Link>
                <Button variant="ghost" onClick={() => handleTestStored(g)} className="px-2 py-1 text-xs">{t("common.test")}</Button>
                <Button variant="ghost" onClick={() => openMembers(g)} className="px-2 py-1 text-xs">{t("gateways.members")}</Button>
                <Button variant="ghost" onClick={() => openEdit(g)} className="px-2 py-1 text-xs">{t("common.edit")}</Button>
                <Button variant="danger" onClick={() => setPendingDelete(g)} className="px-2 py-1 text-xs">{t("common.delete")}</Button>
              </div>
            </div>
          ))
        )}
      </section>

      {/* Create / Edit Modal */}
      <Modal isOpen={formOpen} onClose={() => setFormOpen(false)}>
        <ModalHeader><ModalTitle>{editId === null ? t("gateways.add") : t("gateways.edit", { id: editId })}</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="space-y-3">
            {editId === null && (
              <Field label={t("gateways.idSlug")}>
                <Input name="id" value={form.id} onChange={(v) => setField("id", v)} placeholder="e.g. prod-us" autoComplete="off" />
              </Field>
            )}
            <Field label={t("common.name")}>
              <Input name="name" value={form.name} onChange={(v) => setField("name", v)} placeholder="Production US" />
            </Field>
            <Field label={t("common.description")}>
              <Input name="description" value={form.description} onChange={(v) => setField("description", v)} placeholder={t("common.optional")} />
            </Field>
            <Field label={t("gateways.adminApiAddress")}>
              <Input name="admin_addr" value={form.admin_addr} onChange={(v) => setField("admin_addr", v)} placeholder="http://localhost:8019" autoComplete="off" />
            </Field>
            <Field label={t("gateways.adminUser")}>
              <Input name="admin_user" value={form.admin_user} onChange={(v) => setField("admin_user", v)} placeholder="default" autoComplete="off" />
            </Field>
            <Field label={editId === null ? t("gateways.adminPassword") : t("gateways.adminPasswordKeep")}>
              <Input name="admin_password" type="password" value={form.admin_password} onChange={(v) => setField("admin_password", v)} placeholder={editId === null ? t("common.required") : t("common.unchanged")} autoComplete="new-password" />
            </Field>
            <Field label={t("gateways.caddyAddress")}>
              <Input name="caddy_admin_addr" value={form.caddy_admin_addr} onChange={(v) => setField("caddy_admin_addr", v)} placeholder="http://localhost:2019" autoComplete="off" />
            </Field>
            <Field label={t("gateways.dataAddress")}>
              <Input name="dataplane_addr" value={form.dataplane_addr} onChange={(v) => setField("dataplane_addr", v)} placeholder="http://127.0.0.1:8080" autoComplete="off" />
            </Field>
            <Field label={t("gateways.readonlyServers")}>
              <Input name="readonly_server_ids" value={form.readonly_server_ids} onChange={(v) => setField("readonly_server_ids", v)} placeholder="srv0,srv1" autoComplete="off" />
            </Field>
            <Field label={t("interactions.status")}>
              <select
                value={form.status}
                onChange={(e) => setField("status", e.target.value)}
                className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
              >
                <option value="active">{t("common.active")}</option>
                <option value="disabled">{t("common.disabled")}</option>
              </select>
            </Field>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={handleTest} disabled={testing || submitting}>{testing ? t("common.testing") : t("gateways.testConnection")}</Button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={submitting}>{t("common.cancel")}</Button>
          <Button onClick={handleSubmit} disabled={submitting}>{submitting ? t("common.saving") : t("common.save")}</Button>
        </ModalFooter>
      </Modal>

      {/* Members Modal */}
      <Modal isOpen={!!membersFor} onClose={() => setMembersFor(null)}>
        <ModalHeader><ModalTitle>{t("gateways.membersTitle", { name: membersFor?.name ?? "" })}</ModalTitle></ModalHeader>
        <ModalContent>
          <p className="mb-3 text-[11px] text-slate-500">
            {t("gateways.adminImplicit")}
          </p>
          <div className="space-y-2">
            {members.length === 0 ? (
              <p className="text-xs text-slate-500">{t("gateways.noMembers")}</p>
            ) : (
              members.map((m) => (
                <div key={m.user_id} className="flex items-center gap-2 rounded-md border border-slate-700/60 px-3 py-2">
                  <span className="flex-1 truncate text-sm text-slate-200">{m.username}</span>
                  <select
                    value={m.role}
                    onChange={(e) => handleChangeRole(m.user_id, e.target.value as "admin" | "member")}
                    className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-100"
                  >
                    <option value="admin">{t("role.gatewayAdmin")}</option>
                    <option value="member">{t("role.member")}</option>
                  </select>
                  <Button variant="danger" onClick={() => handleRemoveMember(m.user_id)} className="px-2 py-1 text-xs">{t("common.remove")}</Button>
                </div>
              ))
            )}
          </div>

          <div className="mt-4 flex items-end gap-2 border-t border-slate-700/60 pt-3">
            <div className="flex-1">
              <label className="mb-1 block text-[11px] font-medium text-slate-400">{t("gateways.addMember")}</label>
              <select
                value={addUserId}
                onChange={(e) => setAddUserId(e.target.value ? Number(e.target.value) : "")}
                className="w-full rounded-md border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
              >
                <option value="">{t("gateways.selectUser")}</option>
                {assignableUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.username}</option>
                ))}
              </select>
            </div>
            <select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value as "admin" | "member")}
              className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
            >
              <option value="member">{t("role.member")}</option>
              <option value="admin">{t("role.gatewayAdmin")}</option>
            </select>
            <Button onClick={handleAddMember} disabled={addUserId === ""} className="px-2.5 py-1.5 text-xs">{t("common.add")}</Button>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setMembersFor(null)}>{t("common.close")}</Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleDelete}
        title={t("gateways.deleteTitle")}
        message={t("gateways.deleteMessage", { name: pendingDelete?.name ?? "" })}
        confirmLabel={t("common.delete")}
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
