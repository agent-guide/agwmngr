"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCurrentUser } from "@/components/current-user-context";
import { useI18n } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { listGateways, type ManagerGateway } from "@/lib/api";
import { loadFailureFrom, type LoadFailure } from "@/lib/ui-load-error";
import {
  approvePlatformCatalogOffering,
  createPlatformCatalogOffering,
  listPlatformCatalogOfferings,
  listPlatformTenants,
  retirePlatformCatalogOffering,
  setPlatformCatalogAvailability,
  type CatalogAvailabilityMode,
  type CatalogOfferingCategory,
  type CatalogOfferingKind,
  type PlatformCatalogOffering,
  type Tenant,
} from "@/lib/platform-api";

interface OfferingForm {
  offeringId: string;
  category: CatalogOfferingCategory;
  name: string;
  description: string;
  kind: CatalogOfferingKind;
  sourceGatewayId: string;
  upstreamStableId: string;
  availabilityMode: CatalogAvailabilityMode;
  tenantIds: string[];
}

const emptyForm: OfferingForm = {
  offeringId: "",
  category: "model",
  name: "",
  description: "",
  kind: "platform-native",
  sourceGatewayId: "",
  upstreamStableId: "",
  availabilityMode: "tenant-allowlist",
  tenantIds: [],
};

function TenantChoices({
  tenants,
  selected,
  onChange,
  disabled,
}: {
  tenants: Tenant[];
  selected: string[];
  onChange: (tenantIds: string[]) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const active = tenants.filter((tenant) => tenant.status === "active");
  if (active.length === 0) {
    return <p className="text-xs text-slate-500">{t("catalog.noActiveTenants")}</p>;
  }
  return (
    <div className="grid gap-2 rounded-md border border-slate-700/70 p-3 sm:grid-cols-2">
      {active.map((tenant) => (
        <label key={tenant.id} className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={selected.includes(tenant.id)}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked
              ? [...selected, tenant.id].sort()
              : selected.filter((id) => id !== tenant.id))}
          />
          <span>{tenant.name}</span>
          <span className="font-mono text-[10px] text-slate-500">{tenant.id}</span>
        </label>
      ))}
    </div>
  );
}

