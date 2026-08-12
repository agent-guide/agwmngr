"use client";

import { Input } from "@/components/ui/input";
import type { ProviderNetworkConfig } from "@/lib/api";

export interface NetworkDraft {
  request_timeout_seconds: string;
  max_retries: string;
  retry_delay_seconds: string;
  max_idle_connections: string;
  max_idle_connections_per_host: string;
  idle_keep_alive_timeout_seconds: string;
  proxy_url: string;
  extra_headers: string;
}

const NETWORK_NUMBER_FIELDS = [
  "request_timeout_seconds",
  "max_retries",
  "retry_delay_seconds",
  "max_idle_connections",
  "max_idle_connections_per_host",
  "idle_keep_alive_timeout_seconds",
] as const;

export function emptyNetworkDraft(): NetworkDraft {
  return {
    request_timeout_seconds: "",
    max_retries: "",
    retry_delay_seconds: "",
    max_idle_connections: "",
    max_idle_connections_per_host: "",
    idle_keep_alive_timeout_seconds: "",
    proxy_url: "",
    extra_headers: "",
  };
}

export function networkDraftFromConfig(config?: ProviderNetworkConfig): NetworkDraft {
  const draft = emptyNetworkDraft();
  for (const field of NETWORK_NUMBER_FIELDS) {
    if (config?.[field] !== undefined) draft[field] = String(config[field]);
  }
  draft.proxy_url = config?.proxy_url ?? "";
  return draft;
}

