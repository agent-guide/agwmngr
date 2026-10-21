"use client";

import { useParams } from "next/navigation";
import { ProvidersPage } from "@/components/gateway-providers-page";

export default function GatewayProvidersPage() {
  const { gatewayId } = useParams<{ gatewayId: string }>();
  return <ProvidersPage gatewayId={gatewayId} />;
}
