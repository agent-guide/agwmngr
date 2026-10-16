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

// Exercise real Next.js processes without access to this checkout's .env.local,
// manager.db, object directory or build output. Everything mutable lives in the
// temporary source copy and is deleted at the end of the run.
const root = resolve(import.meta.dir, "..");
const sandbox = mkdtempSync(join(tmpdir(), "agwmngr-runtime-"));
const logPath = join(sandbox, "next.log");
const logFd = openSync(logPath, "a", 0o600);
const password = crypto.randomUUID();
const admin = "runtime-smoke-admin";
const env = { ...process.env };

for (const key of Object.keys(env)) {
  if (
    /^(MANAGER_|PLATFORM_|AGWMNGR_|CADDYMGR_|GATEWAY_|CADDY_|NEXT_PUBLIC_|NODE_ENV$|NODE_OPTIONS$)/.test(
      key,
    )
  ) {
    delete env[key];
  }
}

Object.assign(env, {
  NEXT_TELEMETRY_DISABLED: "1",
  MANAGER_DB_PATH: join(sandbox, "data", "smoke.db"),
  PLATFORM_OBJECT_DIR: join(sandbox, "data", "objects"),
  AGWMNGR_ADMIN_USER: admin,
  AGWMNGR_ADMIN_PASSWORD_HASH: await bcrypt.hash(password, 10),
});

let server: ChildProcess | undefined;

function launch(script: string, args: string[] = []): ChildProcess {
  return spawn(process.execPath, ["run", script, ...args], {
    cwd: sandbox,
    env,
    stdio: ["ignore", logFd, logFd],
    detached: process.platform !== "win32",
  });
}

function completion(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Next process exited with ${code ?? signal}`));
    });
  });
}

async function stopServer() {
  const child = server;
  server = undefined;
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;

  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
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
  server.once("error", (error) => console.error(error.message));

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    assert.equal(server.exitCode, null, `${mode} server exited before readiness`);
    try {
      const response = await fetch(`${base}/api/admin/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        assert.deepEqual(await response.json(), { status: "ok", runtime: "bun" });
        return base;
      }
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
    }
    await Bun.sleep(100);
  }

  throw new Error(`${mode} server did not become ready`);
}

async function request(
  base: string,
  path: string,
  status: number,
  token?: string,
  body?: unknown,
) {
  const response = await fetch(`${base}/api/admin/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, status, `${path}: unexpected HTTP status`);
  return response.json();
}

async function verify(mode: "dev" | "start") {
  let base = await startServer(mode);
  await request(base, "auth/me", 401);
  await request(base, "auth/login", 401, undefined, {
    username: admin,
    password: "incorrect-password",
  });

  const session = await request(base, "auth/login", 200, undefined, {
    username: admin,
    password,
  });
  assert.equal(typeof session.token, "string");
  const user = await request(base, "auth/me", 200, session.token);
  assert.equal(user.username, admin);
  assert.equal(user.is_platform_admin, true);

  const memberName = `runtime-smoke-member-${mode}`;
  await request(base, "users", 201, session.token, {
    username: memberName,
    password,
    is_platform_admin: false,
  });
  const member = await request(base, "auth/login", 200, undefined, {
    username: memberName,
    password,
  });
  await request(base, "users", 403, member.token);

  await stopServer();
  base = await startServer(mode);
  assert.equal((await request(base, "auth/me", 200, session.token)).username, admin);
  await request(base, "users", 403, member.token);
  await request(base, "auth/logout", 200, session.token, {});
  await request(base, "auth/me", 401, session.token);
  await stopServer();

  console.log(
    `${mode}: Bun handler, login, SQLite session/restart, platform denial and logout passed`,
  );
}

try {
  for (const name of [
    "app",
    "components",
    "hooks",
    "lib",
    "packages",
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

  assert.equal(process.versions.bun, "1.3.13", "Use the pinned Bun runtime");
  const nextPackage = JSON.parse(
    readFileSync(join(root, "node_modules", "next", "package.json"), "utf8"),
  );
  assert.equal(nextPackage.version, "16.2.4", "Install the pinned Next.js version");

  await verify("dev");
  await completion(launch("build"));
  await verify("start");
  console.log("Runtime smoke passed; only temporary data and build output were used.");
} catch (error) {
  console.error(readFileSync(logPath, "utf8"));
  throw error;
} finally {
  await stopServer();
  closeSync(logFd);
  rmSync(sandbox, { recursive: true, force: true });
}
