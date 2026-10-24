import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import {
  type DeliveryChannel,
  type DeliveryOutcomeCode,
  type DeliveryState,
  leaseMilliseconds,
} from "./delivery.js";
import { routeChannels } from "./routing.js";
import { asDate, iso } from "./timestamps.js";
import type { NotificationKind, NotificationUrgency } from "./types.js";

export type EmailDestinationState = "pending" | "verified" | "suppressed";

export interface EmailDestination {
  address: string;
  state: EmailDestinationState;
  suppressedReason?: "permanent_failure" | "complaint";
  verifiedAt?: Date;
  createdAt: Date;
}

/** What recording the account address did: a new or changed address, no change, or a refusal. */
export type SetAccountEmailOutcome = "set" | "unchanged" | "suppressed";

export interface ClaimedAttempt {
  id: string;
  ownerUserId: string;
  inboxItemId: string;
  channel: DeliveryChannel;
  attemptCount: number;
}

export interface AttemptContext {
  kind: NotificationKind;
  urgency: NotificationUrgency;
  itemState: string;
  itemExpiresAt: Date;
  emailEnabled: boolean;
  quietHours: {
    enabled: boolean;
    startMinute: number;
    endMinute: number;
    timeZone: string;
  };
  email?: { address: string; state: EmailDestinationState };
}

// Selected columns are aliased to camelCase, so rows read the same with or without `postgres.camel`.
interface DestinationRow {
  address: string;
  state: EmailDestinationState;
  suppressedReason: "permanent_failure" | "complaint" | null;
  verifiedAt: Date | string | null;
  createdAt: Date | string;
}

/**
 * Creates the delivery row for a freshly opened item when the candidate turned email on and has a
 * usable address. Runs inside the item's transaction. Quiet hours set `not_before`.
 */
export async function scheduleDeliveries(
  sql: postgres.TransactionSql,
  input: { ownerUserId: string; itemId: string; urgency: NotificationUrgency; now: Date },
): Promise<void> {
  const [preferences] = await sql<
    {
      emailEnabled: boolean;
      quietHoursEnabled: boolean;
      quietStartMinute: number;
      quietEndMinute: number;
      timeZone: string;
    }[]
  >`
    SELECT email_enabled AS "emailEnabled", quiet_hours_enabled AS "quietHoursEnabled",
      quiet_start_minute AS "quietStartMinute", quiet_end_minute AS "quietEndMinute",
      time_zone AS "timeZone"
    FROM notifications.preferences WHERE owner_user_id = ${input.ownerUserId}::uuid
  `;
  if (!preferences) return;
  const routing = routeChannels({
    urgency: input.urgency,
    now: input.now,
    preferences: {
      emailEnabled: preferences.emailEnabled,
      quietHours: {
        enabled: preferences.quietHoursEnabled,
        startMinute: preferences.quietStartMinute,
        endMinute: preferences.quietEndMinute,
        timeZone: preferences.timeZone,
      },
    },
  });
  const [destination] = await sql<{ state: string }[]>`
    SELECT state FROM notifications.email_destinations
    WHERE owner_user_id = ${input.ownerUserId}::uuid
  `;
  if (routing.email.action === "skip" || destination?.state !== "verified") return;
  const notBefore = routing.email.action === "defer_until" ? routing.email.at : input.now;
  await sql`
    INSERT INTO notifications.delivery_attempts
      (id, owner_user_id, inbox_item_id, channel, state, not_before, created_at, updated_at)
    VALUES (${uuidv7()}::uuid, ${input.ownerUserId}::uuid, ${input.itemId}::uuid, 'email',
      'scheduled', ${iso(notBefore)}::timestamptz, ${iso(input.now)}::timestamptz,
      ${iso(input.now)}::timestamptz)
    ON CONFLICT (inbox_item_id, channel) DO NOTHING
  `;
}

export const maxTestNotificationsPerHour = 5;
export const testNotificationLifetimeMilliseconds = 24 * 60 * 60 * 1000;

export type CreateTestItemOutcome =
  | { outcome: "created"; itemId: string }
  | { outcome: "rate_limited" };

export class PostgresDeliveryStore {
  constructor(private readonly client: postgres.Sql) {}

