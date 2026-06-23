import { withPlatformAccess } from "@/lib/access";
import {
  getUserSummary,
  findUserById,
  updateUser,
  deleteUser,
  countActivePlatformAdmins,
} from "@/lib/db";
import { revokeSessionsForUser } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const GET = withPlatformAccess(async (_req, _access, { params }: Params) => {
  const id = parseId((await params).id);
  if (id === null) return Response.json({ error: "invalid user id" }, { status: 400 });

  const user = getUserSummary(id);
  if (!user) return Response.json({ error: "user not found" }, { status: 404 });
  return Response.json(user);
});

export const PUT = withPlatformAccess(async (req, _access, { params }: Params) => {
  const id = parseId((await params).id);
  if (id === null) return Response.json({ error: "invalid user id" }, { status: 400 });

  const existing = findUserById(id);
  if (!existing) return Response.json({ error: "user not found" }, { status: 404 });

  let body: { password?: string; is_platform_admin?: boolean; status?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  if (body.password !== undefined && body.password.length < 8) {
    return Response.json({ error: "password must be at least 8 characters" }, { status: 400 });
  }
  if (body.status !== undefined && body.status !== "active" && body.status !== "disabled") {
    return Response.json({ error: "status must be 'active' or 'disabled'" }, { status: 400 });
  }

  // Self-lockout guard: don't let the last active platform admin be demoted or
  // disabled, which would leave no one able to manage the platform.
  const willLosePlatformPower =
    (body.is_platform_admin === false || body.status === "disabled") &&
    existing.is_platform_admin === 1 &&
    existing.status === "active";
  if (willLosePlatformPower && countActivePlatformAdmins(id) === 0) {
    return Response.json(
      { error: "cannot demote or disable the last active platform administrator" },
      { status: 400 },
    );
  }

  const updated = updateUser(id, {
    password: body.password,
    isPlatformAdmin: body.is_platform_admin,
    status: body.status as "active" | "disabled" | undefined,
  });

  // Disabling a user (or changing their password) must invalidate live sessions.
  if (body.status === "disabled" || body.password !== undefined) {
    revokeSessionsForUser(id);
  }

  return Response.json(updated);
});

export const DELETE = withPlatformAccess(async (_req, _access, { params }: Params) => {
  const id = parseId((await params).id);
  if (id === null) return Response.json({ error: "invalid user id" }, { status: 400 });

  const existing = findUserById(id);
  if (!existing) return Response.json({ error: "user not found" }, { status: 404 });

  // Don't allow deleting the last active platform admin.
  if (
    existing.is_platform_admin === 1 &&
    existing.status === "active" &&
    countActivePlatformAdmins(id) === 0
  ) {
    return Response.json(
      { error: "cannot delete the last active platform administrator" },
      { status: 400 },
    );
  }

  revokeSessionsForUser(id);
  deleteUser(id);
  return Response.json({ status: "deleted" });
});
