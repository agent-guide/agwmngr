"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { HelpTooltip } from "@/components/ui/tooltip";
import {
  ApiError,
  listACPRoutes,
  listACPServices,
  createACPRoute,
  updateACPRoute,
  deleteACPRoute,
  type ACPRoute,
  type ACPService,
  type ACPRoutePayload,
  type RouteMatchPolicy,
} from "@/lib/api";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{children}</p>;
}

export default function ACPRoutesPage() {
  const [routes, setRoutes] = useState<ACPRoute[]>([]);
  const [services, setServices] = useState<ACPService[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editing, setEditing] = useState<ACPRoute | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  const [formId, setFormId] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formServiceId, setFormServiceId] = useState("");
  const [formMatchHost, setFormMatchHost] = useState("");
  const [formMatchPathPrefix, setFormMatchPathPrefix] = useState("");
  const [formMatchMethods, setFormMatchMethods] = useState("");
  const [formRequireVirtualKey, setFormRequireVirtualKey] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([listACPRoutes(), listACPServices()]);
      setRoutes(r);
      setServices(s);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to load ACP routes", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const resetForm = () => {
    setFormId(""); setFormDesc(""); setFormServiceId("");
    setFormMatchHost(""); setFormMatchPathPrefix("/acp"); setFormMatchMethods("POST");
    setFormRequireVirtualKey(true);
  };

  const openCreate = () => { resetForm(); setIsCreateOpen(true); };

  const openEdit = (route: ACPRoute) => {
    setEditing(route);
    setFormId(route.id);
    setFormDesc(route.description ?? "");
    setFormServiceId(route.service_id);
    setFormMatchHost(route.match_policy?.host ?? "");
    setFormMatchPathPrefix(route.match_policy?.path_prefix ?? "");
    setFormMatchMethods((route.match_policy?.methods ?? []).join(" "));
    setFormRequireVirtualKey(route.auth_policy?.require_virtual_key ?? true);
    setIsEditOpen(true);
  };

  const buildMatchPolicy = (): RouteMatchPolicy => {
    const methods = formMatchMethods.trim()
      ? formMatchMethods.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean)
      : undefined;
    const m: RouteMatchPolicy = {};
    if (formMatchHost.trim()) m.host = formMatchHost.trim();
    if (formMatchPathPrefix.trim()) m.path_prefix = formMatchPathPrefix.trim();
    if (methods?.length) m.methods = methods;
    return m;
  };

  const handleCreate = async () => {
    if (!formServiceId.trim()) { showToast("Service is required", "error"); return; }
    const payload: ACPRoutePayload = {
      ...(formId.trim() && { id: formId.trim() }),
      ...(formDesc.trim() && { description: formDesc.trim() }),
      disabled: false,
      match_policy: buildMatchPolicy(),
      auth_policy: { require_virtual_key: formRequireVirtualKey },
      service_id: formServiceId.trim(),
    } as ACPRoutePayload;
    setSaving(true);
    try {
      const created = await createACPRoute(payload);
      setRoutes((prev) => [...prev, created]);
      setIsCreateOpen(false);
      showToast("ACP route created", "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to create route", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!editing) return;
    if (!formServiceId.trim()) { showToast("Service is required", "error"); return; }
    const payload: ACPRoutePayload = {
      id: editing.id,
      description: formDesc.trim() || undefined,
      disabled: editing.disabled,
      match_policy: buildMatchPolicy(),
      auth_policy: { require_virtual_key: formRequireVirtualKey },
      service_id: formServiceId.trim(),
    };
    setSaving(true);
    try {
      const updated = await updateACPRoute(editing.id, payload);
      setRoutes((prev) => prev.map((r) => (r.id === editing.id ? updated : r)));
      setIsEditOpen(false);
      setEditing(null);
      showToast("ACP route updated", "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to update route", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDeleteId) return;
    setSaving(true);
    try {
      await deleteACPRoute(pendingDeleteId);
      setRoutes((prev) => prev.filter((r) => r.id !== pendingDeleteId));
      showToast("ACP route deleted", "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to delete route", "error");
    } finally {
      setSaving(false);
      setShowConfirm(false);
      setPendingDeleteId(null);
    }
  };

  const renderFormBody = (readonlyId: boolean) => (
    <div className="space-y-5">
      <div className="space-y-3">
        <SectionHeading>Basic Info</SectionHeading>
        {readonlyId ? (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Route ID</label>
            <p className="rounded-md border border-slate-700/60 bg-slate-900/70 px-2.5 py-1.5 font-mono text-xs text-slate-400">{formId}</p>
          </div>
        ) : (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              Route ID
              <HelpTooltip content="Optional. Auto-generated as acp:<service_id>:<path_prefix> when left blank." />
            </label>
            <Input name="id" value={formId} onChange={setFormId} placeholder="auto: acp:<service>:<prefix>" />
          </div>
        )}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">Description</label>
          <Input name="description" value={formDesc} onChange={setFormDesc} placeholder="Optional description" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            Service <span className="text-red-400">*</span>
          </label>
          <select
            value={formServiceId}
            onChange={(e) => setFormServiceId(e.target.value)}
            className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-blue-500/60 focus:outline-none"
          >
            <option value="">— select ACP service —</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.agent_type})</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-3">
        <SectionHeading>
          Match
          <HelpTooltip content="Restrict this route to a host, path prefix, or HTTP methods. The path prefix is stripped before dispatch to the agent." />
        </SectionHeading>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Host</label>
            <Input name="match-host" value={formMatchHost} onChange={setFormMatchHost} placeholder="api.example.com" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Path Prefix</label>
            <Input name="match-path-prefix" value={formMatchPathPrefix} onChange={setFormMatchPathPrefix} placeholder="/acp/codex" />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            Methods
            <HelpTooltip content="Comma or space separated, e.g. POST. Leave blank to allow all." />
          </label>
          <Input name="match-methods" value={formMatchMethods} onChange={setFormMatchMethods} placeholder="POST" />
        </div>
      </div>

      <div className="space-y-2">
        <SectionHeading>Auth Policy</SectionHeading>
        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={formRequireVirtualKey}
            onChange={(e) => setFormRequireVirtualKey(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 accent-blue-500"
          />
          <span className="text-sm text-slate-300">
            Require virtual key
            <HelpTooltip content="When enabled, callers must present a gateway virtual key in Authorization or x-api-key." />
          </span>
        </label>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">ACP Routes</h1>
            <p className="mt-1 text-xs text-slate-400">
              Expose ACP agent services to consumers through path-matched routes.
              <HelpTooltip content="Each route binds a path prefix to an ACP service. Consumers drive agents via POST /<prefix>/turn." />
            </p>
          </div>
          <Button onClick={openCreate} className="px-2.5 py-1 text-xs">Create Route</Button>
        </div>
      </section>

      {loading ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center">
          <p className="text-sm text-slate-400">Loading routes…</p>
        </div>
      ) : routes.length === 0 ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center">
          <p className="text-sm text-slate-400">No ACP routes yet. Create one to expose an agent.</p>
          <Button onClick={openCreate} className="mt-4 px-3 py-1.5 text-xs">Create Route</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {routes.map((route) => (
            <section key={route.id} className="rounded-lg border border-slate-700/70 bg-slate-900/40 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-100">{route.id}</span>
                    <span className="inline-flex items-center gap-1 rounded-sm border border-slate-700/60 bg-slate-800/50 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                      <span className="text-slate-600">service:</span>{route.service_id}
                    </span>
                    {route.read_only && (
                      <span className="inline-flex rounded-sm bg-slate-700/40 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">read-only</span>
                    )}
                  </div>
                  {route.description && <p className="mt-0.5 truncate text-[11px] text-slate-500">{route.description}</p>}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {route.match_policy?.host && (
                      <span className="rounded-sm border border-slate-700/40 bg-slate-900/50 px-1.5 py-0.5 font-mono text-[10px] text-slate-400"><span className="text-slate-600">host:</span>{route.match_policy.host}</span>
                    )}
                    {route.match_policy?.path_prefix && (
                      <span className="rounded-sm border border-slate-700/40 bg-slate-900/50 px-1.5 py-0.5 font-mono text-[10px] text-slate-400"><span className="text-slate-600">prefix:</span>{route.match_policy.path_prefix}</span>
                    )}
                    {(route.match_policy?.methods ?? []).map((m, i) => (
                      <span key={i} className="rounded-sm border border-slate-700/40 bg-slate-900/50 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{m}</span>
                    ))}
                    <span className={`rounded-sm px-1.5 py-0.5 text-[10px] ${route.auth_policy?.require_virtual_key ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-700/40 text-slate-400"}`}>
                      {route.auth_policy?.require_virtual_key ? "vkey required" : "open"}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span title={route.read_only ? "Read-only route" : undefined}>
                    <Button variant="ghost" className="px-2 py-1 text-[10px]" disabled={!!route.read_only} onClick={() => openEdit(route)}>Edit</Button>
                  </span>
                  <span title={route.read_only ? "Read-only route" : undefined}>
                    <Button variant="danger" className="px-2 py-1 text-[10px]" disabled={!!route.read_only} onClick={() => { setPendingDeleteId(route.id); setShowConfirm(true); }}>Delete</Button>
                  </span>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}

      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)}>
        <ModalHeader><ModalTitle>Create ACP Route</ModalTitle></ModalHeader>
        <ModalContent>{renderFormBody(false)}</ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setIsCreateOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving}>{saving ? "Creating…" : "Create Route"}</Button>
        </ModalFooter>
      </Modal>

      <Modal isOpen={isEditOpen} onClose={() => { setIsEditOpen(false); setEditing(null); }}>
        <ModalHeader><ModalTitle>Edit ACP Route — {editing?.id}</ModalTitle></ModalHeader>
        <ModalContent>{renderFormBody(true)}</ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => { setIsEditOpen(false); setEditing(null); }} disabled={saving}>Cancel</Button>
          <Button onClick={handleEdit} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={showConfirm}
        onClose={() => { setShowConfirm(false); setPendingDeleteId(null); }}
        onConfirm={handleDelete}
        title="Delete ACP Route"
        message="Are you sure you want to delete this route? This action cannot be undone."
        confirmLabel={saving ? "Deleting…" : "Delete"}
        variant="danger"
      />
    </div>
  );
}
