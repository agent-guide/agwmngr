import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { dataplaneFetch } from "./dataplane-fetch";

describe("data-plane virtual Host transport", () => {
  let base: string;
  let server: ReturnType<typeof Bun.serve>;
  let closed: Promise<void>;
  let markClosed: () => void;
  beforeAll(() => {
    server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch(req) {
        if (new URL(req.url).pathname === "/stream") {
          const onClose = markClosed;
          req.signal.addEventListener("abort", () => onClose(), { once: true });
          return new Response(new ReadableStream({
            start(controller) { controller.enqueue(new TextEncoder().encode("event: delta\ndata: first\n\n")); },
            cancel() { onClose(); },
          }), { headers: { "Content-Type": "text/event-stream" } });
        }
        return Response.json({ host: req.headers.get("host"), method: req.method });
      },
    });
    base = `http://127.0.0.1:${server.port}`;
  });
  afterAll(async () => { await server.stop(true); });
  const options = { method: "POST", headers: { Host: "agent-smoke.invalid", "Content-Type": "application/json" }, body: "{}" };

  test("connects to the configured listener while preserving the virtual Host", async () => {
    const response = await dataplaneFetch(base, options);
    expect(await response.json()).toEqual({ host: "agent-smoke.invalid", method: "POST" });
  });
  test("propagates abort after headers to the upstream stream", async () => {
    closed = new Promise<void>((resolve) => { markClosed = resolve; });
    const controller = new AbortController();
    const response = await dataplaneFetch(`${base}/stream`, { ...options, signal: controller.signal });
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    controller.abort();
    await expect(reader.read()).rejects.toThrow();
    await closed;
  });
  test("cancelling the response body closes the upstream connection", async () => {
    closed = new Promise<void>((resolve) => { markClosed = resolve; });
    const response = await dataplaneFetch(`${base}/stream`, options);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await closed;
  });
});
