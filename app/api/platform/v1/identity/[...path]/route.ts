import {
  platformIdentityBody,
  requiredText,
  withPlatformIdentity,
} from "@/lib/platform-access";
import { IdentityError } from "@/packages/platform/services/identity";
import type {
  TenantGatewayAccess,
  TenantRole,
  TenantStatus,
} from "@/packages/contracts/platform/identity";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };

async function dispatch(request: Request, context: Context) {
  const { path } = await context.params;
  return withPlatformIdentity(request, async (service, actor, audit) => {
    if (path.length === 1 && path[0] === "tenant-gateway-grants") {
      audit.set({ action: "platform:tenant_gateway_grant" });
      if (request.method === "GET") {
        const query = new URL(request.url).searchParams;
        const filters = {
          principalId: query.get("principal_id") || undefined,
          tenantId: query.get("tenant_id") || undefined,
          gatewayId: query.get("gateway_id") || undefined,
        };
        audit.set({
          tenantId: filters.tenantId ?? null,
          gatewayId: filters.gatewayId ?? null,
          targetKind: "tenant_gateway_grant_collection",
        });
        return Response.json({ items: await service.listTenantGatewayGrants(actor, filters) });
      }
      if (request.method === "PUT" || request.method === "DELETE") {
        const fields = request.method === "PUT"
          ? ["principal_id", "tenant_id", "gateway_id", "access"]
          : ["principal_id", "tenant_id", "gateway_id"];
        const body = await platformIdentityBody(request, fields);
        const principalId = requiredText(body, "principal_id");
        const tenantId = requiredText(body, "tenant_id");
        const gatewayId = requiredText(body, "gateway_id");
        audit.set({
          tenantId,
          gatewayId,
          effectiveAccess: request.method === "PUT" ? requiredText(body, "access") : null,
          targetKind: "tenant_gateway_grant",
          targetId: `${principalId}:${tenantId}:${gatewayId}`,
        });
        if (request.method === "PUT") {
          return Response.json(
            await service.setTenantGatewayGrant(
              actor,
              principalId,
              tenantId,
              gatewayId,
              requiredText(body, "access") as TenantGatewayAccess,
            ),
          );
        }
        await service.removeTenantGatewayGrant(actor, principalId, tenantId, gatewayId);
        return Response.json({ status: "deleted" });
      }
    }

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

    if (request.method === "DELETE" && path.length === 2 && path[0] === "tenants") {
      audit.set({
        action: "platform:tenant",
        tenantId: path[1],
        targetKind: "tenant",
        targetId: path[1],
      });
      await service.deleteTenant(actor, path[1]);
      return Response.json({ status: "deleted" });
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
      path.length === 3 &&
      path[0] === "tenants" &&
      path[2] === "member-resolutions"
    ) {
      audit.set({
        action: "tenant:membership_resolve",
        tenantId: path[1],
        targetKind: "membership_add_receipt",
      });
      const body = await platformIdentityBody(request, ["kind", "username", "principal_id"]);
      const kind = requiredText(body, "kind");
      if (kind === "human") {
        if (body.principal_id !== undefined) {
          throw new IdentityError("invalid_input", "human resolution accepts only username");
        }
        return Response.json(
          await service.resolveMembershipTarget(actor, path[1], {
            kind,
            username: requiredText(body, "username"),
          }),
          { status: 201 },
        );
      }
      if (kind === "service") {
        if (body.username !== undefined) {
          throw new IdentityError("invalid_input", "service resolution accepts only principal_id");
        }
        return Response.json(
          await service.resolveMembershipTarget(actor, path[1], {
            kind,
            principalId: requiredText(body, "principal_id"),
          }),
          { status: 201 },
        );
      }
      throw new IdentityError("invalid_input", "kind must be human or service");
    }

    if (
      request.method === "POST" &&
      path.length === 3 &&
      path[0] === "tenants" &&
      path[2] === "members"
    ) {
      audit.set({
        action: "tenant:membership_add",
        tenantId: path[1],
        targetKind: "tenant_membership",
      });
      const body = await platformIdentityBody(request, ["receipt", "role"]);
      return Response.json(
        await service.addMembershipWithReceipt(
          actor,
          path[1],
          requiredText(body, "receipt"),
          requiredText(body, "role") as TenantRole,
        ),
        { status: 201 },
      );
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
