"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCurrentUser } from "@/components/current-user-context";
import { useI18n } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { loadFailureFrom, type LoadFailure } from "@/lib/ui-load-error";
import {
  bootstrapPlatformTenantMember,
  createPlatformTenant,
  deletePlatformTenant,
  listPlatformPrincipals,
  listPlatformTenantMembers,
  listPlatformTenants,
  removePlatformTenantMember,
  setPlatformTenantStatus,
  updatePlatformTenantMember,
  type Principal,
  type Tenant,
  type TenantMember,
  type TenantRole,
} from "@/lib/platform-api";

export default function PlatformTenantsPage() {
  const { user } = useCurrentUser();
  const { locale, t } = useI18n();
  const { showToast } = useToast();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [principals, setPrincipals] = useState<Principal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<LoadFailure | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createId, setCreateId] = useState("");
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);
  const [manageTenant, setManageTenant] = useState<Tenant | null>(null);
  const [members, setMembers] = useState<TenantMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersMutating, setMembersMutating] = useState(false);
  const [membersFailure, setMembersFailure] = useState<LoadFailure | null>(null);
  const membersGeneration = useRef(0);
  const membersMutationInFlight = useRef(false);
  const [addPrincipalId, setAddPrincipalId] = useState("");
  const [addRole, setAddRole] = useState<TenantRole>("user");
  const [pendingDelete, setPendingDelete] = useState<Tenant | null>(null);
  const [pendingRemove, setPendingRemove] = useState<TenantMember | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailure(null);
    try {
      const [tenantItems, principalItems] = await Promise.all([
        listPlatformTenants(),
        listPlatformPrincipals(),
      ]);
      setTenants(tenantItems);
      setPrincipals(principalItems);
    } catch (error) {
      setLoadFailure(loadFailureFrom(error, t("platformTenants.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!user?.is_platform_admin) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, user?.is_platform_admin]);

  const openMembers = async (tenant: Tenant) => {
    if (membersMutationInFlight.current) return;
    const generation = ++membersGeneration.current;
    setManageTenant(tenant);
    setMembers([]);
    setMembersLoading(true);
    setMembersFailure(null);
    setPendingRemove(null);
    setAddPrincipalId("");
    setAddRole("user");
    try {
      const items = await listPlatformTenantMembers(tenant.id);
      if (generation !== membersGeneration.current) return;
      setMembers(items);
    } catch (error) {
      if (generation !== membersGeneration.current) return;
      setMembersFailure(loadFailureFrom(error, t("platformTenants.membersLoadFailed")));
    } finally {
      if (generation === membersGeneration.current) setMembersLoading(false);
    }
  };

  const closeMembers = () => {
    if (membersMutationInFlight.current) return;
    membersGeneration.current += 1;
    setManageTenant(null);
    setMembers([]);
    setMembersFailure(null);
    setMembersLoading(false);
    setMembersMutating(false);
    setPendingRemove(null);
  };

  const refreshMembersAfterMutation = async (
    tenantId: string,
    generation: number,
    successMessage: string,
  ) => {
    try {
      const items = await listPlatformTenantMembers(tenantId);
      if (generation !== membersGeneration.current) return;
      setMembers(items);
      showToast(successMessage, "success");
    } catch (error) {
      if (generation !== membersGeneration.current) return;
      setMembersFailure(loadFailureFrom(
        error,
        t("platformTenants.rosterRefreshFailed"),
      ));
      showToast(t("platformTenants.rosterReloadRequired"), "error");
    }
  };

  const eligiblePrincipals = useMemo(() => {
    const existing = new Set(members.map((member) => member.principalId));
    return principals.filter((principal) => principal.status === "active" && !existing.has(principal.id));
  }, [members, principals]);

  const handleCreate = async () => {
    if (!createId.trim() || !createName.trim()) {
      showToast(t("platformTenants.idNameRequired"), "error");
      return;
    }
    setCreating(true);
    try {
      const tenant = await createPlatformTenant(createId.trim(), createName.trim());
      setTenants((items) => [...items, tenant].sort((a, b) => a.id.localeCompare(b.id)));
      setCreateOpen(false);
      setCreateId("");
      setCreateName("");
      showToast(t("platformTenants.created"), "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("platformTenants.createFailed"), "error");
    } finally {
      setCreating(false);
    }
  };

  const toggleStatus = async (tenant: Tenant) => {
    const next = tenant.status === "active" ? "disabled" : "active";
    try {
      const updated = await setPlatformTenantStatus(tenant.id, next);
      setTenants((items) => items.map((item) => item.id === tenant.id ? updated : item));
      if (manageTenant?.id === tenant.id) setManageTenant(updated);
      showToast(t(next === "active" ? "platformTenants.enabled" : "platformTenants.disabled"), "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("platformTenants.updateFailed"), "error");
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    try {
      await deletePlatformTenant(id);
      setTenants((items) => items.filter((item) => item.id !== id));
      if (manageTenant?.id === id) closeMembers();
      showToast(t("platformTenants.deleted"), "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("platformTenants.deleteFailed"), "error");
    } finally {
      setPendingDelete(null);
    }
  };

  const addMember = async () => {
    if (
      !manageTenant ||
      !addPrincipalId ||
      manageTenant.status !== "active" ||
      membersMutationInFlight.current
    ) return;
    const tenantId = manageTenant.id;
    const generation = ++membersGeneration.current;
    membersMutationInFlight.current = true;
    setMembersMutating(true);
    try {
      await bootstrapPlatformTenantMember(tenantId, addPrincipalId, addRole);
      if (generation !== membersGeneration.current) return;
      setAddPrincipalId("");
      await refreshMembersAfterMutation(tenantId, generation, t("platformTenants.memberAssigned"));
    } catch (error) {
      if (generation !== membersGeneration.current) return;
      showToast(error instanceof Error ? error.message : t("platformTenants.memberAssignFailed"), "error");
    } finally {
      if (generation === membersGeneration.current) setMembersMutating(false);
      membersMutationInFlight.current = false;
    }
  };

  const changeRole = async (member: TenantMember, role: TenantRole) => {
    if (
      !manageTenant ||
      manageTenant.status !== "active" ||
      member.role === role ||
      membersMutationInFlight.current
    ) return;
    const tenantId = manageTenant.id;
    const generation = ++membersGeneration.current;
    membersMutationInFlight.current = true;
    setMembersMutating(true);
    try {
      await updatePlatformTenantMember(tenantId, member.principalId, role);
      if (generation !== membersGeneration.current) return;
      await refreshMembersAfterMutation(tenantId, generation, t("tenantMembers.roleUpdated"));
    } catch (error) {
      if (generation !== membersGeneration.current) return;
      showToast(error instanceof Error ? error.message : t("tenantMembers.roleUpdateFailed"), "error");
    } finally {
      if (generation === membersGeneration.current) setMembersMutating(false);
      membersMutationInFlight.current = false;
    }
  };

  const removeMember = async () => {
    if (!manageTenant || !pendingRemove || membersMutationInFlight.current) return;
    const tenantId = manageTenant.id;
    const generation = ++membersGeneration.current;
    const principalId = pendingRemove.principalId;
    membersMutationInFlight.current = true;
    setMembersMutating(true);
    setPendingRemove(null);
    try {
      await removePlatformTenantMember(tenantId, principalId);
      if (generation !== membersGeneration.current) return;
      await refreshMembersAfterMutation(tenantId, generation, t("tenantMembers.removed"));
    } catch (error) {
      if (generation !== membersGeneration.current) return;
      showToast(error instanceof Error ? error.message : t("tenantMembers.removeFailed"), "error");
    } finally {
      if (generation === membersGeneration.current) setMembersMutating(false);
      membersMutationInFlight.current = false;
    }
  };

  if (user && !user.is_platform_admin) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-8 text-center text-sm text-amber-200">
        {t("platformTenants.adminRequired")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t("platformTenants.scope")}</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-100">{t("platformTenants.title")}</h1>
            <p className="mt-1 text-sm text-slate-400">{t("platformTenants.description")}</p>
          </div>
          <Button
            onClick={() => setCreateOpen(true)}
            disabled={loading || loadFailure !== null}
            className="px-2.5 py-1 text-xs"
          >{t("platformTenants.create")}</Button>
        </div>
      </section>

      <section className="overflow-x-auto rounded-lg border border-slate-700/70 bg-slate-900/40">
        <div className="grid min-w-[760px] grid-cols-[minmax(0,1fr)_140px_190px_260px] border-b border-slate-700/70 bg-slate-900/95 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          <span>Tenant</span><span>{t("platformTenants.status")}</span><span>{t("common.updated")}</span><span>{t("common.actions")}</span>
        </div>
        {loading ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">{t("common.loading")}</div>
        ) : loadFailure ? (
          <div className={loadFailure.kind === "forbidden" ? "px-3 py-8 text-center text-xs text-amber-300" : "px-3 py-8 text-center text-xs text-rose-300"} role="alert">
            <p>{loadFailure.message}</p>
            <Button variant="ghost" onClick={() => void load()} className="mt-3 px-3 py-1 text-xs">{t("common.retry")}</Button>
          </div>
        ) : tenants.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">{t("platformTenants.empty")}</div>
        ) : tenants.map((tenant) => (
          <div key={tenant.id} className="grid min-w-[760px] grid-cols-[minmax(0,1fr)_140px_190px_260px] items-center border-b border-slate-700/60 px-3 py-2 last:border-b-0">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-slate-100">{tenant.name}</p>
              <p className="truncate font-mono text-[10px] text-slate-500">{tenant.id}</p>
            </div>
            <span><Badge tone={tenant.status === "active" ? "green" : "amber"}>{t(tenant.status === "active" ? "common.active" : "common.disabled")}</Badge></span>
            <span className="text-xs text-slate-400">{new Date(tenant.updatedAt).toLocaleString(locale)}</span>
            <div className="flex flex-wrap gap-1">
              <Button variant="ghost" onClick={() => void openMembers(tenant)} className="px-2 py-1 text-xs">{t("nav.members")}</Button>
              <Button variant="secondary" onClick={() => void toggleStatus(tenant)} className="px-2 py-1 text-xs">
                {t(tenant.status === "active" ? "platformTenants.disable" : "platformTenants.enable")}
              </Button>
              <Button variant="danger" onClick={() => setPendingDelete(tenant)} className="px-2 py-1 text-xs">{t("common.delete")}</Button>
            </div>
          </div>
        ))}
      </section>

      <Modal isOpen={createOpen} onClose={() => setCreateOpen(false)}>
        <ModalHeader><ModalTitle>{t("platformTenants.createTitle")}</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300" htmlFor="tenant-id">{t("platformTenants.id")}</label>
              <Input id="tenant-id" name="tenant-id" value={createId} onChange={setCreateId} placeholder="research" />
              <p className="mt-1 text-xs text-slate-500">{t("platformTenants.idHint")}</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300" htmlFor="tenant-name">{t("common.name")}</label>
              <Input id="tenant-name" name="tenant-name" value={createName} onChange={setCreateName} placeholder="Research" />
            </div>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setCreateOpen(false)}>{t("common.cancel")}</Button>
          <Button onClick={() => void handleCreate()} disabled={creating}>{creating ? t("common.creating") : t("common.create")}</Button>
        </ModalFooter>
      </Modal>

      <Modal
        isOpen={manageTenant !== null}
        onClose={() => { if (!membersMutationInFlight.current) closeMembers(); }}
        className="max-w-4xl"
      >
        <ModalHeader>
          <ModalTitle>{t("platformTenants.membershipsTitle", { name: manageTenant?.name ?? "" })}</ModalTitle>
          <p className="mt-1 font-mono text-xs text-slate-500">{manageTenant?.id}</p>
        </ModalHeader>
        <ModalContent>
          {manageTenant?.status === "disabled" && (
            <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              {t("platformTenants.disabledMemberships")}
            </div>
          )}
          <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px_auto]">
            <Select
              name="platform-member-principal"
              value={addPrincipalId}
              onChange={setAddPrincipalId}
              disabled={manageTenant?.status !== "active" || membersLoading || membersMutating || membersFailure !== null}
              options={[
                { value: "", label: t(eligiblePrincipals.length ? "platformTenants.selectPrincipal" : "platformTenants.noEligiblePrincipals") },
                ...eligiblePrincipals.map((principal) => ({ value: principal.id, label: `${principal.label} · ${t(principal.kind === "human" ? "tenantMembers.human" : "tenantMembers.service")}` })),
              ]}
              className="w-full"
            />
            <Select
              name="platform-member-role"
              value={addRole}
              onChange={(value) => setAddRole(value as TenantRole)}
              disabled={manageTenant?.status !== "active" || membersLoading || membersMutating || membersFailure !== null}
              options={[{ value: "user", label: t("tenantMembers.user") }, { value: "admin", label: t("tenantMembers.admin") }]}
              className="w-full"
            />
            <Button onClick={() => void addMember()} disabled={!addPrincipalId || manageTenant?.status !== "active" || membersLoading || membersMutating || membersFailure !== null}>
              {membersMutating ? t("common.saving") : t("platformTenants.assign")}
            </Button>
          </div>
          <div className="overflow-x-auto rounded-md border border-slate-700/70">
            {membersLoading ? (
              <div className="p-6 text-center text-xs text-slate-500">{t("common.loading")}</div>
            ) : membersFailure ? (
              <div className={membersFailure.kind === "forbidden" ? "p-6 text-center text-xs text-amber-300" : "p-6 text-center text-xs text-rose-300"} role="alert">
                <p>{membersFailure.message}</p>
                {manageTenant && <Button variant="ghost" onClick={() => void openMembers(manageTenant)} className="mt-3 px-3 py-1 text-xs">{t("common.retry")}</Button>}
              </div>
            ) : members.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">{t("platformTenants.noMemberships")}</div>
            ) : members.map((member) => (
              <div key={member.principalId} className="grid min-w-[620px] grid-cols-[minmax(0,1fr)_100px_160px_90px] items-center border-b border-slate-700/60 px-3 py-2 last:border-b-0">
                <div className="min-w-0">
                  <p className="truncate text-xs text-slate-100">{member.principal.label}</p>
                  <p className="truncate font-mono text-[10px] text-slate-500">{member.principalId}</p>
                </div>
                <Badge tone={member.principal.status === "active" ? "green" : "amber"}>{t(member.principal.status === "active" ? "common.active" : "common.disabled")}</Badge>
                <Select
                  name={`platform-role-${member.principalId}`}
                  value={member.role}
                  onChange={(value) => void changeRole(member, value as TenantRole)}
                  disabled={manageTenant?.status !== "active" || member.principal.status !== "active" || membersMutating}
                  options={[{ value: "admin", label: t("tenantMembers.admin") }, { value: "user", label: t("tenantMembers.user") }]}
                />
                <Button variant="danger" onClick={() => setPendingRemove(member)} disabled={membersMutating} className="px-2 py-1 text-xs">{t("common.remove")}</Button>
              </div>
            ))}
          </div>
        </ModalContent>
        <ModalFooter><Button variant="ghost" onClick={closeMembers} disabled={membersMutating}>{t("common.close")}</Button></ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void handleDelete()}
        title={t("platformTenants.deleteTitle")}
        message={pendingDelete ? t("platformTenants.deleteMessage", { name: pendingDelete.name }) : ""}
        confirmLabel={t("common.delete")}
        variant="danger"
      />
      <ConfirmDialog
        isOpen={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        onConfirm={() => void removeMember()}
        title={t("platformTenants.removeTitle")}
        message={pendingRemove ? t("tenantMembers.removeMessage", { principal: pendingRemove.principal.label, tenant: manageTenant?.name ?? "" }) : ""}
        confirmLabel={t("common.remove")}
        variant="danger"
      />
    </div>
  );
}
