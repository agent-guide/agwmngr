"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCurrentUser } from "./current-user-context";
import { useI18n } from "./i18n-provider";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ConfirmDialog } from "./ui/confirm-dialog";
import { Select } from "./ui/select";
import { useToast } from "./ui/toast";
import { loadFailureFrom, type LoadFailure } from "@/lib/ui-load-error";
import {
  completePersonalFile,
  createPersonalFileUploadSession,
  deletePersonalFile,
  listPersonalFiles,
  readPersonalFile,
  uploadPersonalFile,
  type PersonalFile,
  type PersonalFileUploadRequest,
} from "@/lib/platform-api";
import { maxPersonalFileBytes } from "@/packages/contracts/platform/personal-files";

interface RetryUpload {
  file: File;
  input: PersonalFileUploadRequest;
  error: string;
}

export function PersonalFilesPage() {
  const { platformAccess, platformAccessError } = useCurrentUser();
  const { locale, t } = useI18n();
  const { showToast } = useToast();
  const tenants = useMemo(() => (platformAccess?.memberships ?? []).map((membership) => ({
    value: membership.tenantId,
    label: `${membership.tenant.name} · ${t("personalFiles.privateToYou")}`,
  })), [platformAccess?.memberships, t]);
  const [selectedTenant, setSelectedTenant] = useState("");
  const tenantId = tenants.some((tenant) => tenant.value === selectedTenant)
    ? selectedTenant
    : tenants[0]?.value ?? "";
  const [items, setItems] = useState<PersonalFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [mutating, setMutating] = useState(false);
  const [retries, setRetries] = useState<RetryUpload[]>([]);
  const [pendingDelete, setPendingDelete] = useState<PersonalFile | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (!tenantId) { setLoading(false); setItems([]); return; }
    const current = ++generation.current;
    setLoading(true); setFailure(null);
    try {
      const result = await listPersonalFiles(tenantId);
      if (current === generation.current) setItems(result);
    } catch (error) {
      if (current === generation.current) setFailure(loadFailureFrom(error, t("personalFiles.loadFailed")));
    } finally { if (current === generation.current) setLoading(false); }
  }, [t, tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => { window.clearTimeout(timer); generation.current += 1; };
  }, [load]);

  const uploadOne = async (retry: RetryUpload) => {
    const session = await createPersonalFileUploadSession(tenantId, retry.input);
    await uploadPersonalFile(session, retry.file);
    await completePersonalFile(tenantId, session.file.id);
  };

  const upload = async (selected: File[]) => {
    if (!selected.length) return;
    setMutating(true);
    const failed: RetryUpload[] = [];
    let completed = 0;
    for (const file of selected) {
      const retry: RetryUpload = {
        file,
        input: {
          requestKey: crypto.randomUUID().replaceAll("-", ""),
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        },
        error: "",
      };
      if (file.size <= 0 || file.size > maxPersonalFileBytes) {
        failed.push({ ...retry, error: t("personalFiles.sizeInvalid") });
        continue;
      }
      try { await uploadOne(retry); completed += 1; }
      catch (error) { failed.push({ ...retry, error: error instanceof Error ? error.message : t("personalFiles.uploadFailed") }); }
    }
    setRetries(failed); await load(); setMutating(false);
    showToast(failed.length
      ? t("knowledge.uploadPartial", { uploaded: completed, failed: failed.length })
      : t("personalFiles.uploaded", { count: completed }), failed.length ? "error" : "success");
  };

  const retry = async (item: RetryUpload) => {
    setMutating(true);
    try {
      await uploadOne(item);
      setRetries((current) => current.filter((candidate) => candidate !== item));
      await load(); showToast(t("personalFiles.uploadRecovered"), "success");
    } catch (error) {
      setRetries((current) => current.map((candidate) => candidate === item
        ? { ...candidate, error: error instanceof Error ? error.message : t("personalFiles.uploadFailed") }
        : candidate));
    } finally { setMutating(false); }
  };

  const read = async (item: PersonalFile, operation: "preview" | "download") => {
    setMutating(true);
    try {
      const blob = await readPersonalFile(tenantId, item.id, operation);
      const url = URL.createObjectURL(blob);
      if (operation === "preview") window.open(url, "_blank", "noopener,noreferrer");
      else {
        const link = window.document.createElement("a");
        link.href = url; link.download = item.name; link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) { showToast(error instanceof Error ? error.message : t(operation === "preview" ? "personalFiles.previewFailed" : "knowledge.downloadFailed"), "error"); }
    finally { setMutating(false); }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setMutating(true);
    try { await deletePersonalFile(tenantId, pendingDelete.id); setPendingDelete(null); await load(); showToast(t("personalFiles.deleted"), "success"); }
    catch (error) { showToast(error instanceof Error ? error.message : t("knowledge.deleteFailed"), "error"); }
    finally { setMutating(false); }
  };

  if (!platformAccess && platformAccessError) return <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-8 text-center text-sm text-rose-200">{platformAccessError}</div>;
  if (!tenants.length) return <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-8 text-center text-sm text-amber-200">{t("personalFiles.membershipRequired")}</div>;

  return <div className="space-y-6">
    <section className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-slate-700/70 bg-slate-900/40 p-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t("personalFiles.scope")}</p><h1 className="mt-1 text-xl font-semibold text-slate-100">{t("nav.myFiles")}</h1><p className="mt-1 max-w-2xl text-sm text-slate-400">{t("personalFiles.description")}</p></div><div className="flex gap-2"><Select name="files-tenant" value={tenantId} onChange={setSelectedTenant} options={tenants} disabled={mutating} /><input ref={fileInput} type="file" multiple className="sr-only" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void upload(files); }} /><Button onClick={() => fileInput.current?.click()} disabled={loading || Boolean(failure) || mutating}>{t("personalFiles.upload")}</Button></div></section>
    {retries.length > 0 && <section role="alert" className="space-y-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-4">{retries.map((item) => <div key={item.input.requestKey} className="flex flex-wrap items-center justify-between gap-3 text-sm text-rose-200"><span>{item.file.name}: {item.error}</span><Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => void retry(item)} disabled={mutating}>{t("personalFiles.retryUpload")}</Button></div>)}</section>}
    <section className="overflow-hidden rounded-lg border border-slate-700/70 bg-slate-900/40">{loading ? <p className="p-8 text-center text-xs text-slate-500">{t("common.loading")}</p> : failure ? <div role="alert" className={failure.kind === "forbidden" ? "p-8 text-center text-xs text-amber-300" : "p-8 text-center text-xs text-rose-300"}><p>{failure.message}</p><Button variant="ghost" className="mt-3" onClick={() => void load()}>{t("common.retry")}</Button></div> : items.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">{t("personalFiles.empty")}</p> : items.map((item) => <div key={item.id} className="flex flex-wrap items-center gap-3 border-b border-slate-700/60 px-4 py-3 last:border-0"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-100">{item.name}</p><p className="text-xs text-slate-500">{t("knowledge.size", { size: item.sizeBytes.toLocaleString(locale) })} · {item.mimeType}</p>{item.failureReason && <p className="text-xs text-rose-300">{item.failureReason}</p>}</div><Badge tone={item.status === "active" ? "green" : item.status === "failed" ? "red" : "amber"}>{t(item.status === "active" ? "common.active" : item.status === "failed" ? "knowledge.failed" : "knowledge.pending")}</Badge>{item.status === "active" && item.previewAvailable && <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => void read(item, "preview")} disabled={mutating}>{t("personalFiles.preview")}</Button>}{item.status === "active" && <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => void read(item, "download")} disabled={mutating}>{t("knowledge.download")}</Button>}<Button variant="danger" className="px-2 py-1 text-xs" onClick={() => setPendingDelete(item)} disabled={mutating}>{t("common.delete")}</Button></div>)}</section>
    <ConfirmDialog isOpen={pendingDelete !== null} onClose={() => { if (!mutating) setPendingDelete(null); }} onConfirm={() => void remove()} title={t("personalFiles.deleteTitle")} message={t("personalFiles.deleteMessage")} confirmLabel={t("common.delete")} variant="danger" />
  </div>;
}
