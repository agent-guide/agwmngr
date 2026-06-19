"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter } from "@/components/ui/modal";
import {
  ApiError,
  disableCLIAuthRefresher,
  enableCLIAuthRefresher,
  getCLIAuthLoginStatus,
  getCLIAuthRefresherStatus,
  listCLIAuthAuthenticators,
  listProviderTypes,
  listProviders,
  startCLIAuthLogin,
  updateCLIAuthAuthenticator,
  type AuthenticatorConfig,
  type AuthenticatorState,
  type CLIAuthLoginStatus,
  type NetworkConfig,
  type ProviderItem,
  type ProviderTypeItem,
} from "@/lib/api";

function ProviderTypeRow({ item }: { item: ProviderTypeItem }) {
  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-950/35 p-4">
      <div className="flex items-center justify-between gap-4">
        <span className="font-mono text-sm text-slate-200">{item.provider_type}</span>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${
            item.enabled
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
              : "border-slate-600/60 bg-slate-800/60 text-slate-500"
          }`}
        >
          {item.enabled ? "Enabled" : "Disabled"}
        </span>
      </div>
    </div>
  );
}

function ConfigInput({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  min,
  max,
  disabled = false,
}: {
  label: string;
  type?: "text" | "number";
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-slate-400">{label}</label>
      <input
        type={type}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-md border border-slate-700/60 bg-slate-900/70 px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 transition-colors focus:border-slate-500/80 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
}

function AuthenticatorRow({
  item,
  onEnable,
  onDisable,
  enabling,
  disabling,
}: {
  item: AuthenticatorState;
  onEnable: (name: string, config: AuthenticatorConfig) => void;
  onDisable: (name: string) => void;
  enabling: boolean;
  disabling: boolean;
}) {
  const [showConfig, setShowConfig] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [localConfig, setLocalConfig] = useState<AuthenticatorConfig>(item.config);

  const prevEnabledRef = useRef(item.enabled);
  useEffect(() => {
    if (prevEnabledRef.current && !item.enabled) {
      setLocalConfig(item.config);
      setShowAdvanced(false);
    }
    prevEnabledRef.current = item.enabled;
  }, [item.enabled, item.config]);

  const displayConfig = item.enabled ? item.config : localConfig;
  const readOnly = item.enabled;

  const setField = <K extends keyof AuthenticatorConfig>(key: K, value: AuthenticatorConfig[K]) => {
    if (readOnly) return;
    setLocalConfig((prev) => ({ ...prev, [key]: value }));
  };

  const setNetworkField = <K extends keyof NetworkConfig>(key: K, value: NetworkConfig[K]) => {
    if (readOnly) return;
    setLocalConfig((prev) => ({
      ...prev,
      network: { ...prev.network, [key]: value },
    }));
  };

  const handleEnable = () => {
    onEnable(item.name, localConfig);
    setLocalConfig({});
    setShowAdvanced(false);
  };

  const handleDisable = () => {
    onDisable(item.name);
  };

  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-950/35">
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold capitalize text-slate-100">{item.name}</h3>
              {item.source && (
                <span className="rounded-full border border-slate-700/60 bg-slate-800/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                  {item.source}
                </span>
              )}
              {item.read_only && (
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-400">
                  Read-only
                </span>
              )}
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${
                  item.enabled
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                    : "border-slate-600/60 bg-slate-800/60 text-slate-500"
                }`}
              >
                {item.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            {item.provider_type && (
              <p className="mt-1.5 text-xs text-slate-500">
                Provider: <span className="text-slate-400">{item.provider_type}</span>
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setShowConfig((value) => !value)}
              disabled={item.read_only}
              title="Configure and enable"
              className={`rounded-md p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                showConfig
                  ? "bg-slate-700/80 text-slate-200"
                  : "text-slate-500 hover:bg-slate-800/80 hover:text-slate-300"
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {showConfig && !item.read_only && (
        <div className="space-y-3 border-t border-slate-700/50 px-4 py-3">
          {item.enabled && <p className="text-[11px] text-slate-500">Current configuration (read-only)</p>}

          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
            <ConfigInput
              label="Callback Port"
              type="number"
              value={displayConfig.callback_port != null ? String(displayConfig.callback_port) : ""}
              onChange={(value) => setField("callback_port", value ? parseInt(value, 10) : undefined)}
              placeholder="Auto (default)"
              min={1}
              max={65535}
              disabled={readOnly}
            />
            <div className="flex items-center gap-5 pb-1.5 sm:col-span-2">
              <label
                className={`flex select-none items-center gap-2 ${
                  readOnly ? "cursor-not-allowed opacity-50" : "cursor-pointer"
                }`}
              >
                <input
                  type="checkbox"
                  checked={displayConfig.no_browser ?? false}
                  onChange={(e) => setField("no_browser", e.target.checked || undefined)}
                  disabled={readOnly}
                  className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 accent-emerald-500"
                />
                <span className="text-xs text-slate-300">No Browser</span>
              </label>
              <label
                className={`flex select-none items-center gap-2 ${
                  readOnly ? "cursor-not-allowed opacity-50" : "cursor-pointer"
                }`}
              >
                <input
                  type="checkbox"
                  checked={displayConfig.device_flow ?? false}
                  onChange={(e) => setField("device_flow", e.target.checked || undefined)}
                  disabled={readOnly}
                  className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 accent-emerald-500"
                />
                <span className="text-xs text-slate-300">Device Flow</span>
              </label>
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((value) => !value)}
              className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 transition-colors hover:text-slate-400"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform ${showAdvanced ? "rotate-90" : ""}`}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              Network (Advanced)
            </button>

            {showAdvanced && (
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ConfigInput
                  label="Request Timeout (s)"
                  type="number"
                  value={
                    displayConfig.network?.request_timeout_seconds != null
                      ? String(displayConfig.network.request_timeout_seconds)
                      : ""
                  }
                  onChange={(value) =>
                    setNetworkField("request_timeout_seconds", value ? parseInt(value, 10) : undefined)
                  }
                  placeholder="120 (default)"
                  min={1}
                  disabled={readOnly}
                />
                <ConfigInput
                  label="Max Retries"
                  type="number"
                  value={
                    displayConfig.network?.max_retries != null
                      ? String(displayConfig.network.max_retries)
                      : ""
                  }
                  onChange={(value) => setNetworkField("max_retries", value ? parseInt(value, 10) : undefined)}
                  placeholder="3 (default)"
                  min={0}
                  disabled={readOnly}
                />
                <ConfigInput
                  label="Retry Delay (s)"
                  type="number"
                  value={
                    displayConfig.network?.retry_delay_seconds != null
                      ? String(displayConfig.network.retry_delay_seconds)
                      : ""
                  }
                  onChange={(value) =>
                    setNetworkField("retry_delay_seconds", value ? parseInt(value, 10) : undefined)
                  }
                  placeholder="1 (default)"
                  min={0}
                  disabled={readOnly}
                />
                <ConfigInput
                  label="Proxy URL"
                  value={displayConfig.network?.proxy_url ?? ""}
                  onChange={(value) => setNetworkField("proxy_url", value || undefined)}
                  placeholder="http://proxy:port"
                  disabled={readOnly}
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-700/40 pt-1">
            {item.enabled ? (
              <button
                type="button"
                onClick={handleDisable}
                disabled={disabling}
                className="rounded-md border border-slate-600/70 bg-slate-800/70 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {disabling ? "Disabling..." : "Disable"}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleEnable}
                disabled={enabling}
                className="rounded-md border border-emerald-500/40 bg-emerald-600/30 px-3 py-1.5 text-[11px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-600/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {enabling ? "Enabling..." : "Enable"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function GatewayPage() {
  const [providerTypes, setProviderTypes] = useState<ProviderTypeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  const [authenticators, setAuthenticators] = useState<AuthenticatorState[]>([]);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [enablingNames, setEnablingNames] = useState<Set<string>>(new Set());
  const [disablingNames, setDisablingNames] = useState<Set<string>>(new Set());

  const [refresherEnabled, setRefresherEnabled] = useState(false);
  const [refresherToggling, setRefresherToggling] = useState(false);

  // CLIAuth Login modal
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [isCLIAuthOpen, setIsCLIAuthOpen] = useState(false);
  const [cliauthAuthName, setCliauthAuthName] = useState("");
  const [cliauthProviderId, setCliauthProviderId] = useState("");
  const [cliauthStarting, setCliauthStarting] = useState(false);
  const [cliauthLoginId, setCliauthLoginId] = useState<string | null>(null);
  const [cliauthLoginStatus, setCliauthLoginStatus] = useState<CLIAuthLoginStatus | null>(null);
  const cliauthPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const enabledAuthenticators = authenticators.filter((a) => a.enabled);

  const loadProviderTypes = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listProviderTypes();
      setProviderTypes(items);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to load provider types", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const fetchAuthenticators = useCallback(async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const items = await listCLIAuthAuthenticators();
      setAuthenticators(items);
    } catch (error) {
      setAuthError(error instanceof ApiError ? error.message : "Failed to load authenticators");
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const fetchRefresherStatus = useCallback(async () => {
    try {
      const status = await getCLIAuthRefresherStatus();
      setRefresherEnabled(status.enabled);
    } catch {
      // ignore if not configured
    }
  }, []);

  const handleRefresherToggle = useCallback(async () => {
    setRefresherToggling(true);
    try {
      if (refresherEnabled) {
        await disableCLIAuthRefresher();
        setRefresherEnabled(false);
        showToast("Auto refresher disabled", "success");
      } else {
        await enableCLIAuthRefresher();
        setRefresherEnabled(true);
        showToast("Auto refresher enabled", "success");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to toggle refresher", "error");
    } finally {
      setRefresherToggling(false);
    }
  }, [refresherEnabled, showToast]);

  const handleEnable = useCallback(
    async (name: string, config: AuthenticatorConfig) => {
      setEnablingNames((prev) => new Set(prev).add(name));
      setAuthError(null);
      try {
        const result = await updateCLIAuthAuthenticator(name, { enabled: true, config });
        setAuthenticators((prev) => prev.map((item) => (item.name === name ? result.authenticator : item)));
        showToast(`${name} enabled`, "success");
      } catch (error) {
        const message = error instanceof ApiError ? error.message : `Failed to enable ${name}`;
        setAuthError(message);
        showToast(message, "error");
      } finally {
        setEnablingNames((prev) => {
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
      }
    },
    [showToast],
  );

  const handleDisable = useCallback(
    async (name: string) => {
      setDisablingNames((prev) => new Set(prev).add(name));
      setAuthError(null);
      try {
        const result = await updateCLIAuthAuthenticator(name, { enabled: false });
        setAuthenticators((prev) => prev.map((item) => (item.name === name ? result.authenticator : item)));
        showToast(`${name} disabled`, "success");
      } catch (error) {
        const message = error instanceof ApiError ? error.message : `Failed to disable ${name}`;
        setAuthError(message);
        showToast(message, "error");
      } finally {
        setDisablingNames((prev) => {
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
      }
    },
    [showToast],
  );

  const resetCLIAuthModal = () => {
    setIsCLIAuthOpen(false);
    setCliauthAuthName("");
    setCliauthProviderId("");
    setCliauthStarting(false);
    setCliauthLoginId(null);
    setCliauthLoginStatus(null);
    if (cliauthPollRef.current !== null) {
      clearInterval(cliauthPollRef.current);
      cliauthPollRef.current = null;
    }
  };

  const handleStartCLIAuthLogin = async () => {
    if (!cliauthAuthName) {
      showToast("Select an authenticator", "error");
      return;
    }
    setCliauthStarting(true);
    try {
      const res = await startCLIAuthLogin(
        cliauthAuthName,
        cliauthProviderId ? { provider_id: cliauthProviderId } : undefined,
      );
      setCliauthLoginId(res.login_id);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to start login", "error");
      setCliauthStarting(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProviderTypes();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProviderTypes]);

  useEffect(() => {
    if (!isCLIAuthOpen) return;
    listProviders()
      .then(setProviders)
      .catch(() => {});
  }, [isCLIAuthOpen]);

  useEffect(() => {
    if (!cliauthLoginId) return;
    const poll = async () => {
      try {
        const s = await getCLIAuthLoginStatus(cliauthLoginId);
        setCliauthLoginStatus(s);
        if (s.status !== "running") {
          if (cliauthPollRef.current !== null) {
            clearInterval(cliauthPollRef.current);
            cliauthPollRef.current = null;
          }
        }
      } catch {
        if (cliauthPollRef.current !== null) {
          clearInterval(cliauthPollRef.current);
          cliauthPollRef.current = null;
        }
      }
    };
    poll();
    cliauthPollRef.current = setInterval(poll, 2000);
    return () => {
      if (cliauthPollRef.current !== null) {
        clearInterval(cliauthPollRef.current);
        cliauthPollRef.current = null;
      }
    };
  }, [cliauthLoginId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchAuthenticators();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchAuthenticators]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchRefresherStatus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchRefresherStatus]);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <h1 className="text-xl font-semibold tracking-tight text-slate-100">Gateway Configuration</h1>
        <p className="mt-1 text-xs text-slate-400">Configure gateway settings for your Caddy HTTP servers.</p>
      </section>

      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Provider Types</h2>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              Provider integrations available in the gateway. Availability is configured at gateway
              startup (Caddyfile or daemon flags) and is read-only here.
            </p>
          </div>
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-slate-400">Loading provider types...</p>
        ) : providerTypes.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">No provider types available.</p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {providerTypes.map((item) => (
              <ProviderTypeRow key={item.provider_type} item={item} />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">CLI Authentication</h2>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              Configure CLI authenticators and automatic credential refresh behavior.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsCLIAuthOpen(true)}
              className="inline-flex items-center gap-2 rounded-md border border-slate-600/70 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-700/70"
            >
              Add CLIAuth Login
            </button>
            <button
              type="button"
              onClick={handleRefresherToggle}
              disabled={refresherToggling}
              className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                refresherEnabled
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-slate-600/70 bg-slate-800/60 text-slate-300 hover:bg-slate-700/70"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${refresherEnabled ? "bg-emerald-400" : "bg-slate-500"}`}
              />
              {refresherToggling
                ? "Updating..."
                : refresherEnabled
                  ? "Auto refresher enabled"
                  : "Enable auto refresher"}
            </button>
          </div>
        </div>

        {authError && (
          <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {authError}
          </div>
        )}

        {authLoading ? (
          <p className="mt-4 text-sm text-slate-400">Loading authenticators...</p>
        ) : authenticators.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">No authenticators available.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {authenticators.map((item) => (
              <AuthenticatorRow
                key={item.name}
                item={item}
                onEnable={handleEnable}
                onDisable={handleDisable}
                enabling={enablingNames.has(item.name)}
                disabling={disablingNames.has(item.name)}
              />
            ))}
          </div>
        )}
      </section>

      {/* CLIAuth Login Modal */}
      <Modal isOpen={isCLIAuthOpen} onClose={resetCLIAuthModal}>
        <ModalHeader>
          <ModalTitle>Add CLIAuth Login</ModalTitle>
        </ModalHeader>
        <ModalContent>
          {!cliauthLoginId ? (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-300">
                  Authenticator <span className="text-red-400">*</span>
                </label>
                <select
                  value={cliauthAuthName}
                  onChange={(e) => { setCliauthAuthName(e.target.value); setCliauthProviderId(""); }}
                  className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Select an authenticator…</option>
                  {enabledAuthenticators.map((a) => (
                    <option key={a.name} value={a.name}>
                      {a.name}{a.provider_type ? ` (${a.provider_type})` : ""}
                    </option>
                  ))}
                </select>
                {enabledAuthenticators.length === 0 && (
                  <p className="mt-1.5 text-[11px] text-slate-500">
                    No enabled authenticators found.
                  </p>
                )}
              </div>
              {cliauthAuthName && (() => {
                const selectedAuth = enabledAuthenticators.find((a) => a.name === cliauthAuthName);
                const filteredProviders = selectedAuth?.provider_type
                  ? providers.filter((p) => p.provider_type === selectedAuth.provider_type)
                  : providers;
                return (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-300">Provider ID</label>
                    <select
                      value={cliauthProviderId}
                      onChange={(e) => setCliauthProviderId(e.target.value)}
                      className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">Select a provider…</option>
                      {filteredProviders.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.id} ({p.provider_type})
                        </option>
                      ))}
                    </select>
                    {filteredProviders.length === 0 && (
                      <p className="mt-1.5 text-[11px] text-slate-500">
                        No providers found for type &quot;{selectedAuth?.provider_type}&quot;.
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Status:</span>
                <span
                  className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    cliauthLoginStatus?.status === "succeeded"
                      ? "bg-green-900/40 text-green-300"
                      : cliauthLoginStatus?.status === "failed"
                      ? "bg-red-900/40 text-red-300"
                      : "bg-blue-900/40 text-blue-300"
                  }`}
                >
                  {cliauthLoginStatus?.status ?? "starting"}
                </span>
                {cliauthLoginStatus?.status === "running" && (
                  <span className="animate-pulse text-[10px] text-slate-500">polling…</span>
                )}
              </div>

              {cliauthLoginStatus?.phase && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Phase</p>
                  <p className="text-xs text-slate-300">{cliauthLoginStatus.phase}</p>
                </div>
              )}

              {cliauthLoginStatus?.message && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Message</p>
                  <p className="text-xs text-slate-300">{cliauthLoginStatus.message}</p>
                </div>
              )}

              {cliauthLoginStatus?.user_code && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">User Code</p>
                  <p className="font-mono text-base font-bold tracking-widest text-slate-100">
                    {cliauthLoginStatus.user_code}
                  </p>
                </div>
              )}

              {cliauthLoginStatus?.verification_url && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Verification URL</p>
                  <a
                    href={cliauthLoginStatus.verification_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-xs text-blue-400 underline hover:text-blue-300"
                  >
                    {cliauthLoginStatus.verification_url}
                  </a>
                </div>
              )}

              {cliauthLoginStatus?.error && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-red-500">Error</p>
                  <p className="text-xs text-red-400">{cliauthLoginStatus.error}</p>
                </div>
              )}

              {cliauthLoginStatus?.credential_id && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Credential ID</p>
                  <p className="font-mono text-xs text-green-300">{cliauthLoginStatus.credential_id}</p>
                </div>
              )}
            </div>
          )}
        </ModalContent>
        <ModalFooter>
          {!cliauthLoginId ? (
            <>
              <Button variant="ghost" onClick={resetCLIAuthModal} disabled={cliauthStarting}>
                Cancel
              </Button>
              <Button
                onClick={handleStartCLIAuthLogin}
                disabled={cliauthStarting || !cliauthAuthName}
              >
                {cliauthStarting ? "Starting…" : "Start Login"}
              </Button>
            </>
          ) : (
            <Button
              onClick={resetCLIAuthModal}
              disabled={cliauthLoginStatus?.status === "running"}
            >
              {cliauthLoginStatus?.status === "running" ? "Waiting…" : "Close"}
            </Button>
          )}
        </ModalFooter>
      </Modal>
    </div>
  );
}
