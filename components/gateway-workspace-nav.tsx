"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "./i18n-provider";
import type { MessageKey } from "@/lib/i18n";

const items: Array<{ suffix: string; label: MessageKey }> = [
  { suffix: "agents", label: "nav.agents" },
  { suffix: "providers", label: "nav.providers" },
  { suffix: "models", label: "nav.models" },
  { suffix: "llm-routes", label: "gatewayWorkspace.llmRoutes" },
  { suffix: "credentials", label: "nav.credentials" },
  { suffix: "mcp-services", label: "gatewayWorkspace.mcpServices" },
  { suffix: "mcp-routes", label: "gatewayWorkspace.mcpRoutes" },
  { suffix: "virtual-keys", label: "nav.virtualKeys" },
  { suffix: "observability", label: "nav.observability" },
  { suffix: "runtime", label: "nav.runtimes" },
];

export function GatewayWorkspaceNav({ gatewayId }: { gatewayId: string }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const base = `/dashboard/platform/gateways/${encodeURIComponent(gatewayId)}`;
  return <div className="mb-4 space-y-2">
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
      <Link href="/dashboard/platform/gateways" className="text-blue-400 hover:underline">{t("nav.gateways")}</Link>
      <span>/</span><span className="font-mono text-slate-300">{gatewayId}</span>
    </div>
    <nav aria-label={t("gatewayWorkspace.navigation")} className="flex gap-1 overflow-x-auto border-b border-slate-700/70">
      {items.map((item) => {
        const href = `${base}/${item.suffix}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return <Link key={item.suffix} href={href} className={`whitespace-nowrap px-2.5 py-2 text-xs ${active ? "border-b-2 border-blue-400 text-blue-200" : "text-slate-400 hover:text-slate-200"}`}>{t(item.label)}</Link>;
      })}
    </nav>
  </div>;
}
