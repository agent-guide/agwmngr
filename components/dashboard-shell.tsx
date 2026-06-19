"use client";

import { useState } from "react";
import { DashboardHeader } from "@/components/dashboard-header";
import { UserPanel } from "@/components/user-panel";
import { getUsername } from "@/lib/auth";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [username] = useState(() => getUsername() || "admin");

  return (
    <>
      <DashboardHeader
        username={username}
        isAdmin={true}
        onUserClick={() => setPanelOpen(true)}
      />
      {children}
      <UserPanel
        isOpen={panelOpen}
        onClose={() => setPanelOpen(false)}
        username={username}
        isAdmin={true}
      />
    </>
  );
}
