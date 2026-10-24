import { beforeEach, describe, expect, it, vi } from "vitest";

const forward = vi.hoisted(() => vi.fn());
vi.mock("./platform-api", () => ({ forwardPlatformRequest: forward }));
vi.mock("./auth0", () => ({ getLazyAuth0Session: () => ({}) }));

import {
  forwardNotificationCommand,
  forwardNotificationDeliveryEmail,
  forwardNotificationDeliveryStatus,
  forwardNotificationDeliveryTest,
  forwardNotificationList,
  forwardNotificationPreferences,
} from "./notifications-bff";

const ID = "019d04cf-1f80-7000-8000-00000000a111";
const APP = "019d04cf-1f80-7000-8000-00000000a222";
const item = {
  id: ID,
  kind: "application_review_needed",
  urgency: "normal",
  state: "unread",
  applicationId: APP,
  sourceRevision: 3,
  createdAt: "2026-10-22T12:00:00.000Z",
  updatedAt: "2026-10-22T12:00:00.000Z",
  expiresAt: "2026-10-23T12:00:00.000Z",
};
const prefs = {
  version: 1,
  inAppEnabled: true,
  emailEnabled: false,
  quietHours: { enabled: false, startMinute: 1320, endMinute: 420, timeZone: "UTC" },
  updatedAt: "2026-10-22T12:00:00.000Z",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
const req = (url: string, init: RequestInit = {}) =>
  new Request(`https://app.example.test${url}`, init);

beforeEach(() => {
  forward.mockReset();
});

describe("notifications BFF (ADR-055)", () => {
  it("forwards a validated list query and validates the response", async () => {
    forward.mockResolvedValue(json({ items: [item], unreadCount: 1 }));
    const response = await forwardNotificationList(
      req("/api/platform/notifications?state=unread&limit=10&cursor=abc_DEF-1"),
    );
    expect(response.status).toBe(200);
    expect(forward).toHaveBeenCalledWith(
      "/v1/notifications?state=unread&limit=10&cursor=abc_DEF-1",
      expect.objectContaining({ method: "GET" }),
      expect.anything(),
    );
    forward.mockResolvedValue(json({ items: [{ ...item, extra: 1 }], unreadCount: 1 }));
    expect((await forwardNotificationList(req("/api/platform/notifications"))).status).toBe(503);
  });

  it.each(["state=all", "limit=0", "limit=101", "cursor=a%20b", "x=1", "state=open&state=unread"])(
    "refuses the list query %s without calling the platform",
    async (query) => {
      const response = await forwardNotificationList(req(`/api/platform/notifications?${query}`));
      expect(response.status).toBe(400);
      expect(forward).not.toHaveBeenCalled();
    },
  );

  it("forwards a bodyless same-origin command and refuses anything else", async () => {
    forward.mockResolvedValue(json({ ...item, state: "acknowledged" }));
    const ok = await forwardNotificationCommand(
      req(`/api/platform/notifications/${ID}/acknowledgement`, { method: "POST" }),
      ID,
      "acknowledgement",
    );
    expect(ok.status).toBe(200);
    expect(forward).toHaveBeenCalledWith(
      `/v1/notifications/${ID}/acknowledgement`,
      expect.objectContaining({ method: "POST" }),
      expect.anything(),
    );
    forward.mockClear();
    const refusals: [string, RequestInit, string][] = [
      [
        "a body",
        {
          method: "POST",
          headers: { "content-length": "2", "content-type": "application/json" },
          body: "{}",
        },
        ID,
      ],
      [
        "a cross-origin caller",
        { method: "POST", headers: { origin: "https://evil.example.test" } },
        ID,
      ],
      ["a GET", { method: "GET" }, ID],
      ["a bad id", { method: "POST" }, "not-a-uuid"],
    ];
    for (const [, init, id] of refusals) {
      const response = await forwardNotificationCommand(
        req(`/api/platform/notifications/${id}/dismissal`, init),
        id,
        "dismissal",
      );
      expect(response.status).toBe(400);
    }
    expect(forward).not.toHaveBeenCalled();
  });

  it("reads preferences and writes them only with a valid bounded JSON body", async () => {
    forward.mockResolvedValue(json(prefs));
    expect(
      (await forwardNotificationPreferences(req("/api/platform/notifications/preferences"))).status,
    ).toBe(200);
    const body = {
      expectedVersion: 0,
      emailEnabled: true,
      quietHours: { enabled: true, startMinute: 1320, endMinute: 420, timeZone: "UTC" },
    };
    const put = (value: unknown, headers: Record<string, string> = {}) =>
      forwardNotificationPreferences(
        req("/api/platform/notifications/preferences", {
          method: "PUT",
          headers: { "content-type": "application/json", ...headers },
          body: typeof value === "string" ? value : JSON.stringify(value),
        }),
      );
    forward.mockClear();
    forward.mockResolvedValue(json(prefs));
    expect((await put(body)).status).toBe(200);
    expect(forward).toHaveBeenCalledWith(
      "/v1/notifications/preferences",
      expect.objectContaining({ method: "PUT", body: JSON.stringify(body) }),
      expect.anything(),
    );
    forward.mockClear();
    expect((await put({ ...body, extra: true })).status).toBe(400);
    expect((await put("not json")).status).toBe(400);
    expect((await put(body, { origin: "https://evil.example.test" })).status).toBe(400);
    expect((await put(body, { "content-type": "text/plain" })).status).toBe(415);
    expect((await put(body, { "content-length": "99999" })).status).toBe(413);
    expect(forward).not.toHaveBeenCalled();
  });
});

describe("notification delivery BFF (ADR-056)", () => {
  const status = {
    email: { address: "person@example.com", state: "verified" },
  };
  it("forwards and validates the delivery status", async () => {
    forward.mockResolvedValue(json(status));
    const response = await forwardNotificationDeliveryStatus(
      req("/api/platform/notifications/delivery"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(status);
    expect(forward).toHaveBeenCalledWith(
      "/v1/notifications/delivery",
      expect.objectContaining({ method: "GET" }),
      expect.anything(),
    );
    forward.mockResolvedValue(json({ ...status, owner: "x" }));
    expect(
      (await forwardNotificationDeliveryStatus(req("/api/platform/notifications/delivery"))).status,
    ).toBe(503);
    forward.mockClear();
    expect(
      (await forwardNotificationDeliveryStatus(req("/api/platform/notifications/delivery?x=1")))
        .status,
    ).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });

  it("records the account email with a bodyless PUT carrying the session identity proof", async () => {
    forward.mockResolvedValue(new Response(null, { status: 204 }));
    const response = await forwardNotificationDeliveryEmail(
      req("/api/platform/notifications/delivery/email", { method: "PUT" }),
    );
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(forward).toHaveBeenCalledWith(
      "/v1/notifications/delivery/email",
      expect.objectContaining({ method: "PUT" }),
      expect.objectContaining({ includeReauthenticationProof: true }),
    );
    expect(forward.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });

  it("refuses an address from the browser, a query, a cross-origin caller and other methods", async () => {
    const url = "/api/platform/notifications/delivery/email";
    const jsonHeaders = { "content-type": "application/json" };
    for (const request of [
      req(url, {
        method: "PUT",
        body: JSON.stringify({ address: "a@example.com" }),
        headers: jsonHeaders,
      }),
      req(url, { method: "PUT", headers: jsonHeaders }),
      req(url, { method: "PUT", headers: { "content-length": "2" } }),
      req(`${url}?address=a@example.com`, { method: "PUT" }),
      req(url, { method: "PUT", headers: { origin: "https://evil.example" } }),
      req(url, { method: "DELETE" }),
      req(url, { method: "POST" }),
      req(url, { method: "GET" }),
    ])
      expect((await forwardNotificationDeliveryEmail(request)).status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });

  it("passes upstream refusals through and rejects an unexpected success status", async () => {
    const url = "/api/platform/notifications/delivery/email";
    forward.mockResolvedValue(
      Response.json(
        { code: "authentication_required" },
        { status: 401, headers: { "cache-control": "no-store" } },
      ),
    );
    expect((await forwardNotificationDeliveryEmail(req(url, { method: "PUT" }))).status).toBe(401);
    forward.mockResolvedValue(new Response(null, { status: 200 }));
    expect((await forwardNotificationDeliveryEmail(req(url, { method: "PUT" }))).status).toBe(503);
  });

  it("sends a test notification with no body and refuses anything else", async () => {
    forward.mockResolvedValue(json({ id: ID }, 201));
    const url = "/api/platform/notifications/delivery/test";
    const sent = await forwardNotificationDeliveryTest(req(url, { method: "POST" }));
    expect(sent.status).toBe(201);
    expect(await sent.json()).toEqual({ id: ID });
    expect(forward).toHaveBeenCalledWith(
      "/v1/notifications/delivery/test",
      expect.objectContaining({ method: "POST" }),
      expect.anything(),
    );
    forward.mockClear();
    for (const refused of [
      req(url, { method: "GET" }),
      req(`${url}?x=1`, { method: "POST" }),
      req(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      req(url, { method: "POST", headers: { origin: "https://evil.example" } }),
    ])
      expect((await forwardNotificationDeliveryTest(refused)).status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
    forward.mockResolvedValue(json({ id: "not-a-uuid" }, 201));
    expect((await forwardNotificationDeliveryTest(req(url, { method: "POST" }))).status).toBe(503);
    forward.mockResolvedValue(json({ title: "Too many" }, 429));
    expect((await forwardNotificationDeliveryTest(req(url, { method: "POST" }))).status).toBe(429);
  });
});
