"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "./current-user-context";
import { useI18n } from "./i18n-provider";
import { PlatformAgentTestPanel } from "./platform-agent-test-panel";
import { StructuredDataView, StructuredRows } from "./structured-data-view";
import { Badge, protocolTone, type BadgeTone } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardHeader, CardTitle } from "./ui/card";
import { ConfirmDialog } from "./ui/confirm-dialog";
import { PageHeader } from "./ui/page-header";
import { Select } from "./ui/select";
import { useToast } from "./ui/toast";
import {
  applyAgentDeployment,
  archiveAgentDefinition,
  bringAgentDeploymentOnline,
  cancelDeploymentRun,
  createAgentDeployment,
  createAgentRelease,
  getAgentDefinition,
  getDeploymentOperationalMetadata,
  listAgentDeploymentOperations,
  listAgentDeployments,
  listAgentReleases,
  listDeploymentObservations,
  listTenantAgentEndpoints,
  resolveDeploymentPermission,
  retryAgentDeployment,
  rollbackAgentDeployment,
  takeAgentDeploymentOffline,
  verifyAgentDeployment,
  type AgentDefinition,
  type AgentDeployment,
  type AgentDeploymentEndpoint,
  type AgentDeploymentOperation,
  type AgentRelease,
  type DeploymentObservation,
  type DeploymentObservationKind,
  type DeploymentOperationalMetadata,
} from "@/lib/platform-api";
import {
  platformAgentHref,
  platformAgentTabs,
  type PlatformAgentTab,
} from "@/lib/platform-agent-ui";
import {
  actionPermissionDecision,
  operationalPermission,
  optionPermissionDecision,
  rejectPermissionDecision,
  type OperationalPermissionActionDecision,
} from "@/lib/platform-permission";

const TAB_KEYS: Record<PlatformAgentTab, Parameters<ReturnType<typeof useI18n>["t"]>[0]> = {
  overview: "platformAgents.overview",
  configuration: "platformAgents.configuration",
  releases: "platformAgents.releasesDeployments",
  access: "platformAgents.access",
  observability: "platformAgents.observability",
  test: "platformAgents.test",
};

