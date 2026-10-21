"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCurrentUser } from "@/components/current-user-context";
import { useI18n } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import type { VirtualKeyItem } from "@/lib/api";
import {
  abandonDeploymentKeyBinding,
  bindDeploymentKey,
  createPlatformGatewayVirtualKey,
  decommissionAgentDeployment,
  deletePlatformGatewayVirtualKey,
  listDeploymentKeyBindings,
  listPlatformGatewayVirtualKeys,
  reconcilePlatformGatewayVirtualKeyContainment,
  reconcilePlatformGatewayVirtualKey,
  revealPlatformGatewayVirtualKey,
  retryDeploymentKeyBindingCleanup,
  setPlatformGatewayVirtualKeyEnabled,
  unbindDeploymentKey,
  type DeploymentKeyBinding,
  type DeploymentKeyBindingCandidate,
} from "@/lib/platform-api";

export default function PlatformGatewayVirtualKeysPage() {
  const { gatewayId } = useParams<{ gatewayId: string }>();
  const { user, gateways } = useCurrentUser();
  const { t } = useI18n();
  const { showToast } = useToast();
  const [keys, setKeys] = useState<VirtualKeyItem[]>([]);
  const [bindings, setBindings] = useState<DeploymentKeyBinding[]>([]);
  const [candidates, setCandidates] = useState<DeploymentKeyBindingCandidate[]>([]);
  const [deploymentId, setDeploymentId] = useState("");
  const [keyId, setKeyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newKeyId, setNewKeyId] = useState("");
  const [visibleSecret, setVisibleSecret] = useState<{ id: string; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gateway = gateways.find((item) => item.id === gatewayId);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [nextKeys, state] = await Promise.all([
        listPlatformGatewayVirtualKeys(gatewayId),
        listDeploymentKeyBindings(gatewayId),
      ]);
      setKeys(nextKeys); setBindings(state.items); setCandidates(state.candidates);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("deploymentKeys.loadFailed")); }
    finally { setLoading(false); }
  }, [gatewayId, t]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  const available = useMemo(() => candidates.filter((item) =>
    item.lifecycleState === "awaiting_key_binding" && !item.bindingKeyId), [candidates]);
  const selectedDeployment = available.some((item) => item.deploymentId === deploymentId)
    ? deploymentId : available[0]?.deploymentId ?? "";
  const selectedKey = keys.some((item) => item.id === keyId) ? keyId : keys[0]?.id ?? "";

  const bind = async () => {
    if (!selectedDeployment || !selectedKey) return;
    setSaving(true);
    try {
      await bindDeploymentKey(gatewayId, selectedDeployment, selectedKey);
      showToast(t("deploymentKeys.bound"), "success");
      setDeploymentId(""); await load();
    } catch (cause) { showToast(cause instanceof Error ? cause.message : t("deploymentKeys.bindFailed"), "error"); }
    finally { setSaving(false); }
  };
  const unbind = async (item: DeploymentKeyBinding) => {
    setSaving(true);
    try {
      await unbindDeploymentKey(gatewayId, item.deploymentId);
      showToast(t("deploymentKeys.unbound"), "success"); await load();
    } catch (cause) { showToast(cause instanceof Error ? cause.message : t("deploymentKeys.unbindFailed"), "error"); }
    finally { setSaving(false); }
  };
  const toggleKey = async (key: VirtualKeyItem) => {
    setSaving(true);
    try {
      await setPlatformGatewayVirtualKeyEnabled(gatewayId, key.id, key.disabled);
      showToast(t(key.disabled ? "deploymentKeys.enabled" : "deploymentKeys.disabled"), "success");
      await load();
    } catch (cause) { showToast(cause instanceof Error ? cause.message : t("deploymentKeys.lifecycleFailed"), "error"); }
    finally { setSaving(false); }
  };
  const reconcile = async (item: DeploymentKeyBinding) => {
    setSaving(true);
    try {
      await reconcilePlatformGatewayVirtualKeyContainment(gatewayId, item.keyId);
      showToast(t("deploymentKeys.reconciled"), "success"); await load();
    } catch (cause) { showToast(cause instanceof Error ? cause.message : t("deploymentKeys.reconcileFailed"), "error"); }
    finally { setSaving(false); }
  };
  const reconcileOrdinary = async (key: VirtualKeyItem) => {
    setSaving(true);
    try {
      await reconcilePlatformGatewayVirtualKey(gatewayId, key.id);
      showToast(t("deploymentKeys.reconciled"), "success"); await load();
    } catch (cause) { showToast(cause instanceof Error ? cause.message : t("deploymentKeys.reconcileFailed"), "error"); }
    finally { setSaving(false); }
  };
  const decommission = async (item: DeploymentKeyBinding) => {
    setSaving(true);
    try {
      await decommissionAgentDeployment(
        gatewayId,
        item.deploymentId,
        `decommission:${crypto.randomUUID()}`,
      );
      showToast(t("deploymentKeys.decommissioned"), "success"); await load();
    } catch (cause) { showToast(cause instanceof Error ? cause.message : t("deploymentKeys.decommissionFailed"), "error"); }
    finally { setSaving(false); }
  };
  const abandon = async (item: DeploymentKeyBinding) => {
    setSaving(true);
    try {
      await abandonDeploymentKeyBinding(gatewayId, item.deploymentId);
      showToast(t("deploymentKeys.abandoned"), "success"); await load();
    } catch (cause) { showToast(cause instanceof Error ? cause.message : t("deploymentKeys.abandonFailed"), "error"); }
    finally { setSaving(false); }
  };
  const retryBindingCleanup = async (item: DeploymentKeyBinding) => {
    setSaving(true);
    try {
      await retryDeploymentKeyBindingCleanup(gatewayId, item.deploymentId);
      showToast(t("deploymentKeys.abandoned"), "success"); await load();
    } catch (cause) { showToast(cause instanceof Error ? cause.message : t("deploymentKeys.abandonFailed"), "error"); }
    finally { setSaving(false); }
  };
  const createKey = async () => {
    if (!newKeyId.trim()) return;
    setSaving(true);
    try {
      const created = await createPlatformGatewayVirtualKey(gatewayId, {
        id: newKeyId.trim(), disabled: true, allowed_route_ids: [],
      });
      if (created.key) setVisibleSecret({ id: created.id, key: created.key });
      setNewKeyId(""); showToast(t("deploymentKeys.created"), "success"); await load();
    } catch (cause) { showToast(cause instanceof Error ? cause.message : t("deploymentKeys.createFailed"), "error"); }
    finally { setSaving(false); }
  };
  const reveal = async (key: VirtualKeyItem) => {
    setSaving(true);
    try { setVisibleSecret(await revealPlatformGatewayVirtualKey(gatewayId, key.id)); }
    catch (cause) { showToast(cause instanceof Error ? cause.message : t("deploymentKeys.revealFailed"), "error"); }
    finally { setSaving(false); }
  };
  const removeKey = async (key: VirtualKeyItem) => {
    setSaving(true);
    try {
      await deletePlatformGatewayVirtualKey(gatewayId, key.id);
      showToast(t("deploymentKeys.deleted"), "success"); await load();
    } catch (cause) { showToast(cause instanceof Error ? cause.message : t("deploymentKeys.deleteFailed"), "error"); }
    finally { setSaving(false); }
  };

  if (user && !user.is_platform_admin) return <Card className="p-8 text-center text-sm text-amber-200">{t("deploymentKeys.adminRequired")}</Card>;
  return <div className="space-y-4">
    <PageHeader title={t("deploymentKeys.title")}
      description={t("deploymentKeys.description", { gateway: gateway?.name ?? gatewayId })}
      actions={<Link href="/dashboard/platform/gateways" className="text-sm text-blue-400 hover:underline">{t("deploymentKeys.back")}</Link>} />
    {error && <Card className="border-rose-500/30 text-sm text-rose-300">{error}</Card>}
    {visibleSecret && <Card className="border-amber-500/30 bg-amber-500/5">
      <p className="text-sm font-semibold text-amber-200">{t("deploymentKeys.secretTitle")}</p>
      <p className="mt-1 text-xs text-slate-400">{t("deploymentKeys.secretHelp")}</p>
      <pre className="mt-3 overflow-x-auto rounded-md bg-slate-950/70 p-3 text-xs text-slate-100">{visibleSecret.key}</pre>
      <Button variant="ghost" className="mt-2 px-2 py-1 text-xs" onClick={() => setVisibleSecret(null)}>{t("common.dismiss")}</Button>
    </Card>}
    <Card><CardHeader><CardTitle>{t("deploymentKeys.createTitle")}</CardTitle></CardHeader>
      <p className="mb-3 text-xs text-slate-500">{t("deploymentKeys.createHelp")}</p>
      <div className="flex gap-2"><Input name="new-key-id" value={newKeyId} onChange={setNewKeyId} placeholder="tenant-agent-key" />
        <Button disabled={saving || !newKeyId.trim()} onClick={() => void createKey()}>{t("common.create")}</Button></div>
    </Card>
    <Card><CardHeader><CardTitle>{t("deploymentKeys.keyLifecycle")}</CardTitle></CardHeader>
      <div className="space-y-2">{keys.map((key) => <div key={key.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-700/70 p-2">
        <div><p className="font-mono text-xs text-slate-200">{key.id}</p>
          <p className={`mt-1 text-[11px] ${(key.allowed_route_ids?.length ?? 0) === 0 ? "text-amber-300" : "text-slate-500"}`}>
            {(key.allowed_route_ids?.length ?? 0) === 0 ? t("deploymentKeys.allowAll") : t("deploymentKeys.routeCount", { count: key.allowed_route_ids?.length ?? 0 })}
          </p></div>
        <div className="flex flex-wrap gap-1"><Button variant={key.disabled ? "secondary" : "danger"} className="px-2 py-1 text-xs"
          disabled={saving || (key.disabled && (key.allowed_route_ids?.length ?? 0) === 0)}
          onClick={() => void toggleKey(key)}>{key.disabled ? t("deploymentKeys.enable") : t("deploymentKeys.disable")}</Button>
          <Button variant="ghost" className="px-2 py-1 text-xs" disabled={saving}
            onClick={() => void reveal(key)}>{t("deploymentKeys.reveal")}</Button>
          {key.manager_policy_status === "reconciliation_required" && <Button
            variant="secondary" className="px-2 py-1 text-xs" disabled={saving}
            onClick={() => void reconcileOrdinary(key)}>{t("deploymentKeys.reconcile")}</Button>}
          <Button variant="danger" className="px-2 py-1 text-xs"
            disabled={saving || bindings.some((item) => item.keyId === key.id)}
            onClick={() => void removeKey(key)}>{t("common.delete")}</Button></div>
      </div>)}</div>
    </Card>
    <Card><CardHeader><CardTitle>{t("deploymentKeys.bindTitle")}</CardTitle></CardHeader>
      <p className="mb-3 text-xs text-slate-500">{t("deploymentKeys.bindHelp")}</p>
      <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
        <Select name="deployment" value={selectedDeployment} onChange={setDeploymentId}
          options={available.length ? available.map((item) => ({ value: item.deploymentId, label: `${item.tenantId} · ${item.definitionId}` }))
            : [{ value: "", label: t("deploymentKeys.noCandidates") }]} />
        <Select name="virtual-key" value={selectedKey} onChange={setKeyId}
          options={keys.length ? keys.map((item) => ({ value: item.id, label: `${item.id}${item.disabled ? ` · ${t("common.disabled")}` : ""}` }))
            : [{ value: "", label: t("deploymentKeys.noKeys") }]} />
        <Button onClick={() => void bind()} disabled={saving || !selectedDeployment || !selectedKey}>{t("deploymentKeys.bind")}</Button>
      </div>
    </Card>
    <div className="space-y-3">{loading ? <Card className="p-8 text-center text-sm text-slate-400">{t("common.loading")}</Card>
      : bindings.length === 0 ? <Card className="p-8 text-center text-sm text-slate-500">{t("deploymentKeys.empty")}</Card>
        : bindings.map((item) => {
          const candidate = candidates.find((value) => value.deploymentId === item.deploymentId);
          const key = keys.find((value) => value.id === item.keyId);
          return <Card key={item.deploymentId}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-sm font-semibold text-slate-100">{candidate?.definitionId ?? item.deploymentId}</p>
                <p className="mt-1 font-mono text-[11px] text-slate-500">{item.deploymentId}</p></div>
              <div className="flex gap-2"><Badge tone={item.status === "bound" ? "green" : "amber"}>{item.status}</Badge>
                <Badge tone={item.keyPolicyStatus === "stable" ? "blue" : "red"}>{item.keyPolicyStatus}</Badge></div>
            </div>
            <div className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
              <p>{t("deploymentKeys.key")}: <span className="font-mono text-slate-200">{item.keyId}</span>{key?.disabled ? ` · ${t("common.disabled")}` : ""}</p>
              <p className="break-all">{t("deploymentKeys.route")}: <span className="font-mono text-slate-200">{item.routeId}</span></p>
            </div>
            {candidate?.lifecycleState === "ready_to_apply" && <Button variant="danger" className="mt-3 px-2 py-1 text-xs"
              disabled={saving} onClick={() => void unbind(item)}>{t("deploymentKeys.unbind")}</Button>}
            {candidate?.lifecycleState === "awaiting_key_binding" && item.status === "binding" && <Button variant="danger" className="mt-3 px-2 py-1 text-xs"
              disabled={saving} onClick={() => void abandon(item)}>{t("deploymentKeys.abandon")}</Button>}
            {candidate?.lifecycleState === "awaiting_key_binding" && item.status === "cleanup_required" && <Button variant="danger" className="mt-3 px-2 py-1 text-xs"
              disabled={saving} onClick={() => void retryBindingCleanup(item)}>{t("deploymentKeys.retryCleanup")}</Button>}
            {candidate && ["active", "offline", "partial_failure", "deleting"].includes(candidate.lifecycleState) && <Button variant="danger" className="mt-3 px-2 py-1 text-xs"
              disabled={saving} onClick={() => void decommission(item)}>{t("deploymentKeys.decommission")}</Button>}
            {["quarantined_contained", "containment_failed"].includes(item.keyPolicyStatus) && <Button className="mt-3 ml-2 px-2 py-1 text-xs"
              disabled={saving} onClick={() => void reconcile(item)}>{t("deploymentKeys.reconcile")}</Button>}
          </Card>;
        })}</div>
  </div>;
}
