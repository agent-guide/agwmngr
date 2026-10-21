import { withPlatformIdentity } from "@/lib/platform-access";
import { retryPlatformRecovery } from "@/lib/platform-recovery";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ gatewayId: string }> };

export async function POST(request: Request, context: Context) {
  return withPlatformIdentity(request, async (identity, actor, audit) => {
    const { gatewayId } = await context.params;
    await identity.authorizePlatformGateway(actor, gatewayId);
    audit.set({
      action: "platform:gateway_recovery_retry",
      gatewayId,
      effectiveAccess: "platform_admin",
      targetKind: "gateway_recovery",
      targetId: gatewayId,
    });
    const report = await retryPlatformRecovery(gatewayId);
    return Response.json(report, { status: report.failed.length === 0 ? 200 : 202 });
  });
}