function stateTone(state: string): BadgeTone {
  if (["active", "stable", "succeeded", "ready_to_apply"].includes(state)) return "green";
  if (["partial_failure", "failed", "reconciliation_required"].includes(state)) return "red";
  if (["offline", "awaiting_key_binding", "applying"].includes(state)) return "amber";
  return "neutral";
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(value: unknown, ...keys: string[]): string | null {
  const row = object(value);
  if (!row) return null;
  for (const key of keys) if (typeof row[key] === "string") return row[key] as string;
  return null;
}

function requestKey(action: string): string {
  return `ui:${action}:${crypto.randomUUID()}`;
}

function PermissionControls({
  value,
  busy,
  onResolve,
}: {
  value: unknown;
  busy: boolean;
  onResolve: (decision: Record<string, unknown>) => void;
}) {
  const { t } = useI18n();
  const permission = useMemo(() => operationalPermission(value), [value]);
  const [selections, setSelections] = useState<Record<string, OperationalPermissionActionDecision>>({});
  const actionDecision = actionPermissionDecision(permission, selections);

  if (permission.actions.length > 0) {
    return <div className="mt-3 space-y-2">
      {permission.actions.map((action) => <div key={action.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-700/60 px-3 py-2">
        <span className="text-xs text-slate-300">{action.name}</span>
        <div className="flex gap-1.5">
          <Button variant={selections[action.id] === "allow" ? "primary" : "secondary"}
            className="px-2.5 py-1 text-xs" disabled={busy}
            onClick={() => setSelections((current) => ({ ...current, [action.id]: "allow" }))}>
            {t("platformAgents.allow")}
          </Button>
          <Button variant={selections[action.id] === "deny" ? "danger" : "secondary"}
            className="px-2.5 py-1 text-xs" disabled={busy}
            onClick={() => setSelections((current) => ({ ...current, [action.id]: "deny" }))}>
            {t("platformAgents.deny")}
          </Button>
        </div>
      </div>)}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="danger" disabled={busy}
          onClick={() => onResolve(rejectPermissionDecision(permission))}>
          {t("platformAgents.reject")}
        </Button>
        <Button disabled={busy || actionDecision === null}
          onClick={() => actionDecision && onResolve(actionDecision)}>
          {t("platformAgents.submitDecisions")}
        </Button>
      </div>
    </div>;
  }

  return <div className="mt-2 flex flex-wrap gap-2">
    {permission.options.map((option) => <Button key={option.id} disabled={busy}
      onClick={() => onResolve(optionPermissionDecision(option.id))}>{option.name}</Button>)}
    <Button variant="danger" disabled={busy}
      onClick={() => onResolve(rejectPermissionDecision(permission))}>
      {t("platformAgents.reject")}
    </Button>
  </div>;
}

function DeploymentCard({
  deployment,
  releases,
  operations,
  manageable,
  busy,
  onAction,
}: {
  deployment: AgentDeployment;
  releases: AgentRelease[];
  operations: AgentDeploymentOperation[];
  manageable: boolean;
  busy: boolean;
  onAction: (action: "apply" | "retry" | "offline" | "online" | "verify" | "rollback", releaseId?: string) => void;
}) {
  const { t, locale } = useI18n();
  const [rollbackRelease, setRollbackRelease] = useState(deployment.appliedReleaseId ?? releases[0]?.id ?? "");
  return <Card className="space-y-3">
    <CardHeader>
      <div className="min-w-0">
        <CardTitle>{deployment.target.gatewayId}</CardTitle>
        <p className="mt-1 truncate font-mono text-[11px] text-slate-500">{deployment.id}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge tone={stateTone(deployment.lifecycleState)}>{deployment.lifecycleState}</Badge>
        <Badge tone={stateTone(deployment.operationState)}>{deployment.operationState}</Badge>
      </div>
    </CardHeader>
    <dl className="grid gap-2 text-xs sm:grid-cols-2">
      <div><dt className="text-slate-500">Route</dt><dd className="break-all font-mono text-slate-300">{deployment.target.pathPrefix}</dd></div>
      <div><dt className="text-slate-500">Gateway Agent</dt><dd className="break-all font-mono text-slate-300">{deployment.target.gatewayAgentId}</dd></div>
      <div><dt className="text-slate-500">Release</dt><dd className="break-all font-mono text-slate-300">{deployment.appliedReleaseId ?? deployment.requestedReleaseId}</dd></div>
      <div><dt className="text-slate-500">Last verified</dt><dd className="text-slate-300">{deployment.lastVerifiedAt ? new Date(deployment.lastVerifiedAt).toLocaleString(locale) : "—"}</dd></div>
    </dl>
    {deployment.failureCode && <p className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">{deployment.failureCode}</p>}
    {deployment.lifecycleState === "awaiting_key_binding" && <p className="text-xs text-amber-300">{t("platformAgents.awaitBinding")}</p>}
    {manageable && <div className="flex flex-wrap items-center gap-2 border-t border-slate-800/80 pt-3">
      {deployment.lifecycleState === "ready_to_apply" && <Button disabled={busy} onClick={() => onAction("apply")}>{t("platformAgents.apply")}</Button>}
      {deployment.lifecycleState === "partial_failure" && <Button disabled={busy} onClick={() => onAction("retry")}>{t("platformAgents.retry")}</Button>}
      {deployment.lifecycleState === "active" && <Button variant="secondary" disabled={busy} onClick={() => onAction("offline")}>{t("platformAgents.takeOffline")}</Button>}
      {deployment.lifecycleState === "offline" && <Button disabled={busy} onClick={() => onAction("online")}>{t("platformAgents.bringOnline")}</Button>}
      {["active", "offline"].includes(deployment.lifecycleState) && <Button variant="ghost" disabled={busy} onClick={() => onAction("verify")}>{t("platformAgents.verify")}</Button>}
      {deployment.appliedReleaseId && releases.length > 0 && <>
        <Select name={`rollback-${deployment.id}`} value={rollbackRelease} onChange={setRollbackRelease}
          options={releases.map((release) => ({ value: release.id, label: `Release ${release.number}` }))} />
        <Button variant="ghost" disabled={busy || !rollbackRelease || rollbackRelease === deployment.appliedReleaseId}
          onClick={() => onAction("rollback", rollbackRelease)}>{t("platformAgents.rollback")}</Button>
      </>}
    </div>}
    <details>
      <summary className="cursor-pointer text-xs text-slate-400">{t("platformAgents.operationHistory")} ({operations.length})</summary>
      <div className="mt-2 space-y-2">{operations.length === 0
        ? <p className="text-xs text-slate-500">—</p>
        : operations.map((operation) => <div key={operation.id} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-800/80 px-3 py-2 text-xs">
          <Badge tone={stateTone(operation.status)}>{operation.status}</Badge>
          <span className="text-slate-200">{operation.kind}</span>
          <span className="text-slate-500">{operation.phase}</span>
          {operation.failureMessage && <span className="text-rose-300">{operation.failureMessage}</span>}
        </div>)}</div>
    </details>
  </Card>;
}

export function PlatformAgentWorkspace({ tenantId, id, tab }: { tenantId: string; id: string; tab: PlatformAgentTab }) {
  const { platformAccess } = useCurrentUser();
  const { t, locale } = useI18n();
  const { showToast } = useToast();
  const router = useRouter();
  const membership = platformAccess?.memberships.find((item) => item.tenantId === tenantId);
  const readableGatewayIds = useMemo(() => new Set((platformAccess?.gatewayGrants ?? [])
    .filter((grant) => grant.tenantId === tenantId)
    .map((grant) => grant.gatewayId)), [platformAccess?.gatewayGrants, tenantId]);
  const inspectDeployments = membership?.role === "admin" && readableGatewayIds.size > 0;
  const manageGatewayIds = useMemo(() => new Set((platformAccess?.gatewayGrants ?? [])
    .filter((grant) => grant.tenantId === tenantId && grant.access === "manage")
    .map((grant) => grant.gatewayId)), [platformAccess?.gatewayGrants, tenantId]);
  const [definition, setDefinition] = useState<AgentDefinition | null>(null);
  const [releases, setReleases] = useState<AgentRelease[]>([]);
  const [deployments, setDeployments] = useState<AgentDeployment[]>([]);
  const [operations, setOperations] = useState<Record<string, AgentDeploymentOperation[]>>({});
  const [endpoints, setEndpoints] = useState<AgentDeploymentEndpoint[]>([]);
  const [observations, setObservations] = useState<DeploymentObservation[]>([]);
  const [operational, setOperational] = useState<Record<string, DeploymentOperationalMetadata>>({});
  const [observationKind, setObservationKind] = useState<DeploymentObservationKind>("health");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [busyDeployment, setBusyDeployment] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [intentRelease, setIntentRelease] = useState("");
  const [intentGateway, setIntentGateway] = useState("");

  const loadBase = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [nextDefinition, nextReleases] = await Promise.all([
        getAgentDefinition(tenantId, id), listAgentReleases(tenantId, id),
      ]);
      setDefinition(nextDefinition); setReleases(nextReleases);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("agents.loadOneFailed")); }
    finally { setLoading(false); }
  }, [id, t, tenantId]);

  const loadScoped = useCallback(async () => {
    setScopeError(null);
    try {
      if (tab === "access" || tab === "test") {
        setEndpoints((await listTenantAgentEndpoints(tenantId)).filter((item) => item.definitionId === id));
        return;
      }
      if (!inspectDeployments) { setDeployments([]); setObservations([]); setOperational({}); return; }
      const nextDeployments = (await listAgentDeployments(tenantId)).filter((item) => item.definitionId === id);
      setDeployments(nextDeployments);
      if (tab === "releases") {
        const histories = await Promise.all(nextDeployments.map(async (item) => [
          item.id, await listAgentDeploymentOperations(tenantId, item.id),
        ] as const));
        setOperations(Object.fromEntries(histories));
      }
      if (tab === "overview" || tab === "observability") {
        const kind = tab === "overview" ? "health" : observationKind;
        setObservations((await listDeploymentObservations(tenantId, kind)).filter((item) => item.definitionId === id));
      }
      if (tab === "observability") {
        const metadata = await Promise.all(nextDeployments
          .filter((item) => item.appliedReleaseId)
          .map(async (item) => [item.id, await getDeploymentOperationalMetadata(tenantId, item.id)] as const));
        setOperational(Object.fromEntries(metadata));
      }
    } catch (cause) {
      setScopeError(cause instanceof Error ? cause.message : t("platformAgents.deploymentFailed"));
    }
  }, [id, inspectDeployments, observationKind, t, tab, tenantId]);

  useEffect(() => { const timer = window.setTimeout(() => void loadBase(), 0); return () => clearTimeout(timer); }, [loadBase]);
  useEffect(() => { const timer = window.setTimeout(() => void loadScoped(), 0); return () => clearTimeout(timer); }, [loadScoped]);

  const release = async () => {
    if (!definition) return;
    setMutating(true);
    try {
      const created = await createAgentRelease(tenantId, id, definition.version);
      setReleases((current) => [created, ...current]);
      showToast(t("platformAgents.releaseCreated", { number: created.number }), "success");
      router.push(platformAgentHref(id, "releases"));
    } catch (cause) { showToast(cause instanceof Error ? cause.message : t("platformAgents.releaseFailed"), "error"); }
    finally { setMutating(false); }
  };
  const archive = async () => {
    setMutating(true);
    try { await archiveAgentDefinition(tenantId, id); showToast(t("platformAgents.archived"), "success"); router.push("/dashboard/agents"); }
    catch (cause) { showToast(cause instanceof Error ? cause.message : t("platformAgents.archiveFailed"), "error"); setMutating(false); setConfirmArchive(false); }
  };
  const createIntent = async () => {
    const releaseId = intentRelease || releases[0]?.id;
    const gatewayId = intentGateway || [...manageGatewayIds][0];
    if (!releaseId || !gatewayId) return;
    setMutating(true);
    try {
      await createAgentDeployment(tenantId, { releaseId, gatewayId, requestKey: requestKey("create") });
      showToast(t("platformAgents.intentCreated"), "success");
      await loadScoped();
    } catch (cause) { showToast(cause instanceof Error ? cause.message : t("platformAgents.deploymentFailed"), "error"); }
    finally { setMutating(false); }
  };
  const deploymentAction = async (
    deployment: AgentDeployment,
    action: "apply" | "retry" | "offline" | "online" | "verify" | "rollback",
    releaseId?: string,
  ) => {
    setBusyDeployment(deployment.id);
    try {
      if (action === "apply") await applyAgentDeployment(tenantId, deployment.id, requestKey(action));
      if (action === "retry") await retryAgentDeployment(tenantId, deployment.id, requestKey(action));
      if (action === "offline") await takeAgentDeploymentOffline(tenantId, deployment.id, requestKey(action));
      if (action === "online") await bringAgentDeploymentOnline(tenantId, deployment.id, requestKey(action));
      if (action === "verify") await verifyAgentDeployment(tenantId, deployment.id, requestKey(action));
      if (action === "rollback" && releaseId) await rollbackAgentDeployment(tenantId, deployment.id, releaseId, requestKey(action));
      showToast(t("platformAgents.operationSucceeded"), "success");
      await loadScoped();
    } catch (cause) { showToast(cause instanceof Error ? cause.message : t("platformAgents.deploymentFailed"), "error"); }
    finally { setBusyDeployment(null); }
  };
  const resolvePermission = async (
    deploymentId: string,
    permission: unknown,
    decision: Record<string, unknown>,
  ) => {
    const requestId = stringField(permission, "request_id", "requestId");
    if (!requestId) return;
    setBusyDeployment(deploymentId);
    try {
      await resolveDeploymentPermission(tenantId, deploymentId, requestId, decision);
      await loadScoped();
    } catch (cause) { showToast(cause instanceof Error ? cause.message : t("platformAgents.deploymentFailed"), "error"); }
    finally { setBusyDeployment(null); }
  };
  const cancelRun = async (deploymentId: string, run: unknown) => {
    const runId = stringField(run, "run_id", "runId");
    if (!runId) return;
    setBusyDeployment(deploymentId);
    try { await cancelDeploymentRun(tenantId, deploymentId, runId); await loadScoped(); }
    catch (cause) { showToast(cause instanceof Error ? cause.message : t("platformAgents.deploymentFailed"), "error"); }
    finally { setBusyDeployment(null); }
  };

  if (loading) return <Card className="p-8 text-center text-sm text-slate-400">{t("common.loading")}</Card>;
  if (error || !definition) return <Card className="p-8 text-center text-sm text-rose-300">{error ?? t("agents.loadOneFailed")}</Card>;
  const releasable = definition.status === "active" && definition.draft.runtime.type === "builtin" &&
    definition.draft.runtime.advanced.topology.kind === "single" &&
    Boolean(definition.draft.resources.modelDefinitionId) && definition.draft.resources.knowledgeBaseIds.length === 0;
  const health = new Map(observations.filter((item) => item.kind === "health").map((item) => [item.deploymentId, item.data]));
  const selectedIntentRelease = releases.some((item) => item.id === intentRelease) ? intentRelease : releases[0]?.id ?? "";
  const selectedIntentGateway = manageGatewayIds.has(intentGateway) ? intentGateway : [...manageGatewayIds][0] ?? "";

  return <div className="space-y-4">
    <PageHeader title={<span className="flex flex-wrap items-center gap-2">{definition.draft.name}<Badge tone={protocolTone(definition.draft.runtime.type)}>{definition.draft.runtime.type}</Badge><Badge tone={definition.status === "active" ? "green" : "neutral"}>{definition.status}</Badge></span>}
      description={<><Link href="/dashboard/agents" className="text-blue-400 hover:underline">{t("agents.back")}</Link><span className="mx-2 text-slate-600">·</span><span className="font-mono text-xs">{definition.id}</span></>}
      actions={<>{definition.editable && <Link href={`/dashboard/agents/${encodeURIComponent(id)}/edit`}><Button variant="secondary">{t("common.edit")}</Button></Link>}<Button onClick={() => void release()} disabled={!releasable || mutating}>{t("platformAgents.createRelease")}</Button>{definition.editable && <Button variant="danger" onClick={() => setConfirmArchive(true)} disabled={mutating}>{t("authored.archive")}</Button>}</>} />
    <nav aria-label="Agent workspace" className="flex gap-1 overflow-x-auto border-b border-slate-700/70">
      {platformAgentTabs.map((item) => <Link key={item} href={platformAgentHref(id, item)}
        className={`whitespace-nowrap px-3 py-2 text-sm ${tab === item ? "border-b-2 border-blue-400 text-blue-200" : "text-slate-400 hover:text-slate-200"}`}>{t(TAB_KEYS[item])}</Link>)}
    </nav>
    {!releasable && definition.status === "active" && tab === "configuration" && <Card className="border-amber-500/30 bg-amber-500/5 text-xs text-amber-200">{t("platformAgents.releaseRequirements")}</Card>}
    {scopeError && <Card className="border-rose-500/30 text-sm text-rose-300">{scopeError}</Card>}

    {tab === "overview" && <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card><p className="text-xs text-slate-500">{t("platformAgents.identitySummary")}</p><p className="mt-2 text-lg font-semibold text-slate-100">{definition.slug}</p><p className="mt-1 text-xs text-slate-400">Draft v{definition.version} · {releases.length} releases</p></Card>
        <Card><p className="text-xs text-slate-500">{t("platformAgents.resourceCompleteness")}</p><p className="mt-2 text-lg font-semibold text-slate-100">{definition.dependencies.length}</p><p className="mt-1 text-xs text-slate-400">{definition.draft.resources.modelDefinitionId ? "Model ready" : "Model missing"}</p></Card>
        <Card><p className="text-xs text-slate-500">{t("platformAgents.deployments")}</p><p className="mt-2 text-lg font-semibold text-slate-100">{deployments.length}</p><p className="mt-1 text-xs text-slate-400">{t("platformAgents.deploymentVisibility")}</p></Card>
      </div>
      <Card><CardHeader><CardTitle>{definition.draft.name}</CardTitle></CardHeader><p className="text-sm leading-6 text-slate-300">{definition.draft.description || "—"}</p></Card>
      <Card><CardHeader><CardTitle>{t("platformAgents.deployments")}</CardTitle></CardHeader>{deployments.length === 0
        ? <p className="py-6 text-center text-sm text-slate-500">{t("platformAgents.noDeployments")}</p>
        : <div className="grid gap-3 lg:grid-cols-2">{deployments.map((deployment) => <div key={deployment.id} className="rounded-md border border-slate-700/60 p-3"><div className="flex items-center justify-between gap-2"><span className="font-medium text-slate-200">{deployment.target.gatewayId}</span><Badge tone={stateTone(deployment.lifecycleState)}>{deployment.lifecycleState}</Badge></div><p className="mt-2 font-mono text-[11px] text-slate-500">{deployment.target.pathPrefix}</p><div className="mt-3"><StructuredDataView data={health.get(deployment.id)} empty={t("platformAgents.noObservations")} /></div></div>)}</div>}</Card>
    </div>}

    {tab === "configuration" && <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>{t("platformAgents.draft")} · v{definition.version}</CardTitle></CardHeader><StructuredDataView data={{ name: definition.draft.name, description: definition.draft.description, system_prompt: definition.draft.systemPrompt, policy: definition.draft.policy }} /></Card>
      <Card><CardHeader><CardTitle>{t("platformAgents.runtime")}</CardTitle></CardHeader><StructuredDataView data={definition.draft.runtime} /></Card>
      <Card className="lg:col-span-2"><CardHeader><CardTitle>{t("platformAgents.resources")}</CardTitle></CardHeader><StructuredDataView data={definition.draft.resources} empty={t("platformAgents.noResources")} /></Card>
    </div>}

    {tab === "releases" && <div className="space-y-4">
      {manageGatewayIds.size > 0 && releases.length > 0 && <Card className="space-y-3"><CardHeader><CardTitle>{t("platformAgents.createDeployment")}</CardTitle></CardHeader><div className="flex flex-col gap-2 sm:flex-row">
        <Select name="deployment-release" value={selectedIntentRelease} onChange={setIntentRelease} options={releases.map((item) => ({ value: item.id, label: `Release ${item.number}` }))} />
        <Select name="deployment-gateway" value={selectedIntentGateway} onChange={setIntentGateway} options={[...manageGatewayIds].map((gatewayId) => ({ value: gatewayId, label: gatewayId }))} />
        <Button disabled={mutating || !selectedIntentRelease || !selectedIntentGateway} onClick={() => void createIntent()}>{t("platformAgents.createDeployment")}</Button>
      </div></Card>}
      {inspectDeployments && manageGatewayIds.size === 0 && <Card className="border-amber-500/30 text-sm text-amber-200">{t("platformAgents.noManageTargets")}</Card>}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Card><CardHeader><CardTitle>{t("platformAgents.releases")}</CardTitle></CardHeader>{releases.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">{t("platformAgents.noReleases")}</p> : <div className="space-y-2">{releases.map((item) => <details key={item.id} className="rounded-md border border-slate-700/70 p-3"><summary className="cursor-pointer"><span className="font-medium text-slate-100">Release {item.number}</span><span className="ml-2 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString(locale)}</span></summary><div className="mt-3"><StructuredDataView data={{ digest: item.digest, runtime: item.runtimeType, dependencies: item.dependencies }} /></div></details>)}</div>}</Card>
        <div className="space-y-3">{deployments.length === 0 ? <Card className="p-8 text-center text-sm text-slate-500">{t("platformAgents.noDeployments")}</Card> : deployments.map((deployment) => <DeploymentCard key={deployment.id} deployment={deployment} releases={releases} operations={operations[deployment.id] ?? []} manageable={manageGatewayIds.has(deployment.target.gatewayId)} busy={busyDeployment === deployment.id} onAction={(action, releaseId) => void deploymentAction(deployment, action, releaseId)} />)}</div>
      </div>
    </div>}

    {tab === "access" && <div className="space-y-3">{endpoints.length === 0 ? <Card className="p-8 text-center text-sm text-slate-500">{t("platformAgents.noAgentEndpoints")}</Card> : endpoints.map((endpoint) => <Card key={endpoint.deploymentId}><CardHeader><div><CardTitle>{endpoint.gatewayId}</CardTitle><p className="mt-1 font-mono text-xs text-slate-400">{endpoint.pathPrefix}</p></div><div className="flex gap-2"><Badge tone={endpoint.protected ? "green" : "red"}>{endpoint.protected ? t("platformAccess.protected") : t("platformAccess.unprotected")}</Badge><Badge tone={endpoint.invocable ? "blue" : "amber"}>{endpoint.invocable ? t("platformAccess.invocable") : t("platformAccess.notInvocable")}</Badge></div></CardHeader><p className="text-xs text-slate-500">{endpoint.keys.length} eligible key references · bearer hidden</p></Card>)}</div>}

    {tab === "observability" && <div className="space-y-4">
      <div className="flex justify-end"><Select name="agent-observation-kind" value={observationKind} onChange={(value) => setObservationKind(value as DeploymentObservationKind)} options={(["health", "activity", "interactions", "usage"] as DeploymentObservationKind[]).map((kind) => ({ value: kind, label: t(`tenantObservability.${kind}`) }))} /></div>
      {observations.length === 0 ? <Card className="p-8 text-center text-sm text-slate-500">{t("platformAgents.noObservations")}</Card> : observations.map((item) => <Card key={`${item.deploymentId}:${item.kind}`}><CardHeader><div><CardTitle>{item.gatewayId}</CardTitle><p className="font-mono text-[11px] text-slate-500">{item.deploymentId}</p></div><Badge tone="blue">{item.kind}</Badge></CardHeader><StructuredDataView data={item.data} empty={t("platformAgents.noObservations")} /></Card>)}
      {Object.entries(operational).map(([deploymentId, metadata]) => <Card key={deploymentId}><CardHeader><CardTitle>{t("platformAgents.runtimeActivity")}</CardTitle><Badge tone="neutral">{metadata.gatewayId}</Badge></CardHeader><div className="space-y-4"><section><h4 className="mb-2 text-xs font-semibold uppercase text-slate-400">{t("platformAgents.sessions")}</h4><StructuredRows rows={metadata.sessions} /></section><section><h4 className="mb-2 text-xs font-semibold uppercase text-slate-400">{t("platformAgents.runs")}</h4><div className="space-y-2">{metadata.runs.length === 0 ? <p className="text-xs text-slate-500">—</p> : metadata.runs.map((run, index) => { const runId = stringField(run, "run_id", "runId"); return <div key={runId ?? index} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-700/60 p-3"><StructuredDataView data={run} /><Button variant="danger" disabled={!manageGatewayIds.has(metadata.gatewayId) || busyDeployment === deploymentId} onClick={() => void cancelRun(deploymentId, run)}>{t("platformAgents.cancelRun")}</Button></div>; })}</div></section><section><h4 className="mb-2 text-xs font-semibold uppercase text-slate-400">{t("platformAgents.permissions")}</h4><div className="space-y-2">{metadata.permissions.length === 0 ? <p className="text-xs text-slate-500">—</p> : metadata.permissions.map((permission, index) => { const permissionId = stringField(permission, "request_id", "requestId"); return <div key={permissionId ?? index} className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3"><StructuredDataView data={permission} /><PermissionControls value={permission} busy={!manageGatewayIds.has(metadata.gatewayId) || busyDeployment === deploymentId} onResolve={(decision) => void resolvePermission(deploymentId, permission, decision)} /></div>; })}</div></section></div></Card>)}
    </div>}

    {tab === "test" && <PlatformAgentTestPanel endpoints={endpoints} />}
    <ConfirmDialog isOpen={confirmArchive} title={t("platformAgents.archiveTitle")} message={t("platformAgents.archiveMessage")} confirmLabel={t("authored.archive")} variant="danger" onConfirm={() => void archive()} onClose={() => setConfirmArchive(false)} />
  </div>;
}
