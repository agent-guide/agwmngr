"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useI18n } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StructuredDataView } from "@/components/structured-data-view";
import { API_BASE_URL, getToken } from "@/lib/auth";
import {
  createGatewayCompatibilityInvocation,
  getPlatformGatewayAgent,
  listPlatformGatewayAgentRoutes,
  listPlatformGatewayVirtualKeys,
  reconcilePlatformGatewayAgent,
} from "@/lib/platform-api";
import { extractApiError } from "@/lib/utils";

interface AgentDocument {
  id: string;
  name?: string;
  disabled?: boolean;
  runtime?: { type?: "acp" | "builtin" | "http" };
}
interface RouteDocument {
  id: string;
  agent_id: string;
  protocol?: "agent" | "a2a";
  disabled?: boolean;
  auth_policy?: { require_virtual_key?: boolean };
}

export default function GatewayAgentDetailPage() {
  const { gatewayId, agentId } = useParams<{ gatewayId: string; agentId: string }>();
  const { t } = useI18n();
  const [agent, setAgent] = useState<AgentDocument | null>(null);
  const [routes, setRoutes] = useState<RouteDocument[]>([]);
  const [keys, setKeys] = useState<Awaited<ReturnType<typeof listPlatformGatewayVirtualKeys>>>([]);
  const [routeId, setRouteId] = useState("");
  const [keyId, setKeyId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState("");
  const [running, setRunning] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [agentValue, routeValues, keyValues] = await Promise.all([
        getPlatformGatewayAgent(gatewayId, agentId),
        listPlatformGatewayAgentRoutes(gatewayId),
        listPlatformGatewayVirtualKeys(gatewayId),
      ]);
      setAgent(agentValue as AgentDocument);
      setRoutes((routeValues as RouteDocument[]).filter((item) =>
        item.agent_id === agentId && item.protocol === "agent"));
      setKeys(keyValues);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("gatewayAgentDetail.loadFailed"));
    }
  }, [agentId, gatewayId, t]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const reconcile = async () => {
    setReconciling(true);
    try {
      await reconcilePlatformGatewayAgent(gatewayId, agentId);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("gatewayAgentDetail.reconcileFailed"));
    } finally {
      setReconciling(false);
    }
  };

  const selectedRoute = routes.find((item) => item.id === routeId) ?? routes.find((item) =>
    !item.disabled && item.auth_policy?.require_virtual_key === true) ?? routes[0];
  const eligibleKeys = useMemo(() => keys.filter((item) =>
    !item.disabled && item.manager_policy_status === "stable" && selectedRoute &&
      item.allowed_route_ids?.includes(selectedRoute.id)),
  [keys, selectedRoute]);
  const selectedKey = eligibleKeys.some((item) => item.id === keyId)
    ? keyId : eligibleKeys[0]?.id ?? "";

  const runTest = async () => {
    if (!selectedRoute || !selectedKey || !prompt.trim()) return;
    setRunning(true); setResult(""); setError(null);
    try {
      const context = await createGatewayCompatibilityInvocation(
        gatewayId,
        agentId,
        selectedRoute.id,
        selectedKey,
      );
      const token = getToken();
      const response = await fetch(
        `${API_BASE_URL}/api/platform/v1/gateways/${encodeURIComponent(gatewayId)}` +
          `/agent-invocations/${encodeURIComponent(context.id)}/turn`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            input: prompt.trim(),
            options: {
              version: "v1",
              ...(agent?.runtime?.type === "acp"
                ? { runtime: { thread_id: crypto.randomUUID() } }
                : {}),
            },
          }),
        },
      );
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        throw new Error(extractApiError(body, `request failed (${response.status})`));
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const data = frame.split("\n").filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim()).join("\n");
          if (!data) continue;
          try {
            const event = JSON.parse(data) as { text?: string; message?: string };
            text += event.text ?? event.message ?? "";
          } catch { /* Ignore malformed upstream frames. */ }
        }
        setResult(text);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("gatewayAgentDetail.testFailed"));
    } finally { setRunning(false); }
  };

  return <div className="space-y-4">
    <PageHeader title={agent?.name ?? agentId}
      description={t("gatewayAgentDetail.description", { gateway: gatewayId })}
      actions={<div className="flex items-center gap-3"><Link
        href={`/dashboard/platform/gateways/${encodeURIComponent(gatewayId)}/agents/${encodeURIComponent(agentId)}/edit`}>
        <Button variant="secondary" className="px-2.5 py-1 text-xs">{t("common.edit")}</Button>
      </Link><Link className="text-sm text-blue-400 hover:underline"
        href={`/dashboard/platform/gateways/${encodeURIComponent(gatewayId)}/agents`}>
        {t("gatewayAgentDetail.back")}</Link></div>} />
    {error && <Card className="border-rose-500/30 text-sm text-rose-300"><div className="flex flex-wrap items-center justify-between gap-3"><span>{error}</span><Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={reconciling} onClick={() => void reconcile()}>{reconciling ? t("common.loading") : t("gatewayAgentDetail.reconcile")}</Button></div></Card>}
    <Card><CardHeader><CardTitle>{t("gatewayAgentDetail.configuration")}</CardTitle>
      <Badge tone={agent?.disabled ? "neutral" : "green"}>{agent?.disabled
        ? t("common.disabled") : t("common.enabled")}</Badge></CardHeader>
      {agent ? <StructuredDataView data={agent} /> : <p className="text-sm text-slate-400">{t("common.loading")}</p>}
    </Card>
    <Card><CardHeader><CardTitle>{t("gatewayAgentDetail.test")}</CardTitle></CardHeader>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-xs text-slate-400">{t("gatewayAgentDetail.route")}
          <select className="glass-input block w-full rounded-md px-3 py-2 text-sm text-slate-100"
            value={selectedRoute?.id ?? ""} onChange={(event) => setRouteId(event.target.value)}>
            {routes.map((route) => <option key={route.id} value={route.id}>{route.id}</option>)}
          </select></label>
        <label className="space-y-1 text-xs text-slate-400">{t("gatewayAgentDetail.key")}
          <select className="glass-input block w-full rounded-md px-3 py-2 text-sm text-slate-100"
            value={selectedKey} onChange={(event) => setKeyId(event.target.value)}>
            {eligibleKeys.map((key) => <option key={key.id} value={key.id}>{key.id}</option>)}
          </select></label>
      </div>
      <div className="mt-3 flex gap-2"><input className="glass-input min-w-0 flex-1 rounded-md px-3 py-2 text-sm text-slate-100"
        value={prompt} onChange={(event) => setPrompt(event.target.value)}
        placeholder={t("gatewayAgentDetail.prompt")} />
        <Button disabled={running || !prompt.trim() || !selectedRoute || !selectedKey}
          onClick={() => void runTest()}>{running ? t("common.loading") : t("gatewayAgentDetail.run")}</Button></div>
      {result && <pre className="mt-3 whitespace-pre-wrap rounded-md border border-slate-700/70 bg-slate-950/50 p-3 text-xs text-slate-300">{result}</pre>}
      {(!selectedRoute || eligibleKeys.length === 0) && <p className="mt-3 text-xs text-amber-300">{t("gatewayAgentDetail.noEligibleRouteKey")}</p>}
    </Card>
  </div>;
}
