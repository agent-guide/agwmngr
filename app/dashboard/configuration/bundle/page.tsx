"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
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
      showToast("Gateway bundle generated", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to export bundle", "error");
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
      setError(err instanceof Error ? err.message : "Invalid gateway bundle");
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
        nextResults[key] = { ok: false, message: err instanceof Error ? err.message : "Apply failed" };
      }
      setResults({ ...nextResults });
    }
    setApplying(false);
    const failures = Object.values(nextResults).filter((result) => !result.ok).length;
    showToast(failures ? `Bundle applied with ${failures} error${failures === 1 ? "" : "s"}` : "Bundle applied successfully", failures ? "error" : "success");
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
        title="Bundle Import / Export"
        description="Move declarative gateway configuration through the same per-object Admin APIs used by the manager."
      />

      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4" role="note">
        <p className="text-sm font-semibold text-amber-200">Credentials are not included</p>
        <p className="mt-1 text-xs leading-5 text-amber-300/80">
          Bundle export does not contain credential records or generated Virtual Key secrets. Configure credentials separately after import. Import is create-or-update only: it never prunes objects missing from the bundle.
        </p>
        <p className="mt-1 text-xs leading-5 text-amber-300/80">
          Provider and MCP service configuration may contain inline authentication fields. Treat exported YAML as sensitive data.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Export</CardTitle>
              <p className="mt-1 text-xs text-slate-500">Reads all supported object families from the active gateway and emits GatewayBundle YAML.</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="px-2.5 py-1 text-xs"
                disabled={!exportYaml}
                onClick={() => void navigator.clipboard.writeText(exportYaml)
                  .then(() => showToast("Bundle YAML copied", "success"))
                  .catch(() => showToast("Failed to copy Bundle YAML", "error"))}
              >Copy</Button>
              <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={!exportYaml} onClick={() => downloadText(exportYaml)}>Download</Button>
              <Button className="px-2.5 py-1 text-xs" disabled={exporting} onClick={() => void generateExport()}>{exporting ? "Generating…" : "Generate Export"}</Button>
            </div>
          </div>
        </CardHeader>
        {exportYaml ? (
          <pre className="max-h-[28rem] overflow-auto rounded-md border border-slate-700/70 bg-slate-950/70 p-4 font-mono text-[11px] leading-5 text-slate-300" tabIndex={0}>{exportYaml}</pre>
        ) : (
          <p className="py-8 text-center text-sm text-slate-500">Generate an export to preview or download the active gateway configuration.</p>
        )}
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Import</CardTitle>
              <p className="mt-1 text-xs text-slate-500">Paste or load YAML, then preview the create/update/skip/conflict plan before applying.</p>
            </div>
            <label className="cursor-pointer rounded-md border border-slate-700/70 bg-slate-800/60 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700/70">
              Load file
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
          aria-label="GatewayBundle YAML to import"
          placeholder={"apiVersion: gateway.agw/v1alpha1\nkind: GatewayBundle\n\nagents:\n  - id: assistant\n    ..."}
        />
        {error && <div className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-xs leading-5 text-rose-300" role="alert">{error}</div>}
        <div className="mt-3 flex justify-end">
          <Button disabled={!importYaml.trim() || planning || applying} onClick={() => void previewImport()}>{planning ? "Planning…" : "Validate & Preview"}</Button>
        </div>
      </Card>

      {plan && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Dry-run Preview</CardTitle>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {(["create", "update", "skip", "conflict"] as const).map((action) => <Badge key={action} tone={actionTone(action)}>{action} {counts[action]}</Badge>)}
                </div>
              </div>
              <Button
                variant={counts.conflict ? "secondary" : "primary"}
                disabled={applying || counts.conflict > 0 || mutatingCount === 0}
                title={counts.conflict ? "Resolve conflicts before applying" : undefined}
                onClick={() => setConfirmApply(true)}
              >
                {applying ? "Applying…" : `Apply ${mutatingCount} Change${mutatingCount === 1 ? "" : "s"}`}
              </Button>
            </div>
          </CardHeader>
          {plan.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">The bundle contains no supported objects.</p>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                <div className="grid grid-cols-[160px_minmax(180px,1fr)_100px_minmax(220px,1.2fr)] border-b border-slate-700/70 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <span>Family</span><span>ID</span><span>Action</span><span>Reason / Result</span>
                </div>
                {plan.map((item) => {
                  const result = results[`${item.family}:${item.id}`];
                  return (
                    <div key={`${item.family}:${item.id}`} className="grid grid-cols-[160px_minmax(180px,1fr)_100px_minmax(220px,1.2fr)] items-center border-b border-slate-700/50 px-3 py-2.5 text-xs last:border-b-0">
                      <span className="text-slate-400">{item.family}</span>
                      <span className="truncate font-mono text-slate-200" title={item.id}>{item.id}</span>
                      <span><Badge tone={actionTone(item.action)}>{item.action}</Badge></span>
                      <span className={result && !result.ok ? "text-rose-300" : result?.ok ? "text-emerald-300" : "text-slate-500"}>
                        {result ? (result.ok ? "Applied" : result.message) : item.reason ?? "—"}
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
        title="Apply gateway bundle?"
        message={`This will issue ${mutatingCount} audited Admin API write${mutatingCount === 1 ? "" : "s"} against the active gateway. Existing objects not present in the bundle will remain unchanged.`}
        confirmLabel="Apply changes"
        variant="warning"
      />
    </div>
  );
}
