import { getPlatformDeploymentObservability } from "@/lib/platform-deployment-observability";
import { platformObservationQuery } from "@/lib/platform-observation-query";
import { withPlatformIdentity } from "@/lib/platform-access";
import {
  deploymentObservationKinds,
  type DeploymentObservationKind,
} from "@/packages/contracts/platform/deployments";
import { IdentityError } from "@/packages/platform/services/identity";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tenantId: string; kind: string }> };

export async function GET(request: Request, context: Context) {
  return withPlatformIdentity(request, async (_identity, actor, audit) => {
    const { tenantId, kind } = await context.params;
    if (!deploymentObservationKinds.includes(kind as DeploymentObservationKind)) {
      throw new IdentityError("not_found", "deployment observation not found");
    }
    audit.set({
      action: `tenant:deployment_observation_${kind}`,
      tenantId,
      targetKind: "deployment_observation",
      effectiveAccess: "view",
    });
    const service = await getPlatformDeploymentObservability();
    return Response.json({
      items: await service.observations(
        actor,
        tenantId,
        kind as DeploymentObservationKind,
        platformObservationQuery(request.url),
      ),
    });
  });
}
