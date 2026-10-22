import type { EntitlementGrant } from "../store.js";

/**
 * Projects a Stripe subscription onto the provider-neutral entitlement model (D6-005, D6-007).
 *
 * The subscription fetched from Stripe is the source of truth, never the order in which events
 * arrive. Pro access runs through the paid-through time (`current_period_end`), so a cancelled
 * subscription that is set to end with its period keeps access until then, and a delayed or lost
 * renewal webhook does not revoke paid access: a short grace window follows the paid-through time.
 */

export const defaultGraceSeconds = 3 * 24 * 60 * 60;

export type StripeSubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";

const STATUSES: ReadonlySet<string> = new Set([
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
]);

/** The fields of a Stripe subscription this adapter reads; everything else is ignored. */
export interface StripeSubscription {
  id: string;
  customer: string;
  status: StripeSubscriptionStatus;
  cancel_at_period_end?: boolean;
  /** API versions before 2025-03-31 carry the period on the subscription... */
  current_period_end?: number;
  /** ...later versions carry it on each item. */
  items?: { data?: ReadonlyArray<{ current_period_end?: number; price?: { id?: string } }> };
  metadata?: Record<string, string>;
}

const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9_]{1,200}$/u;
const CUSTOMER_ID = /^cus_[A-Za-z0-9_]{1,200}$/u;

/** Parses the fields we rely on, or returns undefined for anything malformed. */
export function parseStripeSubscription(value: unknown): StripeSubscription | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !SUBSCRIPTION_ID.test(raw.id)) return undefined;
  const customer =
    typeof raw.customer === "string"
      ? raw.customer
      : typeof (raw.customer as { id?: unknown } | null)?.id === "string"
        ? ((raw.customer as { id: string }).id as string)
        : undefined;
  if (customer === undefined || !CUSTOMER_ID.test(customer)) return undefined;
  if (typeof raw.status !== "string" || !STATUSES.has(raw.status)) return undefined;
  const periodOf = (candidate: unknown): number | undefined =>
    typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate > 0
      ? candidate
      : undefined;
  const items: Array<{ current_period_end?: number; price?: { id?: string } }> = [];
  const rawItems = (raw.items as { data?: unknown } | undefined)?.data;
  if (Array.isArray(rawItems)) {
    for (const item of rawItems.slice(0, 20)) {
      if (typeof item !== "object" || item === null) continue;
      const end = periodOf((item as { current_period_end?: unknown }).current_period_end);
      const priceId = (item as { price?: { id?: unknown } }).price?.id;
      items.push({
        ...(end !== undefined ? { current_period_end: end } : {}),
        ...(typeof priceId === "string" ? { price: { id: priceId } } : {}),
      });
    }
  }
  const metadata: Record<string, string> = {};
  if (typeof raw.metadata === "object" && raw.metadata !== null && !Array.isArray(raw.metadata)) {
    for (const [key, entry] of Object.entries(raw.metadata as Record<string, unknown>).slice(
      0,
      50,
    )) {
      if (typeof entry === "string" && entry.length <= 500) metadata[key] = entry;
    }
  }
  const period = periodOf(raw.current_period_end);
  return {
    id: raw.id,
    customer,
    status: raw.status as StripeSubscriptionStatus,
    ...(typeof raw.cancel_at_period_end === "boolean"
      ? { cancel_at_period_end: raw.cancel_at_period_end }
      : {}),
    ...(period !== undefined ? { current_period_end: period } : {}),
    items: { data: items },
    metadata,
  };
}

/** The paid-through time in epoch seconds: the latest item period end, or the subscription's. */
export function paidThroughSeconds(subscription: StripeSubscription): number | undefined {
  const ends = [
    subscription.current_period_end,
    ...(subscription.items?.data ?? []).map((item) => item.current_period_end),
  ].filter((value): value is number => typeof value === "number");
  return ends.length > 0 ? Math.max(...ends) : undefined;
}

/**
 * Pro runs through the paid-through time plus the grace window while the subscription is
 * `active`, `trialing` or `past_due` (a payment retry in progress). Every other status, or a
 * missing or already-elapsed period, is Free from now.
 */
export function projectSubscription(
  subscription: StripeSubscription,
  now: Date,
  options: { graceSeconds?: number } = {},
): EntitlementGrant {
  const free: EntitlementGrant = { plan: "free", effectiveAt: now };
  if (
    subscription.status !== "active" &&
    subscription.status !== "trialing" &&
    subscription.status !== "past_due"
  ) {
    return free;
  }
  const paidThrough = paidThroughSeconds(subscription);
  if (paidThrough === undefined) return free;
  const accessThrough = new Date(paidThrough * 1_000);
  const graceSeconds = options.graceSeconds ?? defaultGraceSeconds;
  const graceThrough = new Date(accessThrough.getTime() + graceSeconds * 1_000);
  // Access and grace are both over: nothing paid remains.
  if (graceThrough.getTime() <= now.getTime()) return free;
  if (accessThrough.getTime() <= now.getTime()) {
    // Paid-through has passed but grace remains: keep a minimal Pro window that ends with grace.
    return {
      plan: "pro",
      effectiveAt: now,
      accessThrough: new Date(now.getTime() + 1_000),
      graceThrough,
    };
  }
  return { plan: "pro", effectiveAt: now, accessThrough, graceThrough };
}
