import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import bcrypt from "bcryptjs";
import { startHTTPAgentFixture } from "./http-agent-fixture";

// Keep the exact-Gateway integration isolated from the developer's database,
// object files, build output and source repositories.
const root = resolve(import.meta.dir, "..");
const sandbox = mkdtempSync(join(tmpdir(), "agwmngr-http-agent-"));
const logPath = join(sandbox, "smoke.log");
const logFd = openSync(logPath, "a", 0o600);
const password = crypto.randomUUID();
const admin = "http-agent-smoke-admin";
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^(MANAGER_|AGWMNGR_|CADDYMGR_|GATEWAY_|CADDY_|NEXT_PUBLIC_|NODE_ENV$|NODE_OPTIONS$)/.test(key)) {
    delete env[key];
  }
}

let server: ChildProcess | undefined;
let fixture: Awaited<ReturnType<typeof startHTTPAgentFixture>> | undefined;

function launch(script: string, args: string[] = []): ChildProcess {
  return spawn(process.execPath, ["run", script, ...args], {
    cwd: sandbox,
    env,
    stdio: ["ignore", logFd, logFd],
    detached: process.platform !== "win32",
  });
}

function completion(child: ChildProcess): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`Next process exited with ${code ?? signal}`));
    });
  });
}

async function stopServer() {
  const child = server;
  server = undefined;
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise()));
  const signal = (value: NodeJS.Signals) => {
    try {
      if (process.platform === "win32") child.kill(value);
      else process.kill(-child.pid!, value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  signal("SIGTERM");
  const timer = setTimeout(() => signal("SIGKILL"), 10_000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

async function startServer(mode: "dev" | "start"): Promise<string> {
  const reservation = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(),
  });
  const port = reservation.port!;
  await reservation.stop(true);
  const base = `http://127.0.0.1:${port}`;
  server = launch(mode, ["--hostname", "127.0.0.1", "--port", String(port)]);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    assert.equal(server.exitCode, null, `${mode} server exited before readiness`);
    try {
      const response = await fetch(`${base}/api/admin/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return base;
    } catch {
      // Listener is not ready yet.
    }
    await Bun.sleep(100);
  }
  throw new Error(`${mode} server did not become ready`);
}

async function login(base: string): Promise<string> {
  const response = await fetch(`${base}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: admin, password }),
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 200, `login returned ${response.status}`);
  const payload = await response.json() as { token?: unknown };
  assert.equal(typeof payload.token, "string");
  return payload.token as string;
}

async function verify(mode: "dev" | "start") {
  const base = await startServer(mode);
  const token = await login(base);
  await fixture!.verify(base, token, mode);
  await stopServer();
}

try {
  for (const name of [
    "app",
    "components",
    "hooks",
    "lib",
    "public",
    "scripts",
    "package.json",
    "bun.lock",
    "tsconfig.json",
    "next.config.ts",
    "postcss.config.mjs",
    "next-env.d.ts",
  ]) {
    const source = join(root, name);
    if (existsSync(source)) cpSync(source, join(sandbox, name), { recursive: true });
  }
  symlinkSync(join(root, "node_modules"), join(sandbox, "node_modules"), "dir");
  fixture = await startHTTPAgentFixture(sandbox, logFd);
  Object.assign(env, fixture.env, {
    NEXT_TELEMETRY_DISABLED: "1",
    MANAGER_DB_PATH: join(sandbox, "data", "manager.db"),
    AGWMNGR_ADMIN_USER: admin,
    AGWMNGR_ADMIN_PASSWORD_HASH: await bcrypt.hash(password, 10),
  });
  await verify("dev");
  await completion(launch("build"));
  await verify("start");
  console.log("Gateway v0.7.0 HTTP Agent smoke passed in development and production modes.");
} catch (error) {
  console.error(readFileSync(logPath, "utf8"));
  throw error;
} finally {
  await stopServer();
  await fixture?.stop();
  closeSync(logFd);
  rmSync(sandbox, { recursive: true, force: true });
}
