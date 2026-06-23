import { withPlatformAccess } from "@/lib/access";
import { listUsers, createUser, findUserByUsername } from "@/lib/db";

export const GET = withPlatformAccess(() => {
  return Response.json({ items: listUsers() });
});

export const POST = withPlatformAccess(async (req) => {
  let body: { username?: string; password?: string; is_platform_admin?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  const username = body.username?.trim();
  const password = body.password;
  if (!username || !password) {
    return Response.json({ error: "username and password are required" }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ error: "password must be at least 8 characters" }, { status: 400 });
  }
  if (findUserByUsername(username)) {
    return Response.json({ error: "a user with that username already exists" }, { status: 409 });
  }

  try {
    const user = createUser({
      username,
      password,
      isPlatformAdmin: body.is_platform_admin === true,
    });
    return Response.json(user, { status: 201 });
  } catch (e) {
    // Unique-index race or other constraint failure.
    const msg = (e as Error).message || "failed to create user";
    const status = /unique|constraint/i.test(msg) ? 409 : 500;
    return Response.json({ error: status === 409 ? "username already exists" : msg }, { status });
  }
});
