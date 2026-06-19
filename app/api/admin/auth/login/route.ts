import bcrypt from "bcryptjs";
import { createSession } from "@/lib/session";
import { getServerEnv } from "@/lib/server-env";

export async function POST(req: Request) {
  let body: { username?: string; password?: string };
  try {
    body = (await req.json()) as { username?: string; password?: string };
  } catch {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  const { username, password } = body;
  if (!username || !password) {
    return Response.json({ error: "username and password are required" }, { status: 400 });
  }

  const adminUser = getServerEnv("CADDYMGR_ADMIN_USER");
  const adminHash = getServerEnv("CADDYMGR_ADMIN_PASSWORD_HASH");

  if (!adminUser) {
    return Response.json({ error: "admin credentials not configured" }, { status: 503 });
  }

  // Use a dummy hash when username doesn't match to keep constant-time behaviour.
  const hashToCheck =
    username === adminUser
      ? adminHash
      : "$2a$10$invalidhashpadding000000000000000000000000000000000000";

  const valid = await bcrypt.compare(password, hashToCheck);
  if (username !== adminUser || !valid) {
    return Response.json({ error: "invalid credentials" }, { status: 401 });
  }

  const token = createSession(username);
  return Response.json({ token, username });
}
