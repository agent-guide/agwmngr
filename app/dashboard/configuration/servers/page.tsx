"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { adminFetch, ApiError } from "@/lib/api";
import { useI18n } from "@/components/i18n-provider";

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
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      {!hideId && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            {t("servers.id")} <span className="text-red-400">*</span>
          </label>
          <Input
            name="serverId"
            value={form.id}
            onChange={(value) => onChange({ id: value })}
            placeholder="e.g. main"
          />
          <p className="mt-1 text-xs text-slate-500">{t("servers.idHelp")}</p>
        </div>
      )}

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">
          {t("servers.listenAddresses")} <span className="text-red-400">*</span>
        </label>
        <textarea
          value={form.listen}
          onChange={(e) => onChange({ listen: e.target.value })}
          rows={3}
          placeholder=":8080&#10;:443"
          className="w-full resize-none rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 font-mono text-sm text-slate-100 placeholder-slate-600 focus:border-blue-500/60 focus:outline-none"
        />
        <p className="mt-1 text-xs text-slate-500">{t("servers.listenHelp")}</p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("servers.tlsMode")}</label>
        <select
          value={form.tlsMode}
          onChange={(e) => onChange({ tlsMode: e.target.value as ServerFormState["tlsMode"] })}
          className="w-full rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-blue-500/60 focus:outline-none"
        >
          <option value="none">{t("servers.tlsNone")}</option>
          <option value="auto">{t("servers.tlsAuto")}</option>
          <option value="manual">{t("servers.tlsManual")}</option>
        </select>
      </div>

      {form.tlsMode === "manual" && (
        <>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("servers.certFile")}</label>
            <Input
              name="certFile"
              value={form.certFile}
              onChange={(value) => onChange({ certFile: value })}
              placeholder="/etc/ssl/cert.pem"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("servers.keyFile")}</label>
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
  const { t } = useI18n();
  const toggleApi = (api: string) =>
    onChange({
      apis: form.apis.includes(api) ? form.apis.filter((value) => value !== api) : [...form.apis, api],
    });

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">
          {t("servers.apiDialects")} <span className="text-red-400">*</span>
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
          {t("servers.apiDialectsHelp")}
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
  const { t } = useI18n();
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
      showToast(t("servers.apiDialectRequired"), "error");
      return;
    }

    setDispatcherSaving(true);
    try {
      await addRoute(srv.id, dispatcherForm.apis);
      showToast(t("servers.dispatcherEnabled"), "success");
      await loadDispatcher();
      setIsDispatcherFormOpen(false);
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : t("servers.dispatcherSaveFailed"), "error");
    } finally {
      setDispatcherSaving(false);
    }
  };

  const handleDispatcherRemove = async () => {
    try {
      await removeRoute(srv.id);
      setDispatcher(undefined);
      showToast(t("servers.dispatcherRemoved"), "success");
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : t("servers.dispatcherRemoveFailed"), "error");
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
                {t("servers.readOnly")}
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
          {srv.public_url && <p className="mt-1 font-mono text-[10px] text-slate-500">{t("servers.publicUrl")}: {srv.public_url}</p>}
          {srv.readonly && (
            <p className="mt-1 text-[10px] text-slate-500">
              {t("servers.readOnlyHelp")}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {!srv.readonly && (
            <Button variant="danger" className="px-2 py-1 text-[10px]" onClick={() => onDelete(srv.id)}>
              {t("common.delete")}
            </Button>
          )}
        </div>
      </div>

      <div className="border-t border-slate-700/50 px-3 py-2.5">
        {loadingDispatcher ? (
          <p className="text-[10px] text-slate-600">{t("servers.loadingDispatcher")}</p>
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
                    {dispatcher ? t("servers.dispatcherEnabled") : t("servers.dispatcherDisabled")}
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
                    <span className="text-[9px] font-medium uppercase tracking-wide text-slate-500">{t("servers.paths")}</span>
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
                    <span className="text-[9px] text-slate-500">{t("servers.none")}</span>
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
          <ModalTitle>{t("servers.enableDispatcher", { id: srv.id })}</ModalTitle>
        </ModalHeader>
        <ModalContent>
          <DispatcherFormFields
            form={dispatcherForm}
            onChange={(patch) => setDispatcherForm((prev) => ({ ...prev, ...patch }))}
          />
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setIsDispatcherFormOpen(false)} disabled={dispatcherSaving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleDispatcherSave} disabled={dispatcherSaving}>
            {dispatcherSaving ? t("common.saving") : t("llmRoutes.enable")}
          </Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={confirmRemoveDispatcher}
        onClose={() => setConfirmRemoveDispatcher(false)}
        onConfirm={handleDispatcherRemove}
        title={t("servers.removeDispatcher")}
        message={t("servers.removeDispatcherMessage", { id: srv.id })}
        confirmLabel={t("common.remove")}
        variant="danger"
      />
    </section>
  );
}

export default function ServersPage() {
  const { t } = useI18n();
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
      showToast(error instanceof ApiError ? error.message : t("servers.loadFailed"), "error");
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadServers();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadServers]);

  const totalListeners = servers.reduce((sum, server) => sum + (server.listen?.length ?? 0), 0);

  const handleCreate = async () => {
    if (!createForm.id.trim()) {
      showToast(t("servers.idRequired"), "error");
      return;
    }
    if (!parseLines(createForm.listen).length) {
      showToast(t("servers.listenRequired"), "error");
      return;
    }

    setCreateSaving(true);
    try {
      const created = await createServer(formToServerReq(createForm));
      setServers((prev) => [...prev, created]);
      showToast(t("servers.created"), "success");
      setIsCreateOpen(false);
      setCreateForm(defaultServerForm());
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : t("servers.createFailed"), "error");
    } finally {
      setCreateSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDeleteId) return;
    try {
      await deleteServer(pendingDeleteId);
      setServers((prev) => prev.filter((server) => server.id !== pendingDeleteId));
      showToast(t("servers.deleted"), "success");
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : t("servers.deleteFailed"), "error");
    } finally {
      setPendingDeleteId(null);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">{t("servers.title")}</h1>
            <p className="mt-1 text-xs text-slate-400">
              {t("servers.description")}
            </p>
          </div>
          <Button
            onClick={() => {
              setCreateForm(defaultServerForm());
              setIsCreateOpen(true);
            }}
            className="px-2.5 py-1 text-xs"
          >
            {t("servers.create")}
          </Button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2">
        {[
          { label: t("servers.servers"), value: servers.length },
          { label: t("servers.listenAddresses"), value: totalListeners },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-slate-700/70 bg-slate-900/40 px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{stat.label}</p>
            <p className="mt-0.5 text-xs font-semibold text-slate-100">{stat.value}</p>
          </div>
        ))}
      </section>

      {loading ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center">
          <p className="text-sm text-slate-400">{t("servers.loading")}</p>
        </div>
      ) : servers.length === 0 ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center">
          <p className="text-sm text-slate-400">{t("servers.empty")}</p>
          <Button
            onClick={() => {
              setCreateForm(defaultServerForm());
              setIsCreateOpen(true);
            }}
            className="mt-4 px-3 py-1.5 text-xs"
          >
            {t("servers.create")}
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
          <ModalTitle>{t("servers.create")}</ModalTitle>
        </ModalHeader>
        <ModalContent>
          <ServerFormFields form={createForm} onChange={(patch) => setCreateForm((prev) => ({ ...prev, ...patch }))} />
        </ModalContent>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setIsCreateOpen(false)} disabled={createSaving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleCreate} disabled={createSaving}>
            {createSaving ? t("common.creating") : t("servers.create")}
          </Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(pendingDeleteId)}
        onClose={() => setPendingDeleteId(null)}
        onConfirm={handleDelete}
        title={t("servers.deleteTitle")}
        message={t("servers.deleteMessage")}
        confirmLabel={t("common.delete")}
        variant="danger"
      />
    </div>
  );
}
