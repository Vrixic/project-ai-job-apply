// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboxPanel } from "./inbox-panel";

const at = "2026-10-22T12:00:00.000Z";
const item = (id: string, overrides: Record<string, unknown> = {}) => ({
  id: `019d04cf-1f80-7000-8000-00000000a${id}`,
  kind: "application_review_needed",
  urgency: "normal",
  state: "unread",
  applicationId: "019d04cf-1f80-7000-8000-00000000b001",
  sourceRevision: 3,
  createdAt: at,
  updatedAt: at,
  expiresAt: "2026-11-22T12:00:00.000Z",
  ...overrides,
});

describe("InboxPanel (ADR-055)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const render = async (authenticated = true) => {
    await act(async () => root.render(<InboxPanel authenticated={authenticated} />));
    await act(async () => {});
  };
  const button = (label: RegExp) =>
    Array.from(container.querySelectorAll("button")).find((entry) =>
      label.test(entry.textContent ?? ""),
    );

  it("shows nothing for a signed-out visitor and makes no request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await render(false);
    expect(container.textContent).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says the inbox is not available when the platform has no such route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({}, { status: 404 })),
    );
    await render();
    expect(container.textContent).toContain("The inbox is not available yet.");
  });

  it("offers a retry when the inbox is temporarily unavailable", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ items: [], unreadCount: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "temporarily unavailable",
    );
    await act(async () => button(/try again/i)?.click());
    await act(async () => {});
    expect(container.textContent).toContain("Nothing needs your attention.");
  });

  it("refuses a response that is not a valid inbox page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ items: [{ id: "x", kind: "hired" }], unreadCount: 1 })),
    );
    await render();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("lists items with plain wording, flags the urgent one, and never names a hiring outcome", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          items: [
            item("1", { kind: "application_outcome_needed", urgency: "high" }),
            item("2", { kind: "application_confirmed", urgency: "low", state: "acknowledged" }),
          ],
          unreadCount: 1,
        }),
      ),
    );
    await render();
    const text = container.textContent ?? "";
    expect(text).toContain("Confirm whether it was submitted");
    expect(text).toContain("Needs attention");
    expect(text).toContain("Application confirmed");
    expect(text).toContain("1 unread");
    expect(text).not.toMatch(/interview|offer|rejected|recruiter|hired/iu);
    // Only an unread item offers Mark as seen.
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(
      Array.from(container.querySelectorAll("button")).filter((b) =>
        /mark as seen/i.test(b.textContent ?? ""),
      ),
    ).toHaveLength(1);
  });

  it("marks an item as seen and dismisses another, updating the count", async () => {
    const first = item("1");
    const second = item("2", { kind: "application_confirmed", urgency: "low" });
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/acknowledgement"))
        return Response.json({ ...first, state: "acknowledged" });
      if (init?.method === "POST" && url.endsWith("/dismissal"))
        return Response.json({ ...second, state: "dismissed" });
      return Response.json({ items: [first, second], unreadCount: 2 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await render();
    await act(async () => button(/mark as seen/i)?.click());
    await act(async () => {});
    expect(container.textContent).toContain("1 unread");
    const dismissals = Array.from(container.querySelectorAll("button")).filter((b) =>
      /dismiss/i.test(b.textContent ?? ""),
    );
    await act(async () => dismissals[1]?.click());
    await act(async () => {});
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(container.textContent).toContain("All caught up.");
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts.map(([url]) => String(url))).toEqual([
      `/api/platform/notifications/${first.id}/acknowledgement`,
      `/api/platform/notifications/${second.id}/dismissal`,
    ]);
    // Commands carry no body.
    expect(posts.every(([, init]) => init?.body === undefined)).toBe(true);
  });

  it("loads the next page with the cursor and appends it", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ items: [item("1")], unreadCount: 2, nextCursor: "abc_1" }),
      )
      .mockResolvedValueOnce(Response.json({ items: [item("2")], unreadCount: 2 }));
    vi.stubGlobal("fetch", fetchMock);
    await render();
    await act(async () => button(/show more/i)?.click());
    await act(async () => {});
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("cursor=abc_1");
    expect(button(/show more/i)).toBeUndefined();
  });
});
