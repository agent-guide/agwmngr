import { getPlatformAgentDefinitions, getPlatformAgentReleases } from "@/lib/platform-agent-definitions";
import { platformIdentityBody, requiredText, withPlatformIdentity } from "@/lib/platform-access";
import type { AgentDefinitionDraft } from "@/packages/contracts/platform/agents";
import { IdentityError } from "@/packages/platform/services/identity";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tenantId: string; path?: string[] }> };

async function handler(request: Request, context: Context) {
  return withPlatformIdentity(request, async (_identity, actor, audit) => {
    const { tenantId, path = [] } = await context.params;
    const service = await getPlatformAgentDefinitions();
    audit.set({
      action: `tenant:agent_definition_${request.method.toLowerCase()}`,
      tenantId,
      targetKind: "agent_definition",
      targetId: path[0] ?? null,
    });
    if (request.method === "GET" && path.length === 0) {
      return Response.json({ items: await service.list(actor, tenantId) });
    }
    if (request.method === "POST" && path.length === 0) {
      const body = await platformIdentityBody(request, ["slug", "expected_version", "draft"]);
      const item = await service.create(actor, tenantId, {
        slug: requiredText(body, "slug"),
        expectedVersion: body.expected_version as number,
        draft: body.draft as AgentDefinitionDraft,
      });
      audit.set({ targetId: item.id });
      return Response.json(item, { status: 201 });
    }
    if (request.method === "GET" && path.length === 1) {
      return Response.json(await service.get(actor, tenantId, path[0]));
    }
    if (request.method === "GET" && path.length === 2 && path[1] === "releases") {
      audit.set({ action: "tenant:agent_release_get", targetKind: "agent_release" });
      return Response.json({ items: await (await getPlatformAgentReleases()).list(actor, tenantId, path[0]) });
    }
    if (request.method === "POST" && path.length === 2 && path[1] === "releases") {
      audit.set({ action: "tenant:agent_release_post", targetKind: "agent_release" });
      const body = await platformIdentityBody(request, ["expected_version"]);
      const item = await (await getPlatformAgentReleases()).create(
        actor, tenantId, path[0], body.expected_version as number,
      );
      audit.set({ targetId: item.id });
      return Response.json(item, { status: 201 });
    }
    if (request.method === "GET" && path.length === 3 && path[1] === "releases") {
      audit.set({ action: "tenant:agent_release_get", targetKind: "agent_release", targetId: path[2] });
      return Response.json(await (await getPlatformAgentReleases()).get(actor, tenantId, path[0], path[2]));
    }
    if (request.method === "PUT" && path.length === 1) {
      const body = await platformIdentityBody(request, ["expected_version", "draft"]);
      return Response.json(await service.update(actor, tenantId, path[0], {
        expectedVersion: body.expected_version as number,
        draft: body.draft as AgentDefinitionDraft,
      }));
    }
    if (request.method === "DELETE" && path.length === 1) {
      await service.remove(actor, tenantId, path[0]);
      return new Response(null, { status: 204 });
    }
    throw new IdentityError("not_found", "Agent definition route not found");
  });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
