"use client";

import { useCallback, useEffect, useState } from "react";
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
  createServiceAccount,
  listPlatformPrincipals,
  revokeServiceAccount,
  type Principal,
  type ServicePrincipalCreation,
} from "@/lib/platform-api";

export default function ServiceAccountsPage() {
  const { user } = useCurrentUser();
  const { locale, t } = useI18n();
  const { showToast } = useToast();
  const [accounts, setAccounts] = useState<Principal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<LoadFailure | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [expiryDays, setExpiryDays] = useState("90");
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<ServicePrincipalCreation | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<Principal | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailure(null);
    try {
      setAccounts((await listPlatformPrincipals()).filter((principal) => principal.kind === "service"));
    } catch (error) {
      setLoadFailure(loadFailureFrom(error, t("serviceAccounts.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!user?.is_platform_admin) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, user?.is_platform_admin]);

  const create = async () => {
    if (!name.trim()) {
      showToast(t("serviceAccounts.nameRequired"), "error");
      return;
    }
    setCreating(true);
    try {
      const expiresAt = new Date(Date.now() + Number(expiryDays) * 86_400_000).toISOString();
      const result = await createServiceAccount(name.trim(), expiresAt);
      setIssued(result);
      setAccounts((items) => [...items, result.principal].sort((a, b) => a.id.localeCompare(b.id)));
      setCreateOpen(false);
      setName("");
      showToast(t("serviceAccounts.created"), "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("serviceAccounts.createFailed"), "error");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async () => {
    if (!pendingRevoke) return;
    const id = pendingRevoke.id;
    try {
      await revokeServiceAccount(id);
      setAccounts((items) => items.map((item) =>
        item.id === id ? { ...item, status: "disabled" } : item
      ));
      showToast(t("serviceAccounts.revoked"), "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("serviceAccounts.revokeFailed"), "error");
    } finally {
      setPendingRevoke(null);
    }
  };

  const copyCredential = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.token);
      showToast(t("serviceAccounts.copied"), "success");
    } catch {
      showToast(t("serviceAccounts.copyFailed"), "error");
    }
  };

  if (user && !user.is_platform_admin) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-8 text-center text-sm text-amber-200">
        {t("serviceAccounts.adminRequired")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t("serviceAccounts.scope")}</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-100">{t("serviceAccounts.title")}</h1>
            <p className="mt-1 text-sm text-slate-400">{t("serviceAccounts.description")}</p>
          </div>
          <Button
            onClick={() => setCreateOpen(true)}
            disabled={loading || loadFailure !== null}
            className="px-2.5 py-1 text-xs"
          >{t("serviceAccounts.create")}</Button>
        </div>
      </section>

      <section className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-xs text-blue-200" role="note">
        {t("serviceAccounts.oneTimeNotice")}
      </section>

      <section className="overflow-x-auto rounded-lg border border-slate-700/70 bg-slate-900/40">
        <div className="grid min-w-[620px] grid-cols-[minmax(0,1fr)_130px_150px] border-b border-slate-700/70 bg-slate-900/95 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          <span>{t("serviceAccounts.principal")}</span><span>{t("serviceAccounts.status")}</span><span>{t("common.actions")}</span>
        </div>
        {loading ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">{t("common.loading")}</div>
        ) : loadFailure ? (
          <div className={loadFailure.kind === "forbidden" ? "px-3 py-8 text-center text-xs text-amber-300" : "px-3 py-8 text-center text-xs text-rose-300"} role="alert">
            <p>{loadFailure.message}</p>
            <Button variant="ghost" onClick={() => void load()} className="mt-3 px-3 py-1 text-xs">{t("common.retry")}</Button>
          </div>
        ) : accounts.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">{t("serviceAccounts.empty")}</div>
        ) : accounts.map((account) => (
          <div key={account.id} className="grid min-w-[620px] grid-cols-[minmax(0,1fr)_130px_150px] items-center border-b border-slate-700/60 px-3 py-2 last:border-b-0">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-slate-100">{account.label}</p>
              <p className="truncate font-mono text-[10px] text-slate-500">{account.id}</p>
            </div>
            <span><Badge tone={account.status === "active" ? "green" : "amber"}>{t(account.status === "active" ? "common.active" : "common.disabled")}</Badge></span>
            <Button
              variant="danger"
              onClick={() => setPendingRevoke(account)}
              disabled={account.status !== "active"}
              className="w-fit px-2 py-1 text-xs"
            >
              {t("serviceAccounts.revoke")}
            </Button>
          </div>
        ))}
      </section>

      <Modal isOpen={createOpen} onClose={() => setCreateOpen(false)}>
        <ModalHeader><ModalTitle>{t("serviceAccounts.createTitle")}</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300" htmlFor="service-name">{t("common.name")}</label>
              <Input id="service-name" name="service-name" value={name} onChange={setName} placeholder="deployment-bot" />
              <p className="mt-1 text-xs text-slate-500">{t("serviceAccounts.nameHint", { id: `service:${name || "deployment-bot"}` })}</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300" htmlFor="service-expiry">{t("serviceAccounts.lifetime")}</label>
              <Select
                name="service-expiry"
                value={expiryDays}
                onChange={setExpiryDays}
                options={[30, 90, 365].map((days) => ({ value: String(days), label: t("serviceAccounts.days", { count: days }) }))}
                className="w-full"
              />
            </div>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setCreateOpen(false)}>{t("common.cancel")}</Button>
          <Button onClick={() => void create()} disabled={creating}>{creating ? t("common.creating") : t("common.create")}</Button>
        </ModalFooter>
      </Modal>

      <Modal isOpen={issued !== null} onClose={() => setIssued(null)}>
        <ModalHeader><ModalTitle>{t("serviceAccounts.saveTitle")}</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            {t("serviceAccounts.saveWarning")}
          </div>
          <label className="mt-4 block text-xs font-medium text-slate-400" htmlFor="issued-service-token">{t("serviceAccounts.credential")}</label>
          <textarea
            id="issued-service-token"
            readOnly
            value={issued?.token ?? ""}
            rows={3}
            className="mt-1 w-full resize-none rounded-md border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200"
          />
          <p className="mt-2 text-xs text-slate-500">{t("serviceAccounts.expires", { time: issued ? new Date(issued.expiresAt).toLocaleString(locale) : "" })}</p>
        </ModalContent>
        <ModalFooter>
          <Button variant="secondary" onClick={() => void copyCredential()}>{t("serviceAccounts.copy")}</Button>
          <Button onClick={() => setIssued(null)}>{t("serviceAccounts.saved")}</Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={pendingRevoke !== null}
        onClose={() => setPendingRevoke(null)}
        onConfirm={() => void revoke()}
        title={t("serviceAccounts.revokeTitle")}
        message={pendingRevoke ? t("serviceAccounts.revokeMessage", { name: pendingRevoke.label }) : ""}
        confirmLabel={t("serviceAccounts.revoke")}
        variant="danger"
      />
    </div>
  );
}
