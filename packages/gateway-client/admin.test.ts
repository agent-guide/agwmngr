import { afterEach, describe, expect, test } from "bun:test";
import type { ResolvedGateway } from "../contracts/gateway/connection";
import {
  baseURLCache,
  basicAuthHeader,
  gatewayAddrCandidates,
  gatewayRequestJSON,
} from "./admin";

function gateway(overrides: Partial<ResolvedGateway> = {}): ResolvedGateway {
  return {
    id: "gateway-a",
    name: "Gateway A",
    adminAddr: "http://localhost:8019",
    adminUser: "admin",
    adminPassword: "secret",
    caddyAdminAddr: null,
    dataplaneAddr: null,
    readonlyServerIds: [],
    status: "active",
    ...overrides,
  };
}

afterEach(() => {
  for (const key of Object.keys(baseURLCache())) delete baseURLCache()[key];
});

describe("Gateway Admin client", () => {
  test("builds Basic authentication from the resolved connection", () => {
    expect(basicAuthHeader(gateway())).toBe(
      `Basic ${Buffer.from("admin:secret").toString("base64")}`,
    );
  });

  test("keeps loopback fallback and cache state isolated by Gateway id", () => {
    expect(gatewayAddrCandidates(gateway())).toEqual([
      "http://localhost:8019",
      "http://127.0.0.1:8019",
    ]);

    baseURLCache()["gateway-a"] = "http://127.0.0.1:9019";
    expect(gatewayAddrCandidates(gateway())[0]).toBe("http://127.0.0.1:9019");
    expect(gatewayAddrCandidates(gateway({ id: "gateway-b" }))[0]).toBe(
      "http://localhost:8019",
    );
  });

  test("sends authenticated JSON and records the successful address", async () => {
    let received: { method: string; authorization: string | null; body: unknown } | undefined;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        received = {
          method: request.method,
          authorization: request.headers.get("authorization"),
          body: await request.json(),
        };
        return Response.json({ accepted: true }, { status: 201 });
      },
    });

    try {
      const resolved = gateway({
        adminAddr: `http://127.0.0.1:${server.port}`,
      });
      const result = await gatewayRequestJSON("POST", "/admin/test", resolved, {
        value: 42,
      });

      expect(result).toEqual({ status: 201, body: { accepted: true } });
      expect(received).toEqual({
        method: "POST",
        authorization: basicAuthHeader(resolved),
        body: { value: 42 },
      });
      expect(baseURLCache()[resolved.id]).toBe(resolved.adminAddr);
    } finally {
      await server.stop(true);
    }
  });

  test("forwards cancellation to an in-flight Gateway request", async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        markStarted();
        return new Promise<Response>(() => undefined);
      },
    });

    try {
      const controller = new AbortController();
      const request = gatewayRequestJSON(
        "GET",
        "/admin/hanging",
        gateway({ adminAddr: `http://127.0.0.1:${server.port}` }),
        undefined,
        { signal: controller.signal },
      );
      await started;
      controller.abort();
      await expect(request).rejects.toThrow("gateway unreachable");
    } finally {
      await server.stop(true);
    }
  });
});
