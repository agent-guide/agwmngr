"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "./i18n-provider";
import { Badge, protocolTone } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardHeader, CardTitle } from "./ui/card";
import { ConfirmDialog } from "./ui/confirm-dialog";
import { PageHeader } from "./ui/page-header";
import { useToast } from "./ui/toast";
import {
  archiveAgentDefinition,
  createAgentRelease,
  getAgentDefinition,
  listAgentReleases,
  type AgentDefinition,
  type AgentRelease,
} from "@/lib/platform-api";

export function PlatformAgentDetail({ tenantId, id }: { tenantId: string; id: string }) {
  const { t, locale } = useI18n();
  const { showToast } = useToast();
  const router = useRouter();
  const [definition, setDefinition] = useState<AgentDefinition | null>(null);
  const [releases, setReleases] = useState<AgentRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"configuration" | "releases">("configuration");
  const [confirmArchive, setConfirmArchive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [nextDefinition, nextReleases] = await Promise.all([
        getAgentDefinition(tenantId, id), listAgentReleases(tenantId, id),
      ]);
      setDefinition(nextDefinition); setReleases(nextReleases);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("agents.loadOneFailed")); }
    finally { setLoading(false); }
  }, [id, t, tenantId]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const release = async () => {
    if (!definition) return;
    setMutating(true);
    try {
      const created = await createAgentRelease(tenantId, id, definition.version);
      setReleases((current) => [created, ...current]); setTab("releases");
      showToast(t("platformAgents.releaseCreated", { number: created.number }), "success");
    } catch (cause) { showToast(cause instanceof Error ? cause.message : t("platformAgents.releaseFailed"), "error"); }
    finally { setMutating(false); }
  };
  const archive = async () => {
    setMutating(true);
    try { await archiveAgentDefinition(tenantId, id); showToast(t("platformAgents.archived"), "success"); router.push("/dashboard/agents"); }
    catch (cause) { showToast(cause instanceof Error ? cause.message : t("platformAgents.archiveFailed"), "error"); setMutating(false); setConfirmArchive(false); }
  };

  if (loading) return <Card className="p-8 text-center text-sm text-slate-400">{t("common.loading")}</Card>;
  if (error || !definition) return <Card className="p-8 text-center text-sm text-rose-300">{error ?? t("agents.loadOneFailed")}</Card>;
  const releasable = definition.status === "active" && definition.draft.runtime.type === "builtin" &&
    definition.draft.runtime.advanced.topology.kind === "single" &&
    Boolean(definition.draft.resources.modelDefinitionId) && definition.draft.resources.knowledgeBaseIds.length === 0;

  return <div className="space-y-4">
    <PageHeader title={<span className="flex items-center gap-2">{definition.draft.name}<Badge tone={protocolTone(definition.draft.runtime.type)}>{definition.draft.runtime.type}</Badge><Badge tone={definition.status === "active" ? "green" : "neutral"}>{definition.status}</Badge></span>} description={<><Link href="/dashboard/agents" className="text-blue-400 hover:underline">{t("agents.back")}</Link><span className="mx-2 text-slate-600">·</span><span className="font-mono text-xs">{definition.id}</span></>} actions={<>{definition.editable && <Link href={`/dashboard/agents/${encodeURIComponent(id)}/edit`}><Button variant="secondary">{t("common.edit")}</Button></Link>}<Button onClick={() => void release()} disabled={!releasable || mutating}>{t("platformAgents.createRelease")}</Button>{definition.editable && <Button variant="danger" onClick={() => setConfirmArchive(true)} disabled={mutating}>{t("authored.archive")}</Button>}</>} />
    {!releasable && definition.status === "active" && <Card className="border-amber-500/30 bg-amber-500/5 text-xs text-amber-200">{t("platformAgents.releaseRequirements")}</Card>}
    <div className="flex gap-1 border-b border-slate-700/70">{(["configuration", "releases"] as const).map((item) => <button key={item} type="button" onClick={() => setTab(item)} className={`px-3 py-2 text-sm ${tab === item ? "border-b-2 border-blue-400 text-blue-200" : "text-slate-400"}`}>{t(item === "configuration" ? "platformAgents.configuration" : "platformAgents.releases")}{item === "releases" ? ` (${releases.length})` : ""}</button>)}</div>
    {tab === "configuration" ? <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>{t("platformAgents.draft")}</CardTitle></CardHeader><dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs"><dt className="text-slate-500">Version</dt><dd className="text-slate-200">v{definition.version}</dd><dt className="text-slate-500">Digest</dt><dd className="break-all font-mono text-slate-300">{definition.draftDigest}</dd><dt className="text-slate-500">{t("common.updated")}</dt><dd className="text-slate-300">{new Date(definition.updatedAt).toLocaleString(locale)}</dd><dt className="text-slate-500">{t("platformAgents.topology")}</dt><dd className="text-slate-300">{definition.draft.runtime.type === "builtin" ? definition.draft.runtime.advanced.topology.kind : "—"}</dd></dl></Card>
      <Card><CardHeader><CardTitle>{t("platformAgents.resources")}</CardTitle></CardHeader><div className="space-y-2 text-xs text-slate-300">{definition.dependencies.length === 0 ? <p className="text-slate-500">{t("platformAgents.noResources")}</p> : definition.dependencies.map((dependency, index) => <div key={`${dependency.kind}-${index}`} className="rounded-md border border-slate-700/70 p-2"><Badge tone="neutral">{dependency.kind}</Badge><p className="mt-1 break-all font-mono text-[11px] text-slate-500">{"definitionId" in dependency ? dependency.definitionId : "revisionId" in dependency ? dependency.revisionId : dependency.knowledgeBaseId}</p></div>)}</div></Card>
      <Card className="lg:col-span-2"><CardHeader><CardTitle>{t("platformAgents.systemPrompt")}</CardTitle></CardHeader><pre className="whitespace-pre-wrap text-xs text-slate-300">{definition.draft.systemPrompt || "—"}</pre></Card>
    </div> : <div className="space-y-3">{releases.length === 0 ? <Card className="p-8 text-center text-sm text-slate-500">{t("platformAgents.noReleases")}</Card> : releases.map((item) => <Card key={item.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-slate-100">Release {item.number}</h3><Badge tone="violet">immutable</Badge><Badge tone={protocolTone(item.runtimeType)}>{item.runtimeType}</Badge></div><p className="mt-1 font-mono text-[11px] text-slate-500">{item.id}</p></div><div className="text-right text-xs text-slate-500"><p>{new Date(item.createdAt).toLocaleString(locale)}</p><p>draft v{item.draftVersion}</p></div></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><div className="rounded-md border border-slate-700/70 p-2"><p className="text-[10px] uppercase tracking-wide text-slate-500">Digest</p><p className="mt-1 break-all font-mono text-[11px] text-slate-300">{item.digest}</p></div><div className="rounded-md border border-slate-700/70 p-2"><p className="text-[10px] uppercase tracking-wide text-slate-500">{t("platformAgents.snapshot")}</p><p className="mt-1 text-xs text-slate-300">{item.snapshot.name} · {t("platformAgents.resourceCount", { count: item.dependencies.length })}</p></div></div></Card>)}</div>}
    <ConfirmDialog isOpen={confirmArchive} onClose={() => { if (!mutating) setConfirmArchive(false); }} onConfirm={() => void archive()} title={t("platformAgents.archiveTitle")} message={t("platformAgents.archiveMessage")} confirmLabel={t("authored.archive")} variant="danger" />
  </div>;
}
