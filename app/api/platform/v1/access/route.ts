import { withPlatformIdentity } from "@/lib/platform-access";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return withPlatformIdentity(request, async (service, actor) => {
    return Response.json(await service.access(actor));
  });
}
