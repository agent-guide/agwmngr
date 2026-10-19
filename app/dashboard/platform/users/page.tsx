"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useCurrentUser } from "@/components/current-user-context";
import {
  listManagerUsers,
  createManagerUser,
  updateManagerUser,
  deleteManagerUser,
  type ManagerUser,
} from "@/lib/api";
import { useI18n } from "@/components/i18n-provider";

function RoleBadge({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useI18n();
  return (
    <span
      className={
        isAdmin
          ? "inline-flex items-center rounded-md bg-blue-500/15 px-2 py-0.5 text-[11px] font-medium text-blue-300 ring-1 ring-inset ring-blue-500/30"
          : "inline-flex items-center rounded-md bg-slate-500/15 px-2 py-0.5 text-[11px] font-medium text-slate-300 ring-1 ring-inset ring-slate-500/30"
      }
    >
      {isAdmin ? t("role.platformAdmin") : t("role.member")}
    </span>
  );
}

function StatusBadge({ status }: { status: "active" | "disabled" }) {
  const { t } = useI18n();
  return (
    <span
      className={
        status === "active"
          ? "inline-flex items-center rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30"
          : "inline-flex items-center rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300 ring-1 ring-inset ring-amber-500/30"
      }
    >
      {status === "active" ? t("common.active") : t("common.disabled")}
    </span>
  );
}

export default function UsersPage() {
  const { user: me } = useCurrentUser();
  const { showToast } = useToast();
  const { locale, t } = useI18n();

  const [users, setUsers] = useState<ManagerUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Add modal
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addUsername, setAddUsername] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addIsAdmin, setAddIsAdmin] = useState(true);

  // Edit modal
  const [editItem, setEditItem] = useState<ManagerUser | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editPassword, setEditPassword] = useState("");
  const [editIsAdmin, setEditIsAdmin] = useState(false);
  const [editStatus, setEditStatus] = useState<"active" | "disabled">("active");

  // Delete confirm
  const [pendingDelete, setPendingDelete] = useState<ManagerUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await listManagerUsers());
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("users.loadFailed"), "error");
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const handleAdd = async () => {
    if (!addUsername.trim()) { showToast(t("users.usernameRequired"), "error"); return; }
    if (addPassword.length < 8) { showToast(t("users.passwordMin"), "error"); return; }
    setAddSubmitting(true);
    try {
      const created = await createManagerUser({
        username: addUsername.trim(),
        password: addPassword,
        is_platform_admin: addIsAdmin,
      });
      setUsers((prev) => [...prev, created]);
      showToast(t("users.created"), "success");
      setIsAddOpen(false);
      setAddUsername(""); setAddPassword(""); setAddIsAdmin(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("users.createFailed"), "error");
    } finally {
      setAddSubmitting(false);
    }
  };

  const openEdit = (u: ManagerUser) => {
    setEditItem(u);
    setEditPassword("");
    setEditIsAdmin(u.is_platform_admin);
    setEditStatus(u.status);
  };

  const handleEdit = async () => {
    if (!editItem) return;
    if (editPassword && editPassword.length < 8) {
      showToast(t("users.passwordMin"), "error");
      return;
    }
    const patch: Parameters<typeof updateManagerUser>[1] = {};
    if (editPassword) patch.password = editPassword;
    if (editIsAdmin !== editItem.is_platform_admin) patch.is_platform_admin = editIsAdmin;
    if (editStatus !== editItem.status) patch.status = editStatus;
    if (Object.keys(patch).length === 0) { setEditItem(null); return; }

    setEditSubmitting(true);
    try {
      const updated = await updateManagerUser(editItem.id, patch);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      showToast(t("users.updated"), "success");
      setEditItem(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("users.updateFailed"), "error");
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteManagerUser(pendingDelete.id);
      setUsers((prev) => prev.filter((u) => u.id !== pendingDelete.id));
      showToast(t("users.deleted"), "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("users.deleteFailed"), "error");
    } finally {
      setPendingDelete(null);
    }
  };

  if (me && !me.is_platform_admin) {
    return (
      <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center text-sm text-slate-400">
        {t("users.adminRequired")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">{t("users.title")}</h1>
            <p className="mt-1 text-sm text-slate-400">{t("users.description")}</p>
          </div>
          <Button onClick={() => setIsAddOpen(true)} className="px-2.5 py-1 text-xs">{t("users.add")}</Button>
        </div>
      </section>

      <section className="overflow-x-auto rounded-lg border border-slate-700/70 bg-slate-900/40">
        <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_140px_110px_minmax(0,1fr)_150px] border-b border-slate-700/70 bg-slate-900/95 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          <span>{t("users.username")}</span><span>{t("users.role")}</span><span>{t("interactions.status")}</span><span>{t("common.created")}</span><span>{t("common.actions")}</span>
        </div>

        {loading ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">{t("common.loading")}</div>
        ) : users.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">{t("users.empty")}</div>
        ) : (
          users.map((u) => {
            const isSelf = me?.username === u.username;
            return (
              <div
                key={u.id}
                className="grid grid-cols-[minmax(0,1fr)_140px_110px_minmax(0,1fr)_150px] items-center border-b border-slate-700/60 px-3 py-2 last:border-b-0"
              >
                <p className="truncate text-xs font-medium text-slate-100">
                  {u.username}
                  {isSelf && <span className="ml-2 text-[10px] text-slate-500">{t("users.you")}</span>}
                </p>
                <span><RoleBadge isAdmin={u.is_platform_admin} /></span>
                <span><StatusBadge status={u.status} /></span>
                <span className="truncate text-xs text-slate-400">{new Date(u.created_at).toLocaleString(locale)}</span>
                <div className="flex gap-1">
                  <Button variant="ghost" onClick={() => openEdit(u)} className="px-2 py-1 text-xs">{t("common.edit")}</Button>
                  <Button
                    variant="danger"
                    onClick={() => setPendingDelete(u)}
                    disabled={isSelf}
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

      {/* Add User Modal */}
      <Modal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)}>
        <ModalHeader><ModalTitle>{t("users.add")}</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("users.username")}</label>
              <Input name="username" value={addUsername} onChange={setAddUsername} placeholder="e.g. alice" autoComplete="off" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("users.password")}</label>
              <Input
                name="password"
                type="password"
                value={addPassword}
                onChange={setAddPassword}
                placeholder={t("users.passwordPlaceholder")}
                autoComplete="new-password"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={addIsAdmin} onChange={(e) => setAddIsAdmin(e.target.checked)} className="h-4 w-4 rounded border-slate-600 bg-slate-800" />
              {t("users.platformAdmin")}
            </label>
            {!addIsAdmin && (
              <p className="text-[11px] text-slate-500">
                {t("users.nonAdminHelp")}
              </p>
            )}
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setIsAddOpen(false)} disabled={addSubmitting}>{t("common.cancel")}</Button>
          <Button onClick={handleAdd} disabled={addSubmitting}>{addSubmitting ? t("common.creating") : t("common.create")}</Button>
        </ModalFooter>
      </Modal>

      {/* Edit User Modal */}
      <Modal isOpen={!!editItem} onClose={() => setEditItem(null)}>
        <ModalHeader><ModalTitle>{t("users.edit", { name: editItem?.username ?? "" })}</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("users.resetPassword")}</label>
              <Input
                name="editPassword"
                type="password"
                value={editPassword}
                onChange={setEditPassword}
                placeholder={t("users.keepPassword")}
                autoComplete="new-password"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={editIsAdmin} onChange={(e) => setEditIsAdmin(e.target.checked)} className="h-4 w-4 rounded border-slate-600 bg-slate-800" />
              {t("users.platformAdmin")}
            </label>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("interactions.status")}</label>
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value as "active" | "disabled")}
                className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
              >
                <option value="active">{t("common.active")}</option>
                <option value="disabled">{t("common.disabled")}</option>
              </select>
              {editStatus === "disabled" && (
                <p className="mt-1 text-[11px] text-amber-400/80">{t("users.disableHelp")}</p>
              )}
            </div>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setEditItem(null)} disabled={editSubmitting}>{t("common.cancel")}</Button>
          <Button onClick={handleEdit} disabled={editSubmitting}>{editSubmitting ? t("common.saving") : t("common.save")}</Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleDelete}
        title={t("users.deleteTitle")}
        message={t("users.deleteMessage", { name: pendingDelete?.username ?? "" })}
        confirmLabel={t("common.delete")}
        variant="danger"
      />
    </div>
  );
}
