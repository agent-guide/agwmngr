import { getPlatformToolDefinitions } from "@/lib/platform-tool-definitions";
import { platformIdentityBody, requiredText, withPlatformIdentity } from "@/lib/platform-access";
import { IdentityError } from "@/packages/platform/services/identity";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tenantId: string; path?: string[] }> };

async function handler(request: Request, context: Context) {
  return withPlatformIdentity(request, async (_identity, actor, audit) => {
    const { tenantId, path = [] } = await context.params;
    const service = await getPlatformToolDefinitions();
    audit.set({ action: `tenant:tool_${request.method.toLowerCase()}`, tenantId,
      targetKind: "tenant_tool_definition", targetId: path[0] ?? null });
    if (request.method === "GET" && path.length === 0) {
      return Response.json({ items: await service.list(actor, tenantId) });
    }
    if (request.method === "POST" && path.length === 0) {
      const body = await platformIdentityBody(request, ["name", "description", "offering_id"]);
      const item = await service.create(actor, tenantId, {
        name: requiredText(body, "name"),
        description: typeof body.description === "string" ? body.description : "",
        offeringId: requiredText(body, "offering_id"),
      });
      audit.set({ targetId: item.id });
      return Response.json(item, { status: 201 });
    }
    if (request.method === "GET" && path.length === 1) {
      return Response.json(await service.get(actor, tenantId, path[0]));
    }
    if (request.method === "PUT" && path.length === 1) {
      const body = await platformIdentityBody(request, ["name", "description", "offering_id"]);
      return Response.json(await service.update(actor, tenantId, path[0], {
        name: requiredText(body, "name"),
        description: typeof body.description === "string" ? body.description : "",
        offeringId: requiredText(body, "offering_id"),
      }));
    }
    if (request.method === "DELETE" && path.length === 1) {
      await service.remove(actor, tenantId, path[0]);
      return new Response(null, { status: 204 });
    }
    throw new IdentityError("not_found", "tool definition route not found");
  });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
