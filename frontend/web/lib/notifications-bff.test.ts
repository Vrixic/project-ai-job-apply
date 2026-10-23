import { beforeEach, describe, expect, it, vi } from "vitest";

const forward = vi.hoisted(() => vi.fn());
vi.mock("./platform-api", () => ({ forwardPlatformRequest: forward }));
vi.mock("./auth0", () => ({ getLazyAuth0Session: () => ({}) }));

import {
  forwardNotificationCommand,
  forwardNotificationDeliveryEmail,
  forwardNotificationDeliveryEmailConfirmation,
  forwardNotificationDeliveryPushSubscription,
  forwardNotificationDeliveryPushSubscriptions,
  forwardNotificationDeliveryStatus,
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
  pushEnabled: false,
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
      pushEnabled: false,
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
    email: { address: "person@example.com", state: "verified", codePending: false },
    pushSubscriptions: [{ id: ID, state: "active", createdAt: "2026-10-22T12:00:00.000Z" }],
    pushPublicKey: "B".repeat(87),
  };
  const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    req(url, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json", ...headers },
    });

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

  it("requests an email confirmation and answers 202 with no body", async () => {
    forward.mockResolvedValue(new Response(null, { status: 202 }));
    const response = await forwardNotificationDeliveryEmail(
      req("/api/platform/notifications/delivery/email", {
        method: "PUT",
        body: JSON.stringify({ address: "person@example.com" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
    expect(forward).toHaveBeenCalledWith(
      "/v1/notifications/delivery/email",
      expect.objectContaining({ method: "PUT", body: '{"address":"person@example.com"}' }),
      expect.anything(),
    );
  });

  it("refuses malformed, cross-origin, oversized and wrongly typed email requests", async () => {
    const send = (init: RequestInit) =>
      forwardNotificationDeliveryEmail(req("/api/platform/notifications/delivery/email", init));
    const jsonHeaders = { "content-type": "application/json" };
    expect((await send({ method: "PUT", body: "{}", headers: jsonHeaders })).status).toBe(400);
    expect(
      (
        await send({
          method: "PUT",
          body: JSON.stringify({ address: "person@example.com", extra: 1 }),
          headers: jsonHeaders,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send({
          method: "PUT",
          body: JSON.stringify({ address: "person@example.com" }),
          headers: { "content-type": "text/plain" },
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await send({
          method: "PUT",
          body: JSON.stringify({ address: "person@example.com" }),
          headers: { ...jsonHeaders, origin: "https://evil.example" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send({
          method: "PUT",
          body: JSON.stringify({ address: "a".repeat(5000) }),
          headers: jsonHeaders,
        })
      ).status,
    ).toBe(413);
    expect((await send({ method: "POST", body: "{}", headers: jsonHeaders })).status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });

  it("passes upstream refusals through and rejects an unexpected success status", async () => {
    forward.mockResolvedValue(
      Response.json(
        { code: "rate_limited" },
        { status: 429, headers: { "cache-control": "no-store" } },
      ),
    );
    const limited = await forwardNotificationDeliveryEmail(
      req("/api/platform/notifications/delivery/email", {
        method: "PUT",
        body: JSON.stringify({ address: "person@example.com" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(limited.status).toBe(429);
    forward.mockResolvedValue(new Response(null, { status: 200 }));
    const odd = await forwardNotificationDeliveryEmail(
      req("/api/platform/notifications/delivery/email", {
        method: "PUT",
        body: JSON.stringify({ address: "person@example.com" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(odd.status).toBe(503);
  });

  it("removes the email address with a bodyless same-origin DELETE", async () => {
    forward.mockResolvedValue(new Response(null, { status: 204 }));
    const url = "/api/platform/notifications/delivery/email";
    const removed = await forwardNotificationDeliveryEmail(req(url, { method: "DELETE" }));
    expect(removed.status).toBe(204);
    forward.mockClear();
    for (const init of [
      { method: "DELETE", headers: { origin: "https://evil.example" } },
      { method: "DELETE", headers: { "content-type": "application/json" } },
      { method: "DELETE", headers: { "content-length": "2" } },
    ])
      expect((await forwardNotificationDeliveryEmail(req(url, init))).status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });

  it("confirms an email with a six digit code and validates the result", async () => {
    forward.mockResolvedValue(json({ result: "verified" }));
    const url = "/api/platform/notifications/delivery/email/confirmation";
    const ok = await forwardNotificationDeliveryEmailConfirmation(post(url, { code: "123456" }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ result: "verified" });
    forward.mockClear();
    for (const bad of [{ code: "12345" }, { code: "abcdef" }, { code: 123456 }, {}])
      expect((await forwardNotificationDeliveryEmailConfirmation(post(url, bad))).status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
    forward.mockResolvedValue(json({ result: "approved" }));
    expect(
      (await forwardNotificationDeliveryEmailConfirmation(post(url, { code: "123456" }))).status,
    ).toBe(503);
  });

  it("registers and removes a browser push subscription", async () => {
    forward.mockResolvedValue(json({ id: ID }, 201));
    const url = "/api/platform/notifications/delivery/push-subscriptions";
    const created = await forwardNotificationDeliveryPushSubscriptions(
      post(url, { endpoint: "https://fcm.googleapis.com/fcm/send/abc" }),
    );
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ id: ID });
    forward.mockClear();
    for (const bad of [
      {},
      { endpoint: 4 },
      { endpoint: "x" },
      { endpoint: "https://a.example/b", extra: 1 },
    ])
      expect((await forwardNotificationDeliveryPushSubscriptions(post(url, bad))).status).toBe(400);
    expect(forward).not.toHaveBeenCalled();

    forward.mockResolvedValue(new Response(null, { status: 204 }));
    const removed = await forwardNotificationDeliveryPushSubscription(
      req(`${url}/${ID}`, { method: "DELETE" }),
      ID,
    );
    expect(removed.status).toBe(204);
    expect(forward).toHaveBeenCalledWith(
      `/v1/notifications/delivery/push-subscriptions/${ID}`,
      expect.objectContaining({ method: "DELETE" }),
      expect.anything(),
    );
    forward.mockClear();
    expect(
      (
        await forwardNotificationDeliveryPushSubscription(
          req(`${url}/not-a-uuid`, { method: "DELETE" }),
          "not-a-uuid",
        )
      ).status,
    ).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });
});
