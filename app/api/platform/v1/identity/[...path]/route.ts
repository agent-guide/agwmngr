import {
  platformIdentityBody,
  requiredText,
  withPlatformIdentity,
} from "@/lib/platform-access";
import { IdentityError } from "@/packages/platform/services/identity";
import type { TenantRole, TenantStatus } from "@/packages/contracts/platform/identity";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };

async function dispatch(request: Request, context: Context) {
  const { path } = await context.params;
  return withPlatformIdentity(request, async (service, actor) => {
    if (request.method === "GET" && path.length === 1) {
      if (path[0] === "tenants") {
        return Response.json({ items: await service.listTenants(actor) });
      }
      if (path[0] === "principals") {
        return Response.json({ items: await service.listPrincipals(actor) });
      }
    }

    if (request.method === "POST" && path.length === 1) {
      if (path[0] === "tenants") {
        const body = await platformIdentityBody(request, ["id", "name"]);
        const tenant = await service.createTenant(
          actor,
          requiredText(body, "id"),
          requiredText(body, "name"),
        );
        return Response.json(tenant, { status: 201 });
      }
      if (path[0] === "service-principals") {
        const body = await platformIdentityBody(request, ["name", "expires_at"]);
        const result = await service.createService(
          actor,
          requiredText(body, "name"),
          requiredText(body, "expires_at"),
        );
        return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
      }
    }

    if (request.method === "PUT" && path.length === 2 && path[0] === "tenants") {
      const body = await platformIdentityBody(request, ["status"]);
      return Response.json(
        await service.setTenantStatus(
          actor,
          path[1],
          requiredText(body, "status") as TenantStatus,
        ),
      );
    }

    if (
      path.length === 3 &&
      path[0] === "tenants" &&
      path[2] === "members" &&
      request.method === "GET"
    ) {
      return Response.json({ items: await service.listMemberships(actor, path[1]) });
    }

    if (
      request.method === "POST" &&
      path.length === 4 &&
      path[0] === "tenants" &&
      path[2] === "members" &&
      path[3] === "bootstrap"
    ) {
      const body = await platformIdentityBody(request, ["principal_id", "role"]);
      return Response.json(
        await service.bootstrapMembership(
          actor,
          path[1],
          requiredText(body, "principal_id"),
          requiredText(body, "role") as TenantRole,
        ),
        { status: 201 },
      );
    }

    if (
      path.length === 4 &&
      path[0] === "tenants" &&
      path[2] === "members"
    ) {
      if (request.method === "PUT") {
        const body = await platformIdentityBody(request, ["role"]);
        return Response.json(
          await service.setMembership(
            actor,
            path[1],
            path[3],
            requiredText(body, "role") as TenantRole,
          ),
        );
      }
      if (request.method === "DELETE") {
        await service.removeMembership(actor, path[1], path[3]);
        return Response.json({ status: "deleted" });
      }
    }

    if (
      request.method === "DELETE" &&
      path.length === 2 &&
      path[0] === "service-principals"
    ) {
      await service.disableService(actor, path[1]);
      return Response.json({ status: "disabled" });
    }

    throw new IdentityError("not_found");
  });
}

export { dispatch as GET, dispatch as POST, dispatch as PUT, dispatch as DELETE };
