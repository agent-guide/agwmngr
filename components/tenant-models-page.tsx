"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCurrentUser } from "./current-user-context";
import { useI18n } from "./i18n-provider";
import { UsedByAgents } from "./used-by-agents";
import { usePlatformAgentAttribution } from "@/hooks/use-platform-agent-attribution";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ConfirmDialog } from "./ui/confirm-dialog";
import { Input } from "./ui/input";
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from "./ui/modal";
import { Select } from "./ui/select";
import { useToast } from "./ui/toast";
import { loadFailureFrom, type LoadFailure } from "@/lib/ui-load-error";
import {
  createTenantModelDefinition,
  deleteTenantModelDefinition,
  listTenantCatalogOfferings,
  listTenantModelDefinitions,
  updateTenantModelDefinition,
  type TenantCatalogOffering,
  type TenantModelDefinition,
} from "@/lib/platform-api";

export function TenantModelsPage() {
  const { platformAccess, platformAccessError } = useCurrentUser();
  const { t } = useI18n();
  const { showToast } = useToast();
  const tenants = useMemo(() => (platformAccess?.memberships ?? []).map((membership) => ({
    value: membership.tenantId,
    label: `${membership.tenant.name} · ${t(membership.role === "admin" ? "tenantMembers.admin" : "tenantMembers.user")}`,
  })), [platformAccess?.memberships, t]);
  const [chosenTenant, setChosenTenant] = useState("");
  const tenantId = tenants.some((tenant) => tenant.value === chosenTenant) ? chosenTenant : tenants[0]?.value ?? "";
  const attribution = usePlatformAgentAttribution(tenantId ? [tenantId] : []);
  const [definitions, setDefinitions] = useState<TenantModelDefinition[]>([]);
  const [offerings, setOfferings] = useState<TenantCatalogOffering[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [mutating, setMutating] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<TenantModelDefinition | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TenantModelDefinition | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [offeringId, setOfferingId] = useState("");
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (!tenantId) { setLoading(false); setDefinitions([]); setOfferings([]); return; }
    const current = ++generation.current;
    setLoading(true); setFailure(null);
    try {
      const [nextDefinitions, nextOfferings] = await Promise.all([
        listTenantModelDefinitions(tenantId), listTenantCatalogOfferings(tenantId, "model"),
      ]);
      if (current === generation.current) { setDefinitions(nextDefinitions); setOfferings(nextOfferings); }
    } catch (error) {
      if (current === generation.current) setFailure(loadFailureFrom(error, t("tenantModels.loadFailed")));
    } finally { if (current === generation.current) setLoading(false); }
  }, [t, tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => { window.clearTimeout(timer); generation.current += 1; };
  }, [load]);

  const openCreate = (offering?: TenantCatalogOffering) => {
    setEditing(null); setName(""); setDescription(""); setOfferingId(offering?.offeringId ?? offerings[0]?.offeringId ?? ""); setEditorOpen(true);
  };
  const openEdit = (item: TenantModelDefinition) => {
    setEditing(item); setName(item.name); setDescription(item.description); setOfferingId(item.offeringId); setEditorOpen(true);
  };
  const save = async () => {
    if (!name.trim() || !offeringId) return showToast(t("tenantModels.nameOfferingRequired"), "error");
    setMutating(true);
    try {
      const input = { name, description, offeringId };
      if (editing) await updateTenantModelDefinition(tenantId, editing.id, input);
      else await createTenantModelDefinition(tenantId, input);
      setEditorOpen(false); await load(); showToast(t(editing ? "tenantModels.versionCreated" : "tenantModels.created"), "success");
    } catch (error) { showToast(error instanceof Error ? error.message : t("tenantModels.saveFailed"), "error"); }
    finally { setMutating(false); }
  };
  const remove = async () => {
    if (!pendingDelete) return;
    setMutating(true);
    try { await deleteTenantModelDefinition(tenantId, pendingDelete.id); setPendingDelete(null); await load(); showToast(t("tenantModels.archived"), "success"); }
    catch (error) { showToast(error instanceof Error ? error.message : t("knowledge.archiveFailed"), "error"); }
    finally { setMutating(false); }
  };

  if (!platformAccess && platformAccessError) return <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-8 text-center text-sm text-rose-200">{platformAccessError}</div>;
  if (!tenants.length) return <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-8 text-center text-sm text-amber-200">{t("authored.membershipRequired")}</div>;

  return <div className="space-y-6">
    <section className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-slate-700/70 bg-slate-900/40 p-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t("tenantModels.scope")}</p><h1 className="mt-1 text-xl font-semibold text-slate-100">{t("nav.models")}</h1><p className="mt-1 text-sm text-slate-400">{t("tenantModels.description")}</p></div><div className="flex gap-2"><Select name="models-tenant" value={tenantId} onChange={setChosenTenant} options={tenants} disabled={mutating} /><Button onClick={() => openCreate()} disabled={loading || Boolean(failure) || mutating || offerings.length === 0}>{t("tenantModels.create")}</Button></div></section>
    {loading ? <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center text-xs text-slate-500">{t("common.loading")}</section> : failure ? <section role="alert" className={failure.kind === "forbidden" ? "rounded-lg border border-amber-500/30 bg-amber-500/10 p-8 text-center text-sm text-amber-200" : "rounded-lg border border-rose-500/30 bg-rose-500/10 p-8 text-center text-sm text-rose-200"}><p>{failure.message}</p><Button variant="ghost" className="mt-3" onClick={() => void load()}>{t("common.retry")}</Button></section> : <>
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40"><div className="border-b border-slate-700/70 px-4 py-3"><h2 className="text-sm font-semibold text-slate-200">{t("tenantModels.definitions")}</h2></div>{definitions.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">{t("tenantModels.empty")}</p> : definitions.map((item) => <div key={item.id} className="flex flex-wrap items-center gap-3 border-b border-slate-700/60 px-4 py-3 last:border-0"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-100">{item.name}</p><p className="font-mono text-[10px] text-slate-500">{item.id} · v{item.version} · {item.digest.slice(0, 12)}</p><p className="text-xs text-slate-500">offering {item.offeringId} · {item.offeringDigest.slice(0, 12)}</p></div><Badge tone="blue">{t("tenantModels.tenantOwned")}</Badge><Badge tone={item.availability === "available" ? "green" : "red"}>{t(item.availability === "available" ? "tenantModels.available" : "tenantModels.unavailable")}</Badge><UsedByAgents agentIds={attribution?.modelDefinition[item.id]} /><Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => openEdit(item)} disabled={mutating || item.status === "archived"}>{t("common.edit")}</Button><Button variant="danger" className="px-2 py-1 text-xs" onClick={() => setPendingDelete(item)} disabled={mutating || item.status === "archived"}>{t("authored.archive")}</Button></div>)}</section>
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40"><div className="border-b border-slate-700/70 px-4 py-3"><h2 className="text-sm font-semibold text-slate-200">{t("tenantModels.approvedOfferings")}</h2></div>{offerings.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">{t("tenantModels.noOfferings")}</p> : offerings.map((offering) => <div key={offering.offeringId} className="flex flex-wrap items-center gap-3 border-b border-slate-700/60 px-4 py-3 last:border-0"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-100">{offering.name}</p><p className="font-mono text-[10px] text-slate-500">{offering.offeringId} · v{offering.version} · {offering.digest.slice(0, 12)}</p></div><Badge tone="violet">{t("tenantModels.platformOwned")}</Badge><Badge tone={offering.kind === "gateway-backed" ? "cyan" : "neutral"}>{t(offering.kind === "gateway-backed" ? "tenantModels.gatewaySource" : "tenantModels.platformSource")}</Badge><UsedByAgents agentIds={[]} /><Button className="px-2 py-1 text-xs" onClick={() => openCreate(offering)} disabled={mutating}>{t("tenantModels.createDefinition")}</Button></div>)}</section>
    </>}
    <Modal isOpen={editorOpen} onClose={() => { if (!mutating) setEditorOpen(false); }}><ModalHeader><ModalTitle>{t(editing ? "tenantModels.newVersion" : "tenantModels.createDefinition")}</ModalTitle></ModalHeader><ModalContent><div className="space-y-4"><Input name="model-name" value={name} onChange={setName} placeholder={t("tenantModels.namePlaceholder")} disabled={mutating} /><Input name="model-description" value={description} onChange={setDescription} placeholder={t("common.description")} disabled={mutating} /><Select name="model-offering" value={offeringId} onChange={setOfferingId} options={offerings.map((offering) => ({ value: offering.offeringId, label: `${offering.name} · ${t(offering.kind === "gateway-backed" ? "catalog.gatewayBacked" : "catalog.platformNative")}` }))} disabled={mutating} className="w-full" /></div></ModalContent><ModalFooter><Button variant="ghost" onClick={() => setEditorOpen(false)} disabled={mutating}>{t("common.cancel")}</Button><Button onClick={() => void save()} disabled={mutating}>{mutating ? t("common.saving") : t("tenantModels.saveVersion")}</Button></ModalFooter></Modal>
    <ConfirmDialog isOpen={pendingDelete !== null} onClose={() => { if (!mutating) setPendingDelete(null); }} onConfirm={() => void remove()} title={t("tenantModels.archiveTitle")} message={t("tenantModels.archiveMessage")} confirmLabel={t("authored.archive")} variant="danger" />
  </div>;
}
