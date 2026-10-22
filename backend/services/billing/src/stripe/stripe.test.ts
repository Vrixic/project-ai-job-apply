import { describe, expect, it, vi } from "vitest";
import {
  EntitlementIdempotencyConflictError,
  EntitlementVersionConflictError,
  type ApplyEntitlementChangeInput,
} from "../store.js";
import type { EntitlementSchedule } from "../types.js";
import { StripeApiError, StripeClient, type StripeApi } from "./client.js";
import { loadStripeConfig } from "./config.js";
import { parseStripeSubscription, projectSubscription } from "./projection.js";
import {
  StripeAlreadySubscribedError,
  StripeBillingService,
  StripeNoBillingAccountError,
} from "./service.js";
import { StripeSignatureError, signStripePayload, verifyStripeSignature } from "./signature.js";
import {
  handleStripeWebhook,
  reconcileStripeSubscription,
  stripeAdapterActorReference,
} from "./webhook.js";

const userId = "019d04cf-1f80-7000-8000-000000000001";
const now = new Date("2026-10-22T12:00:00Z");
const nowSeconds = Math.floor(now.getTime() / 1_000);
const day = 86_400;
const secret = "whsec_testsecret";

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_123",
    customer: "cus_123",
    status: "active",
    current_period_end: nowSeconds + 20 * day,
    metadata: { userId },
    ...overrides,
  };
}

describe("Stripe signature verification", () => {
  const payload = '{"id":"evt_12345678"}';
  const header = signStripePayload(payload, secret, now);

  it("accepts a fresh signature from any configured secret", () => {
    expect(() =>
      verifyStripeSignature({ payload, header, secrets: ["whsec_old", secret], now }),
    ).not.toThrow();
  });

  it("rejects a tampered body, wrong secret, stale timestamp and malformed headers", () => {
    const bad = (input: Partial<Parameters<typeof verifyStripeSignature>[0]>) =>
      expect(() =>
        verifyStripeSignature({ payload, header, secrets: [secret], now, ...input }),
      ).toThrow(StripeSignatureError);
    bad({ payload: `${payload} ` });
    bad({ secrets: ["whsec_other"] });
    bad({ secrets: [] });
    bad({ now: new Date(now.getTime() + 301_000) });
    bad({ header: undefined });
    bad({ header: "" });
    bad({ header: "v1=abc" });
    bad({ header: `t=${nowSeconds}` });
    bad({ header: `t=${nowSeconds},v1=${"0".repeat(64)}` });
    bad({ header: `t=${nowSeconds},t=${nowSeconds},v1=${header.split("v1=")[1]}` });
  });
});

describe("subscription projection", () => {
  it("grants Pro through the paid-through time with a grace window", () => {
    const parsed = parseStripeSubscription(subscription());
    expect(parsed).toBeDefined();
    const grant = projectSubscription(parsed as never, now);
    expect(grant).toEqual({
      plan: "pro",
      effectiveAt: now,
      accessThrough: new Date((nowSeconds + 20 * day) * 1_000),
      graceThrough: new Date((nowSeconds + 23 * day) * 1_000),
    });
  });

  it("reads the period from items on newer API versions", () => {
    const parsed = parseStripeSubscription(
      subscription({
        current_period_end: undefined,
        items: { data: [{ current_period_end: nowSeconds + 5 * day, price: { id: "price_1" } }] },
      }),
    );
    expect(projectSubscription(parsed as never, now)).toMatchObject({ plan: "pro" });
  });

  it("keeps access for a subscription that ends with its period, and for retrying payments", () => {
    for (const status of ["trialing", "past_due"]) {
      const parsed = parseStripeSubscription(subscription({ status, cancel_at_period_end: true }));
      expect(projectSubscription(parsed as never, now).plan).toBe("pro");
    }
  });

  it("is Free for every other state and once paid time and grace have passed", () => {
    for (const status of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) {
      expect(
        projectSubscription(parseStripeSubscription(subscription({ status })) as never, now),
      ).toEqual({
        plan: "free",
        effectiveAt: now,
      });
    }
    const expired = parseStripeSubscription(
      subscription({ current_period_end: nowSeconds - 10 * day }),
    );
    expect(projectSubscription(expired as never, now).plan).toBe("free");
    const noPeriod = parseStripeSubscription(subscription({ current_period_end: undefined }));
    expect(projectSubscription(noPeriod as never, now).plan).toBe("free");
  });

  it("keeps a short Pro window while grace remains after the paid period ended", () => {
    const parsed = parseStripeSubscription(subscription({ current_period_end: nowSeconds - day }));
    const grant = projectSubscription(parsed as never, now);
    expect(grant.plan).toBe("pro");
    if (grant.plan === "pro") {
      expect(grant.accessThrough.getTime()).toBeGreaterThan(now.getTime());
      expect(grant.graceThrough?.getTime()).toBe((nowSeconds + 2 * day) * 1_000);
    }
  });

  it("rejects malformed subscriptions", () => {
    expect(parseStripeSubscription(null)).toBeUndefined();
    expect(parseStripeSubscription(subscription({ id: "nope" }))).toBeUndefined();
    expect(parseStripeSubscription(subscription({ customer: 5 }))).toBeUndefined();
    expect(parseStripeSubscription(subscription({ status: "weird" }))).toBeUndefined();
  });
});

