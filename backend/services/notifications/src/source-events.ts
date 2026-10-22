import {
  itemLifetimeMilliseconds,
  type NotificationKind,
  type NotificationUrgency,
} from "./types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EVENT_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const STATUSES = [
  "preparing",
  "review_required",
  "approved",
  "submitting",
  "takeover",
  "reconciliation_required",
  "applied",
  "cancelled",
] as const;

export const applicationEventTypes = Object.freeze([
  "application.status_changed.v1",
  "application.applied.v1",
] as const);

/** What one accepted source event means for the inbox. */
export interface SourceProjection {
  eventId: string;
  ownerUserId: string;
  applicationId: string;
  revision: number;
  /** The item this event opens, or null when it opens none. */
  open: { kind: NotificationKind; urgency: NotificationUrgency; lifetimeMs: number } | null;
  /** Earlier items of these kinds for the same application no longer apply. */
  resolves: readonly NotificationKind[];
}

/** Minimal versioned Applications events only. Anything else, or anything malformed, is refused. */
export function projectApplicationEvent(input: {
  eventId: unknown;
  type: unknown;
  data: unknown;
}): SourceProjection | null {
  if (typeof input.eventId !== "string" || !EVENT_ID_PATTERN.test(input.eventId)) return null;
  if (!(applicationEventTypes as readonly unknown[]).includes(input.type)) return null;
  const data = input.data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "applicationId,revision,status,userId") return null;
  const { applicationId, userId, revision, status } = record;
  if (
    typeof applicationId !== "string" ||
    !UUID_PATTERN.test(applicationId) ||
    typeof userId !== "string" ||
    !UUID_PATTERN.test(userId) ||
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    typeof status !== "string" ||
    !(STATUSES as readonly string[]).includes(status) ||
    (input.type === "application.applied.v1" && status !== "applied")
  )
    return null;
  const base = { eventId: input.eventId, ownerUserId: userId, applicationId, revision };
  switch (status) {
    case "review_required":
      return {
        ...base,
        open: {
          kind: "application_review_needed",
          urgency: "normal",
          lifetimeMs: itemLifetimeMilliseconds.action,
        },
        resolves: [],
      };
    case "reconciliation_required":
      // An unconfirmed submission risks a duplicate, so it is the one urgent item.
      return {
        ...base,
        open: {
          kind: "application_outcome_needed",
          urgency: "high",
          lifetimeMs: itemLifetimeMilliseconds.action,
        },
        resolves: ["application_review_needed"],
      };
    case "applied":
      return {
        ...base,
        open: {
          kind: "application_confirmed",
          urgency: "low",
          lifetimeMs: itemLifetimeMilliseconds.info,
        },
        resolves: ["application_review_needed", "application_outcome_needed"],
      };
    case "cancelled":
      return {
        ...base,
        open: null,
        resolves: ["application_review_needed", "application_outcome_needed"],
      };
    default:
      // preparing, approved, submitting, takeover: the review (if any) is over; nothing new to do.
      return { ...base, open: null, resolves: ["application_review_needed"] };
  }
}
