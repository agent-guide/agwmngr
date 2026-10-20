"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCurrentUser } from "./current-user-context";
import { useI18n } from "./i18n-provider";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ConfirmDialog } from "./ui/confirm-dialog";
import { Input } from "./ui/input";
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from "./ui/modal";
import { Select } from "./ui/select";
import { useToast } from "./ui/toast";
import { UsedByAgents } from "./used-by-agents";
import { usePlatformAgentAttribution } from "@/hooks/use-platform-agent-attribution";
import { loadFailureFrom, type LoadFailure } from "@/lib/ui-load-error";
import {
  completeKnowledgeDocument,
  createDocumentUploadSessions,
  createKnowledgeBase,
  deleteKnowledgeBase,
  deleteKnowledgeDocument,
  downloadKnowledgeDocument,
  listKnowledgeBases,
  listKnowledgeDocuments,
  updateKnowledgeBase,
  uploadKnowledgeDocument,
  type KnowledgeBase,
  type KnowledgeDocument,
} from "@/lib/platform-api";
import { maxDocumentBytes } from "@/packages/contracts/platform/knowledge";

export function KnowledgeBasesPage() {
  const { platformAccess, platformAccessError } = useCurrentUser();
  const { locale, t } = useI18n();
  const { showToast } = useToast();
  const tenantOptions = useMemo(() => (platformAccess?.memberships ?? []).map((membership) => ({
    value: membership.tenantId,
    label: `${membership.tenant.name} · ${t(membership.role === "admin" ? "tenantMembers.admin" : "tenantMembers.user")}`,
  })), [platformAccess?.memberships, t]);
  const [chosenTenant, setChosenTenant] = useState("");
  const tenantId = tenantOptions.some((option) => option.value === chosenTenant)
    ? chosenTenant
    : tenantOptions[0]?.value ?? "";
  const attribution = usePlatformAgentAttribution(tenantId ? [tenantId] : []);
  const [items, setItems] = useState<KnowledgeBase[]>([]);
  const [selected, setSelected] = useState<KnowledgeBase | null>(null);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [mutating, setMutating] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pendingKnowledgeDelete, setPendingKnowledgeDelete] = useState<KnowledgeBase | null>(null);
  const [pendingDocumentDelete, setPendingDocumentDelete] = useState<KnowledgeDocument | null>(null);
  const [uploadFailures, setUploadFailures] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (!tenantId) { setLoading(false); setItems([]); setSelected(null); return; }
    const current = ++generation.current;
    setLoading(true); setFailure(null); setSelected(null); setDocuments([]);
    try {
      const result = await listKnowledgeBases(tenantId);
      if (current === generation.current) setItems(result);
    } catch (error) {
      if (current === generation.current) setFailure(loadFailureFrom(error, t("knowledge.loadFailed")));
    } finally { if (current === generation.current) setLoading(false); }
  }, [t, tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => { window.clearTimeout(timer); generation.current += 1; };
  }, [load]);

  const inspect = async (knowledge: KnowledgeBase) => {
    setSelected(knowledge); setDocuments([]); setUploadFailures([]);
    setMutating(true);
    try { setDocuments(await listKnowledgeDocuments(tenantId, knowledge.id)); }
    catch (error) { showToast(error instanceof Error ? error.message : t("knowledge.documentsLoadFailed"), "error"); }
    finally { setMutating(false); }
  };

  const refreshSelected = async () => {
    if (!selected) return;
    const [nextItems, nextDocuments] = await Promise.all([
      listKnowledgeBases(tenantId),
      listKnowledgeDocuments(tenantId, selected.id),
    ]);
    setItems(nextItems);
    setSelected(nextItems.find((item) => item.id === selected.id) ?? null);
    setDocuments(nextDocuments);
  };

  const openCreate = () => { setSelected(null); setName(""); setDescription(""); setEditorOpen(true); };
  const openEdit = () => { if (selected) { setName(selected.name); setDescription(selected.description); setEditorOpen(true); } };
  const save = async () => {
    if (!name.trim()) return showToast(t("authored.nameRequired"), "error");
    setMutating(true);
    try {
      if (selected) await updateKnowledgeBase(tenantId, selected.id, { name, description });
      else await createKnowledgeBase(tenantId, { name, description });
      setEditorOpen(false); await load();
      showToast(t(selected ? "knowledge.updated" : "knowledge.created"), "success");
    } catch (error) { showToast(error instanceof Error ? error.message : t("knowledge.saveFailed"), "error"); }
    finally { setMutating(false); }
  };

  const upload = async (files: File[]) => {
    if (!selected || files.length === 0) return;
    setMutating(true); setUploadFailures([]);
    const requests = files.map((file) => ({
      requestKey: crypto.randomUUID().replaceAll("-", ""),
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    }));
    const byKey = new Map(requests.map((request, index) => [request.requestKey, files[index]]));
    const failures: string[] = [];
    try {
      const sessions = await createDocumentUploadSessions(tenantId, selected.id, requests);
      for (const session of sessions) {
        const file = byKey.get(session.requestKey);
        if (!session.ok || !file) {
          failures.push(`${file?.name ?? (session.requestKey || t("knowledge.unknownFile"))}: ${session.ok ? t("knowledge.mappingFailed") : session.error}`);
          continue;
        }
        try {
          await uploadKnowledgeDocument(session, file);
          await completeKnowledgeDocument(tenantId, selected.id, session.file.id);
        } catch (error) {
          failures.push(`${file.name}: ${error instanceof Error ? error.message : t("knowledge.uploadFailed")}`);
        }
      }
      await refreshSelected();
      setUploadFailures(failures);
      showToast(failures.length
        ? t("knowledge.uploadPartial", { uploaded: files.length - failures.length, failed: failures.length })
        : t("knowledge.uploaded", { count: files.length }), failures.length ? "error" : "success");
    } catch (error) {
      setUploadFailures([error instanceof Error ? error.message : t("knowledge.batchFailed")]);
    } finally { setMutating(false); }
  };

  const download = async (document: KnowledgeDocument) => {
    if (!selected) return;
    setMutating(true);
    try {
      const blob = await downloadKnowledgeDocument(tenantId, selected.id, document.id);
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url; link.download = document.name; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { showToast(error instanceof Error ? error.message : t("knowledge.downloadFailed"), "error"); }
    finally { setMutating(false); }
  };

  const removeDocument = async () => {
    if (!selected || !pendingDocumentDelete) return;
    setMutating(true);
    try { await deleteKnowledgeDocument(tenantId, selected.id, pendingDocumentDelete.id); setPendingDocumentDelete(null); await refreshSelected(); showToast(t("knowledge.documentDeleted"), "success"); }
    catch (error) { showToast(error instanceof Error ? error.message : t("knowledge.deleteFailed"), "error"); }
    finally { setMutating(false); }
  };

  const removeKnowledge = async () => {
    if (!pendingKnowledgeDelete) return;
    setMutating(true);
    try { await deleteKnowledgeBase(tenantId, pendingKnowledgeDelete.id); setPendingKnowledgeDelete(null); await load(); showToast(t("knowledge.archived"), "success"); }
    catch (error) { showToast(error instanceof Error ? error.message : t("knowledge.archiveFailed"), "error"); }
    finally { setMutating(false); }
  };

  if (!platformAccess && platformAccessError) return <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-8 text-center text-sm text-rose-200">{platformAccessError}</div>;
  if (!tenantOptions.length) return <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-8 text-center text-sm text-amber-200">{t("authored.membershipRequired")}</div>;

  return <div className="space-y-6">
    <section className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-slate-700/70 bg-slate-900/40 p-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t("knowledge.scope")}</p><h1 className="mt-1 text-xl font-semibold text-slate-100">{t("knowledge.title")}</h1><p className="mt-1 text-sm text-slate-400">{t("knowledge.description")}</p></div><div className="flex gap-2"><Select name="knowledge-tenant" value={tenantId} onChange={setChosenTenant} options={tenantOptions} disabled={mutating} /><Button onClick={openCreate} disabled={loading || Boolean(failure) || mutating}>{t("knowledge.create")}</Button></div></section>
    <div className="grid gap-5 lg:grid-cols-[minmax(280px,0.7fr)_minmax(0,1.3fr)]">
      <section className="overflow-hidden rounded-lg border border-slate-700/70 bg-slate-900/40">{loading ? <p className="p-8 text-center text-xs text-slate-500">{t("common.loading")}</p> : failure ? <div role="alert" className={failure.kind === "forbidden" ? "p-8 text-center text-xs text-amber-300" : "p-8 text-center text-xs text-rose-300"}><p>{failure.message}</p><Button variant="ghost" className="mt-3" onClick={() => void load()}>{t("common.retry")}</Button></div> : items.length === 0 ? <p className="p-8 text-center text-xs text-slate-500">{t("knowledge.empty")}</p> : items.map((item) => <button type="button" key={item.id} onClick={() => void inspect(item)} className="flex w-full items-center justify-between gap-3 border-b border-slate-700/60 px-4 py-3 text-left last:border-0 hover:bg-slate-800/40"><span className="min-w-0"><span className="block truncate text-sm font-medium text-slate-100">{item.name}</span><span className="text-xs text-slate-500">{t("knowledge.documentCount", { count: item.documentCount })}</span></span><Badge tone={item.status === "active" ? "green" : "neutral"}>{t(item.status === "active" ? "common.active" : "authored.archived")}</Badge></button>)}</section>
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">{!selected ? <p className="py-12 text-center text-sm text-slate-500">{t("knowledge.select")}</p> : <div className="space-y-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="text-lg font-semibold text-slate-100">{selected.name}</h2><UsedByAgents agentIds={attribution?.knowledgeBase[selected.id]} /></div><p className="text-sm text-slate-400">{selected.description || t("authored.noDescription")}</p></div><div className="flex gap-2"><Button variant="secondary" onClick={openEdit} disabled={mutating}>{t("common.edit")}</Button><Button variant="danger" onClick={() => setPendingKnowledgeDelete(selected)} disabled={mutating}>{t("authored.archive")}</Button></div></div><div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/20 bg-amber-500/5 p-3"><div className="flex gap-2"><Badge tone="amber">{t("knowledge.indexingUnavailable")}</Badge><Badge tone="amber">{t("knowledge.retrievalUnavailable")}</Badge></div><div><input ref={fileInput} type="file" multiple className="sr-only" accept=".pdf,.docx,.pptx,.xlsx,.md,.txt,.html,.csv,.json" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; const oversized = files.filter((file) => file.size > maxDocumentBytes); if (oversized.length) setUploadFailures(oversized.map((file) => `${file.name}: ${t("knowledge.exceedsLimit")}`)); const accepted = files.filter((file) => file.size <= maxDocumentBytes); if (accepted.length) void upload(accepted); }} /><Button onClick={() => fileInput.current?.click()} disabled={mutating}>{t("knowledge.upload")}</Button></div></div>{uploadFailures.length > 0 && <div role="alert" className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">{uploadFailures.map((failure) => <p key={failure}>{failure}</p>)}</div>}<div className="space-y-2">{documents.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">{t("knowledge.noDocuments")}</p> : documents.map((document) => <div key={document.id} className="flex flex-wrap items-center gap-3 rounded-md border border-slate-700/70 p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-100">{document.name}</p><p className="text-xs text-slate-500">{t("knowledge.size", { size: document.sizeBytes.toLocaleString(locale) })} · {document.mimeType}</p>{document.failureReason && <p className="text-xs text-rose-300">{document.failureReason}</p>}</div><Badge tone={document.status === "active" ? "green" : document.status === "failed" ? "red" : "amber"}>{t(document.status === "active" ? "common.active" : document.status === "failed" ? "knowledge.failed" : "knowledge.pending")}</Badge>{document.status === "active" && <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => void download(document)} disabled={mutating}>{t("knowledge.download")}</Button>}<Button variant="danger" className="px-2 py-1 text-xs" onClick={() => setPendingDocumentDelete(document)} disabled={mutating}>{t("common.delete")}</Button></div>)}</div></div>}</section>
    </div>
    <Modal isOpen={editorOpen} onClose={() => { if (!mutating) setEditorOpen(false); }}><ModalHeader><ModalTitle>{t(selected ? "knowledge.editTitle" : "knowledge.create")}</ModalTitle></ModalHeader><ModalContent><div className="space-y-4"><Input name="knowledge-name" value={name} onChange={setName} placeholder={t("knowledge.namePlaceholder")} disabled={mutating} /><Input name="knowledge-description" value={description} onChange={setDescription} placeholder={t("common.description")} disabled={mutating} /></div></ModalContent><ModalFooter><Button variant="ghost" onClick={() => setEditorOpen(false)} disabled={mutating}>{t("common.cancel")}</Button><Button onClick={() => void save()} disabled={mutating}>{mutating ? t("common.saving") : t("common.save")}</Button></ModalFooter></Modal>
    <ConfirmDialog isOpen={pendingKnowledgeDelete !== null} onClose={() => { if (!mutating) setPendingKnowledgeDelete(null); }} onConfirm={() => void removeKnowledge()} title={t("knowledge.archiveTitle")} message={t("knowledge.archiveMessage")} confirmLabel={t("authored.archive")} variant="danger" />
    <ConfirmDialog isOpen={pendingDocumentDelete !== null} onClose={() => { if (!mutating) setPendingDocumentDelete(null); }} onConfirm={() => void removeDocument()} title={t("knowledge.deleteDocumentTitle")} message={t("knowledge.deleteDocumentMessage")} confirmLabel={t("common.delete")} variant="danger" />
  </div>;
}
