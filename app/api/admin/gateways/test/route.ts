import { withPlatformAccess } from "@/lib/access";
import { pingGateway } from "@/lib/gateway-test";

// Pre-save connectivity check with explicit credentials (used by the create /
// edit form before persisting).
export const POST = withPlatformAccess(async (req) => {
  let body: { admin_addr?: string; admin_user?: string; admin_password?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  const adminAddr = body.admin_addr?.trim();
  const adminUser = body.admin_user?.trim();
  if (!adminAddr || !adminUser) {
    return Response.json({ error: "admin_addr and admin_user are required" }, { status: 400 });
  }

  const result = await pingGateway(adminAddr, adminUser, body.admin_password ?? "");
  return Response.json(result);
});
