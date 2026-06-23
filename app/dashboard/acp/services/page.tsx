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
  listACPServices,
  createACPService,
  updateACPService,
  deleteACPService,
  listACPServiceSessions,
  getACPSessionTranscript,
  type ACPService,
  type ACPServicePayload,
  type ACPAgentType,
  type ACPPermissionMode,
  type ACPSessionInfo,
  type ACPTranscriptMessage,
} from "@/lib/api";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{children}</p>;
}

// Accept Unix absolute paths (/foo), Windows drive paths (C:\foo or C:/foo), and UNC paths (\\server\share).
// The path is validated against the OS where the agent-gateway runs, not the browser, so both styles are allowed.
const ABSOLUTE_PATH_RE = /^(\/|[A-Za-z]:[\\/]|\\\\)/;
function isAbsolutePath(p: string): boolean {
  return ABSOLUTE_PATH_RE.test(p.trim());
}

const AGENT_COLORS: Record<string, string> = {
  codex: "bg-teal-500/15 text-teal-300",
  opencode: "bg-indigo-500/15 text-indigo-300",
};

const PERMISSION_COLORS: Record<string, string> = {
  deny: "bg-red-500/15 text-red-300",
  auto_approve: "bg-emerald-500/15 text-emerald-300",
  interactive: "bg-amber-500/15 text-amber-300",
};

const ROLE_COLORS: Record<string, string> = {
  user: "text-blue-300",
  assistant: "text-emerald-300",
  reasoning: "text-slate-400",
};

const SECONDS_PER_NS = 1_000_000_000;

