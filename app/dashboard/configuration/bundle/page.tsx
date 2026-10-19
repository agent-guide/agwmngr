"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/components/i18n-provider";
import {
  applyBundlePlanItem,
  bundleFromSnapshot,
  loadBundleSnapshot,
  parseGatewayBundle,
  planGatewayBundle,
  serializeGatewayBundle,
  type BundlePlanAction,
  type BundlePlanItem,
} from "@/lib/gateway-bundle";

const TEXTAREA_CLASS = "min-h-[24rem] w-full resize-y rounded-md border border-slate-700/70 bg-slate-950/70 p-4 font-mono text-[11px] leading-5 text-slate-200 focus:border-blue-500/60 focus:outline-none";

function actionTone(action: BundlePlanAction): "green" | "blue" | "neutral" | "red" {
  if (action === "create") return "green";
  if (action === "update") return "blue";
  if (action === "conflict") return "red";
  return "neutral";
}

function downloadText(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/yaml;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "gateway.bundle.yaml";
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function BundlePage() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [exportYaml, setExportYaml] = useState("");
  const [importYaml, setImportYaml] = useState("");
  const [plan, setPlan] = useState<BundlePlanItem[] | null>(null);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [results, setResults] = useState<Record<string, { ok: boolean; message?: string }>>({});

  const actionLabel = (action: BundlePlanAction) => ({
    create: t("bundle.actionCreate"),
    update: t("bundle.actionUpdate"),
    skip: t("bundle.actionSkip"),
    conflict: t("bundle.actionConflict"),
  })[action];

  const reasonLabel = (reason?: string) => {
    if (!reason) return "—";
    if (reason === "Bundle object is marked read-only or Caddyfile-owned") return t("bundle.reasonBundleReadonly");
    if (reason === "Unchanged") return t("bundle.reasonUnchanged");
    if (reason === "Existing object is read-only or Caddyfile-owned") return t("bundle.reasonExistingReadonly");
    const missing = reason.match(/^Missing or unavailable: (.+)$/);
    return missing ? t("bundle.reasonMissing", { detail: missing[1] }) : reason;
  };

  const counts = useMemo(() => {
    const out: Record<BundlePlanAction, number> = { create: 0, update: 0, skip: 0, conflict: 0 };
    for (const item of plan ?? []) out[item.action]++;
    return out;
  }, [plan]);

  const generateExport = async () => {
    setExporting(true);
    try {
      const snapshot = await loadBundleSnapshot();
      setExportYaml(serializeGatewayBundle(bundleFromSnapshot(snapshot)));
      showToast(t("bundle.generated"), "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("bundle.exportFailed"), "error");
    } finally {
      setExporting(false);
    }
  };

  const previewImport = async () => {
    setPlanning(true);
    setError("");
    setPlan(null);
    setResults({});
    try {
      const bundle = parseGatewayBundle(importYaml);
      const snapshot = await loadBundleSnapshot();
      setPlan(planGatewayBundle(bundle, snapshot));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("bundle.invalid"));
    } finally {
      setPlanning(false);
    }
  };

  const applyPlan = async () => {
    if (!plan || counts.conflict > 0) return;
    setConfirmApply(false);
    setApplying(true);
    const nextResults: Record<string, { ok: boolean; message?: string }> = {};
    for (const item of plan) {
      if (item.action !== "create" && item.action !== "update") continue;
      const key = `${item.family}:${item.id}`;
      try {
        await applyBundlePlanItem(item);
        nextResults[key] = { ok: true };
      } catch (err) {
        nextResults[key] = { ok: false, message: err instanceof Error ? err.message : t("bundle.applyFailed") };
      }
      setResults({ ...nextResults });
    }
    setApplying(false);
    const failures = Object.values(nextResults).filter((result) => !result.ok).length;
    showToast(failures ? t("bundle.appliedErrors", { count: failures }) : t("bundle.appliedSuccess"), failures ? "error" : "success");
    try {
      const bundle = parseGatewayBundle(importYaml);
      setPlan(planGatewayBundle(bundle, await loadBundleSnapshot()));
    } catch {
      // Keep the completed plan/results visible if the refresh itself fails.
    }
  };

  const mutatingCount = counts.create + counts.update;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("bundle.title")}
        description={t("bundle.description")}
      />

      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4" role="note">
        <p className="text-sm font-semibold text-amber-200">{t("bundle.noCredentials")}</p>
        <p className="mt-1 text-xs leading-5 text-amber-300/80">
          {t("bundle.noCredentialsHelp")}
        </p>
        <p className="mt-1 text-xs leading-5 text-amber-300/80">
          {t("bundle.sensitiveHelp")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{t("bundle.export")}</CardTitle>
              <p className="mt-1 text-xs text-slate-500">{t("bundle.exportHelp")}</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="px-2.5 py-1 text-xs"
                disabled={!exportYaml}
                onClick={() => void navigator.clipboard.writeText(exportYaml)
                  .then(() => showToast(t("bundle.copied"), "success"))
                  .catch(() => showToast(t("bundle.copyFailed"), "error"))}
              >{t("bundle.copy")}</Button>
              <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={!exportYaml} onClick={() => downloadText(exportYaml)}>{t("bundle.download")}</Button>
              <Button className="px-2.5 py-1 text-xs" disabled={exporting} onClick={() => void generateExport()}>{exporting ? t("bundle.generating") : t("bundle.generate")}</Button>
            </div>
          </div>
        </CardHeader>
        {exportYaml ? (
          <pre className="max-h-[28rem] overflow-auto rounded-md border border-slate-700/70 bg-slate-950/70 p-4 font-mono text-[11px] leading-5 text-slate-300" tabIndex={0}>{exportYaml}</pre>
        ) : (
          <p className="py-8 text-center text-sm text-slate-500">{t("bundle.exportEmpty")}</p>
        )}
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{t("bundle.import")}</CardTitle>
              <p className="mt-1 text-xs text-slate-500">{t("bundle.importHelp")}</p>
            </div>
            <label className="cursor-pointer rounded-md border border-slate-700/70 bg-slate-800/60 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700/70">
              {t("bundle.loadFile")}
              <input
                type="file"
                accept=".yaml,.yml,application/yaml,text/yaml,text/plain"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void file.text().then((text) => { setImportYaml(text); setPlan(null); setError(""); });
                  event.target.value = "";
                }}
              />
            </label>
          </div>
        </CardHeader>
        <textarea
          value={importYaml}
          onChange={(event) => { setImportYaml(event.target.value); setPlan(null); setError(""); setResults({}); }}
          className={TEXTAREA_CLASS}
          spellCheck={false}
          aria-label={t("bundle.importLabel")}
          placeholder={"apiVersion: gateway.agw/v1alpha1\nkind: GatewayBundle\n\nagents:\n  - id: assistant\n    ..."}
        />
        {error && <div className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-xs leading-5 text-rose-300" role="alert">{error}</div>}
        <div className="mt-3 flex justify-end">
          <Button disabled={!importYaml.trim() || planning || applying} onClick={() => void previewImport()}>{planning ? t("bundle.planning") : t("bundle.preview")}</Button>
        </div>
      </Card>

      {plan && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>{t("bundle.dryRun")}</CardTitle>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {(["create", "update", "skip", "conflict"] as const).map((action) => <Badge key={action} tone={actionTone(action)}>{actionLabel(action)} {counts[action]}</Badge>)}
                </div>
              </div>
              <Button
                variant={counts.conflict ? "secondary" : "primary"}
                disabled={applying || counts.conflict > 0 || mutatingCount === 0}
                title={counts.conflict ? t("bundle.resolveConflicts") : undefined}
                onClick={() => setConfirmApply(true)}
              >
                {applying ? t("bundle.applying") : t("bundle.applyCount", { count: mutatingCount })}
              </Button>
            </div>
          </CardHeader>
          {plan.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">{t("bundle.noObjects")}</p>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                <div className="grid grid-cols-[160px_minmax(180px,1fr)_100px_minmax(220px,1.2fr)] border-b border-slate-700/70 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <span>{t("bundle.family")}</span><span>ID</span><span>{t("bundle.action")}</span><span>{t("bundle.reasonResult")}</span>
                </div>
                {plan.map((item) => {
                  const result = results[`${item.family}:${item.id}`];
                  return (
                    <div key={`${item.family}:${item.id}`} className="grid grid-cols-[160px_minmax(180px,1fr)_100px_minmax(220px,1.2fr)] items-center border-b border-slate-700/50 px-3 py-2.5 text-xs last:border-b-0">
                      <span className="text-slate-400">{item.family}</span>
                      <span className="truncate font-mono text-slate-200" title={item.id}>{item.id}</span>
                      <span><Badge tone={actionTone(item.action)}>{actionLabel(item.action)}</Badge></span>
                      <span className={result && !result.ok ? "text-rose-300" : result?.ok ? "text-emerald-300" : "text-slate-500"}>
                        {result ? (result.ok ? t("bundle.applied") : result.message) : reasonLabel(item.reason)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      )}

      <ConfirmDialog
        isOpen={confirmApply}
        onClose={() => setConfirmApply(false)}
        onConfirm={() => void applyPlan()}
        title={t("bundle.applyTitle")}
        message={t("bundle.applyMessage", { count: mutatingCount })}
        confirmLabel={t("bundle.applyChanges")}
        variant="warning"
      />
    </div>
  );
}
