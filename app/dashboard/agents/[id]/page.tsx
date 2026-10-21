"use client";

import { use, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { LegacyGatewayRedirect } from "@/components/legacy-gateway-redirect";
import { Card } from "@/components/ui/card";
import { platformAgentHref, platformAgentTenantId } from "@/lib/platform-agent-ui";

export default function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const search = useSearchParams();
  const source = search.get("source");
  const explicitGatewayId = search.get("gateway_id")?.trim() || null;
  const router = useRouter();
  const tenantId = source === "gateway" ? null : platformAgentTenantId(id);
  useEffect(() => {
    if (tenantId) router.replace(platformAgentHref(id));
  }, [id, router, tenantId]);
  if (!tenantId) {
    return <LegacyGatewayRedirect
      target="agents"
      suffix={`/${encodeURIComponent(id)}`}
      explicitGatewayId={explicitGatewayId}
    />;
  }
  return <Card className="p-8 text-center text-sm text-slate-400">Opening Agent workspace…</Card>;
}
