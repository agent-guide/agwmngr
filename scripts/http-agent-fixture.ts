import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import bcrypt from "bcryptjs";
import { httpAgentConfigFromForm, httpAgentFormValues, supportsAgentChat } from "../lib/agent-http";
import { agentPayloadYaml, parseAgentPayloadYaml } from "../lib/agent-yaml";

const REVISION = "3d04b7a0207a6d31746a1b196ae9d82097c2087c";

/** Build a pinned source archive; never check out or mutate the source repo. */
export async function startHTTPAgentFixture(sandbox: string, logFd: number) {
  const sourceRepo = process.env.AGW_SOURCE_DIR || resolve(import.meta.dir, "../../agent-gateway");
  const source = join(sandbox, "gateway-source");
  mkdirSync(source);
  const archive = join(sandbox, "gateway.tar");
  writeFileSync(archive, execFileSync("git", ["-C", sourceRepo, "archive", REVISION], { maxBuffer: 64 << 20 }));
  execFileSync("tar", ["-xf", archive, "-C", source]);
  const children: ChildProcess[] = [];
  const launch = (cmd: string, args: string[]) => {
    const child = spawn(cmd, args, { cwd: source, stdio: ["ignore", logFd, logFd] });
    children.push(child);
    return child;
  };
  const run = (cmd: string, args: string[]) => new Promise<void>((resolve, reject) => {
    const child = launch(cmd, args);
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)));
  });
  const stop = async () => {
    for (const child of children.reverse()) {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue;
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
      try { await exited; } finally { clearTimeout(timer); }
    }
  };
  try {
    await run("go", ["build", "-o", join(source, "agwd"), "./cmd/agwd"]);
    await run("go", ["build", "-o", join(source, "a2a-fixture"), "./examples/a2a-agent"]);
    const listeners = Array.from({ length: 3 }, () => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() }));
    const [fixturePort, adminPort, dataPort] = listeners.map((listener) => listener.port!);
    for (const listener of listeners) await listener.stop(true);
    const fixtureBase = `http://127.0.0.1:${fixturePort}`;
    const adminBase = `http://127.0.0.1:${adminPort}`;
    const gatewayPassword = crypto.randomUUID();
    launch(join(source, "a2a-fixture"), ["--listen", `127.0.0.1:${fixturePort}`]);
    launch(join(source, "agwd"), [
      "--addr", `127.0.0.1:${dataPort}`, "--admin-addr", `127.0.0.1:${adminPort}`,
      "--config-store", join(sandbox, "gateway.db"),
      "--admin-basic-auth-hash", `smoke:${await bcrypt.hash(gatewayPassword, 10)}`,
    ]);
    const deadline = Date.now() + 90_000;
    for (const url of [`${fixtureBase}/healthz`, `${adminBase}/admin/agents`]) {
      let ready = false;
      while (Date.now() < deadline) {
        try {
          const response = await fetch(url, { headers: { Authorization: `Basic ${Buffer.from(`smoke:${gatewayPassword}`).toString("base64")}` }, signal: AbortSignal.timeout(2_000) });
          if (response.ok) { ready = true; break; }
        } catch { /* listener not ready */ }
        await Bun.sleep(100);
      }
      assert.ok(ready, "Pinned Gateway/A2A fixture did not become ready");
    }
    return {
      stop,
      env: {
        MANAGER_SECRET_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"),
        GATEWAY_ADMIN_ADDR: adminBase,
        GATEWAY_ADMIN_USER: "smoke",
        GATEWAY_ADMIN_PASSWORD: gatewayPassword,
        GATEWAY_DATAPLANE_ADDR: `http://127.0.0.1:${dataPort}`,
      },
      async verify(base: string, token: string, mode: string) {
        const call = async (path: string, method = "GET", body?: unknown, expected = 200) => {
          const response = await fetch(`${base}${path}`, {
            method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            ...(body !== undefined && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
          });
          if (response.status !== expected) {
            throw new Error(`${method} ${path} returned ${response.status}: ${(await response.text()).slice(0, 1200)}`);
          }
          return response.json();
        };
        const id = `http-smoke-${mode}`;
        const gateway = "/api/platform/v1/gateways/default";
        const agents = `${gateway}/agents`;
        const http = httpAgentConfigFromForm({ cardUrl: `${fixtureBase}/.well-known/agent-card.json`, protocol: "a2a", authRef: "", timeoutSeconds: "45" });
        const payload = parseAgentPayloadYaml(agentPayloadYaml({ id, name: "HTTP smoke", runtime: { type: "http", http }, routes: {}, resources: {}, policy: {}, disabled: false }));
        await call(agents, "POST", payload, 201);
        const read = await call(`${agents}/${id}`);
        assert.deepEqual(read.runtime.http, http);
        assert.deepEqual(httpAgentConfigFromForm(httpAgentFormValues(read.runtime.http)), http);
        const caps = await call(`${agents}/${id}/capabilities`);
        assert.equal(supportsAgentChat(caps), true);
        assert.equal(caps.sessions.list, false);
        const updated = { ...payload, runtime: { type: "http", http: { ...http, timeout_seconds: 60 } } };
        await call(`${agents}/${id}`, "PUT", updated);
        assert.equal((await call(`${agents}/${id}`)).runtime.http.timeout_seconds, 60);
        const pathPrefix = `/agents/${id}`;
        const route = await call(`${agents}/routes`, "POST", { id: `${id}-turn`, agent_id: id, protocol: "agent", match_policy: { host: "agent-smoke.invalid", path_prefix: pathPrefix }, auth_policy: { require_virtual_key: true }, disabled: false }, 201);
        const native = await call(`${agents}/routes`, "POST", { id: `${id}-native`, agent_id: id, protocol: "a2a", match_policy: { host: "127.0.0.1", path_prefix: `/a2a/${id}` }, auth_policy: { require_virtual_key: true }, disabled: false }, 201);
        const key = await call(`${gateway}/virtual-keys`, "POST", { id: `${id}-key`, disabled: false, allowed_route_ids: [route.id, native.id] }, 201);
        assert.equal(typeof key.key, "string");
        assert.ok(key.key.length > 0);
        const redacted = await call(`${gateway}/virtual-keys/${key.id}`);
        assert.equal(redacted.key, undefined);
        await call(`${agents}/${id}/invocations`, "POST", { route_id: native.id, key_id: key.id }, 409);
        await call("/api/admin/acp/chat/turn", "POST", { route_id: route.id, virtual_key_id: key.id, input: "legacy path is retired" }, 410);
        const context = await call(`${agents}/${id}/invocations`, "POST", {
          route_id: route.id,
          key_id: key.id,
        }, 201);
        const turn = await fetch(`${base}${gateway}/agent-invocations/${encodeURIComponent(context.id)}/turn`, {
          method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ input: "hello remote agent" }), signal: AbortSignal.timeout(30_000),
        });
        assert.equal(turn.status, 200);
        assert.ok(turn.headers.get("content-type")?.includes("text/event-stream"));
        const stream = await turn.text();
        assert.match(stream, /event: session/);
        assert.match(stream, /hello from the local A2A example/);
        assert.match(stream, /event: done/);
        assert.doesNotMatch(stream, /event: error/);
        assert.ok(!stream.includes(key.key), "SSE must not leak the VirtualKey");
        console.log(`${mode}: Gateway ${REVISION.slice(0, 7)} scoped HTTP Agent CRUD, native-route denial and authenticated Test SSE passed`);
      },
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
