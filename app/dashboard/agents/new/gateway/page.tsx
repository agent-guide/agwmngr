"use client";

import { LegacyGatewayRedirect } from "@/components/legacy-gateway-redirect";

export default function LegacyGatewayAgentCreatePage() {
  return <LegacyGatewayRedirect target="agents" suffix="/new" />;
}
