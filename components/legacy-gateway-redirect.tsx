"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "./current-user-context";
import { useI18n } from "./i18n-provider";
import { Card } from "./ui/card";

export function LegacyGatewayRedirect({ target, suffix = "", explicitGatewayId }: {
  target: "virtual-keys" | "runtime" | "observability" | "agents" |
    "providers" | "models" | "llm-routes" | "mcp-services" | "mcp-routes" | "credentials";
  suffix?: string;
  /** null means the legacy URL required path scope but did not provide it. */
  explicitGatewayId?: string | null;
}) {
  const router = useRouter();
  const { user, activeGatewayId, loading } = useCurrentUser();
  const { t } = useI18n();
  const gatewayId = explicitGatewayId === undefined ? activeGatewayId : explicitGatewayId;
  useEffect(() => {
    if (!loading && user?.is_platform_admin && gatewayId) {
      router.replace(
        `/dashboard/platform/gateways/${encodeURIComponent(gatewayId)}/${target}${suffix}`,
      );
    }
  }, [gatewayId, loading, router, suffix, target, user?.is_platform_admin]);
  if (loading) return <Card className="p-8 text-center text-sm text-slate-400">{t("common.loading")}</Card>;
  if (!user?.is_platform_admin) {
    return <Card className="p-8 text-center text-sm text-amber-200">{t("legacyGateway.retired")}</Card>;
  }
  if (!gatewayId) {
    return <Card className="p-8 text-center text-sm text-amber-200">
      {explicitGatewayId === null ? t("legacyGateway.explicitGatewayRequired") : t("gateway.none")}
    </Card>;
  }
  return <Card className="p-8 text-center text-sm text-slate-400">{t("legacyGateway.redirecting")}</Card>;
}
