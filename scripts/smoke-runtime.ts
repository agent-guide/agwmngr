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
  const offeringId = `runtime-tool-${mode}`;
  await platformRequest(base, "catalog/offerings", 403, member.token, "POST", {
    offering_id: "unauthorized-offering",
    category: "tool",
    name: "Unauthorized",
    kind: "platform-native",
    availability: { mode: "all-active-tenants", tenant_ids: [] },
  });
  await platformRequest(base, "catalog/offerings", 400, session.token, "POST", {
    offering_id: `mixed-source-${mode}`,
    category: "tool",
    name: "Mixed source",
    kind: "platform-native",
    source_gateway_id: gatewayId,
    upstream_stable_id: "tool:invalid",
    availability: { mode: "all-active-tenants", tenant_ids: [] },
  });
  const offering = await platformRequest(
    base,
    "catalog/offerings",
    201,
    session.token,
    "POST",
    {
      offering_id: offeringId,
      category: "tool",
      name: `Runtime tool ${mode}`,
      description: "Runtime catalog proof",
      kind: "gateway-backed",
      source_gateway_id: gatewayId,
      upstream_stable_id: "mcp:runtime:probe",
      availability: { mode: "tenant-allowlist", tenant_ids: [tenantId] },
    },
  );
  assert.equal(offering.status, "draft");
  assert.equal(offering.sourceAvailable, true);
  await platformRequest(
    base,
    `catalog/offerings/${offeringId}/approve`,
    200,
    session.token,
    "POST",
  );
  const tenantCatalog = await platformRequest(
    base,
    `tenants/${tenantId}/catalog?category=tool`,
    200,
    member.token,
  );
  assert.equal(tenantCatalog.items[0].offeringId, offeringId);
  assert.equal(tenantCatalog.items[0].owner, "platform");
  assert.equal(tenantCatalog.items[0].sourceGatewayId, undefined);
  assert.equal(tenantCatalog.items[0].upstreamStableId, undefined);
  assert.ok(!JSON.stringify(tenantCatalog).includes("runtime-secret"));
  await platformRequest(base, "catalog/instructions", 403, member.token, "POST", {
    name: "Unauthorized shared instruction",
    content: { text: "denied", files: [], tags: [] },
    availability: { mode: "all-active-tenants", tenant_ids: [] },
  });
  const tenantSkill = await platformRequest(
    base,
    `tenants/${tenantId}/skills`,
    201,
    member.token,
    "POST",
    {
      name: `Runtime skill ${mode}`,
      description: "Runtime immutable-revision proof",
      content: {
        text: "",
        files: [{ path: "SKILL.md", data: Buffer.from("# Runtime skill\n").toString("base64") }],
        tags: ["runtime"],
      },
    },
  );
  assert.equal(tenantSkill.resource.owner.kind, "tenant");
  assert.equal(tenantSkill.revisions[0].contentHash.length, 64);
  const secondRevision = await platformRequest(
    base,
    `tenants/${tenantId}/skills/${encodeURIComponent(tenantSkill.resource.id)}/revisions`,
    201,
    member.token,
    "POST",
    {
      text: "",
      files: [{ path: "SKILL.md", data: Buffer.from("# Runtime skill v2\n").toString("base64") }],
      tags: ["runtime"],
    },
  );
  assert.equal(secondRevision.number, 2);
  const sharedInstruction = await platformRequest(
    base,
    "catalog/instructions",
    201,
    session.token,
    "POST",
    {
      name: `Runtime instruction ${mode}`,
      description: "Shared authored-resource proof",
      content: { text: "Keep responses concise.", files: [], tags: ["runtime"] },
      availability: { mode: "tenant-allowlist", tenant_ids: [tenantId] },
    },
  );
  const tenantInstructions = await platformRequest(
    base,
    `tenants/${tenantId}/instructions`,
    200,
    member.token,
  );
  assert.equal(tenantInstructions.items[0].id, sharedInstruction.resource.id);
  assert.equal(tenantInstructions.items[0].owner.kind, "platform");
  const knowledge = await platformRequest(
    base,
    `tenants/${tenantId}/knowledge-bases`,
    201,
    member.token,
    "POST",
    { name: `Runtime knowledge ${mode}`, description: "Document lifecycle proof" },
  );
  assert.equal(knowledge.indexingStatus, "unavailable");
  assert.equal(knowledge.retrievalStatus, "unavailable");
  const documentBytes = Buffer.from(`runtime document ${mode}`);
  const uploadBatch = await platformRequest(
    base,
    `tenants/${tenantId}/knowledge-bases/${encodeURIComponent(knowledge.id)}/documents/upload-sessions`,
    201,
    member.token,
    "POST",
    { files: [
      { request_key: `runtime-${mode}`, name: "runtime.txt", mime_type: "text/plain", size_bytes: documentBytes.byteLength },
      { request_key: `invalid-${mode}`, name: "runtime.exe", mime_type: "application/octet-stream", size_bytes: 1 },
    ] },
  );
  assert.equal(uploadBatch.items[0].ok, true);
  assert.equal(uploadBatch.items[1].ok, false);
  const uploadTicket = uploadBatch.items[0];
  const uploadResponse = await fetch(`${base}${uploadTicket.upload_url}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${member.token}`, "Content-Type": "text/plain" },
    body: documentBytes,
  });
  assert.equal(uploadResponse.status, 200, await uploadResponse.text());
  const completedDocument = await platformRequest(
    base,
    `tenants/${tenantId}/knowledge-bases/${encodeURIComponent(knowledge.id)}/documents/${encodeURIComponent(uploadTicket.document.id)}/complete`,
    200,
    member.token,
    "POST",
  );
  assert.equal(completedDocument.status, "active");
  assert.equal(completedDocument.indexStatus, "unavailable");
  const downloadTicket = await platformRequest(
    base,
    `tenants/${tenantId}/knowledge-bases/${encodeURIComponent(knowledge.id)}/documents/${encodeURIComponent(completedDocument.id)}/download-url`,
    200,
    member.token,
  );
  const downloadResponse = await fetch(`${base}${downloadTicket.download_url}`, {
    headers: { Authorization: `Bearer ${member.token}` },
  });
  assert.equal(downloadResponse.status, 200);
  assert.equal(await downloadResponse.text(), documentBytes.toString());
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
  const uploadSecret = new URL(`${base}${uploadTicket.upload_url}`).searchParams.get("token");
  assert.ok(uploadSecret && !JSON.stringify(audit).includes(uploadSecret), "object ticket must not enter audit");
  assert.ok(
    audit.items.some(
      (entry: { action?: string; tenant_id?: string; target_id?: string }) =>
        entry.action === "tenant:document_storage_put" &&
        entry.tenant_id === tenantId &&
        entry.target_id === completedDocument.id,
    ),
    "document storage outcome and Tenant scope must be audited",
  );
  assert.ok(
    audit.items.some(
      (entry: { action?: string; target_id?: string; decision?: string }) =>
        entry.action === "platform:catalog_approve" &&
        entry.target_id === offeringId &&
        entry.decision === "allow",
    ),
    "catalog approval outcome and target must be audited",
  );
  assert.ok(
    audit.items.some(
      (entry: { action?: string; decision?: string; http_status?: number }) =>
        entry.action === "platform:catalog_create" &&
        entry.decision === "deny" &&
        entry.http_status === 403,
    ),
    "catalog authorization denial must be audited",
  );

  await stopServer();
  base = await startServer(mode);
  assert.equal((await request(base, "auth/me", 200, session.token)).username, admin);
  await request(base, "users", 403, member.token);
  assert.equal(
    (await platformRequest(base, "access", 200, member.token)).memberships[0].tenantId,
    tenantId,
  );
  await platformRequest(base, "access", 200, issued.token);
  const restartedCatalog = await platformRequest(
    base,
    `tenants/${tenantId}/catalog?category=tool`,
    200,
    member.token,
  );
  assert.equal(restartedCatalog.items[0].offeringId, offeringId);
  const restartedSkills = await platformRequest(
    base,
    `tenants/${tenantId}/skills`,
    200,
    member.token,
  );
  assert.equal(restartedSkills.items[0].id, tenantSkill.resource.id);
  assert.equal(restartedSkills.items[0].latestRevisionNumber, 2);
  const restartedDocuments = await platformRequest(
    base,
    `tenants/${tenantId}/knowledge-bases/${encodeURIComponent(knowledge.id)}/documents`,
    200,
    member.token,
  );
  assert.equal(restartedDocuments.items[0].id, completedDocument.id);
  assert.equal(restartedDocuments.items[0].status, "active");
  await platformRequest(
    base,
    `catalog/offerings/${offeringId}/retire`,
    200,
    session.token,
    "POST",
  );
  assert.deepEqual(
    (await platformRequest(
      base,
      `tenants/${tenantId}/catalog?category=tool`,
      200,
      member.token,
    )).items,
    [],
  );
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
    `${mode}: Bun handler, session restart, catalog/authored/knowledge resources, Tenant Gateway grant audit, service revocation and logout passed`,
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
