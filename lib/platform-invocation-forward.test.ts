import { describe, expect, test } from "bun:test";
import { consumePlatformTurn } from "./platform-invocation-forward";

describe("consumePlatformTurn", () => {
  test("drains a successful permission continuation", async () => {
    const response = new Response([
      "event: delta\ndata: {\"text\":\"continued\"}\n\n",
      "event: done\ndata: {\"stop_reason\":\"end_turn\"}\n\n",
    ].join(""), { headers: { "Content-Type": "text/event-stream" } });
    await expect(consumePlatformTurn(response)).resolves.toBeUndefined();
  });

  test("surfaces an SSE runtime failure", async () => {
    const response = new Response(
      "event: error\ndata: {\"message\":\"checkpoint expired\"}\n\n",
      { headers: { "Content-Type": "text/event-stream" } },
    );
    await expect(consumePlatformTurn(response))
      .rejects.toMatchObject({ code: "conflict", message: "checkpoint expired" });
  });

  test("surfaces a rejected upstream request", async () => {
    const response = Response.json({ error: "permission not found" }, { status: 404 });
    await expect(consumePlatformTurn(response))
      .rejects.toMatchObject({ code: "conflict", message: "permission not found" });
  });
});
