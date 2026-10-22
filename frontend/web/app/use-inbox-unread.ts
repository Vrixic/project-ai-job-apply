"use client";

import { useEffect, useState } from "react";

/**
 * The unread count for the navigation. `undefined` means the inbox is not available (the route is
 * absent or the platform is down), so the navigation shows no link rather than a broken one.
 */
export function useInboxUnread(authenticated: boolean): number | undefined {
  const [unread, setUnread] = useState<number>();
  useEffect(() => {
    if (!authenticated) return;
    let live = true;
    void (async () => {
      try {
        const response = await fetch("/api/platform/notifications?state=unread&limit=1", {
          cache: "no-store",
        });
        if (!response.ok) return;
        const page: unknown = await response.json();
        const count =
          typeof page === "object" && page !== null
            ? (page as { unreadCount?: unknown }).unreadCount
            : undefined;
        if (live && typeof count === "number" && Number.isSafeInteger(count) && count >= 0)
          setUnread(count);
      } catch {
        // No inbox link is better than a broken one.
      }
    })();
    return () => {
      live = false;
    };
  }, [authenticated]);
  return unread;
}
