import { describe, expect, it, vi } from "vitest";
import { withApplicationEventFeed } from "./notifications-feed.js";

const OWNER = "019d04cf-1f80-7000-8000-00000000b001";
const event = (id: string) => ({
  id,
  claimToken: "019d04cf-1f80-7000-8000-00000000c001",
  type: "application.status_changed.v1" as const,
  data: {
    applicationId: "019d04cf-1f80-7000-8000-00000000a001",
    userId: OWNER,
    revision: 2,
    status: "review_required",
  },
  occurredAt: new Date("2026-10-22T12:00:00.000Z"),
});

function setup(
  options: {
    claimed?: ReturnType<typeof event>[];
    outcomes?: Array<string | Error>;
    claimFails?: boolean;
  } = {},
) {
  const order: string[] = [];
  const outcomes = [...(options.outcomes ?? [])];
  const notifications = {
    ingestApplicationEvent: vi.fn(async (input: { id: string }) => {
      order.push(`ingest:${input.id}`);
      const next = outcomes.shift() ?? "recorded";
      if (next instanceof Error) throw next;
      return { outcome: next };
    }),
    listInbox: vi.fn(async () => {
      order.push("list");
      return { items: [], unreadCount: 0 };
    }),
    acknowledge: vi.fn(),
    dismiss: vi.fn(),
    getPreferences: vi.fn(),
    updatePreferences: vi.fn(),
  };
  const events = {
    claimForOwner: vi.fn(async () => {
      if (options.claimFails) throw new Error("db down");
      return options.claimed ?? [];
    }),
    markPublished: vi.fn(async (entry: { id: string }) => {
      order.push(`published:${entry.id}`);
      return true;
    }),
    markFailed: vi.fn(async (entry: { id: string }) => {
      order.push(`failed:${entry.id}`);
      return true;
    }),
  };
  const api = withApplicationEventFeed({
    notifications: notifications as never,
    events,
    clock: () => new Date("2026-10-22T12:00:00.000Z"),
  });
  return { api, notifications, events, order };
}

describe("withApplicationEventFeed (ADR-055)", () => {
  it("takes the owner's pending events before the first page and publishes each one", async () => {
    const { api, order, events } = setup({ claimed: [event("e1"), event("e2")] });
    await api.listInbox(OWNER, { limit: 25 });
    expect(order).toEqual(["ingest:e1", "published:e1", "ingest:e2", "published:e2", "list"]);
    expect(events.claimForOwner).toHaveBeenCalledWith(OWNER, 25, expect.any(Date));
  });

  it("does not pump for a later page", async () => {
    const { api, events } = setup({ claimed: [event("e1")] });
    await api.listInbox(OWNER, { limit: 25, cursor: "abc_1" });
    expect(events.claimForOwner).not.toHaveBeenCalled();
  });

  it("fails a rejected event for retry instead of dropping it", async () => {
    const { api, order } = setup({ claimed: [event("e1")], outcomes: ["rejected"] });
    await api.listInbox(OWNER, {});
    expect(order).toEqual(["ingest:e1", "failed:e1", "list"]);
  });

  it("stops at an ingest failure, releases that event, and still serves the read", async () => {
    const { api, order } = setup({
      claimed: [event("e1"), event("e2")],
      outcomes: [new Error("db down")],
    });
    await expect(api.listInbox(OWNER, {})).resolves.toEqual({ items: [], unreadCount: 0 });
    expect(order).toEqual(["ingest:e1", "failed:e1", "list"]);
  });

  it("never fails the read because the feed is unavailable", async () => {
    const { api, order } = setup({ claimFails: true });
    await expect(api.listInbox(OWNER, {})).resolves.toEqual({ items: [], unreadCount: 0 });
    expect(order).toEqual(["list"]);
  });

  it("passes the other operations straight through", async () => {
    const { api, notifications } = setup();
    await api.acknowledge(OWNER, "x");
    await api.dismiss(OWNER, "y");
    await api.getPreferences(OWNER);
    expect(notifications.acknowledge).toHaveBeenCalledWith(OWNER, "x");
    expect(notifications.dismiss).toHaveBeenCalledWith(OWNER, "y");
    expect(notifications.getPreferences).toHaveBeenCalledWith(OWNER);
  });
});
