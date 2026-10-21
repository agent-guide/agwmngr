"use client";

import { useParams } from "next/navigation";
import { GatewayWorkspaceNav } from "@/components/gateway-workspace-nav";

export default function GatewayWorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { gatewayId } = useParams<{ gatewayId: string }>();
  return <><GatewayWorkspaceNav gatewayId={gatewayId} />{children}</>;
}