function schedule(overrides: Partial<EntitlementSchedule> = {}): EntitlementSchedule {
  return { userId, version: 0, plan: "free", ...overrides } as EntitlementSchedule;
}

function harness(options: {
  subscription?: unknown;
  schedules?: EntitlementSchedule[];
  apply?: (input: ApplyEntitlementChangeInput) => Promise<unknown>;
}) {
  const schedules = [...(options.schedules ?? [schedule()])];
  const applied: ApplyEntitlementChangeInput[] = [];
  const api = {
    retrieveSubscription: vi.fn(async () =>
      options.subscription === undefined
        ? undefined
        : parseStripeSubscription(options.subscription),
    ),
  } as unknown as StripeApi;
  const billing = {
    readEntitlement: vi.fn(async () =>
      schedules.length > 1
        ? (schedules.shift() as EntitlementSchedule)
        : (schedules[0] as EntitlementSchedule),
    ),
    applyEntitlementChange: vi.fn(async (input: ApplyEntitlementChangeInput) => {
      applied.push(input);
      return (
        (await options.apply?.(input)) ?? {
          schedule: {},
          changeId: "c",
          outboxEventId: "o",
          replayed: false,
        }
      );
    }),
  };
  const deliver = (body: string, signature = signStripePayload(body, secret, now)) =>
    handleStripeWebhook(
      { api, billing: billing as never, webhookSecrets: [secret], clock: () => now },
      { rawBody: body, signature },
    );
  return { api, billing, applied, deliver };
}

const event = (type: string, object: Record<string, unknown>, id = "evt_00000001") =>
  JSON.stringify({ id, type, data: { object } });

