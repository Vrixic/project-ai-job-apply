// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanBilling } from "./plan-billing";

const grants = ["profile.manage", "jobs.search", "jobs.save", "applications.history"];

const free = {
  plan: "free",
  accessState: "active",
  grants,
  version: 0,
  evaluatedAt: "2026-10-22T12:00:00.000Z",
  limits: { maxStoredResumes: 1 },
};
const pro = {
  plan: "pro",
  accessState: "active",
  grants,
  version: 2,
  evaluatedAt: "2026-10-22T12:00:00.000Z",
  accessThrough: "2026-11-20T00:00:00.000Z",
  graceThrough: "2026-11-23T00:00:00.000Z",
  limits: { maxStoredResumes: 2 },
};

describe("PlanBilling", () => {
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
    window.history.replaceState(null, "", "/");
  });

  function stubFetch(summary: unknown, session?: Response) {
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      String(input).includes("/billing/")
        ? (session ?? Response.json({}, { status: 503 }))
        : Response.json(summary),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  async function render(navigate = vi.fn()) {
    await act(async () => root.render(<PlanBilling authenticated navigate={navigate} />));
    await act(async () => {});
    return navigate;
  }

  const button = (label: RegExp) =>
    Array.from(container.querySelectorAll("button")).find((item) =>
      label.test(item.textContent ?? ""),
    );

  it("shows nothing for a signed-out visitor", async () => {
    stubFetch(free);
    await act(async () => root.render(<PlanBilling authenticated={false} />));
    expect(container.textContent).toBe("");
  });

  it("offers an upgrade on Free and sends the candidate to Stripe Checkout", async () => {
    const fetchMock = stubFetch(
      free,
      Response.json({ url: "https://checkout.stripe.com/c/pay/cs_test" }, { status: 201 }),
    );
    const navigate = await render();
    expect(container.textContent).toContain("Stored resumes: up to 1 on Free.");
    expect(container.textContent).toContain("There are no other tiers");
    expect(button(/manage subscription/i)).toBeUndefined();
    await act(async () => button(/upgrade to pro/i)?.click());
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/platform/billing/checkout-sessions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(navigate).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test");
  });

  it("offers the customer portal on Pro and shows the paid-through date", async () => {
    stubFetch(
      pro,
      Response.json({ url: "https://billing.stripe.com/p/session/test" }, { status: 201 }),
    );
    const navigate = await render();
    expect(container.textContent).toContain("through 2026-11-20");
    expect(container.textContent).toContain("Stored resumes: up to 2 on Pro.");
    expect(button(/upgrade/i)).toBeUndefined();
    await act(async () => button(/manage subscription/i)?.click());
    await act(async () => {});
    expect(navigate).toHaveBeenCalledWith("https://billing.stripe.com/p/session/test");
  });

  it("never navigates to a URL that is not a Stripe-hosted page", async () => {
    stubFetch(free, Response.json({ url: "https://evil.example.test/pay" }, { status: 201 }));
    const navigate = await render();
    await act(async () => button(/upgrade to pro/i)?.click());
    await act(async () => {});
    expect(navigate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("temporarily unavailable");
  });

  it("explains a refusal with a stable message", async () => {
    stubFetch(free, Response.json({ code: "billing_already_subscribed" }, { status: 409 }));
    const navigate = await render();
    await act(async () => button(/upgrade to pro/i)?.click());
    await act(async () => {});
    expect(navigate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("already have a Pro subscription");
  });

  it("syncs from Stripe on returning from checkout and reports an updated plan", async () => {
    window.history.replaceState(null, "", "/settings?plan=success");
    const fetchMock = stubFetch(free, Response.json({ changed: true }));
    await render();
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/platform/billing/subscription-syncs",
      expect.objectContaining({ method: "POST" }),
    );
    expect(container.textContent).toContain("Your plan is updated.");
  });

  it("says the payment is not confirmed yet and lets the candidate check again", async () => {
    window.history.replaceState(null, "", "/settings?plan=success");
    const fetchMock = stubFetch(free, Response.json({ changed: false }));
    await render();
    await act(async () => {});
    expect(container.textContent).toContain("Payment not confirmed yet");
    await act(async () => button(/check payment status/i)?.click());
    await act(async () => {});
    const syncs = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("subscription-syncs"),
    );
    expect(syncs).toHaveLength(2);
  });

  it("does not sync when the candidate did not arrive from checkout", async () => {
    const fetchMock = stubFetch(free);
    await render();
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes("subscription-syncs")),
    ).toBe(false);
  });
});
