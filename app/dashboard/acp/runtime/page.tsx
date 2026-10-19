"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { AutoRefreshControl } from "@/components/ui/auto-refresh-control";
import { useToast } from "@/components/ui/toast";
import { HelpTooltip } from "@/components/ui/tooltip";
import { useAdminSWR } from "@/hooks/use-admin-swr";
import { PendingPermissions, normalizeACPRuntimePermission } from "@/components/acp-pending-permissions";
import {
  ApiError,
  getACPRuntime,
  closeACPThread,
} from "@/lib/api";
import { useI18n } from "@/components/i18n-provider";

// A pool scope is NUL-separated: ownerID \0 cwd \0 threadID \0 sessionID \0 model
// (pkg/acp/runtime/manager.go). The admin views already surface the owning
// agent_id, so only the thread id has to be recovered from the scope. Rendering
// the raw scope would emit invisible NUL bytes, so it is always split for display.
const SCOPE_SEP = "\u0000";

interface ParsedScope {
  ownerId: string;
  cwd: string;
  threadId: string;
  sessionId: string;
  model: string;
}

function parseScope(scope: string): ParsedScope | null {
  const parts = scope.split(SCOPE_SEP);
  if (parts.length !== 5) return null;
  const [ownerId, cwd, threadId, sessionId, model] = parts;
  return { ownerId, cwd, threadId, sessionId, model };
}

/** Human-readable scope: NUL is not printable, so join with a visible separator. */
function formatScope(scope: string): string {
  return scope.split(SCOPE_SEP).join(" · ");
}

export default function ACPRuntimePage() {
  const { showToast } = useToast();
  const { locale, t } = useI18n();
  const { data, error, isLoading, isValidating, mutate, lastUpdated } = useAdminSWR(
    "acp-runtime",
    getACPRuntime,
    { live: true },
  );

  const [busyId, setBusyId] = useState<string | null>(null);

  const inFlight = data?.in_flight ?? [];
  const instances = data?.instances ?? [];
  const pending = data?.pending_permissions ?? [];

  const close = async (agentId: string, threadId: string) => {
    const key = `${agentId}:${threadId}`;
    setBusyId(key);
    try {
      const res = await closeACPThread(agentId, threadId);
      showToast(t("runtime.closed", { count: res.closed }), "success");
      void mutate();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : t("runtime.closeFailed"), "error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("nav.acpRuntime")}
        description={
          <>
            {t("runtime.acpDescription")}
            <HelpTooltip content={t("runtime.acpHelp")} />
          </>
        }
        actions={<AutoRefreshControl lastUpdated={lastUpdated} onRefresh={() => void mutate()} refreshing={isValidating} />}
      />

      <StatGrid>
        <StatCard label={t("runtime.inFlight")} value={inFlight.length} />
        <StatCard label={t("runtime.pooled")} value={instances.length} />
        <StatCard label={t("runtime.pending")} value={pending.length} tone={pending.length > 0 ? "text-amber-300" : "text-slate-100"} />
      </StatGrid>

      {isLoading && !data ? (
        <Card className="p-8 text-center text-sm text-slate-400">{t("runtime.loading")}</Card>
      ) : error ? (
        <Card className="p-8 text-center text-sm text-rose-300">{error instanceof Error ? error.message : t("runtime.loadFailed")}</Card>
      ) : (
        <>
          {/* Pending permissions */}
          <Card>
            <CardHeader>
              <CardTitle>{t("runtime.pending")} <HelpTooltip content={t("runtime.pendingHelp")} /></CardTitle>
            </CardHeader>
            <PendingPermissions
              pending={pending.map(normalizeACPRuntimePermission)}
              onResolved={() => void mutate()}
            />
          </Card>

          {/* Pooled instances */}
          <Card>
            <CardHeader><CardTitle>{t("runtime.pooled")}</CardTitle></CardHeader>
            {instances.length === 0 ? (
              <p className="text-xs text-slate-500">{t("runtime.noPooled")}</p>
            ) : (
              <div className="space-y-2">
                {instances.map((inst, i) => {
                  const parsed = parseScope(inst.scope);
                  const closable = parsed?.threadId ? { agentId: inst.agent_id, threadId: parsed.threadId } : null;
                  const busy = closable ? busyId === `${closable.agentId}:${closable.threadId}` : false;
                  return (
                    <div key={i} className="flex items-start justify-between gap-2 rounded-md border border-slate-700/60 bg-slate-900/50 p-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[11px] text-slate-300">{inst.agent_id}</span>
                          {inst.alive && <Badge tone="green">{t("runtime.alive")}</Badge>}
                          {inst.active && <Badge tone="blue">{t("runtime.active")}</Badge>}
                          {inst.session_id && <span className="font-mono text-[11px] text-slate-400">{t("runtime.session", { id: inst.session_id })}</span>}
                          {inst.last_used && <span className="text-[11px] text-slate-500" suppressHydrationWarning>{t("runtime.lastUsed", { time: new Date(inst.last_used).toLocaleString(locale) })}</span>}
                        </div>
                        {parsed?.threadId && (
                          <p className="mt-1 font-mono text-[11px] text-slate-400">{t("runtime.thread", { id: parsed.threadId })}</p>
                        )}
                        <p className="mt-1 break-all font-mono text-[11px] text-slate-500">{formatScope(inst.scope)}</p>
                      </div>
                      {closable && (
                        <Button variant="ghost" className="shrink-0 px-2.5 py-1 text-xs" disabled={busy} onClick={() => void close(closable.agentId, closable.threadId)}>
                          {busy ? t("runtime.closing") : t("common.close")}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* In-flight turns */}
          <Card>
            <CardHeader><CardTitle>{t("runtime.inFlight")}</CardTitle></CardHeader>
            {inFlight.length === 0 ? (
              <p className="text-xs text-slate-500">{t("runtime.noInFlight")}</p>
            ) : (
              <div className="space-y-1.5">
                {inFlight.map((turn, i) => {
                  const parsed = parseScope(turn.scope);
                  const closable = parsed?.threadId ? { agentId: turn.agent_id, threadId: parsed.threadId } : null;
                  const busy = closable ? busyId === `${closable.agentId}:${closable.threadId}` : false;
                  return (
                    <div key={i} className="flex items-center justify-between gap-2 rounded-md border border-slate-700/60 bg-slate-900/50 px-3 py-1.5">
                      <div className="min-w-0">
                        <span className="font-mono text-[11px] text-slate-300">{turn.agent_id}</span>
                        <span className="ml-2 break-all font-mono text-[11px] text-slate-500">{formatScope(turn.scope)}</span>
                      </div>
                      {closable && (
                        <Button variant="ghost" className="shrink-0 px-2 py-0.5 text-[11px]" disabled={busy} onClick={() => void close(closable.agentId, closable.threadId)}>
                          {t("common.close")}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
