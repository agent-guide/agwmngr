"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { listGateways, type ManagerGateway } from "@/lib/api";
import {
  listPlatformTenantMembers,
  listPlatformTenants,
  listTenantGatewayGrants,
  revokeTenantGatewayGrant,
  setTenantGatewayGrant,
  type Tenant,
  type TenantGatewayAccess,
  type TenantGatewayGrant,
  type TenantMember,
} from "@/lib/platform-api";
import { useCurrentUser } from "@/components/current-user-context";
import { useI18n } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { loadFailureFrom, type LoadFailure } from "@/lib/ui-load-error";

interface TenantAdminOption {
  tenant: Tenant;
  member: TenantMember;
}

export default function GatewayAccessPage() {
  const { user } = useCurrentUser();
  const { t } = useI18n();
  const { showToast } = useToast();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [gateways, setGateways] = useState<ManagerGateway[]>([]);
  const [admins, setAdmins] = useState<TenantAdminOption[]>([]);
  const [grants, setGrants] = useState<TenantGatewayGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<LoadFailure | null>(null);
  const [tenantId, setTenantId] = useState("");
  const [principalId, setPrincipalId] = useState("");
  const [gatewayId, setGatewayId] = useState("");
  const [access, setAccess] = useState<TenantGatewayAccess>("view");
  const [saving, setSaving] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<TenantGatewayGrant | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailure(null);
    try {
      const [tenantItems, gatewayItems, grantItems] = await Promise.all([
        listPlatformTenants(),
        listGateways(),
        listTenantGatewayGrants(),
      ]);
      const activeTenants = tenantItems.filter((tenant) => tenant.status === "active");
      const membershipGroups = await Promise.all(
        activeTenants.map(async (tenant) => ({
          tenant,
          members: await listPlatformTenantMembers(tenant.id),
        })),
      );
      const adminItems = membershipGroups.flatMap(({ tenant, members }) =>
        members
          .filter((member) => member.role === "admin" && member.principal.status === "active")
          .map((member) => ({ tenant, member }))
      );
      const activeGateways = gatewayItems.filter((gateway) => gateway.status === "active");
      setTenants(activeTenants);
      setGateways(activeGateways);
      setAdmins(adminItems);
      setGrants(grantItems);
      const initialTenant = activeTenants[0]?.id ?? "";
      const tenantAdmins = adminItems.filter((item) => item.tenant.id === initialTenant);
      setTenantId(initialTenant);
      setPrincipalId(tenantAdmins[0]?.member.principalId ?? "");
      setGatewayId(activeGateways[0]?.id ?? "");
    } catch (error) {
      setLoadFailure(loadFailureFrom(error, t("gatewayAccess.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!user?.is_platform_admin) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, user?.is_platform_admin]);

  const selectedTenantAdmins = useMemo(
    () => admins.filter((item) => item.tenant.id === tenantId),
    [admins, tenantId],
  );

  const chooseTenant = (nextTenantId: string) => {
    setTenantId(nextTenantId);
    setPrincipalId(
      admins.find((item) => item.tenant.id === nextTenantId)?.member.principalId ?? "",
    );
  };

  const save = async () => {
    if (!tenantId || !principalId || !gatewayId) {
      showToast(t("gatewayAccess.selectionRequired"), "error");
      return;
    }
    setSaving(true);
    try {
      const saved = await setTenantGatewayGrant({ principalId, tenantId, gatewayId, access });
      setGrants((items) => [
        ...items.filter((item) => !(
          item.principalId === saved.principalId &&
          item.tenantId === saved.tenantId &&
          item.gatewayId === saved.gatewayId
        )),
        saved,
      ].sort((a, b) => `${a.tenantId}:${a.gatewayId}:${a.principalId}`.localeCompare(
        `${b.tenantId}:${b.gatewayId}:${b.principalId}`,
      )));
      showToast(t("gatewayAccess.saved"), "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("gatewayAccess.saveFailed"), "error");
    } finally {
      setSaving(false);
    }
  };

  const revoke = async () => {
    if (!pendingRevoke) return;
    const target = pendingRevoke;
    try {
      await revokeTenantGatewayGrant(target);
      setGrants((items) => items.filter((item) => !(
        item.principalId === target.principalId &&
        item.tenantId === target.tenantId &&
        item.gatewayId === target.gatewayId
      )));
      showToast(t("gatewayAccess.revoked"), "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("gatewayAccess.revokeFailed"), "error");
    } finally {
      setPendingRevoke(null);
    }
  };

  const tenantLabel = (id: string) => tenants.find((tenant) => tenant.id === id)?.name ?? id;
  const principalLabel = (grant: TenantGatewayGrant) =>
    admins.find((item) =>
      item.tenant.id === grant.tenantId && item.member.principalId === grant.principalId
    )?.member.principal.label ?? grant.principalId;
  const gatewayLabel = (id: string) => gateways.find((gateway) => gateway.id === id)?.name ?? id;

  if (user && !user.is_platform_admin) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-8 text-center text-sm text-amber-200">
        {t("gatewayAccess.adminRequired")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t("gatewayAccess.scope")}</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-100">{t("gatewayAccess.title")}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {t("gatewayAccess.description")}
        </p>
      </section>

      <section className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_150px_auto]">
          <Select
            name="grant-tenant"
            value={tenantId}
            onChange={chooseTenant}
            options={[{ value: "", label: t("gatewayAccess.selectTenant") }, ...tenants.map((tenant) => ({ value: tenant.id, label: `${tenant.name} · ${tenant.id}` }))]}
            disabled={loading || loadFailure !== null}
            className="w-full"
          />
          <Select
            name="grant-principal"
            value={principalId}
            onChange={setPrincipalId}
            options={[{ value: "", label: t(selectedTenantAdmins.length ? "gatewayAccess.selectAdmin" : "gatewayAccess.noAdmins") }, ...selectedTenantAdmins.map((item) => ({ value: item.member.principalId, label: `${item.member.principal.label} · ${t(item.member.principal.kind === "human" ? "tenantMembers.human" : "tenantMembers.service")}` }))]}
            disabled={!tenantId || loading || loadFailure !== null}
            className="w-full"
          />
          <Select
            name="grant-gateway"
            value={gatewayId}
            onChange={setGatewayId}
            options={[{ value: "", label: t(gateways.length ? "gatewayAccess.selectGateway" : "gatewayAccess.noGateways") }, ...gateways.map((gateway) => ({ value: gateway.id, label: `${gateway.name} · ${gateway.id}` }))]}
            disabled={loading || loadFailure !== null}
            className="w-full"
          />
          <Select
            name="grant-access"
            value={access}
            onChange={(value) => setAccess(value as TenantGatewayAccess)}
            options={[{ value: "view", label: t("gatewayAccess.view") }, { value: "manage", label: t("gatewayAccess.manage") }]}
            disabled={loading || loadFailure !== null}
            className="w-full"
          />
          <Button onClick={() => void save()} disabled={saving || loading || loadFailure !== null || !tenantId || !principalId || !gatewayId}>
            {saving ? t("common.saving") : t("gatewayAccess.assign")}
          </Button>
        </div>
      </section>

      <section className="overflow-x-auto rounded-lg border border-slate-700/70 bg-slate-900/40">
        <div className="grid min-w-[760px] grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_110px_100px] border-b border-slate-700/70 bg-slate-900/95 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          <span>Tenant</span><span>{t("tenantMembers.admin")}</span><span>Gateway</span><span>{t("gatewayAccess.access")}</span><span>{t("gatewayAccess.action")}</span>
        </div>
        {loading ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">{t("common.loading")}</div>
        ) : loadFailure ? (
          <div className={loadFailure.kind === "forbidden" ? "px-3 py-8 text-center text-xs text-amber-300" : "px-3 py-8 text-center text-xs text-rose-300"} role="alert">
            <p>{loadFailure.message}</p>
            <Button variant="ghost" onClick={() => void load()} className="mt-3 px-3 py-1 text-xs">{t("common.retry")}</Button>
          </div>
        ) : grants.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">{t("gatewayAccess.empty")}</div>
        ) : grants.map((grant) => (
          <div key={`${grant.principalId}:${grant.tenantId}:${grant.gatewayId}`} className="grid min-w-[760px] grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_110px_100px] items-center border-b border-slate-700/60 px-3 py-2 last:border-b-0">
            <div className="min-w-0"><p className="truncate text-xs text-slate-100">{tenantLabel(grant.tenantId)}</p><p className="font-mono text-[10px] text-slate-500">{grant.tenantId}</p></div>
            <div className="min-w-0"><p className="truncate text-xs text-slate-100">{principalLabel(grant)}</p><p className="truncate font-mono text-[10px] text-slate-500">{grant.principalId}</p></div>
            <div className="min-w-0"><p className="truncate text-xs text-slate-100">{gatewayLabel(grant.gatewayId)}</p><p className="font-mono text-[10px] text-slate-500">{grant.gatewayId}</p></div>
            <span><Badge tone={grant.access === "manage" ? "violet" : "blue"}>tenant_gateway:{grant.access}</Badge></span>
            <Button variant="danger" onClick={() => setPendingRevoke(grant)} className="w-fit px-2 py-1 text-xs">{t("gatewayAccess.revoke")}</Button>
          </div>
        ))}
      </section>

      <ConfirmDialog
        isOpen={pendingRevoke !== null}
        onClose={() => setPendingRevoke(null)}
        onConfirm={() => void revoke()}
        title={t("gatewayAccess.revokeTitle")}
        message={pendingRevoke ? t("gatewayAccess.revokeMessage", {
          access: t(pendingRevoke.access === "manage" ? "gatewayAccess.manage" : "gatewayAccess.view"),
          principal: principalLabel(pendingRevoke),
          gateway: gatewayLabel(pendingRevoke.gatewayId),
        }) : ""}
        confirmLabel={t("gatewayAccess.revoke")}
        variant="danger"
      />
    </div>
  );
}
