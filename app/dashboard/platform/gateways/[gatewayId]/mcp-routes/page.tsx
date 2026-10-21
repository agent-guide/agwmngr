"use client";

import { useParams } from "next/navigation";
import { MCPRoutesPage } from "@/components/gateway-mcp-routes-page";

export default function GatewayMCPRoutesPage() {
  const { gatewayId } = useParams<{ gatewayId: string }>();
  return <MCPRoutesPage gatewayId={gatewayId} />;
}
