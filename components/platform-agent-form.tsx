"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "./current-user-context";
import { useI18n } from "./i18n-provider";
import { Badge, protocolTone } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { MultiSelect, type MultiOption } from "./ui/multi-select";
import { Select } from "./ui/select";
import { useToast } from "./ui/toast";
import {
  createAgentDefinition,
  getAuthoredResource,
  listAuthoredResources,
  listKnowledgeBases,
  listTenantModelDefinitions,
  listTenantToolDefinitions,
  updateAgentDefinition,
  type AgentDefinition,
  type AgentDefinitionDraft,
} from "@/lib/platform-api";
import { platformAgentHref } from "@/lib/platform-agent-ui";

type ResourceChoices = {
  models: MultiOption[];
  tools: MultiOption[];
  skills: MultiOption[];
  instructions: MultiOption[];
  knowledge: MultiOption[];
};

const emptyChoices: ResourceChoices = {
  models: [], tools: [], skills: [], instructions: [], knowledge: [],
};

function emptyDraft(): AgentDefinitionDraft {
  return {
    name: "",
    description: "",
    systemPrompt: "",
    runtime: {
      type: "builtin",
      advanced: {
        topology: { kind: "single", maxIterations: 4 },
        generation: { maxTokens: 2_048, temperature: 0.2 },
        permissions: { mode: "interactive", timeoutSeconds: 300, maxPending: 10 },
      },
    },
    resources: {
      modelDefinitionId: null,
      toolDefinitionIds: [],
      skillRevisionIds: [],
      instructionRevisionIds: [],
      knowledgeBaseIds: [],
    },
    policy: { maxAgentDepth: 3 },
  };
}

async function resourceChoices(tenantId: string): Promise<ResourceChoices> {
  const [models, tools, skills, instructions, knowledge] = await Promise.all([
    listTenantModelDefinitions(tenantId),
    listTenantToolDefinitions(tenantId),
    listAuthoredResources({ tenantId }, "skill"),
    listAuthoredResources({ tenantId }, "instruction"),
    listKnowledgeBases(tenantId),
  ]);
  const [skillDetails, instructionDetails] = await Promise.all([
    Promise.all(skills.map((item) => getAuthoredResource({ tenantId }, "skill", item.id))),
    Promise.all(instructions.map((item) => getAuthoredResource({ tenantId }, "instruction", item.id))),
  ]);
  return {
    models: models.filter((item) => item.status === "active").map((item) => ({
      value: item.id, label: item.name, hint: `v${item.version}`,
      disabled: item.availability !== "available", invalid: item.availability !== "available",
    })),
    tools: tools.filter((item) => item.status === "active").map((item) => ({
      value: item.id, label: item.name, hint: `v${item.version}`,
      disabled: item.availability !== "available", invalid: item.availability !== "available",
    })),
    skills: skillDetails.flatMap((detail) => detail.revisions
      .filter((revision) => revision.status !== "archived")
      .map((revision) => ({
        value: revision.id,
        label: detail.resource.name,
        hint: `v${revision.number} · ${revision.status}`,
      }))),
    instructions: instructionDetails.flatMap((detail) => detail.revisions
      .filter((revision) => revision.status !== "archived")
      .map((revision) => ({
        value: revision.id,
        label: detail.resource.name,
        hint: `v${revision.number} · ${revision.status}`,
      }))),
    knowledge: knowledge.filter((item) => item.status === "active").map((item) => ({
      value: item.id, label: item.name, hint: `${item.documentCount}`,
    })),
  };
}

