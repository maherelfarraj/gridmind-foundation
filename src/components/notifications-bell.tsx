import { useState } from "react";
import { Bell } from "lucide-react";

import { useI18n } from "@/lib/i18n/locale-provider";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface StubNotification {
  id: string;
  titleKey: string;
  bodyKey: string;
  read: boolean;
}

const INITIAL_NOTIFICATIONS: StubNotification[] = [
  {
    id: "n1",
    titleKey: "chrome.sampleNotification1Title",
    bodyKey: "chrome.sampleNotification1Body",
    read: false,
  },
  {
    id: "n2",
    titleKey: "chrome.sampleNotification2Title",
    bodyKey: "chrome.sampleNotification2Body",
    read: false,
  },
  {
    id: "n3",
    titleKey: "chrome.sampleNotification3Title",
    bodyKey: "chrome.sampleNotification3Body",
    read: false,
  },
];

export function NotificationsBell() {
  const { t } = useI18n();
  const [notifications, setNotifications] = useState<StubNotification[]>(INITIAL_NOTIFICATIONS);
  const unread = notifications.filter((n) => !n.read).length;

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 text-foreground"
          aria-label={
            unread
              ? t("chrome.notificationsUnreadAria", { count: unread })
              : t("chrome.notificationsAria")
          }
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <Badge
              className="absolute -end-0.5 -top-0.5 h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
              aria-hidden
            >
              {unread}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <DropdownMenuLabel className="p-0 text-sm font-semibold text-foreground">
            {t("chrome.notifications")}
          </DropdownMenuLabel>
          <button
            type="button"
            onClick={markAllRead}
            disabled={unread === 0}
            className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("chrome.markAllRead")}
          </button>
        </div>
        <DropdownMenuSeparator className="my-0" />
        {notifications.length === 0 ? (
          <EmptyState title={t("chrome.allCaughtUp")} compact className="border-0 bg-transparent" />
        ) : (
          <ul className="max-h-80 overflow-y-auto py-1">
            {notifications.map((n) => (
              <li
                key={n.id}
                className="flex flex-col gap-1 border-b border-border/60 px-3 py-2 last:border-b-0"
              >
                <div className="flex items-center gap-2">
                  {!n.read && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                  )}
                  <p className="text-sm font-medium text-foreground">{t(n.titleKey)}</p>
                </div>
                <p className="text-xs text-muted-foreground">{t(n.bodyKey)}</p>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
