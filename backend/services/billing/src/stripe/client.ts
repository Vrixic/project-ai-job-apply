import { parseStripeSubscription, type StripeSubscription } from "./projection.js";

/**
 * The small slice of the Stripe REST API this adapter uses. Requests are form-encoded, carry the
 * pinned `Stripe-Version`, and send an `Idempotency-Key` on every write. Responses are parsed
 * defensively and provider errors are reduced to a status and Stripe's error code: bodies, keys
 * and customer data never reach logs or callers.
 */

export const stripeApiVersion = "2025-09-30.clover";
const DEFAULT_BASE_URL = "https://api.stripe.com";
const REQUEST_TIMEOUT_MS = 10_000;

export class StripeApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(`Stripe request failed with status ${status}`);
    this.name = "StripeApiError";
  }

  /** A failure a retry may fix: network, rate limit, or a Stripe server error. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface StripeApi {
  retrieveSubscription(subscriptionId: string): Promise<StripeSubscription | undefined>;
  /** The newest subscription tagged with this user, in any state, or undefined. */
  findSubscriptionByUser(userId: string): Promise<StripeSubscription | undefined>;
  createCheckoutSession(input: {
    userId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }): Promise<{ url: string }>;
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
}

export interface StripeClientOptions {
  secretKey: string;
  baseUrl?: string;
  apiVersion?: string;
  fetch?: typeof fetch;
}

function encodeForm(entries: ReadonlyArray<readonly [string, string]>): string {
  return entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sessionUrl(body: unknown): string {
  const url = isRecord(body) && typeof body.url === "string" ? body.url : undefined;
  if (!url?.startsWith("https://")) throw new StripeApiError(502, "invalid_response");
  return url;
}

export class StripeClient implements StripeApi {
  readonly #secretKey: string;
  readonly #baseUrl: string;
  readonly #version: string;
  readonly #fetch: typeof fetch;

  constructor(options: StripeClientOptions) {
    this.#secretKey = options.secretKey;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, "");
    this.#version = options.apiVersion ?? stripeApiVersion;
    this.#fetch = options.fetch ?? fetch;
  }

  async #request(
    method: "GET" | "POST",
    path: string,
    form?: ReadonlyArray<readonly [string, string]>,
    idempotencyKey?: string,
  ): Promise<unknown> {
    const query = method === "GET" && form ? `?${encodeForm(form)}` : "";
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#secretKey}`,
      "Stripe-Version": this.#version,
      Accept: "application/json",
    };
    if (method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}${query}`, {
        method,
        headers,
        ...(method === "POST" && form ? { body: encodeForm(form) } : {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new StripeApiError(0, "network_error");
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    if (!response.ok) {
      const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
      const code = typeof error?.code === "string" ? error.code : undefined;
      throw new StripeApiError(response.status, code);
    }
    return body;
  }

  async retrieveSubscription(subscriptionId: string): Promise<StripeSubscription | undefined> {
    if (!/^sub_[A-Za-z0-9_]{1,200}$/u.test(subscriptionId)) return undefined;
    try {
      return parseStripeSubscription(
        await this.#request("GET", `/v1/subscriptions/${subscriptionId}`),
      );
    } catch (error) {
      if (error instanceof StripeApiError && error.status === 404) return undefined;
      throw error;
    }
  }

  async findSubscriptionByUser(userId: string): Promise<StripeSubscription | undefined> {
    if (!/^[0-9a-f-]{36}$/u.test(userId)) return undefined;
    const body = await this.#request("GET", "/v1/subscriptions/search", [
      ["query", `metadata['userId']:'${userId}'`],
      ["limit", "10"],
    ]);
    const data = isRecord(body) && Array.isArray(body.data) ? body.data : [];
    const found = data
      .map((item) => ({
        subscription: parseStripeSubscription(item),
        created: isRecord(item) && typeof item.created === "number" ? item.created : 0,
      }))
      .filter(
        (item): item is { subscription: StripeSubscription; created: number } =>
          item.subscription?.metadata?.userId === userId,
      )
      .sort((left, right) => right.created - left.created);
    return found[0]?.subscription;
  }

  async createCheckoutSession(input: {
    userId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }): Promise<{ url: string }> {
    const body = await this.#request(
      "POST",
      "/v1/checkout/sessions",
      [
        ["mode", "subscription"],
        ["line_items[0][price]", input.priceId],
        ["line_items[0][quantity]", "1"],
        ["success_url", input.successUrl],
        ["cancel_url", input.cancelUrl],
        ["client_reference_id", input.userId],
        ["subscription_data[metadata][userId]", input.userId],
        ["allow_promotion_codes", "false"],
      ],
      input.idempotencyKey,
    );
    return { url: sessionUrl(body) };
  }

  async createPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const body = await this.#request("POST", "/v1/billing_portal/sessions", [
      ["customer", input.customerId],
      ["return_url", input.returnUrl],
    ]);
    return { url: sessionUrl(body) };
  }
}
