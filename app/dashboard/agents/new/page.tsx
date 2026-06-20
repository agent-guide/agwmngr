"use client";

import Link from "next/link";
import { AgentForm } from "@/components/agent-form";
import { PageHeader } from "@/components/ui/page-header";

export default function NewAgentPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="New Agent"
        description={<Link href="/dashboard/agents" className="text-blue-400 hover:underline">← Back to agents</Link>}
      />
      <AgentForm />
    </div>
  );
}
