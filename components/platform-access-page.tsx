"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCurrentUser } from "./current-user-context";
import { useI18n } from "./i18n-provider";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardHeader, CardTitle } from "./ui/card";
import { PageHeader } from "./ui/page-header";
import { Select } from "./ui/select";
import { API_BASE_URL, getToken } from "@/lib/auth";
import {
  createDeploymentInvocation,
  listTenantAgentEndpoints,
  type AgentDeploymentEndpoint,
} from "@/lib/platform-api";
import { extractApiError } from "@/lib/utils";

export function PlatformAccessPage({ mode }: { mode: "endpoints" | "keys" }) {
  const { platformAccess } = useCurrentUser();
  const { t } = useI18n();
  const tenants = platformAccess?.memberships ?? [];
  const [tenantId, setTenantId] = useState("");
  const [items, setItems] = useState<AgentDeploymentEndpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, string>>({});

  const selectedTenant = tenants.some((item) => item.tenantId === tenantId)
    ? tenantId : tenants[0]?.tenantId ?? "";
  useEffect(() => {
    if (selectedTenant && tenantId !== selectedTenant) setTenantId(selectedTenant);
  }, [selectedTenant, tenantId]);

  const load = useCallback(async () => {
    if (!selectedTenant) { setItems([]); return; }
    setLoading(true); setError(null);
    try { setItems(await listTenantAgentEndpoints(selectedTenant)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("platformAccess.agentLoadFailed")); }
    finally { setLoading(false); }
  }, [selectedTenant, t]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  const eligibleKeys = useMemo(() => items.flatMap((item) => item.keys.map((key) => ({
    ...key,
    deploymentId: item.deploymentId,
    definitionId: item.definitionId,
    gatewayId: item.gatewayId,
    routeId: item.gatewayRouteId,
  }))), [items]);

  const test = async (endpoint: AgentDeploymentEndpoint) => {
    if (!prompt.trim() || endpoint.keys.length === 0) return;
    setRunning(endpoint.deploymentId);
    setResult((current) => ({ ...current, [endpoint.deploymentId]: "" }));
    try {
      const context = await createDeploymentInvocation(
        endpoint.tenantId,
        endpoint.deploymentId,
        endpoint.keys[0].id,
      );
      const token = getToken();
      const response = await fetch(
        `${API_BASE_URL}/api/platform/v1/tenants/${encodeURIComponent(endpoint.tenantId)}` +
          `/invocations/${encodeURIComponent(context.id)}/turn`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ input: prompt.trim() }),
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
          } catch { /* ignore malformed upstream events */ }
        }
        setResult((current) => ({ ...current, [endpoint.deploymentId]: text }));
      }
    } catch (cause) {
      setResult((current) => ({
        ...current,
        [endpoint.deploymentId]: cause instanceof Error ? cause.message : t("platformAccess.testFailed"),
      }));
    } finally { setRunning(null); }
  };

  return <div className="space-y-4">
    <PageHeader
      title={t(mode === "endpoints" ? "platformAccess.endpoints" : "platformAccess.keys")}
      description={t(mode === "endpoints" ? "platformAccess.endpointsDescription" : "platformAccess.keysDescription")}
      actions={<Select name="access-tenant" value={selectedTenant} onChange={setTenantId}
        options={tenants.map((item) => ({ value: item.tenantId, label: item.tenant.name }))} />}
    />
    {error && <Card className="border-rose-500/30 text-sm text-rose-300">{error}</Card>}
    {!selectedTenant ? <Card className="p-8 text-center text-sm text-slate-500">{t("platformAccess.noTenant")}</Card>
      : loading ? <Card className="p-8 text-center text-sm text-slate-400">{t("common.loading")}</Card>
        : mode === "keys" ? (
          <div className="space-y-3">{eligibleKeys.length === 0
            ? <Card className="p-8 text-center text-sm text-slate-500">{t("platformAccess.noKeys")}</Card>
            : eligibleKeys.map((key) => <Card key={`${key.deploymentId}:${key.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><p className="font-mono text-sm text-slate-100">{key.id}</p>
                  <p className="mt-1 text-xs text-slate-500">{key.definitionId} · {key.gatewayId}</p></div>
                <div className="flex gap-2"><Badge tone="green">{key.status}</Badge>
                  <Badge tone="blue">{t("platformAccess.explicitRoute")}</Badge></div>
              </div>
              <p className="mt-3 break-all font-mono text-[11px] text-slate-500">{key.routeId}</p>
            </Card>)}</div>
        ) : <div className="space-y-3">{items.length === 0
          ? <Card className="p-8 text-center text-sm text-slate-500">{t("platformAccess.noEndpoints")}</Card>
          : items.map((item) => <Card key={item.deploymentId}>
            <CardHeader><div><CardTitle>{item.definitionId}</CardTitle>
              <p className="mt-1 font-mono text-[11px] text-slate-500">{item.pathPrefix}</p></div>
              <div className="flex gap-2"><Badge tone={item.protected ? "green" : "red"}>
                {item.protected ? t("platformAccess.protected") : t("platformAccess.unprotected")}</Badge>
                <Badge tone={item.invocable ? "blue" : "amber"}>
                  {item.invocable ? t("platformAccess.invocable") : t("platformAccess.notInvocable")}</Badge></div>
            </CardHeader>
            <p className="text-xs text-slate-500">{item.gatewayId} · {item.gatewayRouteId}</p>
            {item.invocable && <div className="mt-3 flex gap-2">
              <input value={prompt} onChange={(event) => setPrompt(event.target.value)}
                placeholder={t("platformAccess.testPrompt")}
                className="glass-input min-w-0 flex-1 rounded-md px-3 py-2 text-sm text-slate-100" />
              <Button disabled={!prompt.trim() || running !== null}
                onClick={() => void test(item)}>{running === item.deploymentId
                  ? t("common.loading") : t("platformAccess.test")}</Button>
            </div>}
            {result[item.deploymentId] !== undefined && <pre className="mt-3 whitespace-pre-wrap rounded-md border border-slate-700/70 bg-slate-950/50 p-3 text-xs text-slate-300">{result[item.deploymentId] || "…"}</pre>}
          </Card>)}</div>}
  </div>;
}
