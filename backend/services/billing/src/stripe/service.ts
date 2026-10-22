import type { StripeApi } from "./client.js";

/**
 * Candidate-initiated Stripe flows: start a Pro checkout and open the customer portal. Redirect
 * URLs are built from the configured application base URL, never from request input, and the user
 * id is attached to the Stripe subscription so the webhook can map it back. A checkout only starts
 * a payment: the entitlement changes solely through the verified webhook projection.
 */

export class StripeAlreadySubscribedError extends Error {
  constructor() {
    super("The account already has a Pro subscription");
    this.name = "StripeAlreadySubscribedError";
  }
}

export class StripeNoBillingAccountError extends Error {
  constructor() {
    super("The account has no billing account to manage");
    this.name = "StripeNoBillingAccountError";
  }
}

export interface StripeBillingServiceOptions {
  api: StripeApi;
  priceId: string;
  /** Origin and path prefix of the web app, for example `https://app.example.test`. */
  appBaseUrl: string;
  clock?: () => Date;
}

const LIVE_STATUSES: ReadonlySet<string> = new Set(["active", "trialing", "past_due"]);
const CHECKOUT_KEY_WINDOW_SECONDS = 600;

export class StripeBillingService {
  readonly #api: StripeApi;
  readonly #priceId: string;
  readonly #base: string;
  readonly #clock: () => Date;

  constructor(options: StripeBillingServiceOptions) {
    this.#api = options.api;
    this.#priceId = options.priceId;
    this.#base = options.appBaseUrl.replace(/\/+$/u, "");
    this.#clock = options.clock ?? (() => new Date());
  }

  #url(path: string): string {
    return `${this.#base}${path}`;
  }

  async startCheckout(userId: string): Promise<{ url: string }> {
    const existing = await this.#api.findSubscriptionByUser(userId);
    if (existing && LIVE_STATUSES.has(existing.status)) throw new StripeAlreadySubscribedError();
    const window = Math.floor(this.#clock().getTime() / 1_000 / CHECKOUT_KEY_WINDOW_SECONDS);
    return this.#api.createCheckoutSession({
      userId,
      priceId: this.#priceId,
      successUrl: this.#url("/settings?plan=success"),
      cancelUrl: this.#url("/settings?plan=cancelled"),
      idempotencyKey: `checkout:${userId}:${window}`,
    });
  }

  async openPortal(userId: string): Promise<{ url: string }> {
    const existing = await this.#api.findSubscriptionByUser(userId);
    if (!existing) throw new StripeNoBillingAccountError();
    return this.#api.createPortalSession({
      customerId: existing.customer,
      returnUrl: this.#url("/settings"),
    });
  }
}
