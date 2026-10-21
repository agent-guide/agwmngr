"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { LegacyGatewayRedirect } from "@/components/legacy-gateway-redirect";
import { PlatformAgentDetail } from "@/components/platform-agent-detail";
import { platformAgentTenantId } from "@/lib/platform-agent-ui";

export default function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const source = useSearchParams().get("source");
  const tenantId = source === "gateway" ? null : platformAgentTenantId(id);
  if (!tenantId) {
    return <LegacyGatewayRedirect target="agents" suffix={`/${encodeURIComponent(id)}`} />;
  }
  return <PlatformAgentDetail tenantId={tenantId} id={id} />;
}