  /**
   * A candidate-requested test item. It travels the same delivery path as a real one, so it proves
   * the configured channel end to end, and it never touches any source fact. At most five per hour.
   */
  async createTestItem(ownerUserId: string, now: Date): Promise<CreateTestItemOutcome> {
    return this.client.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(hashtext(${`notifications-test:${ownerUserId}`}))
      `;
      const [recent] = await transaction<{ count: string }[]>`
        SELECT count(*)::text AS count FROM notifications.inbox_items
        WHERE owner_user_id = ${ownerUserId}::uuid AND kind = 'test_notification'
          AND created_at > ${iso(new Date(now.getTime() - 3_600_000))}::timestamptz
      `;
      if (Number(recent?.count ?? 0) >= maxTestNotificationsPerHour)
        return { outcome: "rate_limited" as const };
      const itemId = uuidv7();
      await transaction`
        INSERT INTO notifications.inbox_items
          (id, owner_user_id, kind, urgency, state, source_service, aggregate_id, source_revision,
           dedupe_key, created_at, updated_at, expires_at)
        VALUES (${itemId}::uuid, ${ownerUserId}::uuid, 'test_notification', 'normal', 'unread',
          'notifications', ${itemId}::uuid, 1, ${`test_notification:${itemId}`},
          ${iso(now)}::timestamptz, ${iso(now)}::timestamptz,
          ${iso(new Date(now.getTime() + testNotificationLifetimeMilliseconds))}::timestamptz)
      `;
      await scheduleDeliveries(transaction, { ownerUserId, itemId, urgency: "normal", now });
      return { outcome: "created" as const, itemId };
    });
  }

  // ---- Email destination -------------------------------------------------------------------

  async readEmailDestination(ownerUserId: string): Promise<EmailDestination | undefined> {
    const [row] = await this.client<DestinationRow[]>`
      SELECT address, state, suppressed_reason AS "suppressedReason", verified_at AS "verifiedAt",
        created_at AS "createdAt"
      FROM notifications.email_destinations WHERE owner_user_id = ${ownerUserId}::uuid
    `;
    if (!row) return undefined;
    return {
      address: row.address,
      state: row.state,
      ...(row.suppressedReason ? { suppressedReason: row.suppressedReason } : {}),
      ...(row.verifiedAt ? { verifiedAt: asDate(row.verifiedAt) } : {}),
      createdAt: asDate(row.createdAt),
    };
  }

  /**
   * Records the address the identity provider verified for this candidate as their one email
   * destination. A different address replaces the old one and cancels mail scheduled to it. An
   * address that was suppressed after a permanent rejection stays suppressed.
   */
  async setAccountEmail(
    ownerUserId: string,
    address: string,
    now: Date,
  ): Promise<SetAccountEmailOutcome> {
    return this.client.begin(async (transaction) => {
      const [current] = await transaction<{ address: string; state: EmailDestinationState }[]>`
        SELECT address, state FROM notifications.email_destinations
        WHERE owner_user_id = ${ownerUserId}::uuid FOR UPDATE
      `;
      if (!current) {
        await transaction`
          INSERT INTO notifications.email_destinations
            (owner_user_id, address, state, verified_at, request_window_started_at,
             request_window_count, created_at, updated_at)
          VALUES (${ownerUserId}::uuid, ${address}, 'verified', ${iso(now)}::timestamptz,
            ${iso(now)}::timestamptz, 0, ${iso(now)}::timestamptz, ${iso(now)}::timestamptz)
        `;
        return "set" as const;
      }
      if (current.address === address && current.state === "verified") return "unchanged" as const;
      if (current.address === address && current.state === "suppressed")
        return "suppressed" as const;
      await transaction`
        UPDATE notifications.email_destinations SET
          address = ${address}, state = 'verified', suppressed_reason = NULL,
          verified_at = ${iso(now)}::timestamptz, code_requested_at = NULL, code_hash = NULL,
          code_expires_at = NULL, code_attempts = 0, updated_at = ${iso(now)}::timestamptz
        WHERE owner_user_id = ${ownerUserId}::uuid
      `;
      // A new address invalidates scheduled mail to the old one.
      await transaction`
        UPDATE notifications.delivery_attempts SET state = 'skipped', lease_until = NULL,
          outcome_code = 'no_destination', updated_at = ${iso(now)}::timestamptz
        WHERE owner_user_id = ${ownerUserId}::uuid AND channel = 'email' AND state = 'scheduled'
      `;
      return "set" as const;
    });
  }

  async suppressEmail(
    ownerUserId: string,
    address: string,
    reason: "permanent_failure" | "complaint",
    now: Date,
  ): Promise<void> {
    await this.client.begin(async (transaction) => {
      await transaction`
        UPDATE notifications.email_destinations SET state = 'suppressed',
          suppressed_reason = ${reason}, verified_at = NULL, updated_at = ${iso(now)}::timestamptz
        WHERE owner_user_id = ${ownerUserId}::uuid AND address = ${address}
      `;
      await transaction`
        UPDATE notifications.delivery_attempts SET state = 'skipped', lease_until = NULL,
          outcome_code = 'no_destination', updated_at = ${iso(now)}::timestamptz
        WHERE owner_user_id = ${ownerUserId}::uuid AND channel = 'email'
          AND state IN ('scheduled', 'sending')
      `;
    });
  }

  // ---- Delivery attempts -------------------------------------------------------------------

  /** Leases due attempts. An expired lease is claimable again, so a crashed run is reclaimed. */
  async claimDue(now: Date, limit: number): Promise<ClaimedAttempt[]> {
    const rows = await this.client<
      {
        id: string;
        ownerUserId: string;
        inboxItemId: string;
        channel: DeliveryChannel;
        attemptCount: number;
      }[]
    >`
      WITH due AS (
        SELECT id FROM notifications.delivery_attempts
        WHERE not_before <= ${iso(now)}::timestamptz
          AND (state = 'scheduled'
            OR (state = 'sending' AND lease_until < ${iso(now)}::timestamptz))
        ORDER BY not_before, id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE notifications.delivery_attempts attempt SET state = 'sending',
        lease_until = ${iso(new Date(now.getTime() + leaseMilliseconds))}::timestamptz,
        attempt_count = attempt.attempt_count + 1, updated_at = ${iso(now)}::timestamptz
      FROM due WHERE attempt.id = due.id
      RETURNING attempt.id, attempt.owner_user_id AS "ownerUserId",
        attempt.inbox_item_id AS "inboxItemId", attempt.channel,
        attempt.attempt_count AS "attemptCount"
    `;
    return rows.map((row) => ({
      id: row.id,
      ownerUserId: row.ownerUserId,
      inboxItemId: row.inboxItemId,
      channel: row.channel,
      attemptCount: row.attemptCount,
    }));
  }

  async loadContext(attempt: ClaimedAttempt): Promise<AttemptContext | undefined> {
    const [row] = await this.client<
      {
        kind: NotificationKind;
        urgency: NotificationUrgency;
        itemState: string;
        expiresAt: Date | string;
        emailEnabled: boolean | null;
        quietHoursEnabled: boolean | null;
        quietStartMinute: number | null;
        quietEndMinute: number | null;
        timeZone: string | null;
        emailAddress: string | null;
        emailState: EmailDestinationState | null;
      }[]
    >`
      SELECT item.kind, item.urgency, item.state AS "itemState", item.expires_at AS "expiresAt",
        preferences.email_enabled AS "emailEnabled",
        preferences.quiet_hours_enabled AS "quietHoursEnabled",
        preferences.quiet_start_minute AS "quietStartMinute",
        preferences.quiet_end_minute AS "quietEndMinute", preferences.time_zone AS "timeZone",
        destination.address AS "emailAddress", destination.state AS "emailState"
      FROM notifications.inbox_items item
      LEFT JOIN notifications.preferences preferences
        ON preferences.owner_user_id = item.owner_user_id
      LEFT JOIN notifications.email_destinations destination
        ON destination.owner_user_id = item.owner_user_id
      WHERE item.id = ${attempt.inboxItemId}::uuid AND item.owner_user_id = ${attempt.ownerUserId}::uuid
    `;
    if (!row) return undefined;
    return {
      kind: row.kind,
      urgency: row.urgency,
      itemState: row.itemState,
      itemExpiresAt: asDate(row.expiresAt),
      emailEnabled: row.emailEnabled ?? false,
      quietHours: {
        enabled: row.quietHoursEnabled ?? false,
        startMinute: row.quietStartMinute ?? 1320,
        endMinute: row.quietEndMinute ?? 420,
        timeZone: row.timeZone ?? "UTC",
      },
      ...(row.emailAddress && row.emailState
        ? { email: { address: row.emailAddress, state: row.emailState } }
        : {}),
    };
  }

  async finishAttempt(
    attemptId: string,
    state: Extract<DeliveryState, "sent" | "failed" | "skipped">,
    outcome: DeliveryOutcomeCode,
    now: Date,
    providerReference?: string,
  ): Promise<void> {
    await this.client`
      UPDATE notifications.delivery_attempts SET state = ${state}, lease_until = NULL,
        outcome_code = ${outcome}, provider_reference = ${providerReference ?? null},
        sent_at = ${state === "sent" ? iso(now) : null}::timestamptz,
        updated_at = ${iso(now)}::timestamptz
      WHERE id = ${attemptId}::uuid AND state = 'sending'
    `;
  }

  /** Back to scheduled for a later time. `consumeAttempt` false when nothing was tried. */
  async rescheduleAttempt(
    attemptId: string,
    notBefore: Date,
    outcome: DeliveryOutcomeCode,
    now: Date,
    consumeAttempt = true,
  ): Promise<void> {
    await this.client`
      UPDATE notifications.delivery_attempts SET state = 'scheduled', lease_until = NULL,
        not_before = ${iso(notBefore)}::timestamptz, outcome_code = ${outcome},
        attempt_count = attempt_count - ${consumeAttempt ? 0 : 1}::int,
        updated_at = ${iso(now)}::timestamptz
      WHERE id = ${attemptId}::uuid AND state = 'sending'
    `;
  }
}
