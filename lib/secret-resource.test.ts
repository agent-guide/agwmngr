import { describe, expect, test } from "bun:test";
import {
  mergeCredentialUpdate,
  mergeProviderUpdate,
  redactCredentialResponse,
  redactProviderResponse,
  redactVirtualKeyResponse,
  virtualKeyPreview,
} from "./secret-resource";

describe("secret response projection", () => {
  test("provider list and detail never expose api_key", () => {
    expect(redactProviderResponse({ id: "p", api_key: "secret" })).toEqual({
      id: "p",
      api_key_set: true,
    });
    expect(redactProviderResponse({ items: [{ id: "p", api_key: "secret" }] })).toEqual({
      items: [{ id: "p", api_key_set: true }],
    });
  });

  test("credential attributes retain non-secret values only", () => {
    expect(
      redactCredentialResponse({
        id: "c",
        attributes: { api_key: "secret", base_url: "https://example.test" },
      }),
    ).toEqual({
      id: "c",
      attributes: { base_url: "https://example.test" },
      api_key_set: true,
    });
  });

  test("virtual key list and detail never expose the bearer", () => {
    expect(redactVirtualKeyResponse({ id: "vk", key: "sk-abcdefgh12345678", disabled: false })).toEqual({
      id: "vk",
      disabled: false,
      key_set: true,
      key_preview: "sk-a…5678",
    });
    expect(redactVirtualKeyResponse({ items: [{ id: "vk", key: "sk-abcdefgh12345678" }] })).toEqual({
      items: [{ id: "vk", key_set: true, key_preview: "sk-a…5678" }],
    });
  });

  test("virtual key with no stored bearer reports key_set false", () => {
    expect(redactVirtualKeyResponse({ id: "vk" })).toEqual({
      id: "vk",
      key_set: false,
      key_preview: "",
    });
  });

  test("virtual key redaction leaves an error body untouched", () => {
    expect(redactVirtualKeyResponse({ error: "not found" })).toEqual({ error: "not found" });
  });

  test("preview reveals nothing for a key short enough to be guessable from it", () => {
    expect(virtualKeyPreview("short-key")).toBe("");
    expect(virtualKeyPreview("0123456789abcdef")).toBe("0123…cdef");
  });
});

describe("write-only secret updates", () => {
  test("provider update preserves an omitted key and strips view-only fields", () => {
    expect(
      mergeProviderUpdate(
        { id: "p", provider_type: "openai", api_key: "secret", source: "store" },
        { provider_type: "openai", base_url: "https://example.test" },
        "p",
      ),
    ).toEqual({
      id: "p",
      provider_type: "openai",
      api_key: "secret",
      base_url: "https://example.test",
    });
  });

  test("credential update preserves or explicitly replaces the key", () => {
    const current = { attributes: { api_key: "old", base_url: "old-url" } };
    expect(mergeCredentialUpdate(current, { attributes: { base_url: "new-url" } })).toEqual({
      attributes: { api_key: "old", base_url: "new-url" },
    });
    expect(
      mergeCredentialUpdate(current, { attributes: { api_key: "new", base_url: "new-url" } }),
    ).toEqual({ attributes: { api_key: "new", base_url: "new-url" } });
  });
});
