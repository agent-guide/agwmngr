import { redirect } from "next/navigation";

export default async function LegacyTenantObservabilityPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  redirect(`/dashboard/observability/overview?tenant=${encodeURIComponent(tenantId)}`);
}
