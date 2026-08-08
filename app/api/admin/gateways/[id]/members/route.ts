import { withPlatformAccess } from "@/lib/access";
import { getGateway, findUserById, setMembership, listGatewayMembers } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export const GET = withPlatformAccess(async (_req, _access, { params }: Params) => {
  const { id } = await params;
  if (!getGateway(id)) return Response.json({ error: "gateway not found" }, { status: 404 });
  return Response.json({ items: listGatewayMembers(id) });
});

// Upsert a membership (assign or change a user's role on this gateway).
export const PUT = withPlatformAccess(async (req, _access, { params }: Params) => {
  const { id } = await params;
  if (!getGateway(id)) return Response.json({ error: "gateway not found" }, { status: 404 });

  let body: { user_id?: number; role?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  const userId = Number(body.user_id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return Response.json({ error: "user_id is required" }, { status: 400 });
  }
  if (body.role !== "admin" && body.role !== "member") {
    return Response.json({ error: "role must be 'admin' or 'member'" }, { status: 400 });
  }
  const user = findUserById(userId);
  if (!user) {
    return Response.json({ error: "user not found" }, { status: 404 });
  }
  if (user.is_platform_admin) {
    return Response.json(
      { error: "platform administrators have implicit gateway access" },
      { status: 400 },
    );
  }

  setMembership(userId, id, body.role);
  return Response.json({ items: listGatewayMembers(id) });
});