function parseStringMap(raw: string, label: string): Record<string, string> | undefined {
  if (!raw.trim()) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  const entries = Object.entries(value);
  if (entries.some(([, item]) => typeof item !== "string")) {
    throw new Error(`${label} values must all be strings`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

export function buildNetworkConfig(draft: NetworkDraft): ProviderNetworkConfig | undefined {
  const config: ProviderNetworkConfig = {};
  for (const field of NETWORK_NUMBER_FIELDS) {
    const raw = draft[field].trim();
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${field} must be a non-negative integer`);
    }
    config[field] = value;
  }
  if (draft.proxy_url.trim()) config.proxy_url = draft.proxy_url.trim();
  const headers = parseStringMap(draft.extra_headers, "Extra headers");
  if (headers !== undefined) config.extra_headers = headers;
  return Object.keys(config).length ? config : undefined;
}

export function parseProviderOptions(raw: string): Record<string, unknown> | undefined {
  if (!raw.trim()) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Provider options must be valid JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Provider options must be a JSON object");
  }
  return value as Record<string, unknown>;
}

type OptionKind = "text" | "number" | "boolean" | "select";
interface OptionField {
  key: string;
  label: string;
  kind: OptionKind;
  choices?: string[];
  placeholder?: string;
}

const COMPACT_CC: OptionField = { key: "compact", label: "Compatibility mode", kind: "select", choices: ["cc", "none"] };
const OPTION_FIELDS: Record<string, OptionField[]> = {
  openai: [
    { key: "organization", label: "Organization", kind: "text", placeholder: "org_..." },
    { key: "project", label: "Project", kind: "text", placeholder: "proj_..." },
    COMPACT_CC,
  ],
  openrouter: [COMPACT_CC],
  codex: [COMPACT_CC],
  claudecode: [
    { key: "api_key_header", label: "API key header", kind: "select", choices: ["authorization", "x-api-key"] },
    { key: "compact", label: "Compatibility mode", kind: "select", choices: ["codex", "none"] },
    { key: "context_window", label: "Context window", kind: "number" },
    { key: "max_output_tokens", label: "Max output tokens", kind: "number" },
    { key: "default_max_tokens", label: "Default max tokens", kind: "number" },
    { key: "vision", label: "Vision", kind: "boolean" },
  ],
  deepseek: [
    { key: "path", label: "Request path", kind: "text" },
    { key: "response_format_type", label: "Response format", kind: "select", choices: ["text", "json_object"] },
    { key: "thinking_type", label: "Thinking mode", kind: "select", choices: ["disabled", "enabled", "none"] },
    { key: "max_tokens", label: "Max tokens", kind: "number" },
    { key: "temperature", label: "Temperature", kind: "number" },
    { key: "top_p", label: "Top P", kind: "number" },
    { key: "presence_penalty", label: "Presence penalty", kind: "number" },
    { key: "frequency_penalty", label: "Frequency penalty", kind: "number" },
    { key: "log_probs", label: "Log probabilities", kind: "boolean" },
    { key: "top_log_probs", label: "Top log probabilities", kind: "number" },
    COMPACT_CC,
  ],
  zhipu: [
    { key: "api_profile", label: "API profile", kind: "select", choices: ["auto", "standard", "coding_plan"] },
    { key: "context_window", label: "Context window", kind: "number" },
    { key: "max_output_tokens", label: "Max output tokens", kind: "number" },
    { key: "vision", label: "Vision", kind: "boolean" },
    { key: "embeddings", label: "Embeddings", kind: "boolean" },
    { key: "thinking_type", label: "Thinking mode", kind: "select", choices: ["disabled", "enabled", "none"] },
    COMPACT_CC,
  ],
  qwen: [
    { key: "enable_thinking", label: "Enable thinking", kind: "boolean" },
    COMPACT_CC,
  ],
};

function parsedOptions(raw: string): Record<string, unknown> {
  try {
    return parseProviderOptions(raw) ?? {};
  } catch {
    return {};
  }
}

function updateOption(raw: string, field: OptionField, next: string): string {
  const options = parsedOptions(raw);
  if (!next) delete options[field.key];
  else if (field.kind === "boolean") options[field.key] = next === "true";
  else if (field.kind === "number") options[field.key] = Number(next);
  else options[field.key] = next;
  return JSON.stringify(options, null, 2);
}

function optionValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}

export function ProviderAdvancedFields({
  idPrefix,
  providerType,
  defaultModel,
  onDefaultModelChange,
  disabled,
  onDisabledChange,
  network,
  onNetworkChange,
  configuredHeaderNames = [],
  optionsRaw,
  onOptionsRawChange,
}: {
  idPrefix: string;
  providerType: string;
  defaultModel: string;
  onDefaultModelChange: (value: string) => void;
  disabled: boolean;
  onDisabledChange: (value: boolean) => void;
  network: NetworkDraft;
  onNetworkChange: (value: NetworkDraft) => void;
  configuredHeaderNames?: string[];
  optionsRaw: string;
  onOptionsRawChange: (value: string) => void;
}) {
  const options = parsedOptions(optionsRaw);
  const fields = OPTION_FIELDS[providerType] ?? [];
  const optionsError = (() => {
    try { parseProviderOptions(optionsRaw); return ""; }
    catch (error) { return error instanceof Error ? error.message : "Invalid options"; }
  })();

  return (
    <>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">Default model</label>
        <Input name={`${idPrefix}DefaultModel`} value={defaultModel} onChange={onDefaultModelChange} placeholder="Optional provider default" />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" checked={disabled} onChange={(event) => onDisabledChange(event.target.checked)} />
        Disabled
      </label>

      {fields.length > 0 && (
        <div className="rounded-md border border-slate-700/70 p-3">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{providerType} options</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((field) => {
              const value = optionValue(options[field.key]);
              return (
                <div key={field.key}>
                  <label className="mb-1 block text-xs font-medium text-slate-400">{field.label}</label>
                  {field.kind === "select" || field.kind === "boolean" ? (
                    <select
                      value={value}
                      onChange={(event) => onOptionsRawChange(updateOption(optionsRaw, field, event.target.value))}
                      className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100"
                    >
                      <option value="">Provider default</option>
                      {(field.kind === "boolean" ? ["true", "false"] : field.choices ?? []).map((choice) => (
                        <option key={choice} value={choice}>{choice}</option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      type={field.kind === "number" ? "number" : "text"}
                      name={`${idPrefix}Option${field.key}`}
                      value={value}
                      onChange={(next) => onOptionsRawChange(updateOption(optionsRaw, field, next))}
                      placeholder={field.placeholder}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <details className="rounded-md border border-slate-700/70 p-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-300">Network settings</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {NETWORK_NUMBER_FIELDS.map((field) => (
            <div key={field}>
              <label className="mb-1 block text-xs font-medium text-slate-400">{field}</label>
              <Input
                type="number"
                name={`${idPrefix}Network${field}`}
                value={network[field]}
                onChange={(value) => onNetworkChange({ ...network, [field]: value })}
                placeholder="Gateway default"
              />
            </div>
          ))}
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-400">Proxy URL</label>
            <Input name={`${idPrefix}ProxyUrl`} value={network.proxy_url} onChange={(value) => onNetworkChange({ ...network, proxy_url: value })} placeholder="http://127.0.0.1:7890" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-400">Extra headers (write-only JSON)</label>
            {configuredHeaderNames.length > 0 && (
              <p className="mb-1 text-[11px] text-slate-500">Configured: {configuredHeaderNames.join(", ")}. Leave blank to preserve them.</p>
            )}
            <textarea
              value={network.extra_headers}
              onChange={(event) => onNetworkChange({ ...network, extra_headers: event.target.value })}
              placeholder={'{"HTTP-Referer":"https://example.com","X-Title":"Agent Gateway"}'}
              rows={3}
              className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 font-mono text-xs text-slate-100"
            />
          </div>
        </div>
      </details>

      <details className="rounded-md border border-slate-700/70 p-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-300">Advanced options JSON</summary>
        <textarea
          value={optionsRaw}
          onChange={(event) => onOptionsRawChange(event.target.value)}
          rows={7}
          className="mt-3 w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 font-mono text-xs text-slate-100"
        />
        {optionsError && <p className="mt-1 text-xs text-red-400">{optionsError}</p>}
      </details>
    </>
  );
}
