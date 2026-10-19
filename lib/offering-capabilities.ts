import { getGateway, getGatewayAuthority } from "./db";
import { resolveGateway } from "./gateway-resolve";
import { gatewayRequestJSON } from "@/packages/gateway-client/admin";
import type { CatalogOfferingReference } from "@/packages/contracts/platform/catalog";
import type {
  OfferingCapabilityCheck,
  OfferingCapabilityDirectory,
} from "@/packages/platform/ports/offering-capabilities";

function itemArray(value: unknown): unknown[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const items = (value as { items?: unknown }).items;
  return Array.isArray(items) ? items : [];
}

export const offeringCapabilityDirectory: OfferingCapabilityDirectory = {
  async check(reference: CatalogOfferingReference): Promise<OfferingCapabilityCheck> {
    if (reference.kind === "platform-native") return { available: true };
    if (!reference.sourceGatewayId || !reference.upstreamStableId) {
      return { available: false, reason: "source_unavailable" };
    }
    const row = getGateway(reference.sourceGatewayId);
    const authority = getGatewayAuthority(reference.sourceGatewayId);
    if (!row || row.status !== "active" || authority?.authorityEpoch !== reference.sourceGatewayAuthorityEpoch) {
      return { available: false, reason: "source_unavailable" };
    }
    let gateway;
    try { gateway = resolveGateway(row); }
    catch { return { available: false, reason: "source_unavailable" }; }

    try {
      if (reference.category === "model") {
        const response = await gatewayRequestJSON(
          "GET",
          `/admin/llm/routes/${encodeURIComponent(reference.upstreamStableId)}`,
          gateway,
        );
        if (response.status < 200 || response.status >= 300 || !response.body ||
          typeof response.body !== "object" || Array.isArray(response.body)) {
          return { available: false, reason: "upstream_missing" };
        }
        const route = response.body as { id?: unknown; disabled?: unknown };
        return route.id === reference.upstreamStableId && route.disabled !== true
          ? { available: true }
          : { available: false, reason: "upstream_missing" };
      }

      const parts = reference.upstreamStableId.startsWith("mcp:")
        ? reference.upstreamStableId.slice(4).split(":")
        : reference.upstreamStableId.split(":");
      if (parts.length < 2) return { available: false, reason: "capability_missing" };
      const serviceId = parts.shift()!;
      const toolName = parts.join(":");
      const response = await gatewayRequestJSON(
        "GET",
        `/admin/mcp/services/${encodeURIComponent(serviceId)}/tools`,
        gateway,
      );
      if (response.status < 200 || response.status >= 300) {
        return { available: false, reason: "upstream_missing" };
      }
      const found = itemArray(response.body).some((item) =>
        Boolean(item && typeof item === "object" && !Array.isArray(item) &&
          (item as { name?: unknown }).name === toolName)
      );
      return found ? { available: true } : { available: false, reason: "capability_missing" };
    } catch {
      return { available: false, reason: "source_unavailable" };
    }
  },
};
