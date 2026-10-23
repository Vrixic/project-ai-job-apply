import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import {
  codeMatches,
  codeRequestLifetimeMilliseconds,
  type DeliveryChannel,
  type DeliveryOutcomeCode,
  type DeliveryState,
  hashEndpoint,
  leaseMilliseconds,
  maxCodeAttempts,
  maxCodeRequestsPerHour,
  maxPushSubscriptionsPerOwner,
} from "./delivery.js";
import { routeChannels } from "./routing.js";
import type { NotificationKind, NotificationUrgency } from "./types.js";

export type EmailDestinationState = "pending" | "verified" | "suppressed";

export interface EmailDestination {
  address: string;
  state: EmailDestinationState;
  suppressedReason?: "permanent_failure" | "complaint";
  verifiedAt?: Date;
  createdAt: Date;
  /** True while a code request waits for the dispatcher or a sent code is still usable. */
  codePending: boolean;
}

export interface PushSubscriptionSummary {
  id: string;
  state: "active" | "expired";
  createdAt: Date;
  lastSuccessAt?: Date;
}

export type RequestCodeOutcome = "requested" | "already_verified" | "rate_limited" | "suppressed";
export type ConfirmCodeOutcome =
  | "verified"
  | "invalid"
  | "expired"
  | "too_many_attempts"
  | "no_request";
export type AddPushOutcome = { outcome: "added"; id: string } | { outcome: "limit_reached" };

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
  pushEnabled: boolean;
  quietHours: {
    enabled: boolean;
    startMinute: number;
    endMinute: number;
    timeZone: string;
  };
  email?: { address: string; state: EmailDestinationState };
  pushSubscriptions: { id: string; endpoint: string }[];
}

export interface ClaimedCodeRequest {
  ownerUserId: string;
  address: string;
  requestedAt: Date;
}

interface DestinationRow {
  address: string;
  state: EmailDestinationState;
  suppressed_reason: "permanent_failure" | "complaint" | null;
  verified_at: Date | null;
  created_at: Date;
  code_requested_at: Date | null;
  code_hash: string | null;
  code_expires_at: Date | null;
}

/**
 * Creates the delivery rows for a freshly opened item: one per channel the candidate turned on
 * that has a usable destination. Runs inside the item's transaction. Quiet hours set `not_before`.
 */
