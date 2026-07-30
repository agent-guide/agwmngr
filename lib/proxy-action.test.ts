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
    expect(actionForProxyPath("HEAD", "/admin/agents/routes")).toBe("gateway:read");
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

describe("actionForProxyPath — agent runtime operations (v0.5.0)", () => {
  test("resolving a pending agent permission is runtime:permission_resolve", () => {
    expect(actionForProxyPath("POST", "/admin/agents/my-agent/permissions/req-1")).toBe(
      "runtime:permission_resolve",
    );
  });

  test("listing permissions is a plain read, not a resolve", () => {
    expect(actionForProxyPath("GET", "/admin/agents/my-agent/permissions")).toBe("gateway:read");
  });

  test("the permissions override needs the exact 5-segment shape", () => {
    // Missing request id — this is the list endpoint's path with a POST, which
    // is not a resolve and must not be granted to a viewer by accident.
    expect(actionForProxyPath("POST", "/admin/agents/my-agent/permissions")).toBe("gateway:write");
    // A deeper path is not a resolve either.
    expect(actionForProxyPath("POST", "/admin/agents/a/permissions/req-1/extra")).toBe(
      "gateway:write",
    );
    // 'permissions' must be in the right position, not merely present.
    expect(actionForProxyPath("POST", "/admin/agents/a/runs/permissions")).toBe("gateway:write");
  });

  test("'routes' is the reserved ingress collection, never an agent id", () => {
    // /admin/agents/routes/{id} is route CRUD. Even in the (impossible) 5-segment
    // shape it must not be mistaken for an agent permission resolve.
    expect(actionForProxyPath("POST", "/admin/agents/routes/permissions/req-1")).toBe(
      "gateway:write",
    );
    expect(actionForProxyPath("POST", "/admin/agents/routes")).toBe("gateway:write");
    expect(actionForProxyPath("PUT", "/admin/agents/routes/agent:a:/x")).toBe("gateway:write");
    expect(actionForProxyPath("DELETE", "/admin/agents/routes/agent:a:/x")).toBe("gateway:write");
  });

  test("run cancellation and ACP thread recovery are ordinary writes", () => {
    expect(actionForProxyPath("DELETE", "/admin/agents/my-agent/runs/run-1")).toBe("gateway:write");
    expect(actionForProxyPath("DELETE", "/admin/acp/runtime/agents/my-agent/threads/t-1")).toBe(
      "gateway:write",
    );
  });

  test("agent runtime diagnostics stay reads", () => {
    expect(actionForProxyPath("GET", "/admin/agents/my-agent/capabilities")).toBe("gateway:read");
    expect(actionForProxyPath("GET", "/admin/agents/my-agent/runs")).toBe("gateway:read");
    expect(actionForProxyPath("GET", "/admin/builtin/runtime")).toBe("gateway:read");
    expect(actionForProxyPath("GET", "/admin/acp/runtime")).toBe("gateway:read");
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
