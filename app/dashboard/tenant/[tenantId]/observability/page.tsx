"use client";

import { useParams } from "next/navigation";
import { PlatformObservabilityPage } from "@/components/platform-observability-page";

export default function TenantObservabilityPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  return <PlatformObservabilityPage tenantId={tenantId} />;
}