export default function ACPServicesPage() {
  const [services, setServices] = useState<ACPService[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editing, setEditing] = useState<ACPService | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  // Form fields
  const [formId, setFormId] = useState("");
  const [formName, setFormName] = useState("");
  const [formAgentType, setFormAgentType] = useState<ACPAgentType>("codex");
  const [formCwd, setFormCwd] = useState("");
  const [formAllowedRoots, setFormAllowedRoots] = useState("");
  const [formDefaultModel, setFormDefaultModel] = useState("");
  const [formEnv, setFormEnv] = useState("");
  const [formPermissionMode, setFormPermissionMode] = useState<ACPPermissionMode>("deny");
  const [formIdleTtl, setFormIdleTtl] = useState("0");
  const [formConfigOverrides, setFormConfigOverrides] = useState("");
  const [formCodexMode, setFormCodexMode] = useState("adapter");
  const [formCodexCommand, setFormCodexCommand] = useState("");
  const [formCodexArgs, setFormCodexArgs] = useState("");
  const [formDisabled, setFormDisabled] = useState(false);
  const [formDescription, setFormDescription] = useState("");

  // Sessions modal
  const [sessionsService, setSessionsService] = useState<ACPService | null>(null);
  const [sessionsCwd, setSessionsCwd] = useState("");
  const [sessions, setSessions] = useState<ACPSessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [transcriptSession, setTranscriptSession] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<ACPTranscriptMessage[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setServices(await listACPServices());
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to load ACP services", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const resetForm = () => {
    setFormId(""); setFormName(""); setFormAgentType("codex"); setFormCwd("");
    setFormAllowedRoots(""); setFormDefaultModel(""); setFormEnv(""); setFormPermissionMode("deny");
    setFormIdleTtl("0"); setFormConfigOverrides(""); setFormCodexMode("adapter");
    setFormCodexCommand(""); setFormCodexArgs(""); setFormDisabled(false); setFormDescription("");
  };

  const openCreate = () => { resetForm(); setIsCreateOpen(true); };

  const openEdit = (svc: ACPService) => {
    setEditing(svc);
    setFormId(svc.id);
    setFormName(svc.name);
    setFormAgentType(svc.agent_type);
    setFormCwd(svc.cwd);
    setFormAllowedRoots((svc.allowed_roots ?? []).join("\n"));
    setFormDefaultModel(svc.default_model ?? "");
    setFormEnv(Object.entries(svc.env ?? {}).map(([k, v]) => `${k}=${v}`).join("\n"));
    setFormPermissionMode(svc.permission_mode ?? "deny");
    setFormIdleTtl(String(svc.idle_ttl ? Math.round(svc.idle_ttl / SECONDS_PER_NS) : 0));
    setFormConfigOverrides(Object.entries(svc.config_overrides ?? {}).map(([k, v]) => `${k}=${v}`).join("\n"));
    setFormCodexMode(svc.codex?.mode ?? "adapter");
    setFormCodexCommand(svc.codex?.adapter_command ?? "");
    setFormCodexArgs((svc.codex?.adapter_args ?? []).join("\n"));
    setFormDisabled(svc.disabled ?? false);
    setFormDescription(svc.description ?? "");
    setIsEditOpen(true);
  };

  const buildPayload = (): ACPServicePayload => {
    const roots = formAllowedRoots.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const overrides: Record<string, string> = {};
    for (const line of formConfigOverrides.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) overrides[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    const env: Record<string, string> = {};
    for (const line of formEnv.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    const idleSeconds = parseInt(formIdleTtl, 10) || 0;
    const payload: ACPServicePayload = {
      id: formId.trim(),
      name: formName.trim(),
      agent_type: formAgentType,
      cwd: formCwd.trim(),
      permission_mode: formPermissionMode,
      disabled: formDisabled,
      idle_ttl: idleSeconds * SECONDS_PER_NS,
    };
    if (roots.length) payload.allowed_roots = roots;
    if (formDefaultModel.trim()) payload.default_model = formDefaultModel.trim();
    if (Object.keys(env).length) payload.env = env;
    if (Object.keys(overrides).length) payload.config_overrides = overrides;
    if (formDescription.trim()) payload.description = formDescription.trim();
    if (formAgentType === "codex") {
      const args = formCodexArgs.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      payload.codex = {
        mode: formCodexMode,
        ...(formCodexCommand.trim() && { adapter_command: formCodexCommand.trim() }),
        ...(args.length && { adapter_args: args }),
      };
    }
    return payload;
  };

  const validate = (): boolean => {
    if (!formId.trim()) { showToast("Service ID is required", "error"); return false; }
    if (!formName.trim()) { showToast("Name is required", "error"); return false; }
    if (!formCwd.trim()) { showToast("Working directory is required", "error"); return false; }
    if (!isAbsolutePath(formCwd)) { showToast("Working directory must be an absolute path", "error"); return false; }
    const roots = formAllowedRoots.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (roots.some((r) => !isAbsolutePath(r))) { showToast("Allowed roots must each be an absolute path", "error"); return false; }
    return true;
  };

  const handleCreate = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const created = await createACPService(buildPayload());
      setServices((prev) => [...prev, created]);
      setIsCreateOpen(false);
      showToast("ACP service created", "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to create service", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!editing) return;
    if (!validate()) return;
    setSaving(true);
    try {
      const updated = await updateACPService(editing.id, buildPayload());
      setServices((prev) => prev.map((s) => (s.id === editing.id ? updated : s)));
      setIsEditOpen(false);
      setEditing(null);
      showToast("ACP service updated", "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to update service", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDeleteId) return;
    setSaving(true);
    try {
      await deleteACPService(pendingDeleteId);
      setServices((prev) => prev.filter((s) => s.id !== pendingDeleteId));
      showToast("ACP service deleted", "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to delete service", "error");
    } finally {
      setSaving(false);
      setShowConfirm(false);
      setPendingDeleteId(null);
    }
  };

  // ── Sessions ─────────────────────────────────────────────────────────────

  const loadSessions = useCallback(async (svc: ACPService, cwd: string) => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const res = await listACPServiceSessions(svc.id, cwd.trim() ? { cwd: cwd.trim() } : undefined);
      setSessions(res.sessions ?? []);
    } catch (err) {
      setSessionsError(err instanceof ApiError ? err.message : "Failed to load sessions");
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const openSessions = (svc: ACPService) => {
    setSessionsService(svc);
    setSessionsCwd(svc.cwd);
    setTranscriptSession(null);
    setTranscript([]);
    void loadSessions(svc, svc.cwd);
  };

  const openTranscript = async (sessionId: string) => {
    if (!sessionsService) return;
    setTranscriptSession(sessionId);
    setTranscriptLoading(true);
    setTranscript([]);
    try {
      const res = await getACPSessionTranscript(sessionsService.id, sessionId, sessionsCwd.trim() || undefined);
      setTranscript(res.messages ?? []);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to load transcript", "error");
    } finally {
      setTranscriptLoading(false);
    }
  };

  const renderFormBody = (readonlyId: boolean) => (
    <div className="space-y-5">
      <div className="space-y-3">
        <SectionHeading>Basic Info</SectionHeading>
        <div className="grid grid-cols-2 gap-3">
          {readonlyId ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Service ID</label>
              <p className="rounded-md border border-slate-700/60 bg-slate-900/70 px-2.5 py-1.5 font-mono text-xs text-slate-400">{formId}</p>
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Service ID <span className="text-red-400">*</span></label>
              <Input name="id" value={formId} onChange={setFormId} placeholder="e.g. codex-main" />
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Name <span className="text-red-400">*</span></label>
            <Input name="name" value={formName} onChange={setFormName} placeholder="Codex" />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">Description</label>
          <Input name="description" value={formDescription} onChange={setFormDescription} placeholder="Optional description" />
        </div>
      </div>

      <div className="space-y-3">
        <SectionHeading>Agent</SectionHeading>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Agent Type <span className="text-red-400">*</span></label>
            <select
              value={formAgentType}
              onChange={(e) => setFormAgentType(e.target.value as ACPAgentType)}
              className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-blue-500/60 focus:outline-none"
            >
              <option value="codex">codex</option>
              <option value="opencode">opencode</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              Permission Mode
              <HelpTooltip content="deny rejects tool calls; auto_approve runs them automatically; interactive surfaces permission requests for approval." />
            </label>
            <select
              value={formPermissionMode}
              onChange={(e) => setFormPermissionMode(e.target.value as ACPPermissionMode)}
              className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-blue-500/60 focus:outline-none"
            >
              <option value="deny">deny</option>
              <option value="auto_approve">auto_approve</option>
              <option value="interactive">interactive</option>
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            Working Directory (cwd) <span className="text-red-400">*</span>
            <HelpTooltip content="Absolute path. The agent runs here by default; all turn cwds must be under allowed roots." />
          </label>
          <Input name="cwd" value={formCwd} onChange={setFormCwd} placeholder="/tmp/acp-codex-test  or  C:\\acp\\workspace" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            Allowed Roots
            <HelpTooltip content="One absolute path per line. Defaults to the working directory if empty." />
          </label>
          <textarea
            value={formAllowedRoots}
            onChange={(e) => setFormAllowedRoots(e.target.value)}
            rows={2}
            placeholder={"/tmp/acp-codex-test\nC:\\acp\\workspace"}
            className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 font-mono text-xs text-slate-100 focus:border-blue-500/60 focus:outline-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Default Model</label>
            <Input name="default-model" value={formDefaultModel} onChange={setFormDefaultModel} placeholder="optional" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              Idle TTL (seconds)
              <HelpTooltip content="Reap pooled instances after this idle time. 0 disables idle expiry." />
            </label>
            <input
              type="number"
              min={0}
              value={formIdleTtl}
              onChange={(e) => setFormIdleTtl(e.target.value)}
              className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-blue-500/60 focus:outline-none"
            />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            Environment Variables
            <HelpTooltip content="One KEY=VALUE per line. Merged over the gateway process environment for the spawned agent. Use it to set a per-service home directory, e.g. CODEX_HOME for codex or HOME for opencode." />
          </label>
          <textarea
            value={formEnv}
            onChange={(e) => setFormEnv(e.target.value)}
            rows={2}
            placeholder={"CODEX_HOME=/tmp/acp-codex-test/.codex"}
            className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 font-mono text-xs text-slate-100 focus:border-blue-500/60 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            Config Overrides
            <HelpTooltip content="One KEY=VALUE per line. Applied as ACP config options on the session." />
          </label>
          <textarea
            value={formConfigOverrides}
            onChange={(e) => setFormConfigOverrides(e.target.value)}
            rows={2}
            placeholder={"model=gpt-5"}
            className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 font-mono text-xs text-slate-100 focus:border-blue-500/60 focus:outline-none"
          />
        </div>
      </div>

      {formAgentType === "codex" && (
        <div className="space-y-3">
          <SectionHeading>
            Codex Settings
            <HelpTooltip content="Codex launches the external codex-acp adapter binary by default." />
          </SectionHeading>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Mode</label>
              <select
                value={formCodexMode}
                onChange={(e) => setFormCodexMode(e.target.value)}
                className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-blue-500/60 focus:outline-none"
              >
                <option value="adapter">adapter</option>
                <option value="app_server">app_server</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Adapter Command</label>
              <Input name="codex-command" value={formCodexCommand} onChange={setFormCodexCommand} placeholder="codex-acp" />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Adapter Args</label>
            <textarea
              value={formCodexArgs}
              onChange={(e) => setFormCodexArgs(e.target.value)}
              rows={2}
              placeholder={"--flag"}
              className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 font-mono text-xs text-slate-100 focus:border-blue-500/60 focus:outline-none"
            />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <SectionHeading>Status</SectionHeading>
        <label className="flex cursor-pointer items-center gap-2.5">
          <input type="checkbox" checked={formDisabled} onChange={(e) => setFormDisabled(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 accent-blue-500" />
          <span className="text-sm text-slate-300">Disabled</span>
        </label>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">ACP Services</h1>
            <p className="mt-1 text-xs text-slate-400">
              Configure CLI coding agents (codex, opencode) the gateway can launch and drive.
              <HelpTooltip content="A service defines an agent type, working directory, and permission mode. Expose it via an ACP route." />
            </p>
          </div>
          <Button onClick={openCreate} className="px-2.5 py-1 text-xs">Create Service</Button>
        </div>
      </section>

      {loading ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center">
          <p className="text-sm text-slate-400">Loading services…</p>
        </div>
      ) : services.length === 0 ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center">
          <p className="text-sm text-slate-400">No ACP services yet. Create one to drive an agent.</p>
          <Button onClick={openCreate} className="mt-4 px-3 py-1.5 text-xs">Create Service</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {services.map((svc) => (
            <section key={svc.id} className="rounded-lg border border-slate-700/70 bg-slate-900/40 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-100">{svc.name}</span>
                    <span className="font-mono text-[10px] text-slate-500">{svc.id}</span>
                    <span className={`inline-flex rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${AGENT_COLORS[svc.agent_type] ?? "bg-slate-700/40 text-slate-400"}`}>{svc.agent_type}</span>
                    <span className={`inline-flex rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${PERMISSION_COLORS[svc.permission_mode ?? "deny"] ?? "bg-slate-700/40 text-slate-400"}`}>{svc.permission_mode ?? "deny"}</span>
                    {svc.disabled && <span className="inline-flex rounded-sm bg-slate-700/40 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">disabled</span>}
                    {svc.read_only && <span className="inline-flex rounded-sm bg-slate-700/40 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">read-only</span>}
                  </div>
                  {svc.description && <p className="mt-0.5 truncate text-[11px] text-slate-500">{svc.description}</p>}
                  <div className="mt-1 font-mono text-[10px] text-slate-500"><span className="text-slate-600">cwd:</span> {svc.cwd}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button variant="ghost" className="px-2 py-1 text-[10px]" onClick={() => openSessions(svc)}>Sessions</Button>
                  <span title={svc.read_only ? "Read-only service" : undefined}>
                    <Button variant="ghost" className="px-2 py-1 text-[10px]" disabled={!!svc.read_only} onClick={() => openEdit(svc)}>Edit</Button>
                  </span>
                  <span title={svc.read_only ? "Read-only service" : undefined}>
                    <Button variant="danger" className="px-2 py-1 text-[10px]" disabled={!!svc.read_only} onClick={() => { setPendingDeleteId(svc.id); setShowConfirm(true); }}>Delete</Button>
                  </span>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Create modal */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)}>
        <ModalHeader><ModalTitle>Create ACP Service</ModalTitle></ModalHeader>
        <ModalContent>{renderFormBody(false)}</ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setIsCreateOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving}>{saving ? "Creating…" : "Create Service"}</Button>
        </ModalFooter>
      </Modal>

      {/* Edit modal */}
      <Modal isOpen={isEditOpen} onClose={() => { setIsEditOpen(false); setEditing(null); }}>
        <ModalHeader><ModalTitle>Edit ACP Service — {editing?.name}</ModalTitle></ModalHeader>
        <ModalContent>{renderFormBody(true)}</ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => { setIsEditOpen(false); setEditing(null); }} disabled={saving}>Cancel</Button>
          <Button onClick={handleEdit} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
        </ModalFooter>
      </Modal>

      {/* Sessions modal */}
      <Modal isOpen={!!sessionsService} onClose={() => setSessionsService(null)}>
        <ModalHeader><ModalTitle>Sessions — {sessionsService?.name}</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="mb-3 flex items-end gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Working Directory</label>
              <Input name="sessions-cwd" value={sessionsCwd} onChange={setSessionsCwd} placeholder="/tmp/acp-codex-test" />
            </div>
            <Button
              variant="ghost"
              className="px-2.5 py-2 text-[11px]"
              onClick={() => sessionsService && loadSessions(sessionsService, sessionsCwd)}
            >
              Refresh
            </Button>
          </div>

          {transcriptSession ? (
            <div>
              <button
                type="button"
                onClick={() => { setTranscriptSession(null); setTranscript([]); }}
                className="mb-2 flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                Back to sessions
              </button>
              <p className="mb-2 font-mono text-[10px] text-slate-500">{transcriptSession}</p>
              {transcriptLoading ? (
                <p className="py-6 text-center text-sm text-slate-400">Loading transcript…</p>
              ) : transcript.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">Empty transcript.</p>
              ) : (
                <div className="space-y-2">
                  {transcript.map((m, i) => (
                    <div key={i} className="rounded-md border border-slate-700/60 bg-slate-900/50 px-3 py-2">
                      <span className={`text-[10px] font-semibold uppercase tracking-wide ${ROLE_COLORS[m.role] ?? "text-slate-400"}`}>{m.role}</span>
                      <p className="mt-1 whitespace-pre-wrap text-[12px] text-slate-200">{m.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : sessionsLoading ? (
            <p className="py-6 text-center text-sm text-slate-400">Loading sessions…</p>
          ) : sessionsError ? (
            <p className="py-6 text-center text-sm text-red-400">{sessionsError}</p>
          ) : sessions.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">No sessions found for this working directory.</p>
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => (
                <button
                  key={s.session_id}
                  type="button"
                  onClick={() => openTranscript(s.session_id)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-700/60 bg-slate-900/50 px-3 py-2 text-left transition-colors hover:border-blue-500/40"
                >
                  <div className="min-w-0">
                    <span className="text-xs font-semibold text-slate-200">{s.title || s.session_id}</span>
                    <p className="truncate font-mono text-[10px] text-slate-500">{s.session_id}</p>
                  </div>
                  {s.updated_at && <span className="shrink-0 text-[10px] text-slate-500">{new Date(s.updated_at).toLocaleString()}</span>}
                </button>
              ))}
            </div>
          )}
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setSessionsService(null)}>Close</Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={showConfirm}
        onClose={() => { setShowConfirm(false); setPendingDeleteId(null); }}
        onConfirm={handleDelete}
        title="Delete ACP Service"
        message="Are you sure you want to delete this service? Routes pointing to it will stop working."
        confirmLabel={saving ? "Deleting…" : "Delete"}
        variant="danger"
      />
    </div>
  );
}
