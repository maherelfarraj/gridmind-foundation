import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight } from "lucide-react";

import { getCurrentUserRoles } from "@/lib/user-roles.functions";
import { listModuleAccess } from "@/lib/modules.functions";
import { getMyPendingCount } from "@/lib/approvals.inbox.functions";
import { getSidebarBadgeCounts } from "@/lib/sidebar-badges.functions";
import { useActiveCompany } from "@/components/company-switcher";
import { NAV_GROUPS, type BadgeKey, type NavGroup, type NavItem } from "@/lib/nav-map";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { DEV_SESSION_CONTEXT, getVisibleModules } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "gridmind-sidebar-groups";

function readStoredState(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/** Resolve the `:projectId` placeholder against the active project, if any. */
function resolveUrl(url: string, projectId: string | null): string {
  return projectId ? url.replace(":projectId", projectId) : url;
}

export function AppSidebar() {
  const { state, isMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const visibleModules = getVisibleModules(DEV_SESSION_CONTEXT.role, DEV_SESSION_CONTEXT.planTier);

  const projectId = useMemo(() => {
    const m = pathname.match(/^\/projects\/([0-9a-fA-F-]{36})/);
    return m ? m[1] : null;
  }, [pathname]);

  const rolesFn = useServerFn(getCurrentUserRoles);
  const rolesQuery = useQuery({
    queryKey: ["me", "roles"],
    queryFn: () => rolesFn(),
    staleTime: 60_000,
  });
  const roles = (rolesQuery.data ?? []).map((r) => r.role as string);
  const isSuperAdmin = roles.includes("super_admin");
  const EXTERNAL_VIEWERS = new Set(["client_viewer", "investor_viewer", "lender_viewer"]);
  const isOnlyExternalViewer = roles.length > 0 && roles.every((r) => EXTERNAL_VIEWERS.has(r));

  const pendingFn = useServerFn(getMyPendingCount);
  const pendingQuery = useQuery({
    queryKey: ["approvals", "pending-count"],
    queryFn: () => pendingFn(),
    enabled: !isOnlyExternalViewer,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const pendingCount = pendingQuery.data?.count ?? 0;

  const badgesFn = useServerFn(getSidebarBadgeCounts);
  const badgesQuery = useQuery({
    queryKey: ["sidebar", "badges"],
    queryFn: () => badgesFn(),
    enabled: !isOnlyExternalViewer,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const badgeCounts: Record<BadgeKey, number> = {
    approvals: pendingCount,
    alarms: badgesQuery.data?.criticalAlarms ?? 0,
    punch: badgesQuery.data?.openPunchA ?? 0,
  };

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
    ? new Set(modulesQuery.data.modules.filter((m) => m.enabled).map((m) => m.key))
    : null;

  const isItemVisible = useCallback(
    (item: NavItem) => {
      if (item.projectScoped && !projectId) return false;
      if (item.hideFromExternalViewers && isOnlyExternalViewer) return false;
      if (item.requiresSuperAdmin && !isSuperAdmin) return false;
      if (item.alwaysVisible) return true;
      if (item.moduleKey === "admin") return visibleModules.has("admin");
      if (enabledModuleKeys) return enabledModuleKeys.has(item.moduleKey);
      return visibleModules.has(item.moduleKey);
    },
    [enabledModuleKeys, isOnlyExternalViewer, isSuperAdmin, projectId, visibleModules],
  );

  const isActive = useCallback(
    (url: string) => pathname === url || pathname.startsWith(`${url}/`),
    [pathname],
  );

  const groups = useMemo(
    () =>
      NAV_GROUPS.map((g) => ({
        group: g,
        items: g.items.filter(isItemVisible),
      })).filter((g) => g.items.length > 0),
    [isItemVisible],
  );

  const activeGroupKey = useMemo(() => {
    for (const { group, items } of groups) {
      if (items.some((i) => isActive(resolveUrl(i.url, projectId)))) return group.key;
    }
    return null;
  }, [groups, isActive, projectId]);

  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setOpenMap(readStoredState());
    setHydrated(true);
  }, []);

  const setGroupOpen = (key: string, open: boolean) => {
    setOpenMap((prev) => {
      const next = { ...prev, [key]: open };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable — in-memory only */
      }
      return next;
    });
  };

  const isGroupOpen = (key: string) => {
    if (key === activeGroupKey) return true; // active group can't be collapsed
    if (isMobile) return openMap[key] ?? true; // mobile sheet: expanded by default
    if (!hydrated) return false;
    return openMap[key] ?? false;
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div
          className={cn("flex h-12 items-center gap-2 px-2", collapsed && "justify-center px-0")}
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
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {groups.map(({ group, items }) => {
                if (group.standalone) {
                  return items.map((item) => {
                    const url = resolveUrl(item.url, projectId);
                    const Icon = item.icon;
                    return (
                      <SidebarMenuItem key={`nav:${group.key}:${url}`}>
                        <SidebarMenuButton asChild isActive={isActive(url)} tooltip={item.label}>
                          <a href={url} className="flex items-center gap-2">
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="truncate">{item.label}</span>
                          </a>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  });
                }

                const count = group.badgeKey ? badgeCounts[group.badgeKey] : 0;
                const open = isGroupOpen(group.key);
                const groupActive = group.key === activeGroupKey;

                if (collapsed) {
                  return (
                    <CollapsedGroup
                      key={`nav:${group.key}`}
                      group={group}
                      items={items}
                      count={count}
                      groupActive={groupActive}
                      projectId={projectId}
                      isActive={isActive}
                    />
                  );
                }

                const GroupIcon = group.icon;
                return (
                  <Collapsible
                    key={`nav:${group.key}`}
                    open={open}
                    onOpenChange={(next) => {
                      if (groupActive) return;
                      setGroupOpen(group.key, next);
                    }}
                    className="group/collapsible"
                  >
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton
                          isActive={groupActive}
                          tooltip={group.label}
                          aria-expanded={open}
                          className="focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                        >
                          <GroupIcon className="h-4 w-4 shrink-0" />
                          <span className="truncate">{group.label}</span>
                          {count > 0 && (
                            <Badge
                              variant="secondary"
                              className="ml-auto h-5 min-w-5 justify-center px-1.5 text-xs"
                            >
                              {count > 99 ? "99+" : count}
                            </Badge>
                          )}
                          <ChevronRight
                            aria-hidden="true"
                            className={cn(
                              "h-4 w-4 shrink-0 transition-transform",
                              count > 0 ? "ml-1" : "ml-auto",
                              open && "rotate-90",
                            )}
                          />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {items.map((item) => {
                            const url = resolveUrl(item.url, projectId);
                            const Icon = item.icon;
                            const itemCount =
                              item.url === "/approvals" ? badgeCounts.approvals : 0;
                            return (
                              <SidebarMenuSubItem key={`nav:${group.key}:${url}:${item.label}`}>
                                <SidebarMenuSubButton asChild isActive={isActive(url)}>
                                  <a href={url} className="flex items-center gap-2">
                                    <Icon className="h-4 w-4 shrink-0" />
                                    <span className="truncate">{item.label}</span>
                                    {itemCount > 0 && (
                                      <Badge
                                        variant="secondary"
                                        className="ml-auto h-5 min-w-5 justify-center px-1.5 text-xs"
                                      >
                                        {itemCount > 99 ? "99+" : itemCount}
                                      </Badge>
                                    )}
                                  </a>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            );
                          })}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}

function CollapsedGroup({
  group,
  items,
  count,
  groupActive,
  projectId,
  isActive,
}: {
  group: NavGroup;
  items: NavItem[];
  count: number;
  groupActive: boolean;
  projectId: string | null;
  isActive: (url: string) => boolean;
}) {
  const GroupIcon = group.icon;
  return (
    <SidebarMenuItem>
      <HoverCard openDelay={80} closeDelay={120}>
        <HoverCardTrigger asChild>
          <SidebarMenuButton isActive={groupActive} aria-label={group.label} className="relative">
            <GroupIcon className="h-4 w-4 shrink-0" />
            <span className="truncate">{group.label}</span>
            {count > 0 && (
              <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-destructive" />
            )}
          </SidebarMenuButton>
        </HoverCardTrigger>
        <HoverCardContent side="right" align="start" className="w-56 p-1">
          <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{group.label}</p>
          <ul className="grid gap-0.5">
            {items.map((item) => {
              const url = resolveUrl(item.url, projectId);
              const Icon = item.icon;
              return (
                <li key={`flyout:${group.key}:${url}:${item.label}`}>
                  <a
                    href={url}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                      isActive(url) && "bg-accent font-medium",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </HoverCardContent>
      </HoverCard>
    </SidebarMenuItem>
  );
}
