import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import bcrypt from "bcryptjs";

const GATEWAY_REVISION = "3d04b7a0207a6d31746a1b196ae9d82097c2087c";
const MODEL_ROUTE_IDS = {
  alpha: "step6-alpha-model",
  beta: "step6-beta-model",
} as const;
const MODEL_REPLY = "Step 6 real Gateway acceptance reply.";

const root = resolve(import.meta.dir, "..");
const sandbox = mkdtempSync(join(tmpdir(), "agwmngr-step6-gateway-"));
const gatewaySource = join(sandbox, "gateway-source");
const logPath = join(sandbox, "acceptance.log");
const logFd = openSync(logPath, "a", 0o600);
const managerPassword = crypto.randomUUID();
const gatewayPassword = crypto.randomUUID();
const managerAdmin = "step6-platform-admin";
const children: ChildProcess[] = [];
let manager: ChildProcess | undefined;
let modelServer: ReturnType<typeof Bun.serve> | undefined;
let adminProxy: ReturnType<typeof Bun.serve> | undefined;

const managerEnv = { ...process.env };
for (const key of Object.keys(managerEnv)) {
  if (/^(MANAGER_|PLATFORM_|AGWMNGR_|CADDYMGR_|GATEWAY_|CADDY_|NEXT_PUBLIC_|NODE_ENV$|NODE_OPTIONS$)/.test(key)) {
    delete managerEnv[key];
  }
}

function launch(command: string, args: string[], cwd: string, env = process.env): ChildProcess {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", logFd, logFd],
    detached: process.platform !== "win32",
  });
  children.push(child);
  return child;
}

function completion(child: ChildProcess): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`process exited with ${code ?? signal}`));
    });
  });
}

async function stopChild(child: ChildProcess | undefined) {
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

async function reservePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const reservation = createServer();
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", () => {
      const address = reservation.address();
      if (!address || typeof address === "string") {
        reservation.close();
        reject(new Error("failed to reserve a local port"));
        return;
      }
      reservation.close((error) => {
        if (error) reject(error);
        else resolvePromise(address.port);
      });
    });
  });
}

async function waitFor(
  url: string,
  options: RequestInit = {},
  label = url,
  timeoutMs = 90_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // The listener or the process is not ready yet.
    }
    await Bun.sleep(100);
  }
  throw new Error(`${label} did not become ready`);
}

interface CallOptions {
  token?: string;
  method?: string;
  body?: unknown;
  expected?: number;
}

interface ApiResult {
  [key: string]: unknown;
  id: string;
  token: string;
  key: string;
  name: string;
  status: string;
  version: number;
  lifecycleState: string;
  deploymentId: string;
  tenantId: string;
  principal: { id: string };
  items: unknown[];
  target: {
    gatewayAgentId: string;
    gatewayRouteId: string;
    pathPrefix: string;
  };
}

