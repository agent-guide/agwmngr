"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { adminFetch, ApiError } from "@/lib/api";

interface TLSConf {
  auto?: boolean;
  cert_file?: string;
  key_file?: string;
}

interface ServerResponse {
  id: string;
  listen: string[];
  readonly?: boolean;
  source?: string;
  public_url?: string;
}

interface MatchConf {
  paths?: string[];
  hosts?: string[];
}

interface HandlerConf {
  type: string;
  apis?: string[];
}

interface RouteResponse {
  id: string;
  order: number;
  match: MatchConf;
  handlers: HandlerConf[];
}

const DISPATCHER_ROUTE_ID = "dispatcher";

const LLM_API_OPTIONS: { value: string; label: string }[] = [
  { value: "openai", label: "OpenAI Compatible" },
  { value: "anthropic", label: "Anthropic Compatible" },
];

async function fetchServers(): Promise<ServerResponse[]> {
  const data = await adminFetch<{ items: ServerResponse[] }>("/admin/caddy/servers");
  return data.items ?? [];
}

async function createServer(req: { id: string; listen: string[]; tls?: TLSConf }): Promise<ServerResponse> {
  return adminFetch<ServerResponse>("/admin/caddy/servers", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

async function deleteServer(id: string): Promise<void> {
  await adminFetch(`/admin/caddy/servers/${encodeURIComponent(id)}`, { method: "DELETE" });
}

async function fetchRoutes(serverId: string): Promise<RouteResponse[]> {
  const data = await adminFetch<{ items: RouteResponse[] }>(
    `/admin/caddy/servers/${encodeURIComponent(serverId)}/routes`,
  );
  return data.items ?? [];
}

async function addRoute(serverId: string, apis: string[]): Promise<void> {
  await adminFetch(`/admin/caddy/servers/${encodeURIComponent(serverId)}/routes`, {
    method: "POST",
    body: JSON.stringify({
      id: DISPATCHER_ROUTE_ID,
      match: {},
      handlers: [{ type: "agent_route_dispatcher", apis }],
    }),
  });
}

async function removeRoute(serverId: string): Promise<void> {
  await adminFetch(
    `/admin/caddy/servers/${encodeURIComponent(serverId)}/routes/${encodeURIComponent(DISPATCHER_ROUTE_ID)}`,
    { method: "DELETE" },
  );
}

function parseLines(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function tlsLabel(tls?: TLSConf): string {
  if (!tls) return "none";
  if (tls.auto) return "auto (ACME)";
  if (tls.cert_file) return "manual";
  return "none";
}

function findDispatcher(routes: RouteResponse[]): RouteResponse | undefined {
  return routes.find((route) => route.handlers.some((handler) => handler.type === "agent_route_dispatcher"));
}

function dispatcherApis(route: RouteResponse): string[] {
  return route.handlers.find((handler) => handler.type === "agent_route_dispatcher")?.apis ?? [];
}

interface ServerFormState {
  id: string;
  listen: string;
  tlsMode: "none" | "auto" | "manual";
  certFile: string;
  keyFile: string;
}

function defaultServerForm(): ServerFormState {
  return { id: "", listen: ":8080", tlsMode: "none", certFile: "", keyFile: "" };
}

function formToServerReq(form: ServerFormState): { id: string; listen: string[]; tls?: TLSConf } {
  const req: { id: string; listen: string[]; tls?: TLSConf } = {
    id: form.id.trim(),
    listen: parseLines(form.listen),
  };
  if (form.tlsMode === "auto") {
    req.tls = { auto: true };
  } else if (form.tlsMode === "manual" && (form.certFile.trim() || form.keyFile.trim())) {
    req.tls = { cert_file: form.certFile.trim(), key_file: form.keyFile.trim() };
  }
  return req;
}

interface DispatcherFormState {
  apis: string[];
}

function ServerFormFields({
  form,
  onChange,
  hideId,
}: {
  form: ServerFormState;
  onChange: (patch: Partial<ServerFormState>) => void;
  hideId?: boolean;
}) {
  return (
    <div className="space-y-4">
      {!hideId && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            Server ID <span className="text-red-400">*</span>
          </label>
          <Input
            name="serverId"
            value={form.id}
            onChange={(value) => onChange({ id: value })}
            placeholder="e.g. main"
          />
          <p className="mt-1 text-xs text-slate-500">Unique identifier for this server block.</p>
        </div>
      )}

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">
          Listen Addresses <span className="text-red-400">*</span>
        </label>
        <textarea
          value={form.listen}
          onChange={(e) => onChange({ listen: e.target.value })}
          rows={3}
          placeholder=":8080&#10;:443"
          className="w-full resize-none rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 font-mono text-sm text-slate-100 placeholder-slate-600 focus:border-blue-500/60 focus:outline-none"
        />
        <p className="mt-1 text-xs text-slate-500">One address per line (e.g. :8080, :443, 0.0.0.0:9000).</p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">TLS Mode</label>
        <select
          value={form.tlsMode}
          onChange={(e) => onChange({ tlsMode: e.target.value as ServerFormState["tlsMode"] })}
          className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-blue-500/60 focus:outline-none"
        >
          <option value="none">None (HTTP)</option>
          <option value="auto">Auto (ACME / Let&apos;s Encrypt)</option>
          <option value="manual">Manual (certificate files)</option>
        </select>
      </div>

      {form.tlsMode === "manual" && (
        <>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Certificate File</label>
            <Input
              name="certFile"
              value={form.certFile}
              onChange={(value) => onChange({ certFile: value })}
              placeholder="/etc/ssl/cert.pem"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Key File</label>
            <Input
              name="keyFile"
              value={form.keyFile}
              onChange={(value) => onChange({ keyFile: value })}
              placeholder="/etc/ssl/key.pem"
            />
          </div>
        </>
      )}
    </div>
  );
}

function DispatcherFormFields({
  form,
  onChange,
}: {
  form: DispatcherFormState;
  onChange: (patch: Partial<DispatcherFormState>) => void;
}) {
  const toggleApi = (api: string) =>
    onChange({
      apis: form.apis.includes(api) ? form.apis.filter((value) => value !== api) : [...form.apis, api],
    });

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">
          LLM API Dialects <span className="text-red-400">*</span>
        </label>
        <div className="mt-1.5 space-y-2">
          {LLM_API_OPTIONS.map((option) => (
            <label key={option.value} className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={form.apis.includes(option.value)}
                onChange={() => toggleApi(option.value)}
                className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 accent-blue-500"
              />
              <span className="text-sm text-slate-300">{option.label}</span>
              <span className="font-mono text-xs text-slate-500">({option.value})</span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Select which LLM API dialects the dispatcher should handle.
        </p>
      </div>
    </div>
  );
}

function ServerRow({
  srv,
  onDelete,
}: {
  srv: ServerResponse;
  onDelete: (id: string) => void;
}) {
  const [dispatcher, setDispatcher] = useState<RouteResponse | undefined>(undefined);
  const [loadingDispatcher, setLoadingDispatcher] = useState(true);
  const { showToast } = useToast();

  const [isDispatcherFormOpen, setIsDispatcherFormOpen] = useState(false);
  const [dispatcherForm, setDispatcherForm] = useState<DispatcherFormState>({ apis: ["openai"] });
  const [dispatcherSaving, setDispatcherSaving] = useState(false);
  const [confirmRemoveDispatcher, setConfirmRemoveDispatcher] = useState(false);

  const loadDispatcher = useCallback(async () => {
    setLoadingDispatcher(true);
    try {
      const routes = await fetchRoutes(srv.id);
      setDispatcher(findDispatcher(routes));
    } catch {
      // ignore route load failures for row rendering
    } finally {
      setLoadingDispatcher(false);
    }
  }, [srv.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDispatcher();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDispatcher]);

  const openDispatcherForm = () => {
    setDispatcherForm({ apis: ["openai"] });
    setIsDispatcherFormOpen(true);
  };

  const handleDispatcherSave = async () => {
    if (!dispatcherForm.apis.length) {
      showToast("At least one LLM API dialect is required", "error");
      return;
    }

    setDispatcherSaving(true);
    try {
      await addRoute(srv.id, dispatcherForm.apis);
      showToast("Dispatcher enabled", "success");
      await loadDispatcher();
      setIsDispatcherFormOpen(false);
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : "Failed to save dispatcher", "error");
    } finally {
      setDispatcherSaving(false);
    }
  };

  const handleDispatcherRemove = async () => {
    try {
      await removeRoute(srv.id);
      setDispatcher(undefined);
      showToast("Dispatcher removed", "success");
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : "Failed to remove dispatcher", "error");
    } finally {
      setConfirmRemoveDispatcher(false);
    }
  };

  const dispatcherFromCaddyfile = Boolean(dispatcher && !dispatcher.id);
  const canEditDispatcher = !srv.readonly && !dispatcherFromCaddyfile;
  const apis = dispatcher ? dispatcherApis(dispatcher) : [];
  const paths = dispatcher?.match?.paths ?? [];

  return (
    <section className="overflow-hidden rounded-lg border border-slate-700/70 bg-slate-900/40">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-slate-100">{srv.id}</span>
            {srv.readonly && (
              <span className="inline-flex rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-300">
                Read-only
              </span>
            )}
            <span className="inline-flex rounded-sm bg-slate-700/40 px-1.5 py-0.5 text-[9px] font-medium text-slate-400">
              TLS: {tlsLabel()}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {(srv.listen ?? []).map((addr) => (
              <span
                key={addr}
                className="inline-flex rounded-sm border border-slate-700/60 bg-slate-800/50 px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
              >
                {addr}
              </span>
            ))}
          </div>
          {srv.public_url && <p className="mt-1 font-mono text-[10px] text-slate-500">Public URL: {srv.public_url}</p>}
          {srv.readonly && (
            <p className="mt-1 text-[10px] text-slate-500">
              This server is managed by system config and cannot be changed from the UI.
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {!srv.readonly && (
            <Button variant="danger" className="px-2 py-1 text-[10px]" onClick={() => onDelete(srv.id)}>
              Delete
            </Button>
          )}
        </div>
      </div>

      <div className="border-t border-slate-700/50 px-3 py-2.5">
        {loadingDispatcher ? (
          <p className="text-[10px] text-slate-600">Loading dispatcher...</p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {canEditDispatcher && (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(dispatcher)}
                    onClick={() => (dispatcher ? setConfirmRemoveDispatcher(true) : openDispatcherForm())}
                    className={[
                      "relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                      dispatcher ? "bg-emerald-500" : "bg-slate-700",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-sm ring-0 transition-transform duration-200",
                        dispatcher ? "translate-x-4" : "translate-x-0",
                      ].join(" ")}
                    />
                  </button>
                )}
                <div className="flex items-center gap-2">
                  <span
                    className={[
                      "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[9px] font-medium",
                      dispatcher
                        ? "border border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                        : "border border-slate-700/60 bg-slate-800/50 text-slate-500",
                    ].join(" ")}
                  >
                    {dispatcher && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                    {dispatcher ? "Dispatcher enabled" : "Dispatcher disabled"}
                  </span>
                  {dispatcherFromCaddyfile && (
                    <span className="inline-flex rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-300">
                      Caddyfile
                    </span>
                  )}
                </div>
              </div>
            </div>

            {dispatcher && (
              <div className="flex flex-wrap gap-3 pl-0">
                {paths.length > 0 && (
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-medium uppercase tracking-wide text-slate-500">Paths:</span>
                    {paths.map((path) => (
                      <span
                        key={path}
                        className="inline-flex rounded-sm border border-slate-700/60 bg-slate-900/50 px-1.5 py-0.5 font-mono text-[9px] text-slate-400"
                      >
                        {path}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <span className="text-[9px] font-medium uppercase tracking-wide text-slate-500">APIs:</span>
                  {apis.length === 0 ? (
                    <span className="text-[9px] text-slate-500">None</span>
                  ) : (
                    apis.map((api) => (
                      <span
                        key={api}
                        className="inline-flex rounded-sm border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-medium text-blue-300"
                      >
                        {api}
                      </span>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <Modal isOpen={isDispatcherFormOpen} onClose={() => setIsDispatcherFormOpen(false)}>
        <ModalHeader>
          <ModalTitle>Enable Dispatcher - {srv.id}</ModalTitle>
        </ModalHeader>
        <ModalContent>
          <DispatcherFormFields
            form={dispatcherForm}
            onChange={(patch) => setDispatcherForm((prev) => ({ ...prev, ...patch }))}
          />
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setIsDispatcherFormOpen(false)} disabled={dispatcherSaving}>
            Cancel
          </Button>
          <Button onClick={handleDispatcherSave} disabled={dispatcherSaving}>
            {dispatcherSaving ? "Saving..." : "Enable"}
          </Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={confirmRemoveDispatcher}
        onClose={() => setConfirmRemoveDispatcher(false)}
        onConfirm={handleDispatcherRemove}
        title="Remove Dispatcher"
        message={`Remove agent_route_dispatcher from server "${srv.id}"?`}
        confirmLabel="Remove"
        variant="danger"
      />
    </section>
  );
}

export default function ServersPage() {
  const [servers, setServers] = useState<ServerResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<ServerFormState>(defaultServerForm());
  const [createSaving, setCreateSaving] = useState(false);

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const loadServers = useCallback(async () => {
    setLoading(true);
    try {
      setServers(await fetchServers());
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : "Failed to load servers", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadServers();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadServers]);

  const totalListeners = servers.reduce((sum, server) => sum + (server.listen?.length ?? 0), 0);

  const handleCreate = async () => {
    if (!createForm.id.trim()) {
      showToast("Server ID is required", "error");
      return;
    }
    if (!parseLines(createForm.listen).length) {
      showToast("At least one listen address is required", "error");
      return;
    }

    setCreateSaving(true);
    try {
      const created = await createServer(formToServerReq(createForm));
      setServers((prev) => [...prev, created]);
      showToast("Server created", "success");
      setIsCreateOpen(false);
      setCreateForm(defaultServerForm());
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : "Failed to create server", "error");
    } finally {
      setCreateSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDeleteId) return;
    try {
      await deleteServer(pendingDeleteId);
      setServers((prev) => prev.filter((server) => server.id !== pendingDeleteId));
      showToast("Server deleted", "success");
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : "Failed to delete server", "error");
    } finally {
      setPendingDeleteId(null);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">Caddy HTTP Servers</h1>
            <p className="mt-1 text-xs text-slate-400">
              Manage Caddy HTTP server instances, listen addresses, TLS configuration, and dispatcher settings.
            </p>
          </div>
          <Button
            onClick={() => {
              setCreateForm(defaultServerForm());
              setIsCreateOpen(true);
            }}
            className="px-2.5 py-1 text-xs"
          >
            Create Server
          </Button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2">
        {[
          { label: "Servers", value: servers.length },
          { label: "Listen Addresses", value: totalListeners },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-slate-700/70 bg-slate-900/40 px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{stat.label}</p>
            <p className="mt-0.5 text-xs font-semibold text-slate-100">{stat.value}</p>
          </div>
        ))}
      </section>

      {loading ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center">
          <p className="text-sm text-slate-400">Loading servers...</p>
        </div>
      ) : servers.length === 0 ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center">
          <p className="text-sm text-slate-400">No servers configured. Create one to start accepting traffic.</p>
          <Button
            onClick={() => {
              setCreateForm(defaultServerForm());
              setIsCreateOpen(true);
            }}
            className="mt-4 px-3 py-1.5 text-xs"
          >
            Create Server
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {servers.map((server) => (
            <ServerRow key={server.id} srv={server} onDelete={setPendingDeleteId} />
          ))}
        </div>
      )}

      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)}>
        <ModalHeader>
          <ModalTitle>Create Server</ModalTitle>
        </ModalHeader>
        <ModalContent>
          <ServerFormFields form={createForm} onChange={(patch) => setCreateForm((prev) => ({ ...prev, ...patch }))} />
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setIsCreateOpen(false)} disabled={createSaving}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={createSaving}>
            {createSaving ? "Creating..." : "Create Server"}
          </Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(pendingDeleteId)}
        onClose={() => setPendingDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Server"
        message="Are you sure you want to delete this server?"
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
