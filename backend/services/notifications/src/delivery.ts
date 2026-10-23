import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { NotificationKind } from "./types.js";

export const deliveryChannels = Object.freeze(["email", "push"] as const);
export type DeliveryChannel = (typeof deliveryChannels)[number];

export type DeliveryState = "scheduled" | "sending" | "sent" | "failed" | "skipped";

/** Why an attempt ended without a send. Stored as `outcome_code`. */
export type DeliveryOutcomeCode =
  | "item_resolved"
  | "channel_off"
  | "no_destination"
  | "rejected_permanent"
  | "attempts_exhausted"
  | "delivered"
  | "deferred_quiet_hours"
  | "transient_error";

export const maxPushSubscriptionsPerOwner = 5;
export const maxCodeRequestsPerHour = 5;
export const maxCodeAttempts = 5;
export const codeLifetimeMilliseconds = 15 * 60 * 1000;
export const codeRequestLifetimeMilliseconds = 60 * 60 * 1000;
export const leaseMilliseconds = 2 * 60 * 1000;
export const maxDeliveryAttempts = 5;

/** Delay before the next try after a transient failure, indexed by attempts already made. */
const backoffMilliseconds = Object.freeze([60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000]);

export function retryDelayMilliseconds(attemptsMade: number): number | undefined {
  return backoffMilliseconds[attemptsMade - 1];
}

const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Lowercased address, or undefined when it is not a plain deliverable mailbox. */
export function normalizeEmailAddress(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const address = value.trim().toLowerCase();
  if (address.length < 6 || address.length > 254) return undefined;
  const [local, domain] = address.split("@");
  if (!local || !domain || address.includes("..") || local.startsWith(".") || local.endsWith("."))
    return undefined;
  return EMAIL_PATTERN.test(address) ? address : undefined;
}

/**
 * The push services the platform will post to. A subscription pointing anywhere else is rejected,
 * so a candidate cannot aim the dispatcher at another host.
 */
const pushHostSuffixes = Object.freeze([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
  "push.apple.com",
  "notify.windows.com",
]);

export function validatePushEndpoint(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.port !== "" && url.port !== "443") ||
    url.hash !== "" ||
    url.pathname.length < 2
  )
    return undefined;
  const host = url.hostname.toLowerCase();
  const allowed = pushHostSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  return allowed ? url.toString() : undefined;
}

export function hashEndpoint(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

export function generateVerificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashVerificationCode(ownerUserId: string, code: string): string {
  return createHash("sha256").update(`notifications-email:${ownerUserId}:${code}`).digest("hex");
}

export function codeMatches(expectedHash: string, ownerUserId: string, code: string): boolean {
  if (!/^[0-9]{6}$/.test(code) || !/^[0-9a-f]{64}$/.test(expectedHash)) return false;
  const actual = Buffer.from(hashVerificationCode(ownerUserId, code), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

const subjects: Readonly<Record<NotificationKind, string>> = Object.freeze({
  application_review_needed: "An application is waiting for your review",
  application_outcome_needed: "Check whether your application was submitted",
  application_confirmed: "Your application was confirmed",
});

/** Transactional wording only: no application detail leaves the platform by email. */
export function notificationEmail(input: {
  to: string;
  kind: NotificationKind;
  webBaseUrl: string;
}): EmailMessage {
  const base = input.webBaseUrl.replace(/\/+$/, "");
  return {
    to: input.to,
    subject: subjects[input.kind],
    text: [
      "You have a new item in your inbox.",
      "",
      `Open your inbox: ${base}/inbox`,
      "",
      `You get this email because email notifications are on. Turn them off in settings: ${base}/settings`,
    ].join("\n"),
  };
}

export function verificationEmail(input: {
  to: string;
  code: string;
  webBaseUrl: string;
}): EmailMessage {
  const base = input.webBaseUrl.replace(/\/+$/, "");
  return {
    to: input.to,
    subject: "Your email confirmation code",
    text: [
      `Your confirmation code is ${input.code}.`,
      "",
      "It expires in 15 minutes. If you did not ask for it, ignore this email.",
      "",
      `Settings: ${base}/settings`,
    ].join("\n"),
  };
}

/** Result a push provider reports for one subscription endpoint. */
export type PushResult = "delivered" | "gone";

/** Thrown by providers. `permanent` stops retries and, for email, suppresses the address. */
export class DeliveryProviderError extends Error {
  constructor(
    readonly permanent: boolean,
    readonly code: string,
  ) {
    super(code);
    this.name = "DeliveryProviderError";
  }
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ reference: string }>;
}

export interface PushProvider {
  send(endpoint: string): Promise<PushResult>;
}
