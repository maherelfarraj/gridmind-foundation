import { useState } from "react";
import { Bell } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface StubNotification {
  id: string;
  title: string;
  body: string;
  read: boolean;
}

const INITIAL_NOTIFICATIONS: StubNotification[] = [
  {
    id: "n1",
    title: "Punchlist item assigned",
    body: "Inverter INV-04 flagged during commissioning walkdown.",
    read: false,
  },
  {
    id: "n2",
    title: "Procurement update",
    body: "MV switchgear PO-1187 marked in transit.",
    read: false,
  },
  {
    id: "n3",
    title: "O&M ticket resolved",
    body: "String 12A output restored after fuse replacement.",
    read: false,
  },
];

export function NotificationsBell() {
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
          aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <Badge
              className="absolute -right-0.5 -top-0.5 h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
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
            Notifications
          </DropdownMenuLabel>
          <button
            type="button"
            onClick={markAllRead}
            disabled={unread === 0}
            className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            Mark all read
          </button>
        </div>
        <DropdownMenuSeparator className="my-0" />
        {notifications.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            You're all caught up
          </div>
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
                  <p className="text-sm font-medium text-foreground">{n.title}</p>
                </div>
                <p className="text-xs text-muted-foreground">{n.body}</p>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
