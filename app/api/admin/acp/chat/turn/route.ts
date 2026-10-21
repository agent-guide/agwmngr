import { withPlatformAccess } from "@/lib/access";

export const dynamic = "force-dynamic";

// Step 6E removes the active-Gateway chat bridge. Platform-managed calls use
// /api/platform/v1/tenants/{tenant}/invocations/{context}/turn; Gateway-only
// Agent Test uses the explicit path-qualified compatibility service.
export const POST = withPlatformAccess(async () => Response.json({
  error: "legacy ACP chat was removed; create a scoped platform invocation context",
  code: "scoped_replacement_required",
}, { status: 410 }));
