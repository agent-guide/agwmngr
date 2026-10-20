"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AgentForm } from "@/components/agent-form";
import { PlatformAgentForm } from "@/components/platform-agent-form";
import { PageHeader } from "@/components/ui/page-header";
import { useI18n } from "@/components/i18n-provider";

export default function NewAgentPage() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const gatewayMode = searchParams.get("mode") === "gateway";
  return (
    <div className="space-y-4">
      <PageHeader
        title={gatewayMode ? t("platformAgents.gatewayCreate") : t("agents.newTitle")}
        description={<Link href="/dashboard/agents" className="text-blue-400 hover:underline">{t("agents.back")}</Link>}
      />
      {gatewayMode ? <AgentForm wizard /> : <PlatformAgentForm />}
    </div>
  );
}
