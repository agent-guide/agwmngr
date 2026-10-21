"use client";

import { useMemo, useState } from "react";
import { useI18n } from "./i18n-provider";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Select } from "./ui/select";
import { API_BASE_URL, getToken } from "@/lib/auth";
import {
  createDeploymentInvocation,
  type AgentDeploymentEndpoint,
} from "@/lib/platform-api";
import { extractApiError } from "@/lib/utils";

function eventText(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const event = value as Record<string, unknown>;
  for (const key of ["text", "delta", "message", "content"]) {
    if (typeof event[key] === "string") return event[key];
  }
  return "";
}

export function PlatformAgentTestPanel({ endpoints }: { endpoints: AgentDeploymentEndpoint[] }) {
  const { t } = useI18n();
  const invocable = useMemo(() => endpoints.filter((item) => item.invocable && item.keys.length > 0), [endpoints]);
  const [chosenDeployment, setChosenDeployment] = useState("");
  const endpoint = invocable.find((item) => item.deploymentId === chosenDeployment) ?? invocable[0];
  const [chosenKey, setChosenKey] = useState("");
  const key = endpoint?.keys.some((item) => item.id === chosenKey)
    ? chosenKey
    : endpoint?.keys[0]?.id ?? "";
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!endpoint || !key || !prompt.trim()) return;
    setRunning(true);
    setResult("");
    setError(null);
    try {
      const context = await createDeploymentInvocation(
        endpoint.tenantId,
        endpoint.deploymentId,
        key,
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
      let output = "";
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const data = frame.split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");
          if (!data || data === "[DONE]") continue;
          try { output += eventText(JSON.parse(data)); }
          catch { /* Ignore malformed upstream events without exposing transport details. */ }
        }
        setResult(output);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("platformAccess.testFailed"));
    } finally {
      setRunning(false);
    }
  };

  if (invocable.length === 0) {
    return <Card className="p-8 text-center text-sm text-slate-500">{t("platformAgents.noAgentEndpoints")}</Card>;
  }
  return <div className="space-y-4">
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select name="test-deployment" value={endpoint.deploymentId} onChange={setChosenDeployment}
          options={invocable.map((item) => ({ value: item.deploymentId, label: `${item.gatewayId} · ${item.pathPrefix}` }))} />
        <Select name="test-key" value={key} onChange={setChosenKey}
          options={endpoint.keys.map((item) => ({ value: item.id, label: item.id }))} />
        <Badge tone="green">{t("platformAccess.protected")}</Badge>
      </div>
      <p className="text-xs text-slate-500">{t("platformAgents.testDescription")}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <textarea name="test-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)}
          placeholder={t("platformAccess.testPrompt")} rows={4}
          className="glass-input min-w-0 flex-1 resize-y rounded-md px-3 py-2 text-sm text-slate-100" />
        <Button disabled={running || !prompt.trim()} onClick={() => void run()} className="self-end">
          {running ? t("common.loading") : t("platformAccess.test")}
        </Button>
      </div>
    </Card>
    {error && <Card className="border-rose-500/30 text-sm text-rose-300">{error}</Card>}
    {(running || result) && <Card>
      <pre className="min-h-24 whitespace-pre-wrap text-sm leading-6 text-slate-200">{result || "…"}</pre>
    </Card>}
  </div>;
}
