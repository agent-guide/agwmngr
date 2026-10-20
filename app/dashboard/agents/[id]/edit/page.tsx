"use client";

import Link from "next/link";
import { use } from "react";
import { useSearchParams } from "next/navigation";
import { AgentForm } from "@/components/agent-form";
import { PlatformAgentForm } from "@/components/platform-agent-form";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { useAdminSWR } from "@/hooks/use-admin-swr";
import { getAgent } from "@/lib/api";
import { useI18n } from "@/components/i18n-provider";
import { getAgentDefinition } from "@/lib/platform-api";
import { platformAgentTenantId } from "@/lib/platform-agent-ui";

export default function EditAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const source = useSearchParams().get("source");
  const tenantId = source === "gateway" ? null : platformAgentTenantId(id);
  if (tenantId) return <PlatformAgentEdit tenantId={tenantId} id={id} />;
  return <GatewayAgentEdit id={id} />;
}

function PlatformAgentEdit({ tenantId, id }: { tenantId: string; id: string }) {
  const { data, error, isLoading } = useAdminSWR(["platform-agent", tenantId, id], () => getAgentDefinition(tenantId, id));
  const { t } = useI18n();
  return <div className="space-y-4"><PageHeader title={t("agents.editTitle", { name: data?.draft.name ?? id })} description={<Link href={`/dashboard/agents/${encodeURIComponent(id)}`} className="text-blue-400 hover:underline">{t("agents.backOne")}</Link>} />{error ? <Card className="p-8 text-center text-sm text-rose-300">{error instanceof Error ? error.message : t("agents.loadOneFailed")}</Card> : isLoading || !data ? <Card className="p-8 text-center text-sm text-slate-400">{t("common.loading")}</Card> : <PlatformAgentForm initial={data} />}</div>;
}

function GatewayAgentEdit({ id }: { id: string }) {
  const { data, error, isLoading } = useAdminSWR(["agent", id], () => getAgent(id));
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("agents.editTitle", { name: data?.name ?? id })}
        description={<Link href={`/dashboard/agents/${encodeURIComponent(id)}?source=gateway`} className="text-blue-400 hover:underline">{t("agents.backOne")}</Link>}
      />
      {error ? (
        <Card className="p-8 text-center text-sm text-rose-300">{error instanceof Error ? error.message : t("agents.loadOneFailed")}</Card>
      ) : isLoading || !data ? (
        <Card className="p-8 text-center text-sm text-slate-400">{t("common.loading")}</Card>
      ) : (
        <AgentForm initial={data} />
      )}
    </div>
  );
}
