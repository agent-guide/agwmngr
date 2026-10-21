"use client";

import { useParams } from "next/navigation";
import { RoutesPage } from "@/components/gateway-llm-routes-page";

export default function GatewayLLMRoutesPage() {
  const { gatewayId } = useParams<{ gatewayId: string }>();
  return <RoutesPage gatewayId={gatewayId} />;
}
