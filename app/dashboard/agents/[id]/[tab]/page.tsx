"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import { PlatformAgentWorkspace } from "@/components/platform-agent-workspace";
import { platformAgentTab, platformAgentTenantId } from "@/lib/platform-agent-ui";

export default function AgentWorkspacePage({
  params,
}: {
  params: Promise<{ id: string; tab: string }>;
}) {
  const { id, tab: rawTab } = use(params);
  const tenantId = platformAgentTenantId(id);
  const tab = platformAgentTab(rawTab);
  if (!tenantId || !tab) notFound();
  return <PlatformAgentWorkspace tenantId={tenantId} id={id} tab={tab} />;
}
