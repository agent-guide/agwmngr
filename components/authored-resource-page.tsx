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
import { UsedByAgents } from "@/components/used-by-agents";
import { usePlatformAgentAttribution } from "@/hooks/use-platform-agent-attribution";
import { loadFailureFrom, type LoadFailure } from "@/lib/ui-load-error";
import {
  contentFromAuthoredResourceEditor,
  initialAuthoredResourceContent,
  textFromAuthoredResourceContent,
} from "@/lib/authored-resource-editor";
import {
  addAuthoredResourceRevision,
  createAuthoredResource,
  deleteAuthoredResource,
  getAuthoredResource,
  listAuthoredResources,
  setAuthoredRevisionStatus,
  updateAuthoredResource,
  type AuthoredResource,
  type AuthoredResourceContent,
  type AuthoredResourceDetail,
  type AuthoredResourceKind,
} from "@/lib/platform-api";

type Scope = { tenantId: string } | { platform: true };

export function AuthoredResourcePage({ kind }: { kind: AuthoredResourceKind }) {
  const { user, platformAccess, platformAccessError } = useCurrentUser();
  const { t } = useI18n();
  const { showToast } = useToast();
  const singular = t(kind === "skill" ? "authored.skill" : "authored.instruction");
  const plural = t(kind === "skill" ? "authored.skills" : "authored.instructions");
  const scopeOptions = useMemo(() => [
    ...(platformAccess?.memberships ?? []).map((membership) => ({
      value: membership.tenantId,
      label: `${membership.tenant.name} · ${t(membership.role === "admin" ? "tenantMembers.admin" : "tenantMembers.user")}`,
    })),
    ...(user?.is_platform_admin ? [{ value: "__platform__", label: t("authored.platformCatalog") }] : []),
  ], [platformAccess?.memberships, t, user?.is_platform_admin]);
  const [selectedScope, setSelectedScope] = useState("");
  const [items, setItems] = useState<AuthoredResource[]>([]);
  const [selected, setSelected] = useState<AuthoredResourceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [mutating, setMutating] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AuthoredResource | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [revisionSource, setRevisionSource] = useState<AuthoredResourceContent | null>(null);
  const generation = useRef(0);

  const effectiveScope = scopeOptions.some((option) => option.value === selectedScope)
    ? selectedScope
    : scopeOptions[0]?.value ?? "";

  const scope: Scope | null = !effectiveScope
    ? null
    : effectiveScope === "__platform__"
      ? { platform: true }
      : { tenantId: effectiveScope };
  const attribution = usePlatformAgentAttribution(effectiveScope === "__platform__"
    ? (platformAccess?.memberships ?? []).map((membership) => membership.tenantId)
    : effectiveScope ? [effectiveScope] : []);

  const load = useCallback(async () => {
    if (!effectiveScope) {
      setItems([]);
      setSelected(null);
      setLoading(false);
      return;
    }
    const current = ++generation.current;
    setLoading(true);
    setFailure(null);
    setSelected(null);
    try {
      const selected: Scope = effectiveScope === "__platform__"
        ? { platform: true }
        : { tenantId: effectiveScope };
      const result = await listAuthoredResources(selected, kind);
      if (current === generation.current) setItems(result);
    } catch (error) {
      if (current === generation.current) setFailure(loadFailureFrom(error, t(kind === "skill" ? "authored.loadSkillsFailed" : "authored.loadInstructionsFailed")));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [effectiveScope, kind, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => { window.clearTimeout(timer); generation.current += 1; };
  }, [load]);

  const inspect = async (item: AuthoredResource) => {
    if (!scope) return;
    setMutating(true);
    try {
      setSelected(await getAuthoredResource(scope, kind, item.id));
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("authored.loadResourceFailed"), "error");
    } finally { setMutating(false); }
  };

  const openCreate = () => {
    setSelected(null);
    setName(""); setDescription(""); setTags("");
    setBody(textFromAuthoredResourceContent(kind, initialAuthoredResourceContent(kind)));
    setEditorOpen(true);
  };

  const openEdit = () => {
    if (!selected) return;
    setName(selected.resource.name);
    setDescription(selected.resource.description);
    setEditorOpen(true);
  };

  const saveMetadataOrCreate = async () => {
    if (!scope || !name.trim()) return showToast(t("authored.nameRequired"), "error");
    setMutating(true);
    try {
      if (selected) {
        await updateAuthoredResource(scope, kind, selected.resource.id, { name, description });
        showToast(t("authored.metadataSaved"), "success");
      } else {
        await createAuthoredResource(
          scope,
          kind,
          { name, description, content: contentFromAuthoredResourceEditor(kind, body, tags) },
          "platform" in scope ? { mode: "all-active-tenants", tenantIds: [] } : undefined,
        );
        showToast(t("authored.created", { kind: singular }), "success");
      }
      setEditorOpen(false);
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("authored.saveFailed"), "error");
    } finally { setMutating(false); }
  };

  const openRevision = () => {
    if (!selected) return;
    const current = selected.revisions[0]?.content ?? initialAuthoredResourceContent(kind);
    setRevisionSource(current);
    setBody(textFromAuthoredResourceContent(kind, current));
    setTags(current.tags.join(", "));
    setRevisionOpen(true);
  };

  const createRevision = async () => {
    if (!scope || !selected) return;
    setMutating(true);
    try {
      await addAuthoredResourceRevision(
        scope,
        kind,
        selected.resource.id,
        contentFromAuthoredResourceEditor(kind, body, tags, revisionSource ?? undefined),
      );
      setRevisionOpen(false);
      setRevisionSource(null);
      setSelected(await getAuthoredResource(scope, kind, selected.resource.id));
      await loadListOnly();
      showToast(t("authored.revisionCreated"), "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("authored.revisionCreateFailed"), "error");
    } finally { setMutating(false); }
  };

  const loadListOnly = async () => {
    if (scope) setItems(await listAuthoredResources(scope, kind));
  };

  const setRevision = async (revisionId: string, status: "published" | "archived") => {
    if (!scope || !selected) return;
    setMutating(true);
    try {
      await setAuthoredRevisionStatus(scope, kind, selected.resource.id, revisionId, status);
      setSelected(await getAuthoredResource(scope, kind, selected.resource.id));
      showToast(t("authored.revisionStatus", { status: t(status === "published" ? "authored.published" : "authored.archived") }), "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("authored.revisionUpdateFailed"), "error");
    } finally { setMutating(false); }
  };

  const remove = async () => {
    if (!scope || !pendingDelete) return;
    setMutating(true);
    try {
      await deleteAuthoredResource(scope, kind, pendingDelete.id);
      setPendingDelete(null); setSelected(null);
      await load();
      showToast(t("platform" in scope ? "authored.sharedArchived" : "authored.deleted"), "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("authored.removeFailed"), "error");
    } finally { setMutating(false); }
  };

  const title = plural;
  if (!platformAccess && platformAccessError) {
    return <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-8 text-center text-sm text-rose-200">{platformAccessError}</div>;
  }
  if (!scopeOptions.length) {
    return <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-8 text-center text-sm text-amber-200">{t("authored.membershipRequired")}</div>;
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t("authored.scope")}</p>
          <h1 className="mt-1 text-xl font-semibold text-slate-100">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">{t("authored.description", { resources: plural })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select name={`${kind}-scope`} value={effectiveScope} onChange={setSelectedScope} options={scopeOptions} disabled={mutating} />
          <Button onClick={openCreate} disabled={loading || Boolean(failure) || mutating}>{t("authored.create", { kind: singular })}</Button>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.85fr)]">
        <section className="overflow-hidden rounded-lg border border-slate-700/70 bg-slate-900/40">
          {loading ? <p className="p-8 text-center text-xs text-slate-500">{t("common.loading")}</p>
            : failure ? <div role="alert" className={failure.kind === "forbidden" ? "p-8 text-center text-xs text-amber-300" : "p-8 text-center text-xs text-rose-300"}><p>{failure.message}</p><Button variant="ghost" className="mt-3" onClick={() => void load()}>{t("common.retry")}</Button></div>
            : items.length === 0 ? <p className="p-8 text-center text-xs text-slate-500">{t("authored.empty", { resources: plural })}</p>
            : items.map((item) => <button key={item.id} type="button" onClick={() => void inspect(item)} className="flex w-full items-center justify-between gap-3 border-b border-slate-700/60 px-4 py-3 text-left last:border-0 hover:bg-slate-800/40">
                <span className="min-w-0"><span className="block truncate text-sm font-medium text-slate-100">{item.name}</span><span className="block truncate text-xs text-slate-500">{item.description || t("authored.noDescription")}</span></span>
                <span className="flex shrink-0 items-center gap-2"><Badge tone={item.owner.kind === "platform" ? "violet" : "blue"}>{t(item.owner.kind === "platform" ? "authored.platform" : "authored.tenant")}</Badge><Badge tone={item.status === "active" ? "green" : "neutral"}>v{item.latestRevisionNumber}</Badge></span>
              </button>)}
        </section>

        <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
          {!selected ? <p className="py-10 text-center text-sm text-slate-500">{t("authored.selectResource")}</p> : <div className="space-y-4">
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-100">{selected.resource.name}</h2><p className="font-mono text-[10px] text-slate-500">{selected.resource.id}</p></div><Badge tone={selected.resource.owner.kind === "platform" ? "violet" : "blue"}>{t(selected.resource.owner.kind === "platform" ? "authored.platform" : "authored.tenant")}</Badge></div>
            <p className="text-sm text-slate-400">{selected.resource.description || t("authored.noDescription")}</p>
            <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={openEdit} disabled={mutating || selected.resource.owner.kind !== ("platform" in (scope ?? {}) ? "platform" : "tenant")}>{t("authored.editMetadata")}</Button><Button onClick={openRevision} disabled={mutating || selected.resource.owner.kind !== ("platform" in (scope ?? {}) ? "platform" : "tenant")}>{t("authored.newRevision")}</Button><Button variant="danger" onClick={() => setPendingDelete(selected.resource)} disabled={mutating || selected.resource.owner.kind !== ("platform" in (scope ?? {}) ? "platform" : "tenant")}>{t(selected.resource.owner.kind === "platform" ? "authored.archive" : "common.delete")}</Button></div>
            <div className="space-y-2 border-t border-slate-700/60 pt-4">{selected.revisions.map((revision) => <div key={revision.id} className="rounded-md border border-slate-700/70 p-3"><div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-medium text-slate-200">{t("authored.revision", { number: revision.number })}<UsedByAgents agentIds={(kind === "skill" ? attribution?.skillRevision : attribution?.instructionRevision)?.[revision.id]} /></span><Badge tone={revision.status === "published" ? "green" : revision.status === "draft" ? "amber" : "neutral"}>{t(revision.status === "published" ? "authored.published" : revision.status === "draft" ? "authored.draft" : "authored.archived")}</Badge></div><p className="mt-1 font-mono text-[10px] text-slate-500">sha256:{revision.contentHash.slice(0, 16)} · {revision.createdAt}</p><p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-slate-400">{textFromAuthoredResourceContent(kind, revision.content)}</p>{revision.status !== "archived" && selected.resource.owner.kind === ("platform" in (scope ?? {}) ? "platform" : "tenant") && <div className="mt-3 flex gap-2">{revision.status === "draft" && <Button className="px-2 py-1 text-xs" onClick={() => void setRevision(revision.id, "published")} disabled={mutating}>{t("authored.publish")}</Button>}<Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void setRevision(revision.id, "archived")} disabled={mutating}>{t("authored.archive")}</Button></div>}</div>)}</div>
          </div>}
        </section>
      </div>

      <Modal isOpen={editorOpen} onClose={() => { if (!mutating) setEditorOpen(false); }}><ModalHeader><ModalTitle>{selected ? t("authored.editMetadata") : t("authored.create", { kind: singular })}</ModalTitle></ModalHeader><ModalContent><div className="space-y-4"><div><label className="mb-1 block text-sm text-slate-300">{t("common.name")}</label><Input name={`${kind}-name`} value={name} onChange={setName} disabled={mutating} /></div><div><label className="mb-1 block text-sm text-slate-300">{t("common.description")}</label><Input name={`${kind}-description`} value={description} onChange={setDescription} disabled={mutating} /></div>{!selected && <><div><label className="mb-1 block text-sm text-slate-300">{kind === "skill" ? "SKILL.md" : t("authored.instructionText")}</label><textarea value={body} onChange={(event) => setBody(event.target.value)} disabled={mutating} rows={10} className="glass-input w-full rounded-md px-3 py-2 font-mono text-sm text-slate-100" /></div><div><label className="mb-1 block text-sm text-slate-300">{t("authored.tags")}</label><Input name={`${kind}-tags`} value={tags} onChange={setTags} disabled={mutating} /></div></>}</div></ModalContent><ModalFooter><Button variant="ghost" onClick={() => setEditorOpen(false)} disabled={mutating}>{t("common.cancel")}</Button><Button onClick={() => void saveMetadataOrCreate()} disabled={mutating}>{mutating ? t("common.saving") : t("common.save")}</Button></ModalFooter></Modal>

      <Modal isOpen={revisionOpen} onClose={() => { if (!mutating) { setRevisionOpen(false); setRevisionSource(null); } }}><ModalHeader><ModalTitle>{t("authored.newImmutableRevision")}</ModalTitle></ModalHeader><ModalContent><div className="space-y-4"><textarea value={body} onChange={(event) => setBody(event.target.value)} disabled={mutating} rows={14} className="glass-input w-full rounded-md px-3 py-2 font-mono text-sm text-slate-100" /><Input name={`${kind}-revision-tags`} value={tags} onChange={setTags} placeholder={t("authored.tagsPlaceholder")} disabled={mutating} /></div></ModalContent><ModalFooter><Button variant="ghost" onClick={() => { setRevisionOpen(false); setRevisionSource(null); }} disabled={mutating}>{t("common.cancel")}</Button><Button onClick={() => void createRevision()} disabled={mutating}>{mutating ? t("common.creating") : t("catalog.createDraft")}</Button></ModalFooter></Modal>

      <ConfirmDialog isOpen={pendingDelete !== null} onClose={() => { if (!mutating) setPendingDelete(null); }} onConfirm={() => void remove()} title={t(pendingDelete?.owner.kind === "platform" ? "authored.archiveSharedTitle" : "authored.deleteTitle")} message={t("authored.removeMessage")} confirmLabel={t(pendingDelete?.owner.kind === "platform" ? "authored.archive" : "common.delete")} variant="danger" />
    </div>
  );
}