export async function scheduleDeliveries(
  sql: postgres.TransactionSql,
  input: { ownerUserId: string; itemId: string; urgency: NotificationUrgency; now: Date },
): Promise<void> {
  const [preferences] = await sql<
    {
      email_enabled: boolean;
      push_enabled: boolean;
      quiet_hours_enabled: boolean;
      quiet_start_minute: number;
      quiet_end_minute: number;
      time_zone: string;
    }[]
  >`
    SELECT email_enabled, push_enabled, quiet_hours_enabled, quiet_start_minute, quiet_end_minute,
      time_zone
    FROM notifications.preferences WHERE owner_user_id = ${input.ownerUserId}::uuid
  `;
  if (!preferences) return;
  const routing = routeChannels({
    urgency: input.urgency,
    now: input.now,
    preferences: {
      emailEnabled: preferences.email_enabled,
      pushEnabled: preferences.push_enabled,
      quietHours: {
        enabled: preferences.quiet_hours_enabled,
        startMinute: preferences.quiet_start_minute,
        endMinute: preferences.quiet_end_minute,
        timeZone: preferences.time_zone,
      },
    },
  });
  const [destination] = await sql<{ state: string }[]>`
    SELECT state FROM notifications.email_destinations
    WHERE owner_user_id = ${input.ownerUserId}::uuid
  `;
  const [active] = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM notifications.push_subscriptions
    WHERE owner_user_id = ${input.ownerUserId}::uuid AND state = 'active'
  `;
  const plan: [DeliveryChannel, Date][] = [];
  if (routing.email.action !== "skip" && destination?.state === "verified")
    plan.push(["email", routing.email.action === "defer_until" ? routing.email.at : input.now]);
  if (routing.push.action !== "skip" && Number(active?.count ?? 0) > 0)
    plan.push(["push", routing.push.action === "defer_until" ? routing.push.at : input.now]);
  for (const [channel, notBefore] of plan) {
    await sql`
      INSERT INTO notifications.delivery_attempts
        (id, owner_user_id, inbox_item_id, channel, state, not_before, created_at, updated_at)
      VALUES (${uuidv7()}::uuid, ${input.ownerUserId}::uuid, ${input.itemId}::uuid, ${channel},
        'scheduled', ${notBefore}, ${input.now}, ${input.now})
      ON CONFLICT (inbox_item_id, channel) DO NOTHING
    `;
  }
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
   * the configured channels end to end, and it never touches any source fact. At most five per hour.
   */
  async createTestItem(ownerUserId: string, now: Date): Promise<CreateTestItemOutcome> {
    return this.client.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(hashtext(${`notifications-test:${ownerUserId}`}))
      `;
      const [recent] = await transaction<{ count: string }[]>`
        SELECT count(*)::text AS count FROM notifications.inbox_items
        WHERE owner_user_id = ${ownerUserId}::uuid AND kind = 'test_notification'
          AND created_at > ${new Date(now.getTime() - 3_600_000)}
      `;
      if (Number(recent?.count ?? 0) >= maxTestNotificationsPerHour)
        return { outcome: "rate_limited" as const };
      const itemId = uuidv7();
      await transaction`
        INSERT INTO notifications.inbox_items
          (id, owner_user_id, kind, urgency, state, source_service, aggregate_id, source_revision,
           dedupe_key, created_at, updated_at, expires_at)
        VALUES (${itemId}::uuid, ${ownerUserId}::uuid, 'test_notification', 'normal', 'unread',
          'notifications', ${itemId}::uuid, 1, ${`test_notification:${itemId}`}, ${now}, ${now},
          ${new Date(now.getTime() + testNotificationLifetimeMilliseconds)})
      `;
      await scheduleDeliveries(transaction, { ownerUserId, itemId, urgency: "normal", now });
      return { outcome: "created" as const, itemId };
    });
  }

  // ---- Email destination -------------------------------------------------------------------

  async readEmailDestination(ownerUserId: string): Promise<EmailDestination | undefined> {
    const [row] = await this.client<DestinationRow[]>`
      SELECT address, state, suppressed_reason, verified_at, created_at, code_requested_at,
        code_hash, code_expires_at
      FROM notifications.email_destinations WHERE owner_user_id = ${ownerUserId}::uuid
    `;
    if (!row) return undefined;
    return {
      address: row.address,
      state: row.state,
      ...(row.suppressed_reason ? { suppressedReason: row.suppressed_reason } : {}),
      ...(row.verified_at ? { verifiedAt: row.verified_at } : {}),
      createdAt: row.created_at,
      codePending: row.code_requested_at !== null || row.code_hash !== null,
    };
  }

  /**
   * Starts or restarts address confirmation. The dispatcher generates and emails the code. At most
   * five requests per hour per candidate; a verified address is not re-verified.
   */
  async requestEmailCode(
    ownerUserId: string,
    address: string,
    now: Date,
  ): Promise<RequestCodeOutcome> {
    return this.client.begin(async (transaction) => {
      const [current] = await transaction<
        {
          address: string;
          state: EmailDestinationState;
          request_window_started_at: Date;
          request_window_count: number;
        }[]
      >`
        SELECT address, state, request_window_started_at, request_window_count
        FROM notifications.email_destinations
        WHERE owner_user_id = ${ownerUserId}::uuid FOR UPDATE
      `;
      if (!current) {
        await transaction`
          INSERT INTO notifications.email_destinations
            (owner_user_id, address, state, code_requested_at, request_window_started_at,
             request_window_count, created_at, updated_at)
          VALUES (${ownerUserId}::uuid, ${address}, 'pending', ${now}, ${now}, 1, ${now}, ${now})
        `;
        return "requested" as const;
      }
      if (current.address === address && current.state === "verified")
        return "already_verified" as const;
      if (current.address === address && current.state === "suppressed")
        return "suppressed" as const;
      const windowExpired =
        now.getTime() - current.request_window_started_at.getTime() >= 3_600_000;
      const count = windowExpired ? 0 : current.request_window_count;
      if (count >= maxCodeRequestsPerHour) return "rate_limited" as const;
      await transaction`
        UPDATE notifications.email_destinations SET
          address = ${address}, state = 'pending', suppressed_reason = NULL, verified_at = NULL,
          code_requested_at = ${now}, code_hash = NULL, code_expires_at = NULL, code_attempts = 0,
          request_window_started_at = ${windowExpired ? now : current.request_window_started_at},
          request_window_count = ${count + 1}, updated_at = ${now}
        WHERE owner_user_id = ${ownerUserId}::uuid
      `;
      // A new address invalidates scheduled mail to the old one.
      await transaction`
        UPDATE notifications.delivery_attempts SET state = 'skipped', lease_until = NULL,
          outcome_code = 'no_destination', updated_at = ${now}
        WHERE owner_user_id = ${ownerUserId}::uuid AND channel = 'email' AND state = 'scheduled'
      `;
      return "requested" as const;
    });
  }

  async confirmEmailCode(
    ownerUserId: string,
    code: string,
    now: Date,
  ): Promise<ConfirmCodeOutcome> {
    return this.client.begin(async (transaction) => {
      const [row] = await transaction<
        {
          state: EmailDestinationState;
          code_hash: string | null;
          code_expires_at: Date | null;
          code_attempts: number;
        }[]
      >`
        SELECT state, code_hash, code_expires_at, code_attempts
        FROM notifications.email_destinations
        WHERE owner_user_id = ${ownerUserId}::uuid FOR UPDATE
      `;
      if (row?.state !== "pending" || !row.code_hash || !row.code_expires_at)
        return "no_request" as const;
      if (row.code_expires_at.getTime() <= now.getTime()) return "expired" as const;
      if (row.code_attempts >= maxCodeAttempts) return "too_many_attempts" as const;
      if (!codeMatches(row.code_hash, ownerUserId, code)) {
        await transaction`
          UPDATE notifications.email_destinations
          SET code_attempts = code_attempts + 1, updated_at = ${now}
          WHERE owner_user_id = ${ownerUserId}::uuid
        `;
        return "invalid" as const;
      }
      await transaction`
        UPDATE notifications.email_destinations SET state = 'verified', verified_at = ${now},
          code_hash = NULL, code_expires_at = NULL, code_requested_at = NULL, code_attempts = 0,
          updated_at = ${now}
        WHERE owner_user_id = ${ownerUserId}::uuid
      `;
      return "verified" as const;
    });
  }

  async removeEmailDestination(ownerUserId: string, now: Date): Promise<boolean> {
    return this.client.begin(async (transaction) => {
      const removed = await transaction`
        DELETE FROM notifications.email_destinations
        WHERE owner_user_id = ${ownerUserId}::uuid RETURNING owner_user_id
      `;
      await transaction`
        UPDATE notifications.delivery_attempts SET state = 'skipped', lease_until = NULL,
          outcome_code = 'no_destination', updated_at = ${now}
        WHERE owner_user_id = ${ownerUserId}::uuid AND channel = 'email'
          AND state IN ('scheduled', 'sending')
      `;
      return removed.length > 0;
    });
  }

  /** Requests the dispatcher has not served yet. Stale ones are dropped first. */
  async claimCodeRequests(now: Date, limit: number): Promise<ClaimedCodeRequest[]> {
    await this.client`
      UPDATE notifications.email_destinations SET code_requested_at = NULL, updated_at = ${now}
      WHERE code_requested_at IS NOT NULL
        AND code_requested_at < ${new Date(now.getTime() - codeRequestLifetimeMilliseconds)}
    `;
    const rows = await this.client<
      { owner_user_id: string; address: string; code_requested_at: Date }[]
    >`
      SELECT owner_user_id, address, code_requested_at FROM notifications.email_destinations
      WHERE state = 'pending' AND code_requested_at IS NOT NULL
      ORDER BY code_requested_at LIMIT ${limit}
    `;
    return rows.map((row) => ({
      ownerUserId: row.owner_user_id,
      address: row.address,
      requestedAt: row.code_requested_at,
    }));
  }

  /**
   * Records a freshly generated code and consumes the request. Returns false when the request
   * changed meanwhile (another run served it, or the candidate chose another address).
   */
  async storeCode(
    request: ClaimedCodeRequest,
    codeHash: string,
    expiresAt: Date,
    now: Date,
  ): Promise<boolean> {
    const rows = await this.client`
      UPDATE notifications.email_destinations SET code_hash = ${codeHash},
        code_expires_at = ${expiresAt}, code_requested_at = NULL, code_attempts = 0,
        updated_at = ${now}
      WHERE owner_user_id = ${request.ownerUserId}::uuid AND state = 'pending'
        AND address = ${request.address} AND code_requested_at = ${request.requestedAt}
      RETURNING owner_user_id
    `;
    return rows.length > 0;
  }

  /** A transient send failure puts the request back so the next run serves it again. */
  async restoreCodeRequest(request: ClaimedCodeRequest, now: Date): Promise<void> {
    await this.client`
      UPDATE notifications.email_destinations SET code_hash = NULL, code_expires_at = NULL,
        code_requested_at = ${request.requestedAt}, updated_at = ${now}
      WHERE owner_user_id = ${request.ownerUserId}::uuid AND state = 'pending'
        AND address = ${request.address} AND code_requested_at IS NULL
    `;
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
          suppressed_reason = ${reason}, verified_at = NULL, code_hash = NULL,
          code_expires_at = NULL, code_requested_at = NULL, updated_at = ${now}
        WHERE owner_user_id = ${ownerUserId}::uuid AND address = ${address}
      `;
      await transaction`
        UPDATE notifications.delivery_attempts SET state = 'skipped', lease_until = NULL,
          outcome_code = 'no_destination', updated_at = ${now}
        WHERE owner_user_id = ${ownerUserId}::uuid AND channel = 'email'
          AND state IN ('scheduled', 'sending')
      `;
    });
  }

  // ---- Push subscriptions ------------------------------------------------------------------

  async listPushSubscriptions(ownerUserId: string): Promise<PushSubscriptionSummary[]> {
    const rows = await this.client<
      { id: string; state: "active" | "expired"; created_at: Date; last_success_at: Date | null }[]
    >`
      SELECT id, state, created_at, last_success_at FROM notifications.push_subscriptions
      WHERE owner_user_id = ${ownerUserId}::uuid ORDER BY created_at, id
    `;
    return rows.map((row) => ({
      id: row.id,
      state: row.state,
      createdAt: row.created_at,
      ...(row.last_success_at ? { lastSuccessAt: row.last_success_at } : {}),
    }));
  }

  /** The same browser endpoint moves to the candidate who subscribed last. */
  async addPushSubscription(
    ownerUserId: string,
    endpoint: string,
    now: Date,
  ): Promise<AddPushOutcome> {
    return this.client.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(hashtext(${`notifications-push:${ownerUserId}`}))
      `;
      const hash = hashEndpoint(endpoint);
      const [existing] = await transaction<{ id: string; owner_user_id: string }[]>`
        SELECT id, owner_user_id FROM notifications.push_subscriptions
        WHERE endpoint_hash = ${hash} FOR UPDATE
      `;
      const [active] = await transaction<{ count: string }[]>`
        SELECT count(*)::text AS count FROM notifications.push_subscriptions
        WHERE owner_user_id = ${ownerUserId}::uuid AND state = 'active' AND endpoint_hash <> ${hash}
      `;
      if (Number(active?.count ?? 0) >= maxPushSubscriptionsPerOwner)
        return { outcome: "limit_reached" as const };
      if (existing) {
        await transaction`
          UPDATE notifications.push_subscriptions SET owner_user_id = ${ownerUserId}::uuid,
            state = 'active', expired_at = NULL
          WHERE id = ${existing.id}::uuid
        `;
        return { outcome: "added" as const, id: existing.id };
      }
      const id = uuidv7();
      await transaction`
        INSERT INTO notifications.push_subscriptions
          (id, owner_user_id, endpoint, endpoint_hash, state, created_at)
        VALUES (${id}::uuid, ${ownerUserId}::uuid, ${endpoint}, ${hash}, 'active', ${now})
      `;
      return { outcome: "added" as const, id };
    });
  }

  async removePushSubscription(ownerUserId: string, id: string, now: Date): Promise<boolean> {
    return this.client.begin(async (transaction) => {
      const removed = await transaction`
        DELETE FROM notifications.push_subscriptions
        WHERE id = ${id}::uuid AND owner_user_id = ${ownerUserId}::uuid RETURNING id
      `;
      const [active] = await transaction<{ count: string }[]>`
        SELECT count(*)::text AS count FROM notifications.push_subscriptions
        WHERE owner_user_id = ${ownerUserId}::uuid AND state = 'active'
      `;
      if (Number(active?.count ?? 0) === 0) {
        await transaction`
          UPDATE notifications.delivery_attempts SET state = 'skipped', lease_until = NULL,
            outcome_code = 'no_destination', updated_at = ${now}
          WHERE owner_user_id = ${ownerUserId}::uuid AND channel = 'push' AND state = 'scheduled'
        `;
      }
      return removed.length > 0;
    });
  }

  async expirePushSubscription(id: string, now: Date): Promise<void> {
    await this.client`
      UPDATE notifications.push_subscriptions SET state = 'expired', expired_at = ${now}
      WHERE id = ${id}::uuid AND state = 'active'
    `;
  }

  async markPushSuccess(id: string, now: Date): Promise<void> {
    await this.client`
      UPDATE notifications.push_subscriptions SET last_success_at = ${now}
      WHERE id = ${id}::uuid
    `;
  }

  // ---- Delivery attempts -------------------------------------------------------------------

  /** Leases due attempts. An expired lease is claimable again, so a crashed run is reclaimed. */
  async claimDue(now: Date, limit: number): Promise<ClaimedAttempt[]> {
    const rows = await this.client<
      {
        id: string;
        owner_user_id: string;
        inbox_item_id: string;
        channel: DeliveryChannel;
        attempt_count: number;
      }[]
    >`
      WITH due AS (
        SELECT id FROM notifications.delivery_attempts
        WHERE not_before <= ${now}
          AND (state = 'scheduled' OR (state = 'sending' AND lease_until < ${now}))
        ORDER BY not_before, id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE notifications.delivery_attempts attempt SET state = 'sending',
        lease_until = ${new Date(now.getTime() + leaseMilliseconds)},
        attempt_count = attempt.attempt_count + 1, updated_at = ${now}
      FROM due WHERE attempt.id = due.id
      RETURNING attempt.id, attempt.owner_user_id, attempt.inbox_item_id, attempt.channel,
        attempt.attempt_count
    `;
    return rows.map((row) => ({
      id: row.id,
      ownerUserId: row.owner_user_id,
      inboxItemId: row.inbox_item_id,
      channel: row.channel,
      attemptCount: row.attempt_count,
    }));
  }

  async loadContext(attempt: ClaimedAttempt): Promise<AttemptContext | undefined> {
    const [row] = await this.client<
      {
        kind: NotificationKind;
        urgency: NotificationUrgency;
        item_state: string;
        expires_at: Date;
        email_enabled: boolean | null;
        push_enabled: boolean | null;
        quiet_hours_enabled: boolean | null;
        quiet_start_minute: number | null;
        quiet_end_minute: number | null;
        time_zone: string | null;
        email_address: string | null;
        email_state: EmailDestinationState | null;
      }[]
    >`
      SELECT item.kind, item.urgency, item.state AS item_state, item.expires_at,
        preferences.email_enabled, preferences.push_enabled, preferences.quiet_hours_enabled,
        preferences.quiet_start_minute, preferences.quiet_end_minute, preferences.time_zone,
        destination.address AS email_address, destination.state AS email_state
      FROM notifications.inbox_items item
      LEFT JOIN notifications.preferences preferences
        ON preferences.owner_user_id = item.owner_user_id
      LEFT JOIN notifications.email_destinations destination
        ON destination.owner_user_id = item.owner_user_id
      WHERE item.id = ${attempt.inboxItemId}::uuid AND item.owner_user_id = ${attempt.ownerUserId}::uuid
    `;
    if (!row) return undefined;
    const subscriptions = await this.client<{ id: string; endpoint: string }[]>`
      SELECT id, endpoint FROM notifications.push_subscriptions
      WHERE owner_user_id = ${attempt.ownerUserId}::uuid AND state = 'active'
      ORDER BY created_at, id
    `;
    return {
      kind: row.kind,
      urgency: row.urgency,
      itemState: row.item_state,
      itemExpiresAt: row.expires_at,
      emailEnabled: row.email_enabled ?? false,
      pushEnabled: row.push_enabled ?? false,
      quietHours: {
        enabled: row.quiet_hours_enabled ?? false,
        startMinute: row.quiet_start_minute ?? 1320,
        endMinute: row.quiet_end_minute ?? 420,
        timeZone: row.time_zone ?? "UTC",
      },
      ...(row.email_address && row.email_state
        ? { email: { address: row.email_address, state: row.email_state } }
        : {}),
      pushSubscriptions: subscriptions,
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
        sent_at = ${state === "sent" ? now : null}, updated_at = ${now}
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
        not_before = ${notBefore}, outcome_code = ${outcome},
        attempt_count = attempt_count - ${consumeAttempt ? 0 : 1}::int, updated_at = ${now}
      WHERE id = ${attemptId}::uuid AND state = 'sending'
    `;
  }
}
