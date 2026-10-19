import type { AgentCapabilities, AgentRuntimeHTTP } from "./api";

export interface HTTPAgentFormValues {
  cardUrl: string;
  protocol: string;
  authRef: string;
  timeoutSeconds: string;
}

export function httpAgentFormValues(config?: AgentRuntimeHTTP): HTTPAgentFormValues {
  return {
    cardUrl: config?.card_url ?? "",
    protocol: config?.protocol ?? "a2a",
    authRef: config?.auth_ref ?? "",
    timeoutSeconds: config?.timeout_seconds === undefined ? "" : String(config.timeout_seconds),
  };
}

/** Shared by Form, YAML and Bundle import. Gateway remains authoritative. */
export function validateHTTPAgentConfig(config: Record<string, unknown>): AgentRuntimeHTTP {
  const unknown = Object.keys(config).filter((key) => !["card_url", "protocol", "auth_ref", "timeout_seconds"].includes(key));
  if (unknown.length) throw new Error(`Unsupported runtime.http fields: ${unknown.join(", ")}`);
  if (typeof config.card_url !== "string" || !config.card_url.trim()) throw new Error("runtime.http.card_url is required");
  const cardUrl = config.card_url.trim();
  let url: URL;
  try { url = new URL(cardUrl); } catch { throw new Error("runtime.http.card_url must be an absolute HTTP(S) URL"); }
  if (!/^https?:\/\//i.test(cardUrl) || !["https:", "http:"].includes(url.protocol)) {
    throw new Error("runtime.http.card_url must be an absolute HTTP(S) URL");
  }
  const authority = cardUrl.split(/[/?#]/)[2] ?? "";
  if (!authority) throw new Error("runtime.http.card_url must be an absolute HTTP(S) URL");
  if (authority.includes("@") || url.hash) throw new Error("runtime.http.card_url must not contain userinfo or a fragment");
  if (url.protocol === "http:") {
    // Inspect the original IPv4 spelling: WHATWG normalizes 127.1, hex and
    // octal addresses, but Gateway's net.ParseIP does not accept those forms.
    const rawHost = authority.startsWith("[") ? authority.slice(0, authority.indexOf("]") + 1) : authority.split(":")[0];
    const ipv4 = rawHost.split(".");
    const loopbackV4 = ipv4.length === 4 && ipv4[0] === "127" && ipv4.every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
    const loopbackV6 = rawHost.startsWith("[") && (url.hostname === "[::1]" || /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/i.test(url.hostname));
    if (rawHost.toLowerCase() !== "localhost" && !loopbackV4 && !loopbackV6) {
      throw new Error("runtime.http.card_url must use HTTPS except for loopback HTTP");
    }
  }
  const protocol = typeof config.protocol === "string" ? config.protocol.trim().toLowerCase() : "";
  if (protocol !== "a2a") throw new Error("runtime.http.protocol must be a2a");
  if (config.auth_ref !== undefined && typeof config.auth_ref !== "string") throw new Error("runtime.http.auth_ref must be a string");
  if (config.timeout_seconds !== undefined && (!Number.isSafeInteger(config.timeout_seconds) || Number(config.timeout_seconds) < 0)) {
    throw new Error("runtime.http.timeout_seconds must be a non-negative integer");
  }
  return {
    card_url: cardUrl,
    protocol,
    ...(config.auth_ref !== undefined && { auth_ref: (config.auth_ref as string).trim() }),
    ...(config.timeout_seconds !== undefined && { timeout_seconds: config.timeout_seconds as number }),
  };
}

export function httpAgentConfigFromForm(values: HTTPAgentFormValues): AgentRuntimeHTTP {
  const timeout = values.timeoutSeconds.trim();
  return validateHTTPAgentConfig({
    card_url: values.cardUrl,
    protocol: values.protocol,
    ...(values.authRef.trim() && { auth_ref: values.authRef }),
    ...(timeout && { timeout_seconds: Number(timeout) }),
  });
}

export function supportsAgentChat(capabilities?: AgentCapabilities): boolean {
  return capabilities?.executable === true && capabilities.turn?.streaming === true;
}

export function isCommonAgentRoute(protocol?: string): boolean {
  // A missing protocol is the legacy/default common-turn contract.
  return !protocol || protocol === "agent";
}