export function PlatformAgentForm({ initial }: { initial?: AgentDefinition }) {
  const { platformAccess, platformAccessError } = useCurrentUser();
  const { t } = useI18n();
  const { showToast } = useToast();
  const router = useRouter();
  const tenantOptions = useMemo(() => (platformAccess?.memberships ?? []).map((membership) => ({
    value: membership.tenantId,
    label: `${membership.tenant.name} · ${t(membership.role === "admin" ? "tenantMembers.admin" : "tenantMembers.user")}`,
  })), [platformAccess?.memberships, t]);
  const [chosenTenant, setChosenTenant] = useState(initial?.tenantId ?? "");
  const tenantId = initial?.tenantId ?? (
    tenantOptions.some((item) => item.value === chosenTenant) ? chosenTenant : tenantOptions[0]?.value ?? ""
  );
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [draft, setDraft] = useState<AgentDefinitionDraft>(() => initial?.draft ?? emptyDraft());
  const [choices, setChoices] = useState<ResourceChoices>(emptyChoices);
  const [loadingResources, setLoadingResources] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);
  const generation = useRef(0);

  const loadChoices = useCallback(async () => {
    if (!tenantId) { setChoices(emptyChoices); return; }
    const current = ++generation.current;
    setLoadingResources(true); setResourceError(null);
    try {
      const next = await resourceChoices(tenantId);
      if (current === generation.current) setChoices(next);
    } catch (error) {
      if (current === generation.current) {
        setResourceError(error instanceof Error ? error.message : t("platformAgents.resourcesFailed"));
      }
    } finally {
      if (current === generation.current) setLoadingResources(false);
    }
  }, [t, tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadChoices(), 0);
    return () => { window.clearTimeout(timer); generation.current += 1; };
  }, [loadChoices]);

  const setRuntimeType = (type: string) => {
    setDraft((current) => ({
      ...current,
      runtime: type === "acp"
        ? { type: "acp", advanced: { agentType: "codex", cwd: "/workspace", permissionMode: "interactive" } }
        : type === "http"
          ? { type: "http", advanced: { cardUrl: "https://example.com/.well-known/agent-card.json", timeoutSeconds: 60 } }
          : emptyDraft().runtime,
    }));
  };

  const save = async () => {
    if (!tenantId || !slug.trim() || !draft.name.trim()) {
      showToast(t("platformAgents.identityRequired"), "error"); return;
    }
    setSaving(true);
    try {
      const saved = initial
        ? await updateAgentDefinition(tenantId, initial.id, initial.version, draft)
        : await createAgentDefinition(tenantId, { slug, expectedVersion: 0, draft });
      showToast(t(initial ? "platformAgents.updated" : "platformAgents.created"), "success");
      router.push(platformAgentHref(saved.id));
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("platformAgents.saveFailed"), "error");
      setSaving(false);
    }
  };

  if (!platformAccess && platformAccessError) {
    return <Card className="border-rose-500/30 p-8 text-center text-sm text-rose-200">{platformAccessError}</Card>;
  }
  if (!tenantOptions.length) {
    return <Card className="border-amber-500/30 p-8 text-center text-sm text-amber-200">{t("authored.membershipRequired")}</Card>;
  }

  const steps = ["platformAgents.stepIdentity", "platformAgents.stepRuntime", "platformAgents.stepResources", "platformAgents.stepReview"] as const;
  const resourceCount = draft.resources.toolDefinitionIds.length + draft.resources.skillRevisionIds.length +
    draft.resources.instructionRevisionIds.length + draft.resources.knowledgeBaseIds.length +
    (draft.resources.modelDefinitionId ? 1 : 0);

  return <div className="space-y-4">
    <div className="grid grid-cols-4 gap-2">
      {steps.map((key, index) => <button key={key} type="button" onClick={() => setStep(index)} className={`rounded-md border px-2 py-2 text-xs ${index === step ? "border-blue-500/50 bg-blue-500/15 text-blue-200" : "border-slate-700/70 text-slate-400"}`}><span className="mr-1 font-mono">{index + 1}</span>{t(key)}</button>)}
    </div>
    <Card className="space-y-5">
      {step === 0 && <>
        <div><h2 className="text-base font-semibold text-slate-100">{t("platformAgents.identity")}</h2><p className="mt-1 text-xs text-slate-500">{t("platformAgents.identityHelp")}</p></div>
        <label className="block space-y-1"><span className="text-xs text-slate-400">Tenant</span><Select name="agent-tenant" value={tenantId} onChange={setChosenTenant} options={tenantOptions} disabled={Boolean(initial) || saving} className="w-full" /></label>
        <label className="block space-y-1"><span className="text-xs text-slate-400">Slug</span><Input name="agent-slug" value={slug} onChange={setSlug} disabled={Boolean(initial) || saving} placeholder="research-assistant" autoCapitalize="none" autoCorrect="off" /></label>
        <label className="block space-y-1"><span className="text-xs text-slate-400">{t("common.name")}</span><Input name="agent-name" value={draft.name} onChange={(name) => setDraft((current) => ({ ...current, name }))} disabled={saving} /></label>
        <label className="block space-y-1"><span className="text-xs text-slate-400">{t("common.description")}</span><Input name="agent-description" value={draft.description} onChange={(description) => setDraft((current) => ({ ...current, description }))} disabled={saving} /></label>
        <label className="block space-y-1"><span className="text-xs text-slate-400">{t("platformAgents.systemPrompt")}</span><textarea name="agent-system-prompt" value={draft.systemPrompt} onChange={(event) => setDraft((current) => ({ ...current, systemPrompt: event.target.value }))} disabled={saving} rows={7} className="glass-input w-full rounded-md px-3 py-2 text-sm text-slate-50" /></label>
      </>}
      {step === 1 && <>
        <div><h2 className="text-base font-semibold text-slate-100">{t("platformAgents.runtime")}</h2><p className="mt-1 text-xs text-slate-500">{t("platformAgents.runtimeHelp")}</p></div>
        <Select name="agent-runtime" value={draft.runtime.type} onChange={setRuntimeType} options={[{ value: "builtin", label: "Builtin" }, { value: "acp", label: "ACP" }, { value: "http", label: "HTTP / A2A" }]} disabled={saving} className="w-full" />
        {draft.runtime.type === "builtin" && <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1"><span className="text-xs text-slate-400">{t("platformAgents.topology")}</span><Select name="agent-topology" value={draft.runtime.advanced.topology.kind} onChange={(kind) => setDraft((current) => current.runtime.type !== "builtin" ? current : ({ ...current, runtime: { ...current.runtime, advanced: { ...current.runtime.advanced, topology: { ...current.runtime.advanced.topology, kind: kind as typeof current.runtime.advanced.topology.kind } } } }))} options={["single", "sequential", "parallel", "loop", "supervisor", "planexecute", "deep", "custom"].map((value) => ({ value, label: value }))} /></label><label className="space-y-1"><span className="text-xs text-slate-400">{t("platformAgents.maxIterations")}</span><Input type="number" name="agent-iterations" value={String(draft.runtime.advanced.topology.maxIterations ?? 4)} onChange={(value) => setDraft((current) => current.runtime.type !== "builtin" ? current : ({ ...current, runtime: { ...current.runtime, advanced: { ...current.runtime.advanced, topology: { ...current.runtime.advanced.topology, maxIterations: Number(value) } } } }))} /></label></div>}
        {draft.runtime.type === "acp" && <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1"><span className="text-xs text-slate-400">{t("platformAgents.agentType")}</span><Select name="agent-acp-type" value={draft.runtime.advanced.agentType} onChange={(agentType) => setDraft((current) => current.runtime.type !== "acp" ? current : ({ ...current, runtime: { ...current.runtime, advanced: { ...current.runtime.advanced, agentType: agentType as "codex" | "opencode" } } }))} options={[{ value: "codex", label: "Codex" }, { value: "opencode", label: "OpenCode" }]} /></label><label className="space-y-1"><span className="text-xs text-slate-400">{t("platformAgents.cwd")}</span><Input name="agent-cwd" value={draft.runtime.advanced.cwd} onChange={(cwd) => setDraft((current) => current.runtime.type !== "acp" ? current : ({ ...current, runtime: { ...current.runtime, advanced: { ...current.runtime.advanced, cwd } } }))} /></label></div>}
        {draft.runtime.type === "http" && <label className="block space-y-1"><span className="text-xs text-slate-400">Agent Card URL</span><Input name="agent-card-url" value={draft.runtime.advanced.cardUrl} onChange={(cardUrl) => setDraft((current) => current.runtime.type !== "http" ? current : ({ ...current, runtime: { ...current.runtime, advanced: { ...current.runtime.advanced, cardUrl } } }))} /></label>}
        {draft.runtime.type !== "builtin" && <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">{t("platformAgents.releaseDeferred")}</div>}
      </>}
      {step === 2 && <>
        <div><h2 className="text-base font-semibold text-slate-100">{t("platformAgents.resources")}</h2><p className="mt-1 text-xs text-slate-500">{t("platformAgents.resourcesHelp")}</p></div>
        {loadingResources ? <p className="text-sm text-slate-500">{t("common.loading")}</p> : resourceError ? <div role="alert" className="rounded-md border border-rose-500/30 p-3 text-sm text-rose-200">{resourceError}<Button variant="ghost" className="ml-2" onClick={() => void loadChoices()}>{t("common.retry")}</Button></div> : <div className="space-y-5">
          <div><p className="mb-2 text-xs font-medium text-slate-300">{t("platformAgents.model")}</p><MultiSelect options={choices.models} selected={draft.resources.modelDefinitionId ? [draft.resources.modelDefinitionId] : []} onChange={(values) => setDraft((current) => ({ ...current, resources: { ...current.resources, modelDefinitionId: values.at(-1) ?? null } }))} emptyText={t("platformAgents.noModels")} /></div>
          <div><p className="mb-2 text-xs font-medium text-slate-300">{t("nav.tools")}</p><MultiSelect options={choices.tools} selected={draft.resources.toolDefinitionIds} onChange={(toolDefinitionIds) => setDraft((current) => ({ ...current, resources: { ...current.resources, toolDefinitionIds } }))} /></div>
          <div><p className="mb-2 text-xs font-medium text-slate-300">{t("nav.skills")}</p><MultiSelect options={choices.skills} selected={draft.resources.skillRevisionIds} onChange={(skillRevisionIds) => setDraft((current) => ({ ...current, resources: { ...current.resources, skillRevisionIds } }))} /></div>
          <div><p className="mb-2 text-xs font-medium text-slate-300">{t("nav.instructions")}</p><MultiSelect options={choices.instructions} selected={draft.resources.instructionRevisionIds} onChange={(instructionRevisionIds) => setDraft((current) => ({ ...current, resources: { ...current.resources, instructionRevisionIds } }))} /></div>
          <div><p className="mb-2 text-xs font-medium text-slate-300">{t("nav.knowledgeBases")}</p><MultiSelect options={choices.knowledge} selected={draft.resources.knowledgeBaseIds} onChange={(knowledgeBaseIds) => setDraft((current) => ({ ...current, resources: { ...current.resources, knowledgeBaseIds } }))} /><p className="mt-2 text-[11px] text-amber-300">{t("platformAgents.knowledgeDeferred")}</p></div>
        </div>}
      </>}
      {step === 3 && <>
        <div><h2 className="text-base font-semibold text-slate-100">{t("platformAgents.review")}</h2><p className="mt-1 text-xs text-slate-500">{t("platformAgents.reviewHelp")}</p></div>
        <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-md border border-slate-700/70 p-3"><p className="text-xs text-slate-500">{t("common.name")}</p><p className="mt-1 text-sm text-slate-100">{draft.name || "—"}</p><p className="mt-1 font-mono text-[11px] text-slate-500">{tenantId}/{slug || "—"}</p></div><div className="rounded-md border border-slate-700/70 p-3"><p className="text-xs text-slate-500">{t("platformAgents.runtime")}</p><div className="mt-1 flex gap-2"><Badge tone={protocolTone(draft.runtime.type)}>{draft.runtime.type}</Badge><Badge tone="neutral">{t("platformAgents.resourceCount", { count: resourceCount })}</Badge></div></div></div>
        {draft.runtime.type === "builtin" && draft.runtime.advanced.topology.kind !== "single" && <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">{t("platformAgents.releaseSingleOnly")}</div>}
      </>}
    </Card>
    <div className="flex justify-between"><Button variant="ghost" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0 || saving}>{t("platformAgents.previous")}</Button>{step < steps.length - 1 ? <Button onClick={() => setStep(step + 1)}>{t("platformAgents.next")}</Button> : <Button onClick={() => void save()} disabled={saving}>{saving ? t("common.saving") : t(initial ? "common.save" : "common.create")}</Button>}</div>
  </div>;
}
