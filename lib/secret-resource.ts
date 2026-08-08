type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactProviderItem(value: unknown): unknown {
  if (!isObject(value)) return value;
  if (!("id" in value) && !("api_key" in value)) return value;
  const { api_key: apiKey, ...safe } = value;
  return { ...safe, api_key_set: typeof apiKey === "string" && apiKey.length > 0 };
}

function redactCredentialItem(value: unknown): unknown {
  if (!isObject(value)) return value;
  if (!("id" in value) && !("attributes" in value)) return value;
  const attributes = isObject(value.attributes) ? value.attributes : undefined;
  if (!attributes) return { ...value, api_key_set: false };

  const { api_key: apiKey, ...safeAttributes } = attributes;
  return {
    ...value,
    attributes: safeAttributes,
    api_key_set: typeof apiKey === "string" && apiKey.length > 0,
  };
}

function redactCollection(value: unknown, redactItem: (item: unknown) => unknown): unknown {
  if (!isObject(value) || !Array.isArray(value.items)) return redactItem(value);
  return { ...value, items: value.items.map(redactItem) };
}

/** Remove Provider API keys from list, detail, and mutation responses. */
export function redactProviderResponse(value: unknown): unknown {
  return redactCollection(value, redactProviderItem);
}

/** Remove Credential api_key attributes from list, detail, and mutation responses. */
export function redactCredentialResponse(value: unknown): unknown {
  return redactCollection(value, redactCredentialItem);
}

/**
 * Provider PUT is a whole-object replacement upstream. Merge the browser's
 * non-secret patch into the current raw object so an omitted API key means
 * preserve rather than erase. Only upstream ProviderConfig fields are sent.
 */
export function mergeProviderUpdate(current: unknown, patch: unknown, id: string): JsonObject {
  const existing = isObject(current) ? current : {};
  const requested = isObject(patch) ? patch : {};
  const merged: JsonObject = { ...existing, ...requested, id };
  const allowed = [
    "id",
    "provider_type",
    "disabled",
    "api_key",
    "base_url",
    "default_model",
    "network",
    "options",
    "created_at",
    "updated_at",
  ];
  const out: JsonObject = {};
  for (const key of allowed) {
    if (merged[key] !== undefined) out[key] = merged[key];
  }
  return out;
}

/**
 * Credential PUT is partial upstream, but a supplied attributes object replaces
 * the whole map. Preserve the raw API key while allowing the UI to replace it
 * explicitly and to edit/delete non-secret attributes.
 */
export function mergeCredentialUpdate(current: unknown, patch: unknown): JsonObject {
  const existing = isObject(current) ? current : {};
  const requested = isObject(patch) ? patch : {};
  if (!isObject(requested.attributes)) return { ...requested };

  const currentAttributes = isObject(existing.attributes) ? existing.attributes : {};
  const currentApiKey = currentAttributes.api_key;
  const requestedApiKey = requested.attributes.api_key;
  const attributes: JsonObject = { ...requested.attributes };
  if (
    (typeof requestedApiKey !== "string" || requestedApiKey.length === 0) &&
    typeof currentApiKey === "string" &&
    currentApiKey.length > 0
  ) {
    attributes.api_key = currentApiKey;
  }
  return { ...requested, attributes };
}
