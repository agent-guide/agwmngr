"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { GatewayCredentialsPage, type GatewayCredentialsAdapter } from "@/components/gateway-credentials-page";
import { useCurrentUser } from "@/components/current-user-context";
import { useI18n } from "@/components/i18n-provider";
import {
  createPlatformGatewayCredential,
  deletePlatformGatewayCredential,
  listPlatformGatewayCredentials,
  listPlatformGatewayProviders,
  updatePlatformGatewayCredential,
} from "@/lib/api";

export default function PlatformGatewayCredentialsPage() {
  const { gatewayId } = useParams<{ gatewayId: string }>();
  const { user, gateways } = useCurrentUser();
  const { t } = useI18n();
  const gateway = gateways.find((item) => item.id === gatewayId);
  const api = useMemo<GatewayCredentialsAdapter>(() => ({
    listCredentials: () => listPlatformGatewayCredentials(gatewayId),
    listProviders: () => listPlatformGatewayProviders(gatewayId),
    createCredential: (payload) => createPlatformGatewayCredential(gatewayId, payload),
    updateCredential: (id, payload) => updatePlatformGatewayCredential(gatewayId, id, payload),
    deleteCredential: (id) => deletePlatformGatewayCredential(gatewayId, id),
  }), [gatewayId]);

  if (user && !user.is_platform_admin) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-8 text-center">
        <h1 className="text-base font-semibold text-amber-200">{t("gatewayCredentials.adminRequired")}</h1>
        <p className="mt-2 text-sm text-slate-400">
          {t("gatewayCredentials.adminRequiredBody")}
        </p>
      </div>
    );
  }

  return (
    <GatewayCredentialsPage
      key={gatewayId}
      api={api}
      scope={{ gatewayId, gatewayName: gateway?.name }}
    />
  );
}
