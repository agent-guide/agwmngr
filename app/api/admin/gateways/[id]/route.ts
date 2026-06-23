import { withPlatformAccess } from "@/lib/access";
import { getGateway, updateGateway, deleteGateway, toGatewaySummary } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export const GET = withPlatformAccess(async (_req, _access, { params }: Params) => {
  const { id } = await params;
  const row = getGateway(id);
  if (!row) return Response.json({ error: "gateway not found" }, { status: 404 });
  return Response.json(toGatewaySummary(row));
});

export const PUT = withPlatformAccess(async (req, _access, { params }: Params) => {
  const { id } = await params;
  if (!getGateway(id)) return Response.json({ error: "gateway not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  if (body.status !== undefined && body.status !== "active" && body.status !== "disabled") {
    return Response.json({ error: "status must be 'active' or 'disabled'" }, { status: 400 });
  }

  // Only fields present in the body are updated. An empty/absent admin_password
  // leaves the stored ciphertext untouched (no accidental credential wipe).
  const row = updateGateway(id, {
    name: body.name !== undefined ? String(body.name) : undefined,
    description: body.description !== undefined ? (body.description ? String(body.description) : null) : undefined,
    admin_addr: body.admin_addr !== undefined ? String(body.admin_addr) : undefined,
    admin_user: body.admin_user !== undefined ? String(body.admin_user) : undefined,
    admin_password: typeof body.admin_password === "string" && body.admin_password ? body.admin_password : undefined,
    caddy_admin_addr: body.caddy_admin_addr !== undefined ? (body.caddy_admin_addr ? String(body.caddy_admin_addr) : null) : undefined,
    dataplane_addr: body.dataplane_addr !== undefined ? (body.dataplane_addr ? String(body.dataplane_addr) : null) : undefined,
    readonly_server_ids: body.readonly_server_ids !== undefined ? (body.readonly_server_ids ? String(body.readonly_server_ids) : null) : undefined,
    status: body.status as "active" | "disabled" | undefined,
  });
  return Response.json(toGatewaySummary(row!));
});

export const DELETE = withPlatformAccess(async (_req, _access, { params }: Params) => {
  const { id } = await params;
  if (!getGateway(id)) return Response.json({ error: "gateway not found" }, { status: 404 });

  // Memberships and any session pointers cascade / null via FK (PRAGMA on).
  deleteGateway(id);
  return Response.json({ status: "deleted", id });
});
