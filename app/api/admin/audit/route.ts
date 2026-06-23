import { withPlatformAccess } from "@/lib/access";
import { listAudit, type AuditFilters } from "@/lib/db";

// Read-only audit log view (platform-admin only).
export const GET = withPlatformAccess((req) => {
  const url = new URL(req.url);
  const filters: AuditFilters = {};
  const gw = url.searchParams.get("gateway_id");
  const decision = url.searchParams.get("decision");
  const actor = url.searchParams.get("actor_user_id");
  const limit = url.searchParams.get("limit");
  if (gw) filters.gateway_id = gw;
  if (decision === "allow" || decision === "deny") filters.decision = decision;
  if (actor && Number.isInteger(Number(actor))) filters.actor_user_id = Number(actor);
  if (limit && Number.isInteger(Number(limit))) filters.limit = Number(limit);

  return Response.json({ items: listAudit(filters) });
});