describe("Stripe webhook handling", () => {
  it("rejects a request without a valid signature before touching anything", async () => {
    const h = harness({ subscription: subscription() });
    await expect(
      h.deliver(event("customer.subscription.updated", { id: "sub_123" }), "t=1,v1=00"),
    ).rejects.toBeInstanceOf(StripeSignatureError);
    expect(h.api.retrieveSubscription).not.toHaveBeenCalled();
    expect(h.billing.applyEntitlementChange).not.toHaveBeenCalled();
  });

  it("projects the retrieved subscription, not the event payload", async () => {
    const h = harness({ subscription: subscription() });
    const body = event("customer.subscription.updated", {
      id: "sub_123",
      status: "canceled",
      metadata: { userId: "someone-else" },
    });
    await expect(h.deliver(body)).resolves.toBe("applied");
    expect(h.applied).toHaveLength(1);
    expect(h.applied[0]).toMatchObject({
      userId,
      expectedVersion: 0,
      idempotencyKey: "stripe:evt_00000001",
      reasonCode: "provider_projection",
      actor: { kind: "provider_adapter", reference: stripeAdapterActorReference },
      grant: { plan: "pro" },
    });
    expect(h.applied[0]?.occurredAt).toEqual(now);
  });

  it("resolves the subscription from checkout and invoice events", async () => {
    for (const body of [
      event("checkout.session.completed", { subscription: "sub_123" }),
      event("invoice.paid", { parent: { subscription_details: { subscription: "sub_123" } } }),
      event("invoice.payment_failed", { subscription: "sub_123" }),
    ]) {
      const h = harness({ subscription: subscription() });
      await expect(h.deliver(body)).resolves.toBe("applied");
    }
  });

  it("ignores unrelated events and subscriptions the application did not tag", async () => {
    const h = harness({ subscription: subscription() });
    await expect(h.deliver(event("customer.created", { id: "cus_1" }))).resolves.toBe("ignored");
    const untagged = harness({ subscription: subscription({ metadata: {} }) });
    await expect(
      untagged.deliver(event("customer.subscription.created", { id: "sub_123" })),
    ).resolves.toBe("ignored");
    const missing = harness({});
    await expect(
      missing.deliver(event("customer.subscription.created", { id: "sub_123" })),
    ).resolves.toBe("ignored");
    expect(h.applied).toHaveLength(0);
    expect(untagged.applied).toHaveLength(0);
  });

  it("writes nothing when the entitlement already matches", async () => {
    const parsed = parseStripeSubscription(subscription());
    const grant = projectSubscription(parsed as never, now);
    const h = harness({
      subscription: subscription(),
      schedules: [schedule({ version: 3, plan: "pro", ...(grant as object) } as never)],
    });
    await expect(
      h.deliver(event("customer.subscription.updated", { id: "sub_123" })),
    ).resolves.toBe("unchanged");
    const free = harness({ subscription: subscription({ status: "canceled" }) });
    await expect(
      free.deliver(event("customer.subscription.deleted", { id: "sub_123" })),
    ).resolves.toBe("unchanged");
    expect(h.applied).toHaveLength(0);
    expect(free.applied).toHaveLength(0);
  });

  it("revokes a Pro entitlement when the subscription is cancelled", async () => {
    const h = harness({
      subscription: subscription({ status: "canceled" }),
      schedules: [
        schedule({
          version: 2,
          plan: "pro",
          accessThrough: new Date("2026-11-01T00:00:00Z"),
        } as never),
      ],
    });
    await expect(
      h.deliver(event("customer.subscription.deleted", { id: "sub_123" })),
    ).resolves.toBe("applied");
    expect(h.applied[0]).toMatchObject({ expectedVersion: 2, grant: { plan: "free" } });
  });

  it("re-reads and retries when another writer changed the version", async () => {
    let calls = 0;
    const h = harness({
      subscription: subscription(),
      schedules: [schedule({ version: 0 }), schedule({ version: 1 })],
      apply: async () => {
        calls += 1;
        if (calls === 1) throw new EntitlementVersionConflictError();
        return { schedule: {}, changeId: "c", outboxEventId: "o", replayed: false };
      },
    });
    await expect(
      h.deliver(event("customer.subscription.updated", { id: "sub_123" })),
    ).resolves.toBe("applied");
    expect(h.applied.map((input) => input.expectedVersion)).toEqual([0, 1]);
  });

  it("acknowledges a redelivered event whose first processing already committed", async () => {
    const h = harness({
      subscription: subscription(),
      apply: async () => {
        throw new EntitlementIdempotencyConflictError();
      },
    });
    await expect(
      h.deliver(event("customer.subscription.updated", { id: "sub_123" })),
    ).resolves.toBe("replayed");
  });

  it("surfaces unexpected failures so Stripe retries the delivery", async () => {
    const h = harness({
      subscription: subscription(),
      apply: async () => {
        throw new Error("database unavailable");
      },
    });
    await expect(
      h.deliver(event("customer.subscription.updated", { id: "sub_123" })),
    ).rejects.toThrow("database unavailable");
  });

  it("rejects a signed but malformed payload", async () => {
    const h = harness({});
    await expect(h.deliver("not json")).rejects.toMatchObject({
      name: "StripeWebhookPayloadError",
    });
    await expect(h.deliver(JSON.stringify({ id: "x", type: "y" }))).rejects.toMatchObject({
      name: "StripeWebhookPayloadError",
    });
  });
});

