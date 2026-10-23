// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => ({
  pushSupported: vi.fn(() => true),
  browserNotificationsBlocked: vi.fn(() => false),
  subscribeThisBrowser: vi.fn(),
  unsubscribeThisBrowser: vi.fn(async () => undefined),
  readStoredSubscriptionId: vi.fn((): string | undefined => undefined),
  storeSubscriptionId: vi.fn(),
}));
vi.mock("../lib/browser-push", () => push);

import { minutesToTime, NotificationSettings, timeToMinutes } from "./notification-settings";

const SUB = "019d04cf-1f80-7000-8000-00000000a111";
const preferences = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  inAppEnabled: true,
  emailEnabled: false,
  pushEnabled: false,
  quietHours: { enabled: false, startMinute: 1320, endMinute: 420, timeZone: "UTC" },
  updatedAt: "2026-10-23T12:00:00.000Z",
  ...overrides,
});
const delivery = (overrides: Record<string, unknown> = {}) => ({
  pushSubscriptions: [],
  pushPublicKey: "B".repeat(87),
  ...overrides,
});

describe("NotificationSettings", () => {
  let container: HTMLDivElement;
  let root: Root;
  let calls: { method: string; path: string; body?: unknown }[];
  let state: { delivery: unknown; preferences: unknown };

  beforeEach(() => {
    vi.stubGlobal("React", React);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    calls = [];
    state = { delivery: delivery(), preferences: preferences() };
    for (const mock of Object.values(push)) mock.mockClear();
    push.pushSupported.mockReturnValue(true);
    push.browserNotificationsBlocked.mockReturnValue(false);
    push.readStoredSubscriptionId.mockReturnValue(undefined);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function stubFetch(
    handler: (method: string, path: string, body: unknown) => Response | undefined = () =>
      undefined,
  ) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).replace("/api/platform/notifications", "");
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method, path, ...(body === undefined ? {} : { body }) });
        const custom = handler(method, path, body);
        if (custom) return custom;
        if (method === "GET" && path === "/delivery") return Response.json(state.delivery);
        if (method === "GET" && path === "/preferences") return Response.json(state.preferences);
        if (method === "PUT" && path === "/delivery/email")
          return new Response(null, { status: 202 });
        return new Response(null, { status: 204 });
      }),
    );
  }

  async function render() {
    await act(async () => root.render(<NotificationSettings authenticated />));
    await act(async () => {});
  }

  const button = (label: RegExp) =>
    Array.from(container.querySelectorAll("button")).find((item) =>
      label.test(item.textContent ?? ""),
    );
  const click = async (label: RegExp) => {
    const target = button(label);
    expect(target, String(label)).toBeTruthy();
    await act(async () => target?.click());
    await act(async () => {});
  };
  async function type(input: HTMLInputElement | null, value: string) {
    if (!input) throw new Error("input missing");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  const checkbox = (label: RegExp) =>
    Array.from(container.querySelectorAll("label"))
      .find((item) => label.test(item.textContent ?? ""))
      ?.querySelector("input") as HTMLInputElement | null;

  it("renders nothing when the platform serves no notifications", async () => {
    stubFetch(() => Response.json({}, { status: 404 }));
    await render();
    expect(container.textContent).toBe("");
  });

  it("shows a retry when the settings cannot be loaded", async () => {
    stubFetch(() => Response.json({}, { status: 503 }));
    await render();
    expect(container.textContent).toContain("temporarily unavailable");
    expect(button(/try again/i)).toBeTruthy();
  });

  it("starts email confirmation and reports a rate limit plainly", async () => {
    stubFetch();
    await render();
    expect(container.textContent).toContain("only tell you to open the inbox");
    await type(container.querySelector('input[type="email"]'), "person@example.com");
    await click(/send confirmation code/i);
    expect(calls).toContainEqual({
      method: "PUT",
      path: "/delivery/email",
      body: { address: "person@example.com" },
    });
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "emailing you a code",
    );

    stubFetch((method, path) =>
      method === "PUT" && path === "/delivery/email"
        ? Response.json({}, { status: 429 })
        : undefined,
    );
    await click(/send confirmation code/i);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Try again in an hour",
    );
  });

  it("confirms the emailed code and explains a wrong one", async () => {
    state.delivery = delivery({
      email: { address: "person@example.com", state: "pending", codePending: true },
    });
    stubFetch((method, path) =>
      method === "POST" && path === "/delivery/email/confirmation"
        ? Response.json({ result: "invalid" })
        : undefined,
    );
    await render();
    expect(container.textContent).toContain("person@example.com");
    expect(button(/^confirm$/i)?.disabled).toBe(true);
    await type(container.querySelector('input[inputmode="numeric"]'), "12ab34");
    expect((container.querySelector('input[inputmode="numeric"]') as HTMLInputElement).value).toBe(
      "1234",
    );
    await type(container.querySelector('input[inputmode="numeric"]'), "123456");
    await click(/^confirm$/i);
    expect(calls).toContainEqual({
      method: "POST",
      path: "/delivery/email/confirmation",
      body: { code: "123456" },
    });
    expect(container.querySelector('[role="status"]')?.textContent).toContain("not right");
  });

  it("saves the email and quiet hours choices with the current version", async () => {
    state.delivery = delivery({
      email: { address: "person@example.com", state: "verified", codePending: false },
    });
    stubFetch((method, path) =>
      method === "PUT" && path === "/preferences" ? Response.json(preferences()) : undefined,
    );
    await render();
    expect(button(/save notification settings/i)?.disabled).toBe(true);
    await act(async () => checkbox(/email me/i)?.click());
    await act(async () => checkbox(/hold email/i)?.click());
    const times = container.querySelectorAll('input[type="time"]');
    await type(times[0] as HTMLInputElement, "21:30");
    await type(times[1] as HTMLInputElement, "06:15");
    await click(/save notification settings/i);
    const save = calls.find((call) => call.method === "PUT" && call.path === "/preferences");
    expect(save?.body).toMatchObject({
      expectedVersion: 1,
      emailEnabled: true,
      pushEnabled: false,
      quietHours: { enabled: true, startMinute: 1290, endMinute: 375 },
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Saved.");
  });

  it("refuses identical quiet hours and never saves email on without a confirmed address", async () => {
    stubFetch();
    await render();
    await act(async () => checkbox(/hold email/i)?.click());
    const times = container.querySelectorAll('input[type="time"]');
    await type(times[0] as HTMLInputElement, "08:00");
    await type(times[1] as HTMLInputElement, "08:00");
    expect(container.textContent).toContain("Choose two different times");
    expect(button(/save notification settings/i)?.disabled).toBe(true);
  });

  it("turns browser notifications on and registers the endpoint", async () => {
    push.subscribeThisBrowser.mockResolvedValue({
      outcome: "subscribed",
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    });
    stubFetch((method, path) =>
      method === "POST" && path === "/delivery/push-subscriptions"
        ? Response.json({ id: SUB }, { status: 201 })
        : undefined,
    );
    await render();
    await click(/turn on for this browser/i);
    expect(push.subscribeThisBrowser).toHaveBeenCalledWith("B".repeat(87));
    expect(calls).toContainEqual({
      method: "POST",
      path: "/delivery/push-subscriptions",
      body: { endpoint: "https://fcm.googleapis.com/fcm/send/abc" },
    });
    expect(push.storeSubscriptionId).toHaveBeenCalledWith(SUB);
  });

  it("explains a blocked permission and a full account without registering anything", async () => {
    push.subscribeThisBrowser.mockResolvedValue({ outcome: "denied" });
    stubFetch();
    await render();
    await click(/turn on for this browser/i);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("blocked");
    expect(calls.some((call) => call.path === "/delivery/push-subscriptions")).toBe(false);

    push.subscribeThisBrowser.mockResolvedValue({ outcome: "subscribed", endpoint: "https://x" });
    stubFetch((method, path) =>
      method === "POST" && path === "/delivery/push-subscriptions"
        ? Response.json({}, { status: 409 })
        : undefined,
    );
    await click(/turn on for this browser/i);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("maximum number");
    expect(push.storeSubscriptionId).not.toHaveBeenCalled();
  });

  it("turns this browser off and removes the stored subscription", async () => {
    state.delivery = delivery({
      pushSubscriptions: [{ id: SUB, state: "active", createdAt: "2026-10-23T12:00:00.000Z" }],
    });
    push.readStoredSubscriptionId.mockReturnValue(SUB);
    stubFetch();
    await render();
    expect(container.textContent).toContain("1 browser set up");
    await click(/turn off for this browser/i);
    expect(calls).toContainEqual({ method: "DELETE", path: `/delivery/push-subscriptions/${SUB}` });
    expect(push.unsubscribeThisBrowser).toHaveBeenCalled();
    expect(push.storeSubscriptionId).toHaveBeenCalledWith(undefined);
  });

  it("says so when the browser cannot show notifications", async () => {
    push.pushSupported.mockReturnValue(false);
    stubFetch();
    await render();
    expect(container.textContent).toContain("This browser cannot show notifications.");
    expect(button(/turn on for this browser/i)).toBeUndefined();
  });
});

describe("quiet hour time helpers", () => {
  it("converts between minutes and clock times", () => {
    expect(minutesToTime(1320)).toBe("22:00");
    expect(minutesToTime(5)).toBe("00:05");
    expect(timeToMinutes("22:00")).toBe(1320);
    expect(timeToMinutes("23:59")).toBe(1439);
    expect(timeToMinutes("24:00")).toBeUndefined();
    expect(timeToMinutes("7:5")).toBeUndefined();
    expect(timeToMinutes("")).toBeUndefined();
  });
});
