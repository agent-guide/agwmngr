"use client";

import { useParams } from "next/navigation";
import { MCPServicesPage } from "@/components/gateway-mcp-services-page";

export default function GatewayMCPServicesPage() {
  const { gatewayId } = useParams<{ gatewayId: string }>();
  return <MCPServicesPage gatewayId={gatewayId} />;
}