describe("Stripe configuration", () => {
  const full = {
    STRIPE_SECRET_KEY: "sk_test_abc123",
    STRIPE_WEBHOOK_SECRETS: "whsec_one, whsec_two",
    STRIPE_PRO_PRICE_ID: "price_123",
    BILLING_APP_BASE_URL: "https://app.example.test/",
  };

  it("is disabled when nothing is set and complete when everything is", () => {
    expect(loadStripeConfig({})).toBeUndefined();
    expect(loadStripeConfig(full)).toEqual({
      secretKey: "sk_test_abc123",
      webhookSecrets: ["whsec_one", "whsec_two"],
      priceId: "price_123",
      appBaseUrl: "https://app.example.test",
    });
  });

  it("fails on partial or malformed configuration", () => {
    expect(() => loadStripeConfig({ STRIPE_SECRET_KEY: "sk_test_abc" })).toThrow(/partially/u);
    expect(() => loadStripeConfig({ ...full, STRIPE_SECRET_KEY: "nope" })).toThrow();
    expect(() => loadStripeConfig({ ...full, STRIPE_WEBHOOK_SECRETS: "abc" })).toThrow();
    expect(() => loadStripeConfig({ ...full, STRIPE_PRO_PRICE_ID: "p" })).toThrow();
    expect(() =>
      loadStripeConfig({ ...full, BILLING_APP_BASE_URL: "http://app.example.test" }),
    ).toThrow();
    expect(() =>
      loadStripeConfig({ ...full, BILLING_APP_BASE_URL: "https://a.test/?x=1" }),
    ).toThrow();
  });
});

describe("Stripe checkout and portal service", () => {
  function setup(existing?: ReturnType<typeof parseStripeSubscription>) {
    const api = {
      findSubscriptionByUser: vi.fn(async () => existing),
      createCheckoutSession: vi.fn(async () => ({ url: "https://checkout.stripe.com/c/1" })),
      createPortalSession: vi.fn(async () => ({ url: "https://billing.stripe.com/p/1" })),
    };
    const service = new StripeBillingService({
      api: api as unknown as StripeApi,
      priceId: "price_123",
      appBaseUrl: "https://app.example.test",
      clock: () => now,
    });
    return { api, service };
  }

  it("starts checkout with server-built redirect URLs", async () => {
    const { api, service } = setup();
    await expect(service.startCheckout(userId)).resolves.toEqual({
      url: "https://checkout.stripe.com/c/1",
    });
    expect(api.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        priceId: "price_123",
        successUrl: "https://app.example.test/settings?plan=success",
        cancelUrl: "https://app.example.test/settings?plan=cancelled",
      }),
    );
  });

  it("refuses a second checkout while a subscription is live", async () => {
    const { service } = setup(parseStripeSubscription(subscription()));
    await expect(service.startCheckout(userId)).rejects.toBeInstanceOf(
      StripeAlreadySubscribedError,
    );
  });

  it("allows checkout again after a cancelled subscription", async () => {
    const { service } = setup(parseStripeSubscription(subscription({ status: "canceled" })));
    await expect(service.startCheckout(userId)).resolves.toBeDefined();
  });

  it("opens the portal for the subscriber's own customer only", async () => {
    const { api, service } = setup(parseStripeSubscription(subscription()));
    await service.openPortal(userId);
    expect(api.createPortalSession).toHaveBeenCalledWith({
      customerId: "cus_123",
      returnUrl: "https://app.example.test/settings",
    });
    const none = setup();
    await expect(none.service.openPortal(userId)).rejects.toBeInstanceOf(
      StripeNoBillingAccountError,
    );
  });
});

