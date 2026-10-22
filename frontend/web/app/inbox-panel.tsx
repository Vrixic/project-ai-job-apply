"use client";

import type { NotificationInboxPage, NotificationItem } from "@ai-job-apply/api-contracts";
import { useCallback, useEffect, useState } from "react";

const copy: Record<NotificationItem["kind"], { title: string; detail: string }> = {
  application_review_needed: {
    title: "Review your application",
    detail: "An application is ready for you to review and approve.",
  },
  application_outcome_needed: {
    title: "Confirm whether it was submitted",
    detail:
      "We could not confirm that an application was submitted. Record what happened so it is not sent twice.",
  },
  application_confirmed: {
    title: "Application confirmed",
    detail: "The employer confirmed your submission.",
  },
};

type View =
  | { status: "loading" }
  | { status: "absent" }
  | { status: "error" }
  | { status: "ready"; items: NotificationItem[]; unreadCount: number; next?: string };

function isItem(value: unknown): value is NotificationItem {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    (value as { kind?: unknown }).kind !== undefined &&
    Object.hasOwn(copy, (value as { kind: string }).kind)
  );
}

function parsePage(value: unknown): NotificationInboxPage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const page = value as Partial<NotificationInboxPage>;
  if (!Array.isArray(page.items) || !page.items.every(isItem)) return undefined;
  if (typeof page.unreadCount !== "number") return undefined;
  return page as NotificationInboxPage;
}

/** The candidate's in-app action inbox. Items are derived; acting on one never changes an application. */
export function InboxPanel({ authenticated }: { authenticated: boolean }) {
  const [view, setView] = useState<View>({ status: "loading" });
  const [busy, setBusy] = useState<string>();

  const load = useCallback(async (cursor?: string) => {
    try {
      const query = new URLSearchParams({ limit: "25" });
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(`/api/platform/notifications?${query}`, { cache: "no-store" });
      if (response.status === 404) return setView({ status: "absent" });
      const page = response.ok ? parsePage(await response.json()) : undefined;
      if (!page) return setView({ status: "error" });
      setView((current) => ({
        status: "ready",
        items:
          cursor && current.status === "ready" ? [...current.items, ...page.items] : page.items,
        unreadCount: page.unreadCount,
        ...(page.nextCursor ? { next: page.nextCursor } : {}),
      }));
    } catch {
      setView({ status: "error" });
    }
  }, []);

  useEffect(() => {
    if (authenticated) void load();
  }, [authenticated, load]);

  async function act(item: NotificationItem, command: "acknowledgement" | "dismissal") {
    setBusy(item.id);
    try {
      const response = await fetch(`/api/platform/notifications/${item.id}/${command}`, {
        method: "POST",
        cache: "no-store",
      });
      const updated: unknown = response.ok ? await response.json() : undefined;
      if (!isItem(updated)) return setView({ status: "error" });
      setView((current) =>
        current.status !== "ready"
          ? current
          : {
              ...current,
              items:
                updated.state === "dismissed" || updated.state === "expired"
                  ? current.items.filter((entry) => entry.id !== item.id)
                  : current.items.map((entry) => (entry.id === item.id ? updated : entry)),
              unreadCount:
                item.state === "unread" && updated.state !== "unread"
                  ? Math.max(0, current.unreadCount - 1)
                  : current.unreadCount,
            },
      );
    } catch {
      setView({ status: "error" });
    } finally {
      setBusy(undefined);
    }
  }

  if (!authenticated) return null;
  return (
    <section aria-labelledby="inbox-heading" className="inbox">
      <h2 id="inbox-heading">Inbox</h2>
      {view.status === "loading" ? <p role="status">Loading...</p> : null}
      {view.status === "absent" ? <p>The inbox is not available yet.</p> : null}
      {view.status === "error" ? (
        <p role="alert">
          The inbox is temporarily unavailable.{" "}
          <button type="button" onClick={() => void load()}>
            Try again
          </button>
        </p>
      ) : null}
      {view.status === "ready" && view.items.length === 0 ? (
        <p>Nothing needs your attention.</p>
      ) : null}
      {view.status === "ready" && view.items.length > 0 ? (
        <>
          <p role="status">
            {view.unreadCount === 0 ? "All caught up." : `${view.unreadCount} unread`}
          </p>
          <ul className="inbox-list">
            {view.items.map((item) => (
              <li key={item.id} data-state={item.state} data-urgency={item.urgency}>
                <h3>
                  {copy[item.kind].title}
                  {item.urgency === "high" ? (
                    <span className="inbox-flag"> Needs attention</span>
                  ) : null}
                </h3>
                <p>{copy[item.kind].detail}</p>
                <p>
                  <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
                </p>
                <div className="inbox-actions">
                  <a href="/jobs">Open jobs</a>
                  {item.state === "unread" ? (
                    <button
                      type="button"
                      disabled={busy === item.id}
                      onClick={() => void act(item, "acknowledgement")}
                    >
                      Mark as seen
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy === item.id}
                    onClick={() => void act(item, "dismissal")}
                  >
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {view.next ? (
            <button type="button" onClick={() => void load(view.next)}>
              Show more
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