async function call(base: string, path: string, options: CallOptions = {}): Promise<ApiResult> {
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  const expected = options.expected ?? 200;
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: expected ${expected}, received ${response.status}: ${text.slice(0, 2_000)}`,
  );
  if (!text) return undefined as unknown as ApiResult;
  const contentType = response.headers.get("content-type") ?? "";
  return (contentType.includes("json") ? JSON.parse(text) : { text }) as ApiResult;
}

async function login(base: string, username: string, password: string): Promise<string> {
  const result = await call(base, "/api/admin/auth/login", {
    body: { username, password },
  });
  assert.equal(typeof result.token, "string");
  return result.token;
}

async function assertSSE(response: Response, hiddenSecret: string) {
  assert.equal(response.status, 200, `turn returned ${response.status}: ${await response.clone().text()}`);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
  const body = await response.text();
  assert.match(body, /event: (content|delta)/);
  assert.ok(body.includes(MODEL_REPLY), `turn did not contain the model reply: ${body.slice(0, 2_000)}`);
  assert.match(body, /event: done/);
  assert.ok(!body.includes(hiddenSecret), "turn response leaked a credential");
}

async function managerTurn(
  base: string,
  tenantId: string,
  contextId: string,
  token: string,
  hiddenSecret: string,
) {
  const response = await fetch(
    `${base}/api/platform/v1/tenants/${encodeURIComponent(tenantId)}` +
      `/invocations/${encodeURIComponent(contextId)}/turn`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: "Run the Step 6 acceptance turn." }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  await assertSSE(response, hiddenSecret);
}

async function rawGatewayTurn(
  dataBase: string,
  pathPrefix: string,
  bearer: string | undefined,
  expected: number,
) {
  const response = await fetch(`${dataBase}${pathPrefix}/turn`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify({ input: "Run the external Step 6 turn.", options: { version: "v1" } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (expected === 200) await assertSSE(response, bearer!);
  else assert.equal(response.status, expected, `raw Gateway turn returned ${response.status}: ${await response.text()}`);
}

function copyManagerSource() {
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
}

function archiveGateway() {
  mkdirSync(gatewaySource);
  const archive = join(sandbox, "gateway.tar");
  const sourceRepo = process.env.AGW_SOURCE_DIR || resolve(root, "../agent-gateway");
  writeFileSync(
    archive,
    execFileSync("git", ["-C", sourceRepo, "archive", GATEWAY_REVISION], { maxBuffer: 64 << 20 }),
  );
  execFileSync("tar", ["-xf", archive, "-C", gatewaySource]);
}

function basicAuth(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

async function gatewayJSON(
  adminBase: string,
  username: string,
  password: string,
  path: string,
  expected = 200,
): Promise<ApiResult> {
  const response = await fetch(`${adminBase}${path}`, {
    headers: { Authorization: basicAuth(username, password) },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  assert.equal(response.status, expected, `Gateway GET ${path}: ${response.status}: ${text}`);
  return text ? JSON.parse(text) as ApiResult : undefined as unknown as ApiResult;
}

async function gatewayWrite(
  adminBase: string,
  username: string,
  password: string,
  path: string,
  body: unknown,
  expected = 201,
): Promise<ApiResult> {
  const response = await fetch(`${adminBase}${path}`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(username, password),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  assert.equal(response.status, expected, `Gateway POST ${path}: ${response.status}: ${text}`);
  return text ? JSON.parse(text) as ApiResult : undefined as unknown as ApiResult;
}

async function main() {
  copyManagerSource();
  archiveGateway();

  let modelCalls = 0;
  const modelPort = await reservePort();
  modelServer = Bun.serve({
    hostname: "127.0.0.1",
    port: modelPort,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
        return Response.json({ error: "not found" }, { status: 404 });
      }
      if (request.headers.get("authorization") !== "Bearer step6-upstream-key") {
        return Response.json({ error: "invalid upstream credential" }, { status: 401 });
      }
      const payload = await request.json() as { stream?: boolean };
      modelCalls += 1;
      if (payload.stream) {
        const first = JSON.stringify({
          id: `chatcmpl-step6-${modelCalls}`,
          object: "chat.completion.chunk",
          created: 1_790_000_000,
          model: "step6-model",
          choices: [{
            index: 0,
            delta: { role: "assistant", content: MODEL_REPLY },
            finish_reason: null,
          }],
        });
        const last = JSON.stringify({
          id: `chatcmpl-step6-${modelCalls}`,
          object: "chat.completion.chunk",
          created: 1_790_000_000,
          model: "step6-model",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 8, completion_tokens: 7, total_tokens: 15 },
        });
        return new Response(`data: ${first}\n\ndata: ${last}\n\ndata: [DONE]\n\n`, {
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      return Response.json({
        id: `chatcmpl-step6-${modelCalls}`,
        object: "chat.completion",
        created: 1_790_000_000,
        model: "step6-model",
        choices: [{
          index: 0,
          message: { role: "assistant", content: MODEL_REPLY },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 8, completion_tokens: 7, total_tokens: 15 },
      });
    },
  });

  const adminPort = await reservePort();
  const dataPort = await reservePort();
  const adminBase = `http://127.0.0.1:${adminPort}`;
  const dataBase = `http://127.0.0.1:${dataPort}`;

  await completion(launch("go", ["build", "-o", join(gatewaySource, "agwd"), "./cmd/agwd"], gatewaySource));
  const gateway = launch(join(gatewaySource, "agwd"), [
    "--addr", `127.0.0.1:${dataPort}`,
    "--admin-addr", `127.0.0.1:${adminPort}`,
    "--config-store", join(sandbox, "gateway.db"),
    "--admin-basic-auth-hash", `step6:${await bcrypt.hash(gatewayPassword, 10)}`,
  ], gatewaySource);
  gateway.once("error", (error) => console.error(error.message));
  await waitFor(`${adminBase}/admin/agents`, {
    headers: { Authorization: basicAuth("step6", gatewayPassword) },
  }, "pinned Gateway v0.7.0");
  await gatewayWrite(adminBase, "step6", gatewayPassword, "/admin/llm/providers", {
    id: "step6-openai",
    provider_type: "openai",
    api_key: "step6-upstream-key",
    base_url: `http://127.0.0.1:${modelServer.port}/v1`,
    default_model: "step6-model",
  });
  for (const [tenantId, routeId] of Object.entries(MODEL_ROUTE_IDS)) {
    await gatewayWrite(adminBase, "step6", gatewayPassword, "/admin/llm/routes", {
      id: routeId,
      protocol: "openai",
      disabled: false,
      match_policy: {
        path_prefix: `/v1/${tenantId}/chat/completions`,
        methods: ["POST"],
      },
      auth_policy: { require_virtual_key: true },
      target_policy: { provider_target: { provider_id: "step6-openai" } },
    });
  }

  const proxyState = {
    failNextAgentRouteCreate: false,
    requests: [] as string[],
  };
  const adminProxyPort = await reservePort();
  adminProxy = Bun.serve({
    hostname: "127.0.0.1",
    port: adminProxyPort,
    async fetch(request) {
      const url = new URL(request.url);
      const signature = `${request.method} ${url.pathname}`;
      proxyState.requests.push(signature);
      if (proxyState.failNextAgentRouteCreate && signature === "POST /admin/agents/routes") {
        proxyState.failNextAgentRouteCreate = false;
        return Response.json({ error: "injected Step 6 route-create failure" }, { status: 503 });
      }
      const headers = new Headers(request.headers);
      headers.delete("host");
      headers.delete("content-length");
      const response = await fetch(`${adminBase}${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        body: request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.arrayBuffer(),
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      const responseHeaders = new Headers(response.headers);
      responseHeaders.delete("content-encoding");
      responseHeaders.delete("content-length");
      const empty = response.status === 204 || response.status === 304;
      return new Response(empty ? null : await response.arrayBuffer(), {
        status: response.status,
        headers: responseHeaders,
      });
    },
  });

  Object.assign(managerEnv, {
    NEXT_TELEMETRY_DISABLED: "1",
    MANAGER_DB_PATH: join(sandbox, "data", "manager.db"),
    PLATFORM_OBJECT_DIR: join(sandbox, "data", "objects"),
    AGWMNGR_ADMIN_USER: managerAdmin,
    AGWMNGR_ADMIN_PASSWORD_HASH: await bcrypt.hash(managerPassword, 10),
    MANAGER_SECRET_KEY: "31".repeat(32),
    GATEWAY_ADMIN_ADDR: `http://127.0.0.1:${adminProxy.port}`,
    GATEWAY_ADMIN_USER: "step6",
    GATEWAY_ADMIN_PASSWORD: gatewayPassword,
    GATEWAY_DATAPLANE_ADDR: dataBase,
    CADDY_ADMIN_ADDR: "http://127.0.0.1:1",
  });

  await completion(launch(process.execPath, ["run", "build"], sandbox, managerEnv));
  const managerPort = await reservePort();
  const managerBase = `http://127.0.0.1:${managerPort}`;
  manager = launch(process.execPath, [
    "run", "start", "--hostname", "127.0.0.1", "--port", String(managerPort),
  ], sandbox, managerEnv);
  manager.once("error", (error) => console.error(error.message));
  await waitFor(`${managerBase}/api/admin/health`, {}, "production manager");

  const platformToken = await login(managerBase, managerAdmin, managerPassword);
  const createUser = async (username: string) => {
    const user = await call(managerBase, "/api/admin/users", {
      token: platformToken,
      body: { username, password: managerPassword, is_platform_admin: false },
      expected: 201,
    });
    return { ...user, token: await login(managerBase, username, managerPassword) };
  };
  const alphaAdmin = await createUser("step6-alpha-admin");
  const betaAdmin = await createUser("step6-beta-admin");
  const alphaMember = await createUser("step6-alpha-member");
  const alphaObserver = await createUser("step6-alpha-observer");

  for (const [id, name] of [["alpha", "Alpha"], ["beta", "Beta"]]) {
    await call(managerBase, "/api/platform/v1/identity/tenants", {
      token: platformToken,
      body: { id, name },
      expected: 201,
    });
  }
  const bootstrap = (tenantId: string, principalId: string, role: "admin" | "user") =>
    call(
      managerBase,
      `/api/platform/v1/identity/tenants/${tenantId}/members/bootstrap`,
      { token: platformToken, body: { principal_id: principalId, role }, expected: 201 },
    );
  await bootstrap("alpha", `user:${alphaAdmin.id}`, "admin");
  await bootstrap("alpha", `user:${alphaMember.id}`, "user");
  await bootstrap("alpha", `user:${alphaObserver.id}`, "admin");
  await bootstrap("beta", `user:${betaAdmin.id}`, "admin");

  const service = await call(managerBase, "/api/platform/v1/identity/service-principals", {
    token: platformToken,
    body: {
      name: "step6-invoker",
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    },
    expected: 201,
  });
  await bootstrap("alpha", service.principal.id, "user");

  const setGrant = (principalId: string, tenantId: string, access: "view" | "manage") =>
    call(managerBase, "/api/platform/v1/identity/tenant-gateway-grants", {
      token: platformToken,
      method: "PUT",
      body: {
        principal_id: principalId,
        tenant_id: tenantId,
        gateway_id: "default",
        access,
      },
    });
  const removeGrant = (principalId: string, tenantId: string) =>
    call(managerBase, "/api/platform/v1/identity/tenant-gateway-grants", {
      token: platformToken,
      method: "DELETE",
      body: { principal_id: principalId, tenant_id: tenantId, gateway_id: "default" },
    });
  await setGrant(`user:${alphaAdmin.id}`, "alpha", "manage");
  await setGrant(`user:${alphaObserver.id}`, "alpha", "view");
  await setGrant(`user:${betaAdmin.id}`, "beta", "manage");

  for (const [tenantId, routeId] of Object.entries(MODEL_ROUTE_IDS)) {
    const offeringId = `step6-${tenantId}-model-offering`;
    await call(managerBase, "/api/platform/v1/catalog/offerings", {
      token: platformToken,
      body: {
        offering_id: offeringId,
        category: "model",
        name: `Step 6 ${tenantId} acceptance model`,
        description: "Pinned real-Gateway acceptance model",
        kind: "gateway-backed",
        source_gateway_id: "default",
        upstream_stable_id: routeId,
        availability: { mode: "tenant-allowlist", tenant_ids: [tenantId] },
      },
      expected: 201,
    });
    await call(
      managerBase,
      `/api/platform/v1/catalog/offerings/${encodeURIComponent(offeringId)}/approve`,
      { token: platformToken, method: "POST" },
    );
  }

  const createRelease = async (
    tenantId: string,
    token: string,
    slug: string,
    label: string,
    offeringId: string,
  ) => {
    const model = await call(managerBase, `/api/platform/v1/tenants/${tenantId}/models`, {
      token,
      body: {
        name: `${label} model`,
        description: "Step 6 real-Gateway model binding",
        offering_id: offeringId,
      },
      expected: 201,
    });
    const draft = {
      name: `${label} v1`,
      description: "Real Gateway acceptance Agent",
      systemPrompt: `${label.toUpperCase()} VERSION ONE`,
      runtime: { type: "builtin", advanced: { topology: { kind: "single" } } },
      resources: {
        modelDefinitionId: model.id,
        toolDefinitionIds: [],
        skillRevisionIds: [],
        instructionRevisionIds: [],
        knowledgeBaseIds: [],
      },
      policy: {},
    };
    const definition = await call(managerBase, `/api/platform/v1/tenants/${tenantId}/agents`, {
      token,
      body: { slug, expected_version: 0, draft },
      expected: 201,
    });
    const release = await call(
      managerBase,
      `/api/platform/v1/tenants/${tenantId}/agents/${encodeURIComponent(definition.id)}/releases`,
      { token, body: { expected_version: 1 }, expected: 201 },
    );
    return { model, draft, definition, release };
  };

  const alpha = await createRelease(
    "alpha",
    alphaAdmin.token,
    "real-gateway",
    "Alpha acceptance",
    "step6-alpha-model-offering",
  );
  const beta = await createRelease(
    "beta",
    betaAdmin.token,
    "real-gateway",
    "Beta acceptance",
    "step6-beta-model-offering",
  );
  const alphaV2 = await call(
    managerBase,
    `/api/platform/v1/tenants/alpha/agents/${encodeURIComponent(alpha.definition.id)}`,
    {
      token: alphaAdmin.token,
      method: "PUT",
      body: {
        expected_version: 1,
        draft: {
          ...alpha.draft,
          name: "Alpha acceptance v2",
          systemPrompt: "ALPHA ACCEPTANCE VERSION TWO",
        },
      },
    },
  );
  const alphaRelease2 = await call(
    managerBase,
    `/api/platform/v1/tenants/alpha/agents/${encodeURIComponent(alpha.definition.id)}/releases`,
    { token: alphaAdmin.token, body: { expected_version: alphaV2.version }, expected: 201 },
  );

  const createIntent = (tenantId: string, token: string, releaseId: string, requestKey: string) =>
    call(managerBase, `/api/platform/v1/tenants/${tenantId}/deployments`, {
      token,
      body: { release_id: releaseId, gateway_id: "default", request_key: requestKey },
      expected: 201,
    });
  const alphaDeployment = await createIntent(
    "alpha", alphaAdmin.token, alpha.release.id, "step6-alpha-primary",
  );
  const betaDeployment = await createIntent(
    "beta", betaAdmin.token, beta.release.id, "step6-beta-primary",
  );
  assert.equal(alphaDeployment.lifecycleState, "awaiting_key_binding");
  assert.equal(betaDeployment.lifecycleState, "awaiting_key_binding");

  await call(managerBase, "/api/platform/v1/tenants/alpha/deployments", {
    token: betaAdmin.token,
    expected: 403,
  });
  await call(managerBase, "/api/platform/v1/tenants/beta/deployments", {
    token: alphaAdmin.token,
    expected: 403,
  });
  const observerView = await call(managerBase, "/api/platform/v1/tenants/alpha/deployments", {
    token: alphaObserver.token,
  });
  assert.equal(observerView.items.length, 1);
  await call(managerBase, "/api/platform/v1/tenants/alpha/deployments", {
    token: alphaObserver.token,
    body: {
      release_id: alpha.release.id,
      gateway_id: "default",
      request_key: "step6-view-denied",
    },
    expected: 403,
  });

  const bindAndEnable = async (deployment: ApiResult, keyId: string) => {
    const key = await call(managerBase, "/api/platform/v1/gateways/default/virtual-keys", {
      token: platformToken,
      body: { id: keyId, disabled: true, allowed_route_ids: [] },
      expected: 201,
    });
    assert.equal(typeof key.key, "string");
    await call(
      managerBase,
      `/api/platform/v1/gateways/default/deployment-key-bindings/${encodeURIComponent(deployment.id)}`,
      { token: platformToken, method: "PUT", body: { key_id: keyId } },
    );
    await call(
      managerBase,
      `/api/platform/v1/gateways/default/virtual-keys/${encodeURIComponent(keyId)}/enable`,
      { token: platformToken, method: "POST" },
    );
    return key.key as string;
  };
  const alphaBearer = await bindAndEnable(alphaDeployment, "step6-alpha-key");
  const betaBearer = await bindAndEnable(betaDeployment, "step6-beta-key");

  const apply = (tenantId: string, deploymentId: string, token: string, requestKey: string, expected = 200) =>
    call(
      managerBase,
      `/api/platform/v1/tenants/${tenantId}/deployments/${encodeURIComponent(deploymentId)}/apply`,
      { token, body: { request_key: requestKey }, expected },
    );
  proxyState.failNextAgentRouteCreate = true;
  const failed = await apply(
    "alpha", alphaDeployment.id, alphaAdmin.token, "step6-alpha-apply-fails", 202,
  );
  assert.equal(failed.status, "failed");
  const agentCreatesAfterFailure = proxyState.requests.filter((entry) =>
    entry === "POST /admin/agents").length;
  await gatewayJSON(
    adminBase,
    "step6",
    gatewayPassword,
    `/admin/agents/${encodeURIComponent(alphaDeployment.target.gatewayAgentId)}`,
  );
  await gatewayJSON(
    adminBase,
    "step6",
    gatewayPassword,
    `/admin/agents/routes/${encodeURIComponent(alphaDeployment.target.gatewayRouteId)}`,
    404,
  );
  await removeGrant(`user:${alphaAdmin.id}`, "alpha");
  await call(
    managerBase,
    `/api/platform/v1/tenants/alpha/deployments/${encodeURIComponent(alphaDeployment.id)}/retry`,
    {
      token: alphaAdmin.token,
      body: { request_key: "step6-retry-while-revoked" },
      expected: 403,
    },
  );
  assert.equal(
    proxyState.requests.filter((entry) => entry === "POST /admin/agents").length,
    agentCreatesAfterFailure,
    "revoked retry reached the Gateway",
  );
  await setGrant(`user:${alphaAdmin.id}`, "alpha", "manage");
  const retried = await call(
    managerBase,
    `/api/platform/v1/tenants/alpha/deployments/${encodeURIComponent(alphaDeployment.id)}/retry`,
    {
      token: alphaAdmin.token,
      body: { request_key: "step6-retry-after-restore" },
    },
  );
  assert.equal(retried.status, "succeeded");
  assert.equal(
    proxyState.requests.filter((entry) => entry === "POST /admin/agents").length,
    agentCreatesAfterFailure,
    "retry recreated the journaled existing Agent",
  );
  await gatewayJSON(
    adminBase,
    "step6",
    gatewayPassword,
    `/admin/agents/routes/${encodeURIComponent(alphaDeployment.target.gatewayRouteId)}`,
  );
  assert.equal((await apply(
    "beta", betaDeployment.id, betaAdmin.token, "step6-beta-apply",
  )).status, "succeeded");

  const alphaAgent = await gatewayJSON(
    adminBase,
    "step6",
    gatewayPassword,
    `/admin/agents/${encodeURIComponent(alphaDeployment.target.gatewayAgentId)}`,
  );
  const betaAgent = await gatewayJSON(
    adminBase,
    "step6",
    gatewayPassword,
    `/admin/agents/${encodeURIComponent(betaDeployment.target.gatewayAgentId)}`,
  );
  assert.equal(alphaAgent.name, "Alpha acceptance v1");
  assert.equal(betaAgent.name, "Beta acceptance v1");

  const memberContext = await call(
    managerBase,
    `/api/platform/v1/tenants/alpha/deployments/${encodeURIComponent(alphaDeployment.id)}/invocations`,
    { token: alphaMember.token, body: {}, expected: 201 },
  );
  assert.ok(!JSON.stringify(memberContext).includes(alphaBearer));
  await managerTurn(managerBase, "alpha", memberContext.id, alphaMember.token, alphaBearer);
  const betaContext = await call(
    managerBase,
    `/api/platform/v1/tenants/beta/deployments/${encodeURIComponent(betaDeployment.id)}/invocations`,
    { token: betaAdmin.token, body: {}, expected: 201 },
  );
  await managerTurn(managerBase, "beta", betaContext.id, betaAdmin.token, betaBearer);

  const serviceContext = await call(
    managerBase,
    `/api/platform/v1/tenants/alpha/deployments/${encodeURIComponent(alphaDeployment.id)}/invocations`,
    { token: service.token, body: {}, expected: 201 },
  );
  await managerTurn(managerBase, "alpha", serviceContext.id, service.token, alphaBearer);
  await rawGatewayTurn(dataBase, alphaDeployment.target.pathPrefix, undefined, 401);
  await rawGatewayTurn(dataBase, alphaDeployment.target.pathPrefix, service.token, 401);
  await rawGatewayTurn(dataBase, alphaDeployment.target.pathPrefix, alphaBearer, 200);
  await call(managerBase, "/api/platform/v1/access", { token: alphaBearer, expected: 401 });

  await Bun.sleep(500);
  for (const kind of ["activity", "usage", "interactions", "health"]) {
    const observation = await call(
      managerBase,
      `/api/platform/v1/tenants/alpha/deployments/${encodeURIComponent(alphaDeployment.id)}/${kind}`,
      { token: alphaAdmin.token },
    );
    assert.equal(observation.deploymentId, alphaDeployment.id);
    assert.equal(observation.tenantId, "alpha");
    assert.ok(!JSON.stringify(observation).includes(alphaBearer));
  }

  const rollback = (
    releaseId: string,
    requestKey: string,
  ) => call(
    managerBase,
    `/api/platform/v1/tenants/alpha/deployments/${encodeURIComponent(alphaDeployment.id)}/rollback`,
    {
      token: alphaAdmin.token,
      body: { release_id: releaseId, request_key: requestKey },
    },
  );
  await call(
    managerBase,
    `/api/platform/v1/tenants/alpha/deployments/${encodeURIComponent(alphaDeployment.id)}/rollback`,
    {
      token: alphaAdmin.token,
      body: { release_id: alphaRelease2.id, request_key: "step6-unverified-release-denied" },
      expected: 409,
    },
  );
  assert.equal((await rollback(alpha.release.id, "step6-rollback-v1")).status, "succeeded");
  assert.equal((await gatewayJSON(
    adminBase,
    "step6",
    gatewayPassword,
    `/admin/agents/${encodeURIComponent(alphaDeployment.target.gatewayAgentId)}`,
  )).name, "Alpha acceptance v1");

  assert.ok(modelCalls >= 4, `expected at least four real Gateway model calls, received ${modelCalls}`);
  console.log(`Gateway ${GATEWAY_REVISION.slice(0, 7)} Step 6 acceptance passed:`);
  console.log("- two Tenant deployments shared one real Gateway and remained isolated");
  console.log("- manage/view grants, revocation-before-retry and partial-failure recovery passed");
  console.log("- platform invocation, direct Virtual Key invocation and service-credential separation passed");
  console.log("- activity/usage/interactions/health observation, verified-release rollback and unverified-release denial passed");

}

try {
  await main();
} catch (error) {
  console.error(readFileSync(logPath, "utf8"));
  throw error;
} finally {
  await adminProxy?.stop(true);
  await modelServer?.stop(true);
  await stopChild(manager);
  for (const child of children.reverse()) await stopChild(child);
  closeSync(logFd);
  rmSync(sandbox, { recursive: true, force: true });
}
