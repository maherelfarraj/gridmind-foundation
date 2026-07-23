import type { ReactNode } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { AppBreadcrumbs, type BreadcrumbItemSpec } from "@/components/breadcrumbs";
import { ActiveCompanyProvider, CompanySwitcher } from "@/components/company-switcher";
import { NotificationsBell } from "@/components/notifications-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

interface AppShellProps {
  children: ReactNode;
  breadcrumbs?: BreadcrumbItemSpec[];
}

export function AppShell({ children, breadcrumbs = [{ label: "Dashboard" }] }: AppShellProps) {
  return (
    <ActiveCompanyProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="bg-background">
          <header className="sticky top-0 z-20 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:flex sm:h-14 sm:px-4">
            <div className="flex min-w-0 items-center gap-2">
              <SidebarTrigger className="text-foreground" />
              <div className="min-w-0 flex-1">
                <AppBreadcrumbs items={breadcrumbs} />
              </div>
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
              <CompanySwitcher />
              <NotificationsBell />
              <ThemeToggle />
              <UserMenu />
            </div>
          </header>
          <main className="flex-1 p-4 sm:p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </ActiveCompanyProvider>
  );
}
