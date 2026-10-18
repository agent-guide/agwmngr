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
  MANAGER_SECRET_KEY: "11".repeat(32),
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

async function platformRequest(
  base: string,
  path: string,
  status: number,
  token?: string,
  method = "GET",
  body?: unknown,
) {
  const response = await fetch(`${base}/api/platform/v1/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(
    response.status,
    status,
    `${path}: expected ${status}, received ${response.status}: ${
      response.status === status ? "" : await response.clone().text()
    }`,
  );
  return response.json();
}

async function adminRequest(
  base: string,
  path: string,
  status: number,
  token: string,
  method: string,
  body?: unknown,
) {
  const response = await fetch(`${base}/api/admin/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, status, `${path}: ${await response.clone().text()}`);
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
  const gatewayId = `runtime-${mode}`;
  await adminRequest(base, "gateways", 201, session.token, "POST", {
    id: gatewayId,
    name: `Runtime ${mode}`,
    admin_addr: "http://127.0.0.1:1",
    admin_user: "runtime",
    admin_password: "runtime-secret",
  });

  const memberName = `runtime-smoke-member-${mode}`;
  const memberUser = await request(base, "users", 201, session.token, {
    username: memberName,
    password,
    is_platform_admin: false,
  });
  const member = await request(base, "auth/login", 200, undefined, {
    username: memberName,
    password,
  });
  await request(base, "users", 403, member.token);

  await platformRequest(base, "access", 401);
  const memberAccess = await platformRequest(base, "access", 200, member.token);
  assert.deepEqual(memberAccess.memberships, []);
  const adminAccess = await platformRequest(base, "access", 200, session.token);
  assert.deepEqual(adminAccess.memberships, []);

  const tenantId = `runtime-${mode}`;
  await platformRequest(base, "identity/tenants", 403, member.token, "POST", {
    id: "unauthorized",
    name: "Unauthorized",
  });
  await platformRequest(base, "identity/tenants", 201, session.token, "POST", {
    id: tenantId,
    name: `Runtime ${mode}`,
  });
  await platformRequest(
    base,
    `identity/tenants/${tenantId}/members/bootstrap`,
    201,
    session.token,
    "POST",
    { principal_id: `user:${memberUser.id}`, role: "user" },
  );
  const memberWithTenant = await platformRequest(base, "access", 200, member.token);
  assert.equal(memberWithTenant.memberships[0].tenantId, tenantId);
  assert.equal(memberWithTenant.memberships[0].role, "user");
  await platformRequest(
    base,
    `identity/tenants/${tenantId}/members`,
    403,
    member.token,
  );

  const serviceName = `runtime-${mode}`;
  const issued = await platformRequest(
    base,
    "identity/service-principals",
    201,
    session.token,
    "POST",
    { name: serviceName, expires_at: new Date(Date.now() + 86_400_000).toISOString() },
  );
  assert.match(issued.token, /^agwmngr_svc_[0-9a-f]{64}$/);
  await platformRequest(base, "access", 200, issued.token);
  await platformRequest(
    base,
    `identity/tenants/${tenantId}/members/bootstrap`,
    201,
    session.token,
    "POST",
    { principal_id: issued.principal.id, role: "admin" },
  );
  await platformRequest(
    base,
    "identity/tenant-gateway-grants",
    400,
    session.token,
    "PUT",
    {
      principal_id: `user:${memberUser.id}`,
      tenant_id: tenantId,
      gateway_id: gatewayId,
      access: "view",
    },
  );
  await platformRequest(
    base,
    "identity/tenant-gateway-grants",
    200,
    session.token,
    "PUT",
    {
      principal_id: issued.principal.id,
      tenant_id: tenantId,
      gateway_id: gatewayId,
      access: "manage",
    },
  );
  const grants = await platformRequest(
    base,
    `identity/tenant-gateway-grants?tenant_id=${tenantId}`,
    200,
    session.token,
  );
  assert.deepEqual(grants.items[0], {
    principalId: issued.principal.id,
    tenantId,
    gatewayId,
    access: "manage",
    createdAt: grants.items[0].createdAt,
    updatedAt: grants.items[0].updatedAt,
  });
  await platformRequest(
    base,
    `identity/tenants/${tenantId}/members/user:${user.id}`,
    403,
    issued.token,
    "PUT",
    { role: "user" },
  );
  await platformRequest(
    base,
    `identity/tenants/${tenantId}/members/bootstrap`,
    403,
    issued.token,
    "POST",
    { principal_id: `user:${user.id}`, role: "user" },
  );
  await platformRequest(
    base,
    `identity/tenants/${tenantId}/members`,
    200,
    issued.token,
  );
  const audit = await request(base, "audit?limit=100", 200, session.token);
  assert.ok(
    audit.items.some((entry: { action?: string }) => entry.action === "platform:identity"),
    "platform identity calls must be audited",
  );
  assert.ok(
    audit.items.some(
      (entry: { action?: string; tenant_id?: string; gateway_id?: string; effective_access?: string }) =>
        entry.action === "platform:tenant_gateway_grant" &&
        entry.tenant_id === tenantId &&
        entry.gateway_id === gatewayId &&
        entry.effective_access === "manage",
    ),
    "Tenant Gateway grant outcome and scope must be audited",
  );
  assert.ok(!JSON.stringify(audit).includes(issued.token), "service bearer must not enter audit");

  await stopServer();
  base = await startServer(mode);
  assert.equal((await request(base, "auth/me", 200, session.token)).username, admin);
  await request(base, "users", 403, member.token);
  assert.equal(
    (await platformRequest(base, "access", 200, member.token)).memberships[0].tenantId,
    tenantId,
  );
  await platformRequest(base, "access", 200, issued.token);
  await platformRequest(
    base,
    `identity/service-principals/${issued.principal.id}`,
    200,
    session.token,
    "DELETE",
  );
  await platformRequest(base, "access", 401, issued.token);
  await request(base, "auth/logout", 200, session.token, {});
  await request(base, "auth/me", 401, session.token);
  await stopServer();

  console.log(
    `${mode}: Bun handler, session restart, Tenant Gateway grant audit, service revocation and logout passed`,
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
  await completion(launch("migrate:platform"));
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
