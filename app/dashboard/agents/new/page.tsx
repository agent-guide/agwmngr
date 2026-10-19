"use client";

import Link from "next/link";
import { AgentForm } from "@/components/agent-form";
import { PageHeader } from "@/components/ui/page-header";
import { useI18n } from "@/components/i18n-provider";

export default function NewAgentPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("agents.newTitle")}
        description={<Link href="/dashboard/agents" className="text-blue-400 hover:underline">{t("agents.back")}</Link>}
      />
      <AgentForm wizard />
    </div>
  );
}
