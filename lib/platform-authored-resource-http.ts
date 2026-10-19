import type {
  AuthoredResourceContent,
  AuthoredResourceKind,
  CreateAuthoredResourceInput,
} from "@/packages/contracts/platform/authored-resources";
import type { CatalogAvailabilityMode } from "@/packages/contracts/platform/catalog";
import { IdentityError } from "@/packages/platform/services/identity";
import { getPlatformAuthoredResources } from "./platform-authored-resources";
import { platformIdentityBody, requiredText, withPlatformIdentity } from "./platform-access";

function content(value: unknown): AuthoredResourceContent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new IdentityError("invalid_input", "content is required");
  }
  return value as AuthoredResourceContent;
}

function createInput(body: Record<string, unknown>): CreateAuthoredResourceInput {
  if (body.description !== undefined && typeof body.description !== "string") {
    throw new IdentityError("invalid_input", "description must be text");
  }
  return {
    name: requiredText(body, "name"),
    description: (body.description as string | undefined) ?? "",
    content: content(body.content),
  };
}

function availability(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new IdentityError("invalid_input", "availability is required");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["mode", "tenant_ids"].includes(key))) {
    throw new IdentityError("invalid_input", "unsupported availability field");
  }
  if (typeof record.mode !== "string" || record.tenant_ids !== undefined && (
    !Array.isArray(record.tenant_ids) || record.tenant_ids.some((item) => typeof item !== "string")
  )) throw new IdentityError("invalid_input", "invalid availability");
  return {
    mode: record.mode as CatalogAvailabilityMode,
    tenantIds: record.tenant_ids as string[] | undefined,
  };
}

export function tenantAuthoredResourceHandler(kind: AuthoredResourceKind) {
  return async (request: Request, context: { params: Promise<{ tenantId: string; path?: string[] }> }) => {
    return withPlatformIdentity(request, async (_identity, actor, audit) => {
      const { tenantId, path = [] } = await context.params;
      const service = await getPlatformAuthoredResources();
      const targetId = path[0] ?? null;
      audit.set({
        action: `tenant:${kind}_${request.method.toLowerCase()}`,
        tenantId,
        targetKind: kind,
        targetId,
      });
      if (request.method === "GET" && path.length === 0) {
        return Response.json({ items: await service.listTenant(actor, tenantId, kind) });
      }
      if (request.method === "POST" && path.length === 0) {
        const body = await platformIdentityBody(request, ["name", "description", "content"]);
        return Response.json(await service.createTenant(actor, tenantId, kind, createInput(body)), { status: 201 });
      }
      if (request.method === "GET" && path.length === 1) {
        return Response.json(await service.getTenant(actor, tenantId, kind, path[0]));
      }
      if (request.method === "PUT" && path.length === 1) {
        const body = await platformIdentityBody(request, ["name", "description"]);
        return Response.json(await service.updateMetadata(actor, tenantId, kind, path[0], {
          name: requiredText(body, "name"),
          description: typeof body.description === "string" ? body.description : "",
        }));
      }
      if (request.method === "DELETE" && path.length === 1) {
        await service.remove(actor, tenantId, kind, path[0]);
        return new Response(null, { status: 204 });
      }
      if (request.method === "POST" && path.length === 2 && path[1] === "revisions") {
        const body = await platformIdentityBody(request, ["text", "files", "tags"]);
        return Response.json(await service.addRevision(actor, tenantId, kind, path[0], content(body)), { status: 201 });
      }
      if (request.method === "PUT" && path.length === 3 && path[1] === "revisions") {
        const body = await platformIdentityBody(request, ["status"]);
        return Response.json(await service.setRevisionStatus(
          actor, tenantId, kind, path[0], path[2], requiredText(body, "status") as "published" | "archived",
        ));
      }
      throw new IdentityError("not_found", "resource route not found");
    });
  };
}

export function platformAuthoredResourceHandler(kind: AuthoredResourceKind) {
  return async (request: Request, context: { params: Promise<{ path?: string[] }> }) => {
    return withPlatformIdentity(request, async (_identity, actor, audit) => {
      const { path = [] } = await context.params;
      const service = await getPlatformAuthoredResources();
      const targetId = path[0] ?? null;
      audit.set({
        action: `platform:${kind}_${request.method.toLowerCase()}`,
        targetKind: kind,
        targetId,
      });
      if (request.method === "GET" && path.length === 0) {
        return Response.json({ items: await service.listPlatform(actor, kind) });
      }
      if (request.method === "POST" && path.length === 0) {
        const body = await platformIdentityBody(request, ["name", "description", "content", "availability"]);
        return Response.json(await service.createPlatform(
          actor, kind, createInput(body), availability(body.availability),
        ), { status: 201 });
      }
      if (request.method === "GET" && path.length === 1) {
        return Response.json(await service.getPlatform(actor, kind, path[0]));
      }
      if (request.method === "PUT" && path.length === 1) {
        const body = await platformIdentityBody(request, ["name", "description"]);
        return Response.json(await service.updateMetadata(actor, null, kind, path[0], {
          name: requiredText(body, "name"),
          description: typeof body.description === "string" ? body.description : "",
        }));
      }
      if (request.method === "DELETE" && path.length === 1) {
        await service.remove(actor, null, kind, path[0]);
        return new Response(null, { status: 204 });
      }
      if (request.method === "POST" && path.length === 2 && path[1] === "revisions") {
        const body = await platformIdentityBody(request, ["text", "files", "tags"]);
        return Response.json(await service.addRevision(actor, null, kind, path[0], content(body)), { status: 201 });
      }
      if (request.method === "PUT" && path.length === 3 && path[1] === "revisions") {
        const body = await platformIdentityBody(request, ["status"]);
        return Response.json(await service.setRevisionStatus(
          actor, null, kind, path[0], path[2], requiredText(body, "status") as "published" | "archived",
        ));
      }
      if (request.method === "PUT" && path.length === 2 && path[1] === "availability") {
        const body = await platformIdentityBody(request, ["mode", "tenant_ids"]);
        return Response.json(await service.setPlatformAvailability(actor, kind, path[0], availability({
          mode: body.mode,
          tenant_ids: body.tenant_ids,
        })));
      }
      throw new IdentityError("not_found", "resource route not found");
    });
  };
}
