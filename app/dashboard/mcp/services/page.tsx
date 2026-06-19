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
  listMCPServices,
  createMCPService,
  updateMCPService,
  deleteMCPService,
  getMCPServiceCapabilities,
  getMCPServiceSession,
  listMCPTools,
  callMCPTool,
  listMCPResources,
  listMCPPrompts,
  readMCPResource,
  type MCPService,
  type MCPServicePayload,
  type MCPTransport,
  type MCPAuthType,
  type MCPTool,
  type MCPResource,
  type MCPPrompt,
  type MCPSession,
} from "@/lib/api";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{children}</p>;
}

const TRANSPORT_COLORS: Record<string, string> = {
  stdio: "bg-amber-500/15 text-amber-300",
  sse: "bg-violet-500/15 text-violet-300",
  streamable_http: "bg-blue-500/15 text-blue-300",
};

type InspectTab = "capabilities" | "tools" | "resources" | "prompts" | "session";

export default function MCPServicesPage() {
  const [services, setServices] = useState<MCPService[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editing, setEditing] = useState<MCPService | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  // Form fields
  const [formId, setFormId] = useState("");
  const [formName, setFormName] = useState("");
  const [formTransport, setFormTransport] = useState<MCPTransport>("streamable_http");
  const [formCommand, setFormCommand] = useState("");
  const [formArgs, setFormArgs] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formPostUrl, setFormPostUrl] = useState("");
  const [formEnv, setFormEnv] = useState("");
  const [formAutoAuth, setFormAutoAuth] = useState(false);
  const [formAuthType, setFormAuthType] = useState<MCPAuthType>("");
  const [formAuthApiKey, setFormAuthApiKey] = useState("");
  const [formAuthUsername, setFormAuthUsername] = useState("");
  const [formAuthPassword, setFormAuthPassword] = useState("");
  const [formDisabled, setFormDisabled] = useState(false);
  const [formDescription, setFormDescription] = useState("");

  // Inspect modal
  const [inspectService, setInspectService] = useState<MCPService | null>(null);
  const [inspectTab, setInspectTab] = useState<InspectTab>("tools");
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<unknown>(null);
  const [tools, setTools] = useState<MCPTool[]>([]);
  const [resources, setResources] = useState<MCPResource[]>([]);
  const [prompts, setPrompts] = useState<MCPPrompt[]>([]);
  const [session, setSession] = useState<MCPSession | null>(null);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [toolArgs, setToolArgs] = useState("{}");
  const [toolResult, setToolResult] = useState<string | null>(null);
  const [toolCalling, setToolCalling] = useState(false);
  const [resourceContent, setResourceContent] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setServices(await listMCPServices());
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to load MCP services", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const resetForm = () => {
    setFormId(""); setFormName(""); setFormTransport("streamable_http");
    setFormCommand(""); setFormArgs(""); setFormUrl(""); setFormPostUrl("");
    setFormEnv(""); setFormAutoAuth(false); setFormAuthType("");
    setFormAuthApiKey(""); setFormAuthUsername(""); setFormAuthPassword("");
    setFormDisabled(false); setFormDescription("");
  };

  const openCreate = () => { resetForm(); setIsCreateOpen(true); };

  const openEdit = (svc: MCPService) => {
    setEditing(svc);
    setFormId(svc.id);
    setFormName(svc.name);
    setFormTransport(svc.transport);
    setFormCommand(svc.command ?? "");
    setFormArgs((svc.args ?? []).join("\n"));
    setFormUrl(svc.url ?? "");
    setFormPostUrl(svc.post_url ?? "");
    setFormEnv(Object.entries(svc.env ?? {}).map(([k, v]) => `${k}=${v}`).join("\n"));
    setFormAutoAuth(svc.auto_auth ?? false);
    setFormAuthType(svc.auth?.type ?? "");
    setFormAuthApiKey(svc.auth?.api_key ?? "");
    setFormAuthUsername(svc.auth?.username ?? "");
    setFormAuthPassword(svc.auth?.password ?? "");
    setFormDisabled(svc.disabled ?? false);
    setFormDescription(svc.description ?? "");
    setIsEditOpen(true);
  };

  const buildPayload = (): MCPServicePayload => {
    const args = formArgs.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const env: Record<string, string> = {};
    for (const line of formEnv.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    const payload: MCPServicePayload = {
      id: formId.trim(),
      name: formName.trim(),
      transport: formTransport,
      disabled: formDisabled,
      auto_auth: formAutoAuth,
    };
    if (formDescription.trim()) payload.description = formDescription.trim();
    if (formTransport === "stdio") {
      if (formCommand.trim()) payload.command = formCommand.trim();
      if (args.length) payload.args = args;
    } else {
      if (formUrl.trim()) payload.url = formUrl.trim();
      if (formTransport === "sse" && formPostUrl.trim()) payload.post_url = formPostUrl.trim();
    }
    if (Object.keys(env).length) payload.env = env;
    if (formAuthType) {
      payload.auth = {
        type: formAuthType,
        ...(formAuthApiKey.trim() && { api_key: formAuthApiKey.trim() }),
        ...(formAuthUsername.trim() && { username: formAuthUsername.trim() }),
        ...(formAuthPassword.trim() && { password: formAuthPassword.trim() }),
      };
    }
    return payload;
  };

  const validate = (): boolean => {
    if (!formId.trim()) { showToast("Service ID is required", "error"); return false; }
    if (!formName.trim()) { showToast("Name is required", "error"); return false; }
    if (formTransport === "stdio" && !formCommand.trim()) { showToast("Command is required for stdio", "error"); return false; }
    if (formTransport !== "stdio" && !formUrl.trim()) { showToast("URL is required for HTTP transports", "error"); return false; }
    return true;
  };

  const handleCreate = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const created = await createMCPService(buildPayload());
      setServices((prev) => [...prev, created]);
      setIsCreateOpen(false);
      showToast("MCP service created", "success");
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
      const updated = await updateMCPService(editing.id, buildPayload());
      setServices((prev) => prev.map((s) => (s.id === editing.id ? updated : s)));
      setIsEditOpen(false);
      setEditing(null);
      showToast("MCP service updated", "success");
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
      await deleteMCPService(pendingDeleteId);
      setServices((prev) => prev.filter((s) => s.id !== pendingDeleteId));
      showToast("MCP service deleted", "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to delete service", "error");
    } finally {
      setSaving(false);
      setShowConfirm(false);
      setPendingDeleteId(null);
    }
  };

  // ── Inspect ────────────────────────────────────────────────────────────────

  const loadInspectTab = useCallback(async (svc: MCPService, tab: InspectTab) => {
    setInspectLoading(true);
    setInspectError(null);
    try {
      if (tab === "capabilities") setCapabilities(await getMCPServiceCapabilities(svc.id));
      else if (tab === "tools") setTools(await listMCPTools(svc.id));
      else if (tab === "resources") setResources(await listMCPResources(svc.id));
      else if (tab === "prompts") setPrompts(await listMCPPrompts(svc.id));
      else if (tab === "session") setSession(await getMCPServiceSession(svc.id));
    } catch (err) {
      setInspectError(err instanceof ApiError ? err.message : "Failed to load");
    } finally {
      setInspectLoading(false);
    }
  }, []);

  const openInspect = (svc: MCPService) => {
    setInspectService(svc);
    setInspectTab("tools");
    setExpandedTool(null);
    setToolResult(null);
    setToolArgs("{}");
    setResourceContent({});
    void loadInspectTab(svc, "tools");
  };

  const switchInspectTab = (tab: InspectTab) => {
    setInspectTab(tab);
    setExpandedTool(null);
    setToolResult(null);
    if (inspectService) void loadInspectTab(inspectService, tab);
  };

  const handleCallTool = async (name: string) => {
    if (!inspectService) return;
    let parsed: Record<string, unknown> = {};
    if (toolArgs.trim()) {
      try {
        parsed = JSON.parse(toolArgs);
      } catch {
        showToast("Arguments must be valid JSON", "error");
        return;
      }
    }
    setToolCalling(true);
    setToolResult(null);
    try {
      const res = await callMCPTool(inspectService.id, { name, arguments: parsed });
      setToolResult(JSON.stringify(res, null, 2));
    } catch (err) {
      setToolResult(err instanceof ApiError ? `Error: ${err.message}` : "Error calling tool");
    } finally {
      setToolCalling(false);
    }
  };

  const handleReadResource = async (uri: string) => {
    if (!inspectService) return;
    try {
      const res = await readMCPResource(inspectService.id, uri);
      setResourceContent((prev) => ({ ...prev, [uri]: JSON.stringify(res.contents, null, 2) }));
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to read resource", "error");
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
              <Input name="id" value={formId} onChange={setFormId} placeholder="e.g. mcp-main" />
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Name <span className="text-red-400">*</span></label>
            <Input name="name" value={formName} onChange={setFormName} placeholder="Main MCP Service" />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">Description</label>
          <Input name="description" value={formDescription} onChange={setFormDescription} placeholder="Optional description" />
        </div>
      </div>

      <div className="space-y-3">
        <SectionHeading>
          Transport <span className="text-red-400">*</span>
          <HelpTooltip content="stdio launches a local subprocess; sse and streamable_http connect to a remote MCP server over HTTP." />
        </SectionHeading>
        <div className="flex flex-wrap gap-3">
          {(["streamable_http", "sse", "stdio"] as MCPTransport[]).map((t) => (
            <label key={t} className="flex cursor-pointer items-center gap-2">
              <input type="radio" name="transport" value={t} checked={formTransport === t} onChange={() => setFormTransport(t)} className="accent-blue-500" />
              <span className="font-mono text-xs text-slate-300">{t}</span>
            </label>
          ))}
        </div>

        {formTransport === "stdio" ? (
          <>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Command <span className="text-red-400">*</span></label>
              <Input name="command" value={formCommand} onChange={setFormCommand} placeholder="npx" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">
                Args
                <HelpTooltip content="One argument per line." />
              </label>
              <textarea
                value={formArgs}
                onChange={(e) => setFormArgs(e.target.value)}
                rows={3}
                placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/tmp"}
                className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 font-mono text-xs text-slate-100 focus:border-blue-500/60 focus:outline-none"
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">URL <span className="text-red-400">*</span></label>
              <Input name="url" value={formUrl} onChange={setFormUrl} placeholder="https://your-mcp-server/mcp" />
            </div>
            {formTransport === "sse" && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-300">
                  POST URL
                  <HelpTooltip content="SSE only. If empty, derived from the URL." />
                </label>
                <Input name="post-url" value={formPostUrl} onChange={setFormPostUrl} placeholder="optional" />
              </div>
            )}
          </>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            Environment
            <HelpTooltip content="One KEY=VALUE per line. Passed to stdio subprocesses." />
          </label>
          <textarea
            value={formEnv}
            onChange={(e) => setFormEnv(e.target.value)}
            rows={2}
            placeholder={"API_TOKEN=xyz"}
            className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 font-mono text-xs text-slate-100 focus:border-blue-500/60 focus:outline-none"
          />
        </div>
      </div>

      <div className="space-y-3">
        <SectionHeading>Auth</SectionHeading>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Type</label>
            <select
              value={formAuthType}
              onChange={(e) => setFormAuthType(e.target.value as MCPAuthType)}
              className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-blue-500/60 focus:outline-none"
            >
              <option value="">— none —</option>
              <option value="api_key">api_key</option>
              <option value="bearer">bearer</option>
              <option value="basic">basic</option>
              <option value="oauth2">oauth2</option>
            </select>
          </div>
          <label className="flex cursor-pointer items-center gap-2 pt-5">
            <input type="checkbox" checked={formAutoAuth} onChange={(e) => setFormAutoAuth(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 accent-blue-500" />
            <span className="text-xs text-slate-300">
              Auto auth
              <HelpTooltip content="Let the gateway negotiate authentication automatically when supported." />
            </span>
          </label>
        </div>
        {(formAuthType === "api_key" || formAuthType === "bearer" || formAuthType === "oauth2") && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">{formAuthType === "api_key" ? "API Key" : "Token"}</label>
            <Input name="auth-api-key" value={formAuthApiKey} onChange={setFormAuthApiKey} placeholder="secret value" />
          </div>
        )}
        {formAuthType === "basic" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Username</label>
              <Input name="auth-username" value={formAuthUsername} onChange={setFormAuthUsername} placeholder="user" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Password</label>
              <Input name="auth-password" value={formAuthPassword} onChange={setFormAuthPassword} placeholder="password" />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <SectionHeading>Status</SectionHeading>
        <label className="flex cursor-pointer items-center gap-2.5">
          <input type="checkbox" checked={formDisabled} onChange={(e) => setFormDisabled(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 accent-blue-500" />
          <span className="text-sm text-slate-300">Disabled</span>
        </label>
      </div>
    </div>
  );

  const INSPECT_TABS: InspectTab[] = ["tools", "resources", "prompts", "capabilities", "session"];

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">MCP Services</h1>
            <p className="mt-1 text-xs text-slate-400">
              Register upstream MCP servers the gateway can route to and inspect.
              <HelpTooltip content="A service is a connection to an MCP server over stdio or HTTP. Inspect tools, resources, and prompts here." />
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
          <p className="text-sm text-slate-400">No MCP services yet. Create one to connect an MCP server.</p>
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
                    <span className={`inline-flex rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${TRANSPORT_COLORS[svc.transport] ?? "bg-slate-700/40 text-slate-400"}`}>{svc.transport}</span>
                    {svc.disabled && <span className="inline-flex rounded-sm bg-slate-700/40 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">disabled</span>}
                    {svc.read_only && <span className="inline-flex rounded-sm bg-slate-700/40 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">read-only</span>}
                  </div>
                  {svc.description && <p className="mt-0.5 truncate text-[11px] text-slate-500">{svc.description}</p>}
                  <div className="mt-1 font-mono text-[10px] text-slate-500">
                    {svc.transport === "stdio"
                      ? `${svc.command ?? ""} ${(svc.args ?? []).join(" ")}`.trim()
                      : svc.url}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button variant="ghost" className="px-2 py-1 text-[10px]" onClick={() => openInspect(svc)}>Inspect</Button>
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
        <ModalHeader><ModalTitle>Create MCP Service</ModalTitle></ModalHeader>
        <ModalContent>{renderFormBody(false)}</ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setIsCreateOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving}>{saving ? "Creating…" : "Create Service"}</Button>
        </ModalFooter>
      </Modal>

      {/* Edit modal */}
      <Modal isOpen={isEditOpen} onClose={() => { setIsEditOpen(false); setEditing(null); }}>
        <ModalHeader><ModalTitle>Edit MCP Service — {editing?.name}</ModalTitle></ModalHeader>
        <ModalContent>{renderFormBody(true)}</ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => { setIsEditOpen(false); setEditing(null); }} disabled={saving}>Cancel</Button>
          <Button onClick={handleEdit} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
        </ModalFooter>
      </Modal>

      {/* Inspect modal */}
      <Modal isOpen={!!inspectService} onClose={() => setInspectService(null)}>
        <ModalHeader><ModalTitle>Inspect — {inspectService?.name}</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="mb-3 flex flex-wrap gap-1.5 border-b border-slate-700/60 pb-2">
            {INSPECT_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => switchInspectTab(tab)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${
                  inspectTab === tab ? "bg-blue-600/20 text-blue-300" : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {inspectLoading ? (
            <p className="py-6 text-center text-sm text-slate-400">Loading…</p>
          ) : inspectError ? (
            <p className="py-6 text-center text-sm text-red-400">{inspectError}</p>
          ) : inspectTab === "tools" ? (
            tools.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">No tools exposed.</p>
            ) : (
              <div className="space-y-2">
                {tools.map((tool) => (
                  <div key={tool.name} className="rounded-md border border-slate-700/60 bg-slate-900/50">
                    <button
                      type="button"
                      onClick={() => { setExpandedTool(expandedTool === tool.name ? null : tool.name); setToolResult(null); setToolArgs("{}"); }}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                    >
                      <div className="min-w-0">
                        <span className="font-mono text-xs font-semibold text-slate-200">{tool.name}</span>
                        {tool.description && <p className="mt-0.5 truncate text-[11px] text-slate-500">{tool.description}</p>}
                      </div>
                      <svg className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${expandedTool === tool.name ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    {expandedTool === tool.name && (
                      <div className="border-t border-slate-700/60 px-3 py-2 space-y-2">
                        {tool.input_schema != null && (
                          <div>
                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Input Schema</p>
                            <pre className="max-h-40 overflow-auto rounded bg-slate-950/70 p-2 font-mono text-[10px] text-slate-400">{JSON.stringify(tool.input_schema, null, 2)}</pre>
                          </div>
                        )}
                        <div>
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Arguments (JSON)</p>
                          <textarea
                            value={toolArgs}
                            onChange={(e) => setToolArgs(e.target.value)}
                            rows={3}
                            className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-2 py-1.5 font-mono text-[11px] text-slate-100 focus:border-blue-500/60 focus:outline-none"
                          />
                        </div>
                        <Button className="px-2.5 py-1 text-[11px]" disabled={toolCalling} onClick={() => handleCallTool(tool.name)}>
                          {toolCalling ? "Calling…" : "Call Tool"}
                        </Button>
                        {toolResult && (
                          <pre className="max-h-48 overflow-auto rounded bg-slate-950/70 p-2 font-mono text-[10px] text-slate-300">{toolResult}</pre>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          ) : inspectTab === "resources" ? (
            resources.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">No resources exposed.</p>
            ) : (
              <div className="space-y-2">
                {resources.map((r) => (
                  <div key={r.uri} className="rounded-md border border-slate-700/60 bg-slate-900/50 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-xs font-semibold text-slate-200">{r.name}</span>
                        <p className="truncate font-mono text-[10px] text-slate-500">{r.uri}</p>
                        {r.description && <p className="mt-0.5 text-[11px] text-slate-500">{r.description}</p>}
                      </div>
                      <Button variant="ghost" className="shrink-0 px-2 py-1 text-[10px]" onClick={() => handleReadResource(r.uri)}>Read</Button>
                    </div>
                    {resourceContent[r.uri] && (
                      <pre className="mt-2 max-h-48 overflow-auto rounded bg-slate-950/70 p-2 font-mono text-[10px] text-slate-300">{resourceContent[r.uri]}</pre>
                    )}
                  </div>
                ))}
              </div>
            )
          ) : inspectTab === "prompts" ? (
            prompts.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">No prompts exposed.</p>
            ) : (
              <div className="space-y-2">
                {prompts.map((p) => (
                  <div key={p.name} className="rounded-md border border-slate-700/60 bg-slate-900/50 px-3 py-2">
                    <span className="font-mono text-xs font-semibold text-slate-200">{p.name}</span>
                    {p.description && <p className="mt-0.5 text-[11px] text-slate-500">{p.description}</p>}
                  </div>
                ))}
              </div>
            )
          ) : inspectTab === "capabilities" ? (
            <pre className="max-h-80 overflow-auto rounded bg-slate-950/70 p-3 font-mono text-[10px] text-slate-300">{capabilities ? JSON.stringify(capabilities, null, 2) : "No data."}</pre>
          ) : (
            session ? (
              <div className="space-y-1.5 text-[11px]">
                {[
                  ["Session ID", session.id],
                  ["State", session.state],
                  ["Transport", session.transport],
                  ["Upstream session", session.upstream_session_id ?? "—"],
                  ["Created", session.created_at ? new Date(session.created_at).toLocaleString() : "—"],
                  ["Last used", session.last_used_at ? new Date(session.last_used_at).toLocaleString() : "—"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <span className="text-slate-500">{k}</span>
                    <span className="font-mono text-slate-300">{v}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-slate-500">No active session.</p>
            )
          )}
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setInspectService(null)}>Close</Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={showConfirm}
        onClose={() => { setShowConfirm(false); setPendingDeleteId(null); }}
        onConfirm={handleDelete}
        title="Delete MCP Service"
        message="Are you sure you want to delete this service? Routes pointing to it will stop working."
        confirmLabel={saving ? "Deleting…" : "Delete"}
        variant="danger"
      />
    </div>
  );
}
