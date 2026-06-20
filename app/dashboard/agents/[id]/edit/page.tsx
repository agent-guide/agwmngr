"use client";

import Link from "next/link";
import { use } from "react";
import { AgentForm } from "@/components/agent-form";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { useAdminSWR } from "@/hooks/use-admin-swr";
import { getAgent } from "@/lib/api";

export default function EditAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, isLoading } = useAdminSWR(["agent", id], () => getAgent(id));

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Edit ${data?.name ?? id}`}
        description={<Link href={`/dashboard/agents/${encodeURIComponent(id)}`} className="text-blue-400 hover:underline">← Back to agent</Link>}
      />
      {error ? (
        <Card className="p-8 text-center text-sm text-rose-300">{error instanceof Error ? error.message : "Failed to load agent"}</Card>
      ) : isLoading || !data ? (
        <Card className="p-8 text-center text-sm text-slate-400">Loading…</Card>
      ) : (
        <AgentForm initial={data} />
      )}
    </div>
  );
}
