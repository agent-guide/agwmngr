import { withPlatformAccess } from "@/lib/access";

export const dynamic = "force-dynamic";

export const POST = withPlatformAccess(async () => Response.json({
  error: "legacy ACP permission resolution was removed; use the scoped invocation API",
  code: "scoped_replacement_required",
}, { status: 410 }));
