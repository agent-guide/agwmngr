"use client";

import { useState } from "react";
import { DashboardHeader } from "@/components/dashboard-header";
import { UserPanel } from "@/components/user-panel";
import { PermissionBanner } from "@/components/permission-banner";
import { getUsername } from "@/lib/auth";
import { useCurrentUser } from "@/components/current-user-context";
import { useI18n } from "@/components/i18n-provider";
import { usePathname } from "next/navigation";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [username] = useState(() => getUsername() || "admin");
  const { user, loading, activeGateway } = useCurrentUser();
  const { t } = useI18n();
  const pathname = usePathname();
  const hasGatewayContentAccess =
    user?.is_platform_admin || activeGateway?.role === "admin";
  const ownsAccessDecision =
    pathname.startsWith("/dashboard/tenant/") ||
    pathname.startsWith("/dashboard/platform/") ||
    pathname.startsWith("/dashboard/resources/");

  return (
    <>
      <DashboardHeader
        username={username}
        isAdmin={Boolean(user?.is_platform_admin)}
        onUserClick={() => setPanelOpen(true)}
      />
      {loading ? (
        <div className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-8 text-center text-sm text-slate-400">
          {t("common.loadingAccess")}
        </div>
      ) : hasGatewayContentAccess || ownsAccessDecision ? (
        <>
          {hasGatewayContentAccess && <PermissionBanner />}
          {children}
        </>
      ) : (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-8 text-center">
          <h2 className="text-base font-semibold text-amber-200">{t("access.noGatewayTitle")}</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-400">
            {t("access.noGatewayBody")}
          </p>
        </div>
      )}
      <UserPanel
        isOpen={panelOpen}
        onClose={() => setPanelOpen(false)}
        username={username}
        isAdmin={Boolean(user?.is_platform_admin)}
      />
    </>
  );
}
