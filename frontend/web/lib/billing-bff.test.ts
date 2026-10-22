import { beforeEach, describe, expect, it, vi } from "vitest";

const forward = vi.hoisted(() => vi.fn());
vi.mock("./platform-api", () => ({ forwardPlatformRequest: forward }));
vi.mock("./auth0", () => ({ getLazyAuth0Session: () => ({}) }));

import { forwardBillingSession, forwardBillingSync, isStripeHostedUrl } from "./billing-bff";

const request = (
  init: RequestInit = {},
  url = "https://app.example.test/api/platform/billing/checkout-sessions",
) => new Request(url, { method: "POST", ...init });

const link = (url: string) =>
  Response.json({ url }, { status: 201, headers: { "content-type": "application/json" } });

describe("billing BFF", () => {
  beforeEach(() => forward.mockReset());

  it("accepts only Stripe-hosted https URLs", () => {
    expect(isStripeHostedUrl("https://checkout.stripe.com/c/pay/x")).toBe(true);
    expect(isStripeHostedUrl("https://billing.stripe.com/p/x")).toBe(true);
    for (const bad of [
      "http://checkout.stripe.com/x",
      "https://stripe.com.evil.test/x",
      "https://user:pw@checkout.stripe.com/x",
      "https://evil.test/checkout.stripe.com",
      "not a url",
      42,
    ]) {
      expect(isStripeHostedUrl(bad)).toBe(false);
    }
  });

  it("forwards a bodyless POST and returns a validated Stripe session link", async () => {
    forward.mockResolvedValue(link("https://checkout.stripe.com/c/pay/cs_test"));
    const response = await forwardBillingSession(request(), "checkout-sessions");
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test" });
    expect(forward).toHaveBeenCalledWith(
      "/v1/billing/checkout-sessions",
      expect.objectContaining({ method: "POST" }),
      expect.anything(),
    );
    expect(forward.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });

  it("refuses bodies, queries and cross-origin requests without calling the platform", async () => {
    const bad = [
      request({ body: "{}", headers: { "content-type": "application/json" } }),
      request({ headers: { "content-length": "2" } }),
      request({ headers: { origin: "https://evil.example.test" } }),
      request({}, "https://app.example.test/api/platform/billing/checkout-sessions?price=x"),
    ];
    for (const item of bad) {
      expect((await forwardBillingSession(item, "checkout-sessions")).status).toBe(400);
    }
    expect(forward).not.toHaveBeenCalled();
    const sameOrigin = request({ headers: { origin: "https://app.example.test" } });
    forward.mockResolvedValue(link("https://billing.stripe.com/p/x"));
    expect((await forwardBillingSession(sameOrigin, "portal-sessions")).status).toBe(201);
  });

  it("replaces a non-Stripe URL from upstream with an unavailable problem", async () => {
    forward.mockResolvedValue(link("https://evil.example.test/pay"));
    const response = await forwardBillingSession(request(), "checkout-sessions");
    expect(response.status).toBe(503);
  });

  it("passes upstream refusals through unchanged", async () => {
    forward.mockResolvedValue(
      Response.json({ code: "billing_already_subscribed" }, { status: 409 }),
    );
    const response = await forwardBillingSession(request(), "checkout-sessions");
    expect(response.status).toBe(409);
  });

  it("forwards a bodyless sync and validates its response", async () => {
    forward.mockResolvedValue(
      Response.json(
        { changed: true },
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const response = await forwardBillingSync(
      request({}, "https://app.example.test/api/platform/billing/subscription-syncs"),
    );
    expect(response.status).toBe(200);
    expect(forward).toHaveBeenCalledWith(
      "/v1/billing/subscription-syncs",
      expect.objectContaining({ method: "POST" }),
      expect.anything(),
    );
    forward.mockClear();
    const refused = await forwardBillingSync(
      request({ headers: { origin: "https://evil.example.test" } }),
    );
    expect(refused.status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });
});
