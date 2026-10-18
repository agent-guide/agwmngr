"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  addTenantMember,
  listTenantMembers,
  removeTenantMember,
  resolveTenantMember,
  updateTenantMember,
  type MembershipAddResolution,
  type TenantMember,
  type TenantRole,
} from "@/lib/platform-api";
import { useCurrentUser } from "@/components/current-user-context";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { loadFailureFrom, type LoadFailure } from "@/lib/ui-load-error";
import { useI18n } from "@/components/i18n-provider";

function statusClasses(status: "active" | "disabled"): string {
  return status === "active"
    ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
    : "bg-amber-500/15 text-amber-300 ring-amber-500/30";
}

export default function TenantMembersPage() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId;
  return <TenantMembersScope key={tenantId} tenantId={tenantId} />;
}

function TenantMembersScope({ tenantId }: { tenantId: string }) {
  const { locale, t } = useI18n();
  const {
    platformAccess,
    platformAccessError,
    loading: accessLoading,
    refresh,
  } = useCurrentUser();
  const { showToast } = useToast();
  const membership = platformAccess?.memberships.find(
    (item) => item.tenantId === tenantId && item.role === "admin",
  );
  const authorized = Boolean(membership);
  const [members, setMembers] = useState<TenantMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadFailure, setLoadFailure] = useState<LoadFailure | null>(null);
  const loadGeneration = useRef(0);
  const mutationInFlight = useRef(false);
  const [mutating, setMutating] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [kind, setKind] = useState<"human" | "service">("human");
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState<TenantRole>("user");
  const [resolution, setResolution] = useState<MembershipAddResolution | null>(null);
  const [resolving, setResolving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<TenantMember | null>(null);

  const load = useCallback(async () => {
    if (!authorized) return;
    const generation = ++loadGeneration.current;
    setLoading(true);
    setLoadFailure(null);
    try {
      const items = await listTenantMembers(tenantId);
      if (generation !== loadGeneration.current) return;
      setMembers(items);
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      setLoadFailure(loadFailureFrom(error, t("tenantMembers.loadFailed")));
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [authorized, tenantId, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      loadGeneration.current += 1;
    };
  }, [load]);

  const closeAdd = () => {
    setAddOpen(false);
    setIdentifier("");
    setRole("user");
    setResolution(null);
  };

  const handleResolve = async () => {
    const value = identifier.trim();
    if (!value) {
      showToast(kind === "human" ? t("tenantMembers.usernameRequired") : t("tenantMembers.serviceIdRequired"), "error");
      return;
    }
    setResolving(true);
    try {
      setResolution(await resolveTenantMember(
        tenantId,
        kind === "human"
          ? { kind, username: value }
          : { kind, principalId: value },
      ));
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("tenantMembers.resolveFailed"), "error");
    } finally {
      setResolving(false);
    }
  };

  const handleAdd = async () => {
    if (!resolution || mutationInFlight.current) return;
    mutationInFlight.current = true;
    loadGeneration.current += 1;
    setMutating(true);
    setAdding(true);
    try {
      await addTenantMember(tenantId, resolution.receipt, role);
      showToast(t("tenantMembers.added"), "success");
      closeAdd();
      await load();
    } catch (error) {
      setResolution(null);
      showToast(error instanceof Error ? error.message : t("tenantMembers.addFailed"), "error");
    } finally {
      setAdding(false);
      setMutating(false);
      mutationInFlight.current = false;
    }
  };

  const changeRole = async (member: TenantMember, nextRole: TenantRole) => {
    if (member.role === nextRole || mutationInFlight.current) return;
    mutationInFlight.current = true;
    loadGeneration.current += 1;
    setMutating(true);
    try {
      const updated = await updateTenantMember(tenantId, member.principalId, nextRole);
      setMembers((items) => items.map((item) =>
        item.principalId === updated.principalId ? { ...item, ...updated } : item
      ));
      showToast(t("tenantMembers.roleUpdated"), "success");
      await refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("tenantMembers.roleUpdateFailed"), "error");
    } finally {
      setMutating(false);
      mutationInFlight.current = false;
    }
  };

  const confirmRemove = async () => {
    if (!pendingRemove || mutationInFlight.current) return;
    const principalId = pendingRemove.principalId;
    mutationInFlight.current = true;
    loadGeneration.current += 1;
    setMutating(true);
    setPendingRemove(null);
    try {
      await removeTenantMember(tenantId, principalId);
      setMembers((items) => items.filter((item) => item.principalId !== principalId));
      showToast(t("tenantMembers.removed"), "success");
      await refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("tenantMembers.removeFailed"), "error");
    } finally {
      setMutating(false);
      mutationInFlight.current = false;
    }
  };

  if (accessLoading) {
    return <div className="p-8 text-center text-sm text-slate-400">{t("tenantMembers.loadingAccess")}</div>;
  }
  if (platformAccessError) {
    return (
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-8 text-center" role="alert">
        <h1 className="text-base font-semibold text-rose-200">{t("tenantMembers.accessLoadFailed")}</h1>
        <p className="mt-2 text-sm text-slate-400">{platformAccessError}</p>
        <Button onClick={() => void refresh()} variant="ghost" className="mt-4 px-3 py-1.5 text-xs">
          {t("common.retry")}
        </Button>
      </div>
    );
  }
  if (!authorized) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-8 text-center">
        <h1 className="text-base font-semibold text-amber-200">{t("tenantMembers.adminRequired")}</h1>
        <p className="mt-2 text-sm text-slate-400">
          {t("tenantMembers.adminRequiredBody")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              {t("tenantMembers.scope")} · <span className="font-mono normal-case">{tenantId}</span>
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-100">{t("tenantMembers.title", { name: membership!.tenant.name })}</h1>
            <p className="mt-1 text-sm text-slate-400">
              {t("tenantMembers.description")}
            </p>
          </div>
          <Button
            onClick={() => setAddOpen(true)}
            disabled={loading || mutating || loadFailure !== null}
            className="px-2.5 py-1 text-xs"
          >{t("tenantMembers.add")}</Button>
        </div>
      </section>

      <section className="overflow-x-auto rounded-lg border border-slate-700/70 bg-slate-900/40">
        <div className="grid min-w-[720px] grid-cols-[minmax(0,1.4fr)_110px_110px_150px] border-b border-slate-700/70 bg-slate-900/95 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          <span>{t("tenantMembers.principal")}</span><span>{t("tenantMembers.kind")}</span><span>{t("tenantMembers.status")}</span><span>{t("tenantMembers.roleActions")}</span>
        </div>
        {loading ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">{t("common.loading")}</div>
        ) : loadFailure ? (
          <div className={loadFailure.kind === "forbidden" ? "px-3 py-8 text-center text-xs text-amber-300" : "px-3 py-8 text-center text-xs text-rose-300"} role="alert">
            <p>{loadFailure.message}</p>
            <Button variant="ghost" onClick={() => void load()} className="mt-3 px-3 py-1 text-xs">{t("common.retry")}</Button>
          </div>
        ) : members.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">{t("tenantMembers.empty")}</div>
        ) : members.map((member) => (
          <div
            key={member.principalId}
            className="grid min-w-[720px] grid-cols-[minmax(0,1.4fr)_110px_110px_150px] items-center border-b border-slate-700/60 px-3 py-2 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-slate-100">{member.principal.label}</p>
              <p className="truncate font-mono text-[10px] text-slate-500">{member.principalId}</p>
            </div>
            <span className="text-xs text-slate-400">{t(member.principal.kind === "human" ? "tenantMembers.human" : "tenantMembers.service")}</span>
            <span>
              <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${statusClasses(member.principal.status)}`}>
                {t(member.principal.status === "active" ? "tenantMembers.active" : "tenantMembers.disabled")}
              </span>
            </span>
            <div className="flex items-center gap-1.5">
              <Select
                name={`role-${member.principalId}`}
                value={member.role}
                onChange={(value) => void changeRole(member, value as TenantRole)}
                disabled={mutating}
                options={[{ value: "admin", label: t("tenantMembers.admin") }, { value: "user", label: t("tenantMembers.user") }]}
                className="min-w-0 flex-1"
              />
              <Button variant="danger" onClick={() => setPendingRemove(member)} disabled={mutating} className="px-2 py-1 text-xs">{t("common.remove")}</Button>
            </div>
          </div>
        ))}
      </section>

      <Modal isOpen={addOpen} onClose={closeAdd}>
        <ModalHeader><ModalTitle>{t("tenantMembers.addTitle")}</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300" htmlFor="principal-kind">{t("tenantMembers.principalKind")}</label>
              <Select
                name="principal-kind"
                value={kind}
                onChange={(value) => { setKind(value as "human" | "service"); setIdentifier(""); setResolution(null); }}
                options={[{ value: "human", label: t("tenantMembers.human") }, { value: "service", label: t("tenantMembers.service") }]}
                className="w-full"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300" htmlFor="principal-identifier">
                {kind === "human" ? t("tenantMembers.exactUsername") : t("tenantMembers.exactServiceId")}
              </label>
              <Input
                id="principal-identifier"
                name="principal-identifier"
                value={identifier}
                onChange={(value) => { setIdentifier(value); setResolution(null); }}
                placeholder={kind === "human" ? "alice" : "service:deployment-bot"}
                autoComplete="off"
              />
              <p className="mt-1 text-xs text-slate-500">{t("tenantMembers.noSearch")}</p>
            </div>
            {!resolution ? (
              <Button onClick={() => void handleResolve()} disabled={resolving}>
                {resolving ? t("tenantMembers.resolving") : t("tenantMembers.resolveExact")}
              </Button>
            ) : (
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
                <p className="text-sm font-medium text-slate-100">{resolution.label}</p>
                <p className="mt-1 text-xs text-slate-400">{t(resolution.kind === "human" ? "tenantMembers.human" : "tenantMembers.service")} · {t(resolution.status === "active" ? "tenantMembers.active" : "tenantMembers.disabled")}</p>
                <p className="mt-1 text-[10px] text-slate-500">{t("tenantMembers.confirmExpires", { time: new Date(resolution.expiresAt).toLocaleTimeString(locale) })}</p>
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300" htmlFor="new-member-role">{t("tenantMembers.role")}</label>
              <Select
                name="new-member-role"
                value={role}
                onChange={(value) => setRole(value as TenantRole)}
                options={[{ value: "user", label: t("tenantMembers.user") }, { value: "admin", label: t("tenantMembers.admin") }]}
                className="w-full"
              />
            </div>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={closeAdd}>{t("common.cancel")}</Button>
          <Button onClick={() => void handleAdd()} disabled={!resolution || adding}>
            {adding ? t("common.adding") : t("tenantMembers.confirmAdd")}
          </Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        onConfirm={() => void confirmRemove()}
        title={t("tenantMembers.removeTitle")}
        message={pendingRemove ? t("tenantMembers.removeMessage", { principal: pendingRemove.principal.label, tenant: membership!.tenant.name }) : ""}
        confirmLabel={t("common.remove")}
        variant="danger"
      />
    </div>
  );
}
