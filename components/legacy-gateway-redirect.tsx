"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "./current-user-context";
import { useI18n } from "./i18n-provider";
import { Card } from "./ui/card";

export function LegacyGatewayRedirect({ target, suffix = "" }: {
  target: "virtual-keys" | "runtime" | "observability" | "agents";
  suffix?: string;
}) {
  const router = useRouter();
  const { user, activeGatewayId, loading } = useCurrentUser();
  const { t } = useI18n();
  useEffect(() => {
    if (!loading && user?.is_platform_admin && activeGatewayId) {
      router.replace(
        `/dashboard/platform/gateways/${encodeURIComponent(activeGatewayId)}/${target}${suffix}`,
      );
    }
  }, [activeGatewayId, loading, router, suffix, target, user?.is_platform_admin]);
  if (loading) return <Card className="p-8 text-center text-sm text-slate-400">{t("common.loading")}</Card>;
  if (!user?.is_platform_admin) {
    return <Card className="p-8 text-center text-sm text-amber-200">{t("legacyGateway.retired")}</Card>;
  }
  if (!activeGatewayId) {
    return <Card className="p-8 text-center text-sm text-amber-200">{t("gateway.none")}</Card>;
  }
  return <Card className="p-8 text-center text-sm text-slate-400">{t("legacyGateway.redirecting")}</Card>;
}
