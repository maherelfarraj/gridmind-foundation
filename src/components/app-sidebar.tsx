import { useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCurrentUserRoles } from "@/lib/user-roles.functions";
import { listModuleAccess } from "@/lib/modules.functions";
import { useActiveCompany } from "@/components/company-switcher";

import {
  Atom,
  Building2,
  CalendarRange,
  ClipboardCheck,
  HardHat,
  Handshake,
  MailPlus,
  PencilRuler,
  Shield,
  SlidersHorizontal,
  Truck,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";



import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DEV_SESSION_CONTEXT,
  getVisibleModules,
  type ModuleKey,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";

interface NavItem {
  moduleKey: ModuleKey;
  label: string;
  url: string;
  icon: LucideIcon;
  requiresSuperAdmin?: boolean;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Lifecycle",
    items: [
      { moduleKey: "crm", label: "Develop & Sell (CRM)", url: "/crm", icon: Handshake },
      { moduleKey: "engineering", label: "Engineering", url: "/engineering", icon: PencilRuler },
      { moduleKey: "procurement", label: "Procurement", url: "/procurement", icon: Truck },
      { moduleKey: "planning_budget", label: "Planning & Budget", url: "/planning", icon: CalendarRange },
      { moduleKey: "field_qaqc", label: "Field, HSE & QA/QC", url: "/field", icon: HardHat },
      {
        moduleKey: "commissioning",
        label: "Commission & Turnover",
        url: "/commissioning",
        icon: ClipboardCheck,
      },
      { moduleKey: "om_scada", label: "O&M & SCADA", url: "/om", icon: Wrench },
      { moduleKey: "portals", label: "Client & Investor Portals", url: "/partners", icon: Users },
      { moduleKey: "green_hydrogen", label: "Green H₂", url: "/green-h2", icon: Atom },
    ],
  },
  {
    label: "Administration",
    items: [
      { moduleKey: "admin", label: "Users", url: "/settings/users", icon: MailPlus },
      { moduleKey: "admin", label: "Departments", url: "/settings/departments", icon: Building2 },
      { moduleKey: "admin", label: "Module access", url: "/settings/modules", icon: SlidersHorizontal },
      {
        moduleKey: "admin",
        label: "Tenants",
        url: "/admin/tenants",
        icon: Shield,
        requiresSuperAdmin: true,
      },
    ],
  },
];



export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const visibleModules = getVisibleModules(
    DEV_SESSION_CONTEXT.role,
    DEV_SESSION_CONTEXT.planTier,
  );

  const rolesFn = useServerFn(getCurrentUserRoles);
  const rolesQuery = useQuery({
    queryKey: ["me", "roles"],
    queryFn: () => rolesFn(),
    staleTime: 60_000,
  });
  const isSuperAdmin = (rolesQuery.data ?? []).some((r) => r.role === "super_admin");

  const { activeCompanyId } = useActiveCompany();
  const modulesFn = useServerFn(listModuleAccess);
  const modulesQuery = useQuery({
    queryKey: ["modules", activeCompanyId],
    queryFn: () => modulesFn({ data: { companyId: activeCompanyId } }),
    enabled: Boolean(activeCompanyId),
    staleTime: 30_000,
  });
  // Runtime source of truth: module_access_rules. Fall back to the plan-based
  // permissions map only while the query is loading or errored so nav isn't
  // blank on first paint.
  const enabledModuleKeys: Set<string> | null = modulesQuery.data
    ? new Set(
        modulesQuery.data.modules
          .filter((m) => m.enabled)
          .map((m) => m.key),
      )
    : null;

  const isActive = (url: string) =>
    pathname === url || pathname.startsWith(`${url}/`);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div
          className={cn(
            "flex h-12 items-center gap-2 px-2",
            collapsed && "justify-center px-0",
          )}
        >
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <span className="font-display text-sm font-bold">G</span>
          </div>
          {!collapsed && (
            <span className="truncate font-display text-base font-bold tracking-tight text-sidebar-foreground">
              GridMind EPC
            </span>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter((item) => {
            if (item.requiresSuperAdmin && !isSuperAdmin) return false;
            if (item.moduleKey === "admin") return visibleModules.has("admin");
            // Prefer rule-driven visibility; fall back to plan-based map.
            if (enabledModuleKeys) return enabledModuleKeys.has(item.moduleKey);
            return visibleModules.has(item.moduleKey);
          });
          if (items.length === 0) return null;


          return (
            <SidebarGroup key={section.label}>
              <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => {
                    const active = isActive(item.url);
                    const Icon = item.icon;
                    return (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          tooltip={item.label}
                        >
                          {/* TODO: swap to <Link to="..."> once each leaf route lands (Batches 08+). */}
                          <a href={item.url} className="flex items-center gap-2">
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="truncate">{item.label}</span>
                          </a>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
