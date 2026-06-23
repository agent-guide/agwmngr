import { describe, expect, test } from "bun:test";
import { actionForProxyPath, canonicalSegments } from "./proxy-action";

describe("canonicalSegments", () => {
  test("splits on '/' and drops empty + '.' segments", () => {
    expect(canonicalSegments("/admin/credentials")).toEqual(["admin", "credentials"]);
    expect(canonicalSegments("/admin//credentials/")).toEqual(["admin", "credentials"]);
    expect(canonicalSegments("/admin/./credentials")).toEqual(["admin", "credentials"]);
  });

  test("strips query and fragment", () => {
    expect(canonicalSegments("/admin/credentials?source=store")).toEqual(["admin", "credentials"]);
    expect(canonicalSegments("/admin/credentials#frag")).toEqual(["admin", "credentials"]);
  });
});

describe("actionForProxyPath — method defaults", () => {
  test("GET/HEAD default to gateway:read", () => {
    expect(actionForProxyPath("GET", "/admin/mcp/services")).toBe("gateway:read");
    expect(actionForProxyPath("HEAD", "/admin/acp/routes")).toBe("gateway:read");
  });

  test("mutating methods default to gateway:write", () => {
    expect(actionForProxyPath("POST", "/admin/mcp/services")).toBe("gateway:write");
    expect(actionForProxyPath("PUT", "/admin/llm/routes/x")).toBe("gateway:write");
    expect(actionForProxyPath("DELETE", "/admin/providers/x")).toBe("gateway:write");
    expect(actionForProxyPath("PATCH", "/admin/anything")).toBe("gateway:write");
  });

  test("method comparison is case-insensitive", () => {
    expect(actionForProxyPath("get", "/admin/mcp/services")).toBe("gateway:read");
    expect(actionForProxyPath("post", "/admin/mcp/services/x/tools/call")).toBe("runtime:chat");
  });
});

describe("actionForProxyPath — runtime override (execute-on-read POSTs)", () => {
  test("tools/call and resources/read map to runtime:chat", () => {
    expect(actionForProxyPath("POST", "/admin/mcp/services/svc/tools/call")).toBe("runtime:chat");
    expect(actionForProxyPath("POST", "/admin/mcp/services/svc/resources/read")).toBe("runtime:chat");
  });

  test("only the trailing segments count (not a substring anywhere)", () => {
    // A resource literally named 'call' under 'tools' still matches the suffix;
    // an unrelated tail does not.
    expect(actionForProxyPath("POST", "/admin/mcp/services/svc/tools/list")).toBe("gateway:write");
    expect(actionForProxyPath("POST", "/admin/tools/call/extra")).toBe("gateway:write");
  });

  test("GET on those paths is NOT runtime:chat (only POST executes)", () => {
    expect(actionForProxyPath("GET", "/admin/mcp/services/svc/tools/call")).toBe("gateway:read");
  });
});

describe("actionForProxyPath — secret override (per-segment, not prefix-string)", () => {
  test("GET credentials / providers map to secrets:read-redacted", () => {
    expect(actionForProxyPath("GET", "/admin/credentials")).toBe("secrets:read-redacted");
    expect(actionForProxyPath("GET", "/admin/credentials/cred-1")).toBe("secrets:read-redacted");
    expect(actionForProxyPath("GET", "/admin/llm/providers")).toBe("secrets:read-redacted");
    expect(actionForProxyPath("GET", "/admin/llm/providers/openai")).toBe("secrets:read-redacted");
  });

  test("sibling resources are NOT mis-matched as secret reads", () => {
    // The old regex `^/admin/credentials` matched these; canonical segment
    // matching must not.
    expect(actionForProxyPath("GET", "/admin/credentials-extra")).toBe("gateway:read");
    expect(actionForProxyPath("GET", "/admin/llm/providers-summary")).toBe("gateway:read");
  });

  test("mutations on secret paths stay gateway:write (not a redacted read)", () => {
    expect(actionForProxyPath("POST", "/admin/credentials")).toBe("gateway:write");
    expect(actionForProxyPath("PUT", "/admin/llm/providers/openai")).toBe("gateway:write");
  });
});
