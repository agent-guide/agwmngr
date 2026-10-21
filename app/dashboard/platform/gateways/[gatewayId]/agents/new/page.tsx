"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AgentForm } from "@/components/agent-form";
import { PageHeader } from "@/components/ui/page-header";
import { useI18n } from "@/components/i18n-provider";

export default function NewGatewayAgentPage() {
  const { gatewayId } = useParams<{ gatewayId: string }>();
  const { t } = useI18n();
  return <div className="space-y-4">
    <PageHeader
      title={t("platformAgents.gatewayCreate")}
      description={<Link
        href={`/dashboard/platform/gateways/${encodeURIComponent(gatewayId)}/agents`}
        className="text-blue-400 hover:underline"
      >{t("gatewayAgentDetail.back")}</Link>}
    />
    <AgentForm wizard gatewayId={gatewayId} />
  </div>;
}
