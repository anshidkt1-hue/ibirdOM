import { Link, useNavigate } from "@tanstack/react-router";
import {
  Bell,
  BellOff,
  CheckCheck,
  CreditCard,
  FileWarning,
  ImageOff,
  PackageX,
  Receipt,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNotifications, type NotificationWithState } from "@/hooks/use-notifications";
import { CATEGORY_LABEL, timeAgo, type NotificationCategory, type NotificationSeverity } from "@/lib/notifications";
import { cn } from "@/lib/utils";

export const CATEGORY_ICON: Record<NotificationCategory, LucideIcon> = {
  assignments: UserCheck,
  orders: Receipt,
  payments: CreditCard,
  stock: PackageX,
  documents: FileWarning,
  catalog: ImageOff,
};

const SEVERITY_STYLE: Record<NotificationSeverity, string> = {
  critical: "bg-destructive/10 text-destructive",
  warning: "bg-warning/15 text-warning",
  info: "bg-primary/10 text-primary",
};

// Opens the page the notification is about and marks it read
export function useOpenNotification() {
  const navigate = useNavigate();
  const { markRead } = useNotifications();
  return (n: NotificationWithState) => {
    markRead(n.id);
    navigate(n.link as any);
  };
}

export function NotificationRow({
  n,
  onOpen,
  compact = false,
  actions,
}: {
  n: NotificationWithState;
  onOpen: () => void;
  compact?: boolean;
  actions?: React.ReactNode;
}) {
  const Icon = CATEGORY_ICON[n.category];
  return (
    <div
      className={cn(
        "group flex items-start gap-3 transition-colors hover:bg-secondary",
        compact ? "px-3 py-2.5" : "px-4 py-3",
        !n.read && "bg-primary/[0.04]",
      )}
    >
      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", SEVERITY_STYLE[n.severity])}>
        <Icon className="size-4" />
      </span>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="flex items-start gap-2">
          <span className={cn("min-w-0 flex-1 text-sm leading-snug", n.read ? "font-medium" : "font-semibold")}>
            {n.title}
          </span>
          {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{n.description}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
          <span className="font-medium">{CATEGORY_LABEL[n.category]}</span>
          <span>·</span>
          <span>{n.ongoing ? "Ongoing" : timeAgo(n.at)}</span>
        </span>
      </button>
      {actions}
    </div>
  );
}

const DROPDOWN_LIMIT = 8;

export function NotificationBell() {
  const { notifications, unreadCount, markAllRead } = useNotifications();
  const open = useOpenNotification();
  // Unread first, then the rest, most urgent at the top
  const shown = [...notifications.filter((n) => !n.read), ...notifications.filter((n) => n.read)].slice(0, DROPDOWN_LIMIT);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="relative" aria-label={`Notifications (${unreadCount} unread)`}>
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(24rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
          <p className="text-sm font-bold">
            Notifications
            {unreadCount > 0 && <span className="ml-1.5 text-xs font-semibold text-primary">{unreadCount} new</span>}
          </p>
          {unreadCount > 0 && (
            <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={markAllRead}>
              <CheckCheck className="size-3.5" /> Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-[min(26rem,70vh)] divide-y divide-border overflow-y-auto">
          {shown.map((n) => (
            <NotificationRow key={n.id} n={n} compact onOpen={() => open(n)} />
          ))}
          {!shown.length && (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground">
              <BellOff className="size-6" /> You're all caught up.
            </div>
          )}
        </div>
        <div className="border-t border-border p-1.5">
          <Button asChild variant="ghost" className="w-full justify-center text-sm font-semibold text-primary">
            <Link to="/notifications">View all notifications{notifications.length ? ` (${notifications.length})` : ""}</Link>
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
