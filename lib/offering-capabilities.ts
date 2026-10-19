import { getGateway, getGatewayAuthority } from "./db";
import { resolveGateway } from "./gateway-resolve";
import { gatewayRequestJSON } from "@/packages/gateway-client/admin";
import type { CatalogOfferingReference } from "@/packages/contracts/platform/catalog";
import type {
  OfferingCapabilityCheck,
  OfferingCapabilityDirectory,
} from "@/packages/platform/ports/offering-capabilities";

const capabilityProbeTimeoutMs = 5_000;

function itemArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const response = value as { items?: unknown; tools?: unknown };
  if (Array.isArray(response.items)) return response.items;
  return Array.isArray(response.tools) ? response.tools : [];
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
      const signal = AbortSignal.timeout(capabilityProbeTimeoutMs);
      if (reference.category === "model") {
        const response = await gatewayRequestJSON(
          "GET",
          `/admin/llm/routes/${encodeURIComponent(reference.upstreamStableId)}`,
          gateway,
          undefined,
          { signal },
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

      if (!reference.upstreamStableId.startsWith("mcp:")) {
        return { available: false, reason: "capability_missing" };
      }
      const parts = reference.upstreamStableId.slice(4).split(":");
      if (parts.length < 2) return { available: false, reason: "capability_missing" };
      const serviceId = parts.shift()!;
      const toolName = parts.join(":");
      if (!serviceId || !toolName) return { available: false, reason: "capability_missing" };
      const serviceResponse = await gatewayRequestJSON(
        "GET",
        `/admin/mcp/services/${encodeURIComponent(serviceId)}`,
        gateway,
        undefined,
        { signal },
      );
      if (serviceResponse.status < 200 || serviceResponse.status >= 300 ||
        !serviceResponse.body || typeof serviceResponse.body !== "object" ||
        Array.isArray(serviceResponse.body)) {
        return { available: false, reason: "upstream_missing" };
      }
      const service = serviceResponse.body as { id?: unknown; disabled?: unknown };
      if (service.id !== serviceId || service.disabled === true) {
        return { available: false, reason: "upstream_missing" };
      }
      const response = await gatewayRequestJSON(
        "GET",
        `/admin/mcp/services/${encodeURIComponent(serviceId)}/tools`,
        gateway,
        undefined,
        { signal },
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
