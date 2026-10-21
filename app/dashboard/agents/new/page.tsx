"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PlatformAgentForm } from "@/components/platform-agent-form";
import { LegacyGatewayRedirect } from "@/components/legacy-gateway-redirect";
import { PageHeader } from "@/components/ui/page-header";
import { useI18n } from "@/components/i18n-provider";

export default function NewAgentPage() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const gatewayMode = searchParams.get("mode") === "gateway";
  if (gatewayMode) return <LegacyGatewayRedirect target="agents" suffix="/new" />;
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("agents.newTitle")}
        description={<Link href="/dashboard/agents" className="text-blue-400 hover:underline">{t("agents.back")}</Link>}
      />
      <PlatformAgentForm />
    </div>
  );
}