describe("Stripe client", () => {
  function client(response: { status?: number; body: unknown }) {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(response.body), {
          status: response.status ?? 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    return {
      fetchMock,
      client: new StripeClient({ secretKey: "sk_test_abc", fetch: fetchMock as never }),
    };
  }

  it("sends a pinned version, bearer auth and an idempotency key on checkout", async () => {
    const { client: stripe, fetchMock } = client({
      body: { url: "https://checkout.stripe.com/c/1" },
    });
    await stripe.createCheckoutSession({
      userId,
      priceId: "price_123",
      successUrl: "https://app.example.test/ok",
      cancelUrl: "https://app.example.test/no",
      idempotencyKey: "checkout:key",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk_test_abc");
    expect(headers["Stripe-Version"]).toMatch(/^\d{4}-\d{2}-\d{2}/u);
    expect(headers["Idempotency-Key"]).toBe("checkout:key");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("mode")).toBe("subscription");
    expect(body.get("subscription_data[metadata][userId]")).toBe(userId);
    expect(body.get("client_reference_id")).toBe(userId);
  });

  it("reduces provider errors to a status and code", async () => {
    const { client: stripe } = client({
      status: 429,
      body: { error: { code: "rate_limit", message: "secret details" } },
    });
    const error = await stripe
      .createPortalSession({ customerId: "cus_1", returnUrl: "https://a.test" })
      .catch((e) => e);
    expect(error).toBeInstanceOf(StripeApiError);
    expect(error).toMatchObject({ status: 429, code: "rate_limit", retryable: true });
    expect(String(error.message)).not.toContain("secret");
  });

  it("treats an unknown subscription as missing and rejects a non-https session url", async () => {
    const missing = client({ status: 404, body: { error: { code: "resource_missing" } } });
    await expect(missing.client.retrieveSubscription("sub_1")).resolves.toBeUndefined();
    const bad = client({ body: { url: "http://evil.test" } });
    await expect(
      bad.client.createPortalSession({ customerId: "cus_1", returnUrl: "https://a.test" }),
    ).rejects.toBeInstanceOf(StripeApiError);
  });

  it("finds the newest subscription tagged with the user", async () => {
    const { client: stripe } = client({
      body: {
        data: [
          { ...subscription({ id: "sub_old", status: "canceled" }), created: 1 },
          { ...subscription({ id: "sub_new" }), created: 9 },
          { ...subscription({ id: "sub_other", metadata: { userId: "x" } }), created: 99 },
        ],
      },
    });
    await expect(stripe.findSubscriptionByUser(userId)).resolves.toMatchObject({ id: "sub_new" });
  });
});

describe("Stripe reconciliation (D6-007)", () => {
  function pull(found: unknown, retrieved: unknown = found, schedules?: EntitlementSchedule[]) {
    const h = harness({ subscription: retrieved, ...(schedules ? { schedules } : {}) });
    const api = {
      findSubscriptionByUser: vi.fn(async () =>
        found === undefined ? undefined : parseStripeSubscription(found),
      ),
      retrieveSubscription: h.api.retrieveSubscription,
    } as unknown as StripeApi;
    const run = () =>
      reconcileStripeSubscription({ api, billing: h.billing as never, clock: () => now }, userId);
    return { ...h, run };
  }

  it("projects the candidate's own subscription as a system reconciliation", async () => {
    const h = pull(subscription());
    await expect(h.run()).resolves.toBe("applied");
    expect(h.applied[0]).toMatchObject({
      userId,
      reasonCode: "reconciliation",
      actor: { kind: "system", reference: stripeAdapterActorReference },
      grant: { plan: "pro" },
    });
    expect(h.applied[0]?.idempotencyKey).toMatch(/^stripe-sync:/u);
  });

  it("does nothing when Stripe holds no subscription for the candidate", async () => {
    const h = pull(undefined);
    await expect(h.run()).resolves.toBe("unchanged");
    expect(h.applied).toHaveLength(0);
  });

  it("never projects a subscription tagged for a different user", async () => {
    const other = subscription({ metadata: { userId: "019d04cf-1f80-7000-8000-0000000000aa" } });
    const h = pull(other);
    await expect(h.run()).resolves.toBe("unchanged");
    expect(h.applied).toHaveLength(0);
  });

  it("uses the retrieved subscription, which is strongly consistent, over the search result", async () => {
    const h = pull(subscription({ status: "incomplete" }), subscription({ status: "active" }));
    await expect(h.run()).resolves.toBe("applied");
    expect(h.applied[0]?.grant.plan).toBe("pro");
  });

  it("is idempotent when the entitlement already matches", async () => {
    const parsed = parseStripeSubscription(subscription());
    const grant = projectSubscription(parsed as never, now);
    const h = pull(subscription(), subscription(), [
      schedule({ version: 4, plan: "pro", ...(grant as object) } as never),
    ]);
    await expect(h.run()).resolves.toBe("unchanged");
    expect(h.applied).toHaveLength(0);
  });
});
