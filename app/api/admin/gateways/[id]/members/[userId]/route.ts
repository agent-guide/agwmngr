import { withPlatformAccess } from "@/lib/access";
import { getGateway, removeMembership, listGatewayMembers } from "@/lib/db";

type Params = { params: Promise<{ id: string; userId: string }> };

export const DELETE = withPlatformAccess(async (_req, _access, { params }: Params) => {
  const { id, userId } = await params;
  if (!getGateway(id)) return Response.json({ error: "gateway not found" }, { status: 404 });

  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) {
    return Response.json({ error: "invalid user id" }, { status: 400 });
  }

  removeMembership(uid, id);
  return Response.json({ items: listGatewayMembers(id) });
});
