import bcrypt from "bcryptjs";
import { findUserByUsername } from "@/lib/db";
import { createSessionForUser } from "@/lib/session";

// Constant-time decoy so a missing/disabled user takes the same time as a real
// one with a wrong password (avoids username enumeration via timing).
const DECOY_HASH = "$2a$10$invalidhashpadding000000000000000000000000000000000000";

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

  const user = findUserByUsername(username);
  const usable = user && user.status === "active";
  const hashToCheck = usable ? user!.password_hash : DECOY_HASH;

  const valid = await bcrypt.compare(password, hashToCheck);
  if (!usable || !valid) {
    return Response.json({ error: "invalid credentials" }, { status: 401 });
  }

  const token = createSessionForUser(user!);
  return Response.json({ token, username: user!.username });
}
