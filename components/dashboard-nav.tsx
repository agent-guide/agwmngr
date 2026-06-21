"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useMobileSidebar } from "@/components/mobile-sidebar-context";

function IconHome({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>;
}
function IconLayers({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>;
}
function IconBarChart({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" /></svg>;
}
function IconKey({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg>;
}
function IconActivity({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>;
}
function IconBrain({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" /><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" /></svg>;
}
function IconCredential({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>;
}
function IconRoute({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M6 17V9a6 6 0 0 1 6-6h1" /><path d="M18 7v8a6 6 0 0 1-6 6H11" /></svg>;
}
function IconServer({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="8" rx="2" ry="2" /><rect x="2" y="14" width="20" height="8" rx="2" ry="2" /><line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" /></svg>;
}
function IconGateway({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>;
}
function IconPlug({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path d="M18 8v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8z" /></svg>;
}
function IconBot({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" /></svg>;
}
function IconAgent({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" /></svg>;
}

const NAV_SECTIONS = [
  { key: "agents", label: "Agents" },
  { key: "llm", label: "LLM" },
  { key: "mcp", label: "MCP" },
  { key: "acp", label: "ACP" },
  { key: "configuration", label: "Configuration" },
] as const;

// Agents is the first-class section: the agent itself plus the day-to-day views
// for working with it (observation + the keys used to call it). LLM / MCP / ACP
// below are the shared infrastructure that backs agents, not sub-items of one agent.
const NAV_ITEMS = [
  { href: "/dashboard/general/overview", label: "Overview", icon: IconHome, section: "agents" },
  { href: "/dashboard/agents", label: "Agents", icon: IconAgent, section: "agents" },
  { href: "/dashboard/agents/interactions", label: "Interactions", icon: IconActivity, section: "agents" },
  { href: "/dashboard/agents/usage", label: "Usage", icon: IconBarChart, section: "agents" },
  { href: "/dashboard/general/virtual-keys", label: "Virtual Keys", icon: IconKey, section: "agents" },
  { href: "/dashboard/llm/providers", label: "Providers", icon: IconLayers, section: "llm" },
  { href: "/dashboard/llm/models", label: "Models", icon: IconBrain, section: "llm" },
  { href: "/dashboard/llm/credentials", label: "Credentials", icon: IconCredential, section: "llm" },
  { href: "/dashboard/llm/routes", label: "Routes", icon: IconRoute, section: "llm" },
  { href: "/dashboard/mcp/services", label: "Services", icon: IconPlug, section: "mcp" },
  { href: "/dashboard/mcp/routes", label: "Routes", icon: IconRoute, section: "mcp" },
  { href: "/dashboard/acp/services", label: "Services", icon: IconBot, section: "acp" },
  { href: "/dashboard/acp/routes", label: "Routes", icon: IconRoute, section: "acp" },
  { href: "/dashboard/acp/runtime", label: "Runtime", icon: IconActivity, section: "acp" },
  { href: "/dashboard/configuration/cliauth", label: "CLI Authenticators", icon: IconGateway, section: "configuration" },
  { href: "/dashboard/configuration/servers", label: "Servers", icon: IconServer, section: "configuration" },
] as const;

export function DashboardNav() {
  const pathname = usePathname();
  const { isOpen, isCollapsed, toggleCollapsed, close } = useMobileSidebar();

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    if (isOpen) {
      window.addEventListener("keydown", handleEscape);
      return () => window.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen, close]);

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden" onClick={close} aria-hidden="true" />
      )}
      <nav className={cn(
        "w-56 glass-nav p-4 flex flex-col lg:transition-[width] lg:duration-200",
        isCollapsed ? "lg:w-[4.5rem]" : "lg:w-56",
        "lg:block fixed lg:static inset-y-0 left-0 z-50",
        "transform transition-transform duration-300 ease-in-out",
        isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}>
        <div className="mb-4">
          <div className={cn("flex", isCollapsed ? "flex-col items-center gap-2" : "items-center justify-between")}>
            <div className={cn("flex items-center gap-3", isCollapsed && "lg:flex-col lg:gap-1")}>
              <div className={cn(
                "flex items-center justify-center rounded-md bg-blue-600 text-white font-bold",
                isCollapsed ? "h-9 w-9 text-sm" : "h-8 w-8 text-xs"
              )}>A</div>
              <div className={cn(isCollapsed && "lg:hidden")}>
                <h1 className="text-base font-semibold tracking-tight text-slate-100">AGW</h1>
                <p className="mt-0.5 text-xs text-slate-400">Manager</p>
              </div>
            </div>
            <button
              type="button"
              onClick={toggleCollapsed}
              className="hidden rounded-md border border-slate-700/70 bg-slate-800/60 p-1.5 text-slate-300 transition-colors hover:bg-slate-700/70 hover:text-slate-100 lg:inline-flex"
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <svg className={cn("h-4 w-4 transition-transform", isCollapsed && "rotate-180")} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M12.707 14.707a1 1 0 01-1.414 0L7.293 10.707a1 1 0 010-1.414l4-4a1 1 0 111.414 1.414L9.414 10l3.293 3.293a1 1 0 010 1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>

        <ul className="space-y-4">
          {NAV_SECTIONS.map((section) => {
            const items = NAV_ITEMS.filter((item) => item.section === section.key);
            if (items.length === 0) return null;
            return (
              <li key={section.key} className="space-y-1.5">
                <p className={cn("px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500", isCollapsed && "lg:hidden")}>
                  {section.label}
                </p>
                <ul className="space-y-1">
                  {items.map((item) => {
                    const isActive = pathname === item.href;
                    const IconComponent = item.icon;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={close}
                          className={cn(
                            "flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-md transition-colors duration-200",
                            isCollapsed && "lg:justify-center lg:px-0",
                            isActive ? "glass-nav-item-active text-slate-100" : "glass-nav-item text-slate-300 hover:text-slate-100"
                          )}
                          title={isCollapsed ? item.label : undefined}
                        >
                          <IconComponent className="h-4 w-4 shrink-0" />
                          <span className={cn(isCollapsed && "lg:hidden")}>{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
