"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useEffect, useState, type ComponentType } from "react";
import { cn } from "@/lib/utils";
import { useMobileSidebar } from "@/components/mobile-sidebar-context";
import { useCurrentUser } from "@/components/current-user-context";

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
function IconUsers({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
}
function IconShield({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>;
}
function IconChevron({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>;
}

type NavItem = { href: string; label: string; icon: ComponentType<{ className?: string }> };
type SubGroup = { key: string; label: string; items: NavItem[] };
type NavGroup = {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  adminOnly?: boolean;
  items?: NavItem[];
  subgroups?: SubGroup[];
};

// The WORKSPACE zone is the agent-centric focus: the agent itself plus the
// day-to-day views for working with it. It stays always-visible at the top.
const WORKSPACE_ITEMS: NavItem[] = [
  { href: "/dashboard/general/overview", label: "Overview", icon: IconHome },
  { href: "/dashboard/agents", label: "Agents", icon: IconAgent },
  { href: "/dashboard/agents/routes", label: "Agent Routes", icon: IconRoute },
  { href: "/dashboard/agents/interactions", label: "Interactions", icon: IconActivity },
  { href: "/dashboard/agents/usage", label: "Usage", icon: IconBarChart },
  { href: "/dashboard/general/virtual-keys", label: "Virtual Keys", icon: IconKey },
];

// Everything below is the shared infrastructure that backs agents. It is
// collapsed into disclosure groups so it no longer competes with the agent
// zone for the eye. LLM / MCP / Runtimes live inside one "Resources" group.
const NAV_GROUPS: NavGroup[] = [
  {
    key: "resources",
    label: "Resources",
    icon: IconLayers,
    subgroups: [
      {
        key: "llm",
        label: "LLM",
        items: [
          { href: "/dashboard/llm/providers", label: "Providers", icon: IconLayers },
          { href: "/dashboard/llm/models", label: "Models", icon: IconBrain },
          { href: "/dashboard/llm/credentials", label: "Credentials", icon: IconCredential },
          { href: "/dashboard/llm/routes", label: "Routes", icon: IconRoute },
        ],
      },
      {
        key: "mcp",
        label: "MCP",
        items: [
          { href: "/dashboard/mcp/services", label: "Services", icon: IconPlug },
          { href: "/dashboard/mcp/routes", label: "Routes", icon: IconRoute },
        ],
      },
      {
        key: "runtimes",
        label: "Runtimes",
        items: [
          { href: "/dashboard/acp/runtime", label: "ACP Runtime", icon: IconBot },
          { href: "/dashboard/agents/runtimes/builtin", label: "Builtin Runtime", icon: IconBrain },
        ],
      },
    ],
  },
  {
    key: "configuration",
    label: "Configuration",
    icon: IconServer,
    items: [
      { href: "/dashboard/configuration/cliauth", label: "CLI Authenticators", icon: IconGateway },
      { href: "/dashboard/configuration/servers", label: "Servers", icon: IconServer },
    ],
  },
  {
    key: "platform",
    label: "Platform",
    icon: IconShield,
    adminOnly: true,
    items: [
      { href: "/dashboard/platform/users", label: "Users", icon: IconUsers },
      { href: "/dashboard/platform/gateways", label: "Gateways", icon: IconGateway },
      { href: "/dashboard/platform/audit", label: "Audit Log", icon: IconActivity },
    ],
  },
];

function groupItems(group: NavGroup): NavItem[] {
  return group.items ?? group.subgroups?.flatMap((sg) => sg.items) ?? [];
}

const STORAGE_KEY = "dashboard.nav.groups";

/**
 * Resolve which single item href is active for a pathname by longest-prefix
 * match, so `/dashboard/agents/interactions` highlights Interactions (not the
 * shorter Agents) and `/dashboard/agents/new` still highlights Agents.
 */
function resolveActiveHref(pathname: string, allHrefs: string[]): string | null {
  let best: string | null = null;
  for (const href of allHrefs) {
    if (pathname === href || pathname.startsWith(href + "/")) {
      if (!best || href.length > best.length) best = href;
    }
  }
  return best;
}

export function DashboardNav() {
  const pathname = usePathname();
  const { isOpen, isCollapsed, toggleCollapsed, close } = useMobileSidebar();
  const { user } = useCurrentUser();

  const groups = NAV_GROUPS.filter((g) => !g.adminOnly || user?.is_platform_admin);

  const allHrefs = [
    ...WORKSPACE_ITEMS.map((i) => i.href),
    ...groups.flatMap((g) => groupItems(g).map((i) => i.href)),
  ];
  const activeHref = resolveActiveHref(pathname, allHrefs);

  // Disclosure state per group, persisted; default collapsed.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    } catch {
      return {};
    }
  });

  // Effective openness is derived, not synced via an effect: until the user
  // explicitly toggles a group, it defaults to open iff it owns the active
  // route (so the current page is never hidden). Once toggled, the stored
  // boolean wins — an explicit user choice persists across navigation.
  const isGroupOpen = (key: string, hasActive: boolean) => openGroups[key] ?? hasActive;

  const toggleGroup = (key: string, currentlyOpen: boolean) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [key]: !currentlyOpen };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    if (isOpen) {
      window.addEventListener("keydown", handleEscape);
      return () => window.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen, close]);

  const renderLink = (item: NavItem) => {
    const isActive = item.href === activeHref;
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
  };

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden" onClick={close} aria-hidden="true" />
      )}
      <nav className={cn(
        "w-56 glass-nav p-4 flex flex-col lg:transition-[width] lg:duration-200",
        isCollapsed ? "lg:w-[4.5rem]" : "lg:w-56",
        "lg:block fixed lg:static inset-y-0 left-0 z-50 overflow-y-auto",
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

        {isCollapsed ? (
          /* Narrow rail: flatten everything to an icon list; the accordion is
             not usable at this width. */
          <ul className="space-y-1 lg:block">
            {WORKSPACE_ITEMS.map(renderLink)}
            <li className="my-2 border-t border-slate-700/50" aria-hidden="true" />
            {groups.flatMap((g) => groupItems(g)).map(renderLink)}
          </ul>
        ) : (
          <div className="space-y-4">
            {/* WORKSPACE — always visible, the agent-centric focus */}
            <ul className="space-y-1">
              {WORKSPACE_ITEMS.map(renderLink)}
            </ul>

            {/* Collapsible infrastructure groups */}
            <ul className="space-y-1">
              {groups.map((group) => {
                const GroupIcon = group.icon;
                const hasActive = groupItems(group).some((i) => i.href === activeHref);
                const groupOpen = isGroupOpen(group.key, hasActive);
                return (
                  <li key={group.key}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.key, groupOpen)}
                      aria-expanded={groupOpen}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200",
                        "glass-nav-item text-slate-300 hover:text-slate-100",
                        hasActive && !groupOpen && "text-slate-100"
                      )}
                    >
                      <GroupIcon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 text-left">{group.label}</span>
                      {hasActive && !groupOpen && <span className="h-1.5 w-1.5 rounded-full bg-blue-400" aria-hidden="true" />}
                      <IconChevron className={cn("h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform duration-200", groupOpen && "rotate-90")} />
                    </button>

                    {groupOpen && (
                      <div className="mt-1 space-y-2 pl-3">
                        {group.subgroups
                          ? group.subgroups.map((sg) => (
                              <div key={sg.key} className="space-y-1">
                                <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{sg.label}</p>
                                <ul className="space-y-1 border-l border-slate-700/50 pl-1.5">
                                  {sg.items.map(renderLink)}
                                </ul>
                              </div>
                            ))
                          : (
                            <ul className="space-y-1 border-l border-slate-700/50 pl-1.5">
                              {(group.items ?? []).map(renderLink)}
                            </ul>
                          )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </nav>
    </>
  );
}
