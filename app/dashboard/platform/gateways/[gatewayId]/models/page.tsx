"use client";

import { useParams } from "next/navigation";
import { ModelsPage } from "@/components/gateway-models-page";

export default function GatewayModelsPage() {
  const { gatewayId } = useParams<{ gatewayId: string }>();
  return <ModelsPage gatewayId={gatewayId} />;
}