export default function PlatformCatalogPage() {
  const { user } = useCurrentUser();
  const { t } = useI18n();
  const { showToast } = useToast();
  const [offerings, setOfferings] = useState<PlatformCatalogOffering[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [gateways, setGateways] = useState<ManagerGateway[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<LoadFailure | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<OfferingForm>(emptyForm);
  const [availabilityOffering, setAvailabilityOffering] = useState<PlatformCatalogOffering | null>(null);
  const [availabilityMode, setAvailabilityMode] = useState<CatalogAvailabilityMode>("tenant-allowlist");
  const [availabilityTenantIds, setAvailabilityTenantIds] = useState<string[]>([]);
  const [pendingRetire, setPendingRetire] = useState<PlatformCatalogOffering | null>(null);
  const [mutating, setMutating] = useState(false);
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setLoadFailure(null);
    try {
      const [catalogItems, tenantItems, gatewayItems] = await Promise.all([
        listPlatformCatalogOfferings(),
        listPlatformTenants(),
        listGateways(),
      ]);
      if (generation !== loadGeneration.current) return;
      setOfferings(catalogItems);
      setTenants(tenantItems);
      setGateways(gatewayItems);
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      setLoadFailure(loadFailureFrom(error, t("catalog.loadFailed")));
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!user?.is_platform_admin) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      loadGeneration.current += 1;
    };
  }, [load, user?.is_platform_admin]);

  const activeGateways = useMemo(
    () => gateways.filter((gateway) => gateway.status === "active"),
    [gateways],
  );

  const openCreate = () => {
    setForm({ ...emptyForm, tenantIds: [] });
    setCreateOpen(true);
  };

  const create = async () => {
    if (!form.offeringId || !form.name) {
      showToast(t("catalog.idNameRequired"), "error");
      return;
    }
    if (form.kind === "gateway-backed" && (!form.sourceGatewayId || !form.upstreamStableId)) {
      showToast(t("catalog.gatewaySourceRequired"), "error");
      return;
    }
    setMutating(true);
    try {
      await createPlatformCatalogOffering({
        offeringId: form.offeringId,
        category: form.category,
        name: form.name,
        description: form.description,
        kind: form.kind,
        ...(form.kind === "gateway-backed" ? {
          sourceGatewayId: form.sourceGatewayId,
          upstreamStableId: form.upstreamStableId,
        } : {}),
        availability: {
          mode: form.availabilityMode,
          tenantIds: form.availabilityMode === "tenant-allowlist" ? form.tenantIds : [],
        },
      });
      setCreateOpen(false);
      await load();
      showToast(t("catalog.created"), "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("catalog.createFailed"), "error");
    } finally {
      setMutating(false);
    }
  };

  const approve = async (offering: PlatformCatalogOffering) => {
    setMutating(true);
    try {
      await approvePlatformCatalogOffering(offering.offeringId);
      await load();
      showToast(t("catalog.approved"), "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("catalog.approveFailed"), "error");
    } finally {
      setMutating(false);
    }
  };

  const openAvailability = (offering: PlatformCatalogOffering) => {
    setAvailabilityOffering(offering);
    setAvailabilityMode(offering.availability.mode);
    setAvailabilityTenantIds(offering.availability.tenantIds);
  };

  const saveAvailability = async () => {
    if (!availabilityOffering) return;
    setMutating(true);
    try {
      await setPlatformCatalogAvailability(
        availabilityOffering.offeringId,
        availabilityMode,
        availabilityMode === "tenant-allowlist" ? availabilityTenantIds : [],
      );
      setAvailabilityOffering(null);
      await load();
      showToast(t("catalog.availabilitySaved"), "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("catalog.availabilitySaveFailed"), "error");
    } finally {
      setMutating(false);
    }
  };

  const retire = async () => {
    if (!pendingRetire) return;
    setMutating(true);
    try {
      await retirePlatformCatalogOffering(pendingRetire.offeringId);
      setPendingRetire(null);
      await load();
      showToast(t("catalog.retired"), "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("catalog.retireFailed"), "error");
    } finally {
      setMutating(false);
    }
  };

  if (user && !user.is_platform_admin) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-8 text-center text-sm text-amber-200">
        {t("catalog.adminRequired")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-slate-700/70 bg-slate-900/40 p-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t("catalog.scope")}</p>
          <h1 className="mt-1 text-xl font-semibold text-slate-100">{t("catalog.title")}</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            {t("catalog.description")}
          </p>
        </div>
        <Button onClick={openCreate} disabled={loading || loadFailure !== null || mutating}>{t("catalog.create")}</Button>
      </section>

      <section className="overflow-x-auto rounded-lg border border-slate-700/70 bg-slate-900/40">
        <div className="grid min-w-[980px] grid-cols-[minmax(0,1.2fr)_90px_140px_110px_minmax(0,1fr)_230px] border-b border-slate-700/70 bg-slate-900/95 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          <span>{t("catalog.offering")}</span><span>{t("catalog.category")}</span><span>{t("catalog.kind")}</span><span>{t("catalog.status")}</span><span>{t("catalog.availability")}</span><span>{t("common.actions")}</span>
        </div>
        {loading ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">{t("common.loading")}</div>
        ) : loadFailure ? (
          <div className={loadFailure.kind === "forbidden" ? "px-3 py-8 text-center text-xs text-amber-300" : "px-3 py-8 text-center text-xs text-rose-300"} role="alert">
            <p>{loadFailure.message}</p>
            <Button variant="ghost" onClick={() => void load()} className="mt-3 px-3 py-1 text-xs">{t("common.retry")}</Button>
          </div>
        ) : offerings.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">{t("catalog.empty")}</div>
        ) : offerings.map((offering) => (
          <div key={offering.offeringId} className="grid min-w-[980px] grid-cols-[minmax(0,1.2fr)_90px_140px_110px_minmax(0,1fr)_230px] items-center border-b border-slate-700/60 px-3 py-3 last:border-b-0">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-100">{offering.name}</p>
              <p className="truncate font-mono text-[10px] text-slate-500">{offering.offeringId} · v{offering.version} · {offering.digest.slice(0, 12)}</p>
              {offering.kind === "gateway-backed" && (
                <p className={offering.sourceAvailable ? "truncate text-[10px] text-slate-500" : "truncate text-[10px] text-amber-300"}>
                  {offering.sourceGatewayId} / {offering.upstreamStableId}{offering.sourceAvailable ? "" : ` · ${t("catalog.sourceUnavailable")}`}
                </p>
              )}
            </div>
            <Badge tone={offering.category === "model" ? "blue" : "violet"}>{t(offering.category === "model" ? "catalog.model" : "catalog.tool")}</Badge>
            <Badge tone={offering.kind === "gateway-backed" ? "cyan" : "neutral"}>{t(offering.kind === "gateway-backed" ? "catalog.gatewayBacked" : "catalog.platformNative")}</Badge>
            <Badge tone={offering.status === "active" ? "green" : offering.status === "draft" ? "amber" : "red"}>{t(offering.status === "active" ? "catalog.active" : offering.status === "draft" ? "catalog.draft" : "catalog.retiredStatus")}</Badge>
            <p className="truncate text-xs text-slate-400">
              {offering.availability.mode === "all-active-tenants"
                ? t("catalog.allActiveTenants")
                : offering.availability.tenantIds.length
                  ? offering.availability.tenantIds.join(", ")
                  : t("catalog.noTenants")}
            </p>
            <div className="flex flex-wrap gap-2">
              {offering.status === "draft" && (
                <Button className="px-2 py-1 text-xs" disabled={mutating || !offering.sourceAvailable} onClick={() => void approve(offering)}>{t("common.approve")}</Button>
              )}
              {offering.status !== "retired" && (
                <>
                  <Button variant="secondary" className="px-2 py-1 text-xs" disabled={mutating} onClick={() => openAvailability(offering)}>{t("catalog.availability")}</Button>
                  <Button variant="danger" className="px-2 py-1 text-xs" disabled={mutating} onClick={() => setPendingRetire(offering)}>{t("catalog.retire")}</Button>
                </>
              )}
            </div>
          </div>
        ))}
      </section>

      <Modal isOpen={createOpen} onClose={() => { if (!mutating) setCreateOpen(false); }}>
        <ModalHeader><ModalTitle>{t("catalog.createTitle")}</ModalTitle></ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            <div><label className="mb-1.5 block text-sm text-slate-300" htmlFor="offering-id">{t("catalog.stableId")}</label><Input name="offering-id" value={form.offeringId} onChange={(value) => setForm((current) => ({ ...current, offeringId: value }))} placeholder="primary-chat-model" disabled={mutating} /></div>
            <div><label className="mb-1.5 block text-sm text-slate-300" htmlFor="offering-name">{t("common.name")}</label><Input name="offering-name" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} placeholder={t("catalog.namePlaceholder")} disabled={mutating} /></div>
            <div><label className="mb-1.5 block text-sm text-slate-300" htmlFor="offering-description">{t("common.description")}</label><Input name="offering-description" value={form.description} onChange={(value) => setForm((current) => ({ ...current, description: value }))} placeholder={t("catalog.descriptionPlaceholder")} disabled={mutating} /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="mb-1.5 block text-sm text-slate-300">{t("catalog.category")}</label><Select name="offering-category" value={form.category} onChange={(value) => setForm((current) => ({ ...current, category: value as CatalogOfferingCategory }))} options={[{ value: "model", label: t("catalog.model") }, { value: "tool", label: t("catalog.tool") }]} disabled={mutating} className="w-full" /></div>
              <div><label className="mb-1.5 block text-sm text-slate-300">{t("catalog.kind")}</label><Select name="offering-kind" value={form.kind} onChange={(value) => setForm((current) => ({ ...current, kind: value as CatalogOfferingKind, sourceGatewayId: "", upstreamStableId: "" }))} options={[{ value: "platform-native", label: t("catalog.platformNative") }, { value: "gateway-backed", label: t("catalog.gatewayBacked") }]} disabled={mutating} className="w-full" /></div>
            </div>
            {form.kind === "gateway-backed" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="mb-1.5 block text-sm text-slate-300">{t("catalog.sourceGateway")}</label><Select name="offering-source-gateway" value={form.sourceGatewayId} onChange={(value) => setForm((current) => ({ ...current, sourceGatewayId: value }))} options={[{ value: "", label: t(activeGateways.length ? "catalog.selectGateway" : "catalog.noActiveGateways") }, ...activeGateways.map((gateway) => ({ value: gateway.id, label: `${gateway.name} · ${gateway.id}` }))]} disabled={mutating} className="w-full" /></div>
                <div><label className="mb-1.5 block text-sm text-slate-300" htmlFor="offering-upstream-id">{t("catalog.upstreamId")}</label><Input name="offering-upstream-id" value={form.upstreamStableId} onChange={(value) => setForm((current) => ({ ...current, upstreamStableId: value }))} placeholder={form.category === "model" ? "model-route-id" : "mcp:service-id:tool-name"} disabled={mutating} /></div>
              </div>
            )}
            <div><label className="mb-1.5 block text-sm text-slate-300">{t("catalog.tenantAvailability")}</label><Select name="offering-availability" value={form.availabilityMode} onChange={(value) => setForm((current) => ({ ...current, availabilityMode: value as CatalogAvailabilityMode, tenantIds: [] }))} options={[{ value: "tenant-allowlist", label: t("catalog.explicitAllowlist") }, { value: "all-active-tenants", label: t("catalog.allActiveTenants") }]} disabled={mutating} className="w-full" /></div>
            {form.availabilityMode === "tenant-allowlist" && <TenantChoices tenants={tenants} selected={form.tenantIds} onChange={(tenantIds) => setForm((current) => ({ ...current, tenantIds }))} disabled={mutating} />}
          </div>
        </ModalContent>
        <ModalFooter><Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={mutating}>{t("common.cancel")}</Button><Button onClick={() => void create()} disabled={mutating}>{mutating ? t("common.creating") : t("catalog.createDraft")}</Button></ModalFooter>
      </Modal>

      <Modal isOpen={availabilityOffering !== null} onClose={() => { if (!mutating) setAvailabilityOffering(null); }}>
        <ModalHeader><ModalTitle>{t("catalog.tenantAvailability")}</ModalTitle><p className="mt-1 font-mono text-xs text-slate-500">{availabilityOffering?.offeringId}</p></ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            <Select name="catalog-availability-mode" value={availabilityMode} onChange={(value) => { setAvailabilityMode(value as CatalogAvailabilityMode); setAvailabilityTenantIds([]); }} options={[{ value: "tenant-allowlist", label: t("catalog.explicitAllowlist") }, { value: "all-active-tenants", label: t("catalog.allActiveTenants") }]} disabled={mutating} className="w-full" />
            {availabilityMode === "tenant-allowlist" && <TenantChoices tenants={tenants} selected={availabilityTenantIds} onChange={setAvailabilityTenantIds} disabled={mutating} />}
          </div>
        </ModalContent>
        <ModalFooter><Button variant="ghost" onClick={() => setAvailabilityOffering(null)} disabled={mutating}>{t("common.cancel")}</Button><Button onClick={() => void saveAvailability()} disabled={mutating}>{mutating ? t("common.saving") : t("common.save")}</Button></ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={pendingRetire !== null}
        onClose={() => { if (!mutating) setPendingRetire(null); }}
        onConfirm={() => void retire()}
        title={t("catalog.retireTitle")}
        message={pendingRetire ? t("catalog.retireMessage", { name: pendingRetire.name }) : ""}
        confirmLabel={t("catalog.retire")}
        variant="danger"
      />
    </div>
  );
}
