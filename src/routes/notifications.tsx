import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { BellOff, CheckCheck, Eye, EyeOff, Loader2, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { CATEGORY_ICON, NotificationRow, useOpenNotification } from "@/components/notifications";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useNotifications } from "@/hooks/use-notifications";
import { CATEGORY_LABEL, type NotificationCategory } from "@/lib/notifications";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — ibird" },
      { name: "description", content: "New paid orders, payments, stock alerts, undelivered invoices and catalogue issues." },
    ],
  }),
  component: NotificationsPage,
});

const CATEGORIES: NotificationCategory[] = ["orders", "payments", "stock", "documents", "catalog"];

const CATEGORY_HINT: Record<NotificationCategory, string> = {
  orders: "Paid WhatsApp orders to pack, and orders still waiting for payment.",
  payments: "Payments received in the last 48 hours.",
  stock: "Active products that are out of stock or below their reorder level.",
  documents: "WhatsApp invoices that could not be delivered to the customer.",
  catalog: "WhatsApp products left out of the catalogue because of their photo.",
};

function NotificationsPage() {
  const { notifications, unreadCount, isLoading, refetch, markRead, markUnread, markAllRead } = useNotifications();
  const open = useOpenNotification();
  const [category, setCategory] = useState<NotificationCategory | "all">("all");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const counts = useMemo(() => {
    const c = Object.fromEntries(CATEGORIES.map((k) => [k, { total: 0, unread: 0 }])) as Record<
      NotificationCategory,
      { total: number; unread: number }
    >;
    for (const n of notifications) {
      c[n.category].total++;
      if (!n.read) c[n.category].unread++;
    }
    return c;
  }, [notifications]);

  const list = notifications.filter(
    (n) => (category === "all" || n.category === category) && (!unreadOnly || !n.read),
  );
  const visibleUnread = list.filter((n) => !n.read).map((n) => n.id);

  return (
    <AppShell
      title="Notifications"
      subtitle={unreadCount ? `${unreadCount} unread` : "You're all caught up."}
      actions={
        <>
          <Button variant="outline" className="gap-2" onClick={() => refetch()}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
          <Button className="gap-2" disabled={!unreadCount} onClick={markAllRead}>
            <CheckCheck className="size-4" /> Mark all read
          </Button>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        {/* Categories */}
        <nav className="card-surface h-fit p-2" aria-label="Notification categories">
          {(["all", ...CATEGORIES] as const).map((key) => {
            const Icon = key === "all" ? null : CATEGORY_ICON[key];
            const total = key === "all" ? notifications.length : counts[key].total;
            const unread = key === "all" ? unreadCount : counts[key].unread;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setCategory(key)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  category === key ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground" : "hover:bg-secondary",
                )}
              >
                {Icon ? <Icon className="size-4 shrink-0" /> : <span className="size-4 shrink-0" />}
                <span className="min-w-0 flex-1 truncate">{key === "all" ? "All notifications" : CATEGORY_LABEL[key]}</span>
                {unread > 0 ? (
                  <span className="rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">{unread}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">{total}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* List */}
        <div className="card-surface min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <h2 className="font-bold">{category === "all" ? "All notifications" : CATEGORY_LABEL[category]}</h2>
              <p className="text-xs text-muted-foreground">
                {category === "all" ? "Everything that needs attention, most urgent first." : CATEGORY_HINT[category]}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Switch checked={unreadOnly} onCheckedChange={setUnreadOnly} /> Unread only
              </label>
              {visibleUnread.length > 0 && (
                <Button size="sm" variant="ghost" className="gap-1" onClick={() => markRead(visibleUnread)}>
                  <CheckCheck className="size-3.5" /> Mark read
                </Button>
              )}
            </div>
          </div>

          <div className="divide-y divide-border">
            {list.map((n) => (
              <NotificationRow
                key={n.id}
                n={n}
                onOpen={() => open(n)}
                actions={
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      title={n.read ? "Mark as unread" : "Mark as read"}
                      onClick={() => (n.read ? markUnread(n.id) : markRead(n.id))}
                    >
                      {n.read ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                    <Button size="sm" variant="outline" className="hidden sm:inline-flex" onClick={() => open(n)}>
                      Open
                    </Button>
                  </div>
                }
              />
            ))}
            {!list.length && (
              <div className="flex flex-col items-center gap-2 px-4 py-14 text-center text-sm text-muted-foreground">
                {isLoading ? (
                  <>
                    <Loader2 className="size-6 animate-spin" /> Loading notifications…
                  </>
                ) : (
                  <>
                    <BellOff className="size-7" />
                    {unreadOnly ? "No unread notifications here." : "Nothing here. You're all caught up."}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
