"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AgentForm } from "@/components/agent-form";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { useAdminSWR } from "@/hooks/use-admin-swr";
import { useI18n } from "@/components/i18n-provider";
import { getPlatformGatewayAgent } from "@/lib/platform-api";

export default function EditGatewayAgentPage() {
  const { gatewayId, agentId } = useParams<{ gatewayId: string; agentId: string }>();
  const { data, error, isLoading } = useAdminSWR(
    ["platform-gateway-agent", gatewayId, agentId],
    () => getPlatformGatewayAgent(gatewayId, agentId),
  );
  const { t } = useI18n();
  const detailPath = `/dashboard/platform/gateways/${encodeURIComponent(gatewayId)}` +
    `/agents/${encodeURIComponent(agentId)}`;
  return <div className="space-y-4">
    <PageHeader
      title={t("agents.editTitle", { name: data?.name ?? agentId })}
      description={<Link href={detailPath} className="text-blue-400 hover:underline">
        {t("agents.backOne")}
      </Link>}
    />
    {error ? <Card className="p-8 text-center text-sm text-rose-300">
      {error instanceof Error ? error.message : t("agents.loadOneFailed")}
    </Card> : isLoading || !data ? <Card className="p-8 text-center text-sm text-slate-400">
      {t("common.loading")}
    </Card> : <AgentForm initial={data} gatewayId={gatewayId} />}
  </div>;
}
