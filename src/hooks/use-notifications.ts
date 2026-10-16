import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRole } from "@/components/role-provider";
import { fetchNotifications, type AppNotification } from "@/lib/notifications";

export type { AppNotification } from "@/lib/notifications";

// Read notifications are remembered per user in this browser (ids of notifications marked read)
const KEY_PREFIX = "ibird-notifications-read:";
const MAX_REMEMBERED = 500;
const listeners = new Set<() => void>();
const cache = new Map<string, string[]>();

function readIds(key: string): string[] {
  if (!cache.has(key)) {
    let ids: string[] = [];
    try {
      ids = JSON.parse(localStorage.getItem(key) ?? "[]");
    } catch {
      ids = [];
    }
    cache.set(key, Array.isArray(ids) ? ids : []);
  }
  return cache.get(key)!;
}

function writeIds(key: string, ids: string[]) {
  const next = ids.slice(-MAX_REMEMBERED);
  cache.set(key, next);
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* storage full or blocked: read state lasts for this session only */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const EMPTY: string[] = [];

export function useNotifications() {
  const { user, role } = useRole();
  const key = `${KEY_PREFIX}${user?.id ?? "guest"}`;

  const { data: items = [], isLoading, refetch } = useQuery({
    queryKey: ["notifications", user?.id ?? null, role ?? null],
    queryFn: () => fetchNotifications({ userId: user?.id ?? null, role: role ?? null }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const readList = useSyncExternalStore(
    subscribe,
    () => (typeof window === "undefined" ? EMPTY : readIds(key)),
    () => EMPTY,
  );
  const read = useMemo(() => new Set(readList), [readList]);

  const markRead = useCallback(
    (ids: string | string[]) => {
      const add = (Array.isArray(ids) ? ids : [ids]).filter((id) => !read.has(id));
      if (add.length) writeIds(key, [...readIds(key), ...add]);
    },
    [key, read],
  );
  const markUnread = useCallback(
    (id: string) => writeIds(key, readIds(key).filter((x) => x !== id)),
    [key],
  );

  const withState = useMemo(
    () => items.map((n: AppNotification) => ({ ...n, read: read.has(n.id) })),
    [items, read],
  );
  const unreadCount = withState.filter((n) => !n.read).length;

  return {
    notifications: withState,
    unreadCount,
    isLoading,
    refetch,
    markRead,
    markUnread,
    markAllRead: () => markRead(items.map((n: AppNotification) => n.id)),
  };
}

export type NotificationWithState = ReturnType<typeof useNotifications>["notifications"][number];
