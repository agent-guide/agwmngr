import { withPlatformAccess } from "@/lib/access";
import { listGateways, getGateway, createGateway, toGatewaySummary } from "@/lib/db";
import { isEncryptionConfigured } from "@/lib/crypto";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export const GET = withPlatformAccess(() => {
  return Response.json({ items: listGateways().map(toGatewaySummary) });
});

export const POST = withPlatformAccess(async (req) => {
  if (!isEncryptionConfigured()) {
    return Response.json(
      {
        error:
          "MANAGER_SECRET_KEY is not configured in the running manager process; set it in .env.local and restart the manager before saving gateway credentials",
      },
      { status: 503 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  const id = String(body.id ?? "").trim();
  const name = String(body.name ?? "").trim();
  const adminAddr = String(body.admin_addr ?? "").trim();
  const adminUser = String(body.admin_user ?? "").trim();
  const adminPassword = String(body.admin_password ?? "");

  if (!id || !name || !adminAddr || !adminUser) {
    return Response.json(
      { error: "id, name, admin_addr and admin_user are required" },
      { status: 400 },
    );
  }
  if (!SLUG_RE.test(id)) {
    return Response.json(
      { error: "id must be a slug (lowercase letters, digits, hyphens)" },
      { status: 400 },
    );
  }
  if (getGateway(id)) {
    return Response.json({ error: "a gateway with that id already exists" }, { status: 409 });
  }

  try {
    const row = createGateway({
      id,
      name,
      description: body.description ? String(body.description) : null,
      admin_addr: adminAddr,
      admin_user: adminUser,
      admin_password: adminPassword,
      caddy_admin_addr: body.caddy_admin_addr ? String(body.caddy_admin_addr) : null,
      dataplane_addr: body.dataplane_addr ? String(body.dataplane_addr) : null,
      readonly_server_ids: body.readonly_server_ids ? String(body.readonly_server_ids) : null,
      status: body.status === "disabled" ? "disabled" : "active",
    });
    return Response.json(toGatewaySummary(row), { status: 201 });
  } catch (e) {
    const msg = (e as Error).message || "failed to create gateway";
    const status = /unique|constraint/i.test(msg) ? 409 : 500;
    return Response.json({ error: msg }, { status });
  }
});
