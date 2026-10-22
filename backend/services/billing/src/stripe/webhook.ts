import { v7 as uuidv7 } from "uuid";
import {
  EntitlementIdempotencyConflictError,
  EntitlementVersionConflictError,
  type ApplyEntitlementChangeInput,
  type ApplyEntitlementChangeResult,
  type EntitlementGrant,
} from "../store.js";
import type { EntitlementReader, EntitlementSchedule } from "../types.js";
import type { StripeApi } from "./client.js";
import { type StripeSubscription, projectSubscription } from "./projection.js";
import { verifyStripeSignature } from "./signature.js";

/**
 * Stripe webhook processing (D6-005, D6-007). The signed event only says that a subscription
 * changed. The handler then retrieves the subscription from Stripe and projects that current state
 * onto the entitlement, so out-of-order, duplicated and replayed events all converge on the
 * provider's latest truth. The application never trusts event payload fields beyond the ids.
 */

/** The fixed attribution for every projection written by this adapter. */
export const stripeAdapterActorReference = "019d04cf-1f80-7000-8000-00000000b111";

export type StripeWebhookOutcome = "applied" | "unchanged" | "replayed" | "ignored";

export interface StripeWebhookDependencies {
  api: StripeApi;
  billing: EntitlementReader & {
    applyEntitlementChange(
      input: ApplyEntitlementChangeInput,
    ): Promise<ApplyEntitlementChangeResult>;
  };
  /** Accepted signing secrets; more than one allows rotation. */
  webhookSecrets: readonly string[];
  clock?: () => Date;
  graceSeconds?: number;
  /** Optional hook for the safe outcome log line. */
  onOutcome?: (outcome: { outcome: StripeWebhookOutcome; eventType: string }) => void;
}

const EVENT_ID = /^evt_[A-Za-z0-9_]{8,200}$/u;
const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9_]{1,200}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_ATTEMPTS = 4;

export class StripeWebhookPayloadError extends Error {
  constructor() {
    super("The Stripe event payload is malformed");
    this.name = "StripeWebhookPayloadError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asId(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.id === "string") return value.id;
  return undefined;
}

/** The subscription id an event refers to, or undefined for events this adapter ignores. */
export function subscriptionIdFromEvent(
  type: string,
  object: Record<string, unknown>,
): string | undefined {
  let candidate: string | undefined;
  if (type.startsWith("customer.subscription.")) {
    candidate = asId(object.id);
  } else if (
    type === "checkout.session.completed" ||
    type === "checkout.session.async_payment_succeeded"
  ) {
    candidate = asId(object.subscription);
  } else if (type === "invoice.paid" || type === "invoice.payment_failed") {
    const parent = isRecord(object.parent) ? object.parent : undefined;
    const details = isRecord(parent?.subscription_details)
      ? parent.subscription_details
      : undefined;
    candidate = asId(details?.subscription) ?? asId(object.subscription);
  }
  return candidate !== undefined && SUBSCRIPTION_ID.test(candidate) ? candidate : undefined;
}

function sameGrant(schedule: EntitlementSchedule, grant: EntitlementGrant): boolean {
  if (schedule.plan !== grant.plan) return false;
  if (grant.plan === "free") return true;
  if (schedule.plan !== "pro") return false;
  return (
    schedule.accessThrough.getTime() === grant.accessThrough.getTime() &&
    (schedule.graceThrough?.getTime() ?? null) === (grant.graceThrough?.getTime() ?? null)
  );
}

async function applyProjection(
  deps: StripeWebhookDependencies,
  userId: string,
  eventId: string,
  subscription: StripeSubscription,
): Promise<StripeWebhookOutcome> {
  const clock = deps.clock ?? (() => new Date());
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const schedule = await deps.billing.readEntitlement(userId);
    const now = new Date(Math.floor(clock().getTime() / 1_000) * 1_000);
    const grant = projectSubscription(subscription, now, {
      ...(deps.graceSeconds !== undefined ? { graceSeconds: deps.graceSeconds } : {}),
    });
    if (sameGrant(schedule, grant)) return "unchanged";
    // A user with no stored entitlement is already implicitly Free.
    if (schedule.version === 0 && grant.plan === "free") return "unchanged";
    try {
      const result = await deps.billing.applyEntitlementChange({
        userId,
        expectedVersion: schedule.version,
        idempotencyKey: `stripe:${eventId}`,
        occurredAt: now,
        traceId: uuidv7(),
        reasonCode: "provider_projection",
        actor: { kind: "provider_adapter", reference: stripeAdapterActorReference },
        grant,
      });
      return result.replayed ? "replayed" : "applied";
    } catch (error) {
      // Another writer won the version: re-read and project again.
      if (error instanceof EntitlementVersionConflictError) continue;
      // The event was already applied; a later redelivery projects a different instant.
      if (error instanceof EntitlementIdempotencyConflictError) return "replayed";
      throw error;
    }
  }
  throw new EntitlementVersionConflictError();
}

/**
 * Verifies and processes one Stripe webhook delivery. Throws `StripeSignatureError` for an
 * unauthenticated request (respond 400) and any other error for a failure Stripe should retry
 * (respond 5xx). Every successful return is a 2xx.
 */
export async function handleStripeWebhook(
  deps: StripeWebhookDependencies,
  request: { rawBody: string | Buffer; signature: string | undefined },
): Promise<StripeWebhookOutcome> {
  const clock = deps.clock ?? (() => new Date());
  verifyStripeSignature({
    payload: request.rawBody,
    header: request.signature,
    secrets: deps.webhookSecrets,
    now: clock(),
  });
  let event: unknown;
  try {
    event = JSON.parse(
      typeof request.rawBody === "string" ? request.rawBody : request.rawBody.toString("utf8"),
    );
  } catch {
    throw new StripeWebhookPayloadError();
  }
  if (!isRecord(event) || typeof event.id !== "string" || !EVENT_ID.test(event.id)) {
    throw new StripeWebhookPayloadError();
  }
  const type = typeof event.type === "string" ? event.type : "";
  const object =
    isRecord(event.data) && isRecord(event.data.object) ? event.data.object : undefined;
  const subscriptionId = object ? subscriptionIdFromEvent(type, object) : undefined;
  const report = (outcome: StripeWebhookOutcome): StripeWebhookOutcome => {
    deps.onOutcome?.({ outcome, eventType: type.slice(0, 80) });
    return outcome;
  };
  if (!subscriptionId) return report("ignored");

  const subscription = await deps.api.retrieveSubscription(subscriptionId);
  const userId = subscription?.metadata?.userId;
  // A subscription this application did not create (no tagged user) is not ours to project.
  if (!subscription || userId === undefined || !UUID.test(userId)) return report("ignored");
  return report(await applyProjection(deps, userId, event.id, subscription));
}
