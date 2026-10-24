import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { scheduleDeliveries } from "./delivery-store.js";
import type { SourceProjection } from "./source-events.js";
import { asDate, iso } from "./timestamps.js";
import {
  defaultQuietHours,
  type InboxItem,
  type InboxState,
  type NotificationKind,
  type NotificationPreferences,
  type NotificationUrgency,
  type QuietHours,
} from "./types.js";

interface ItemRow {
  id: string;
  kind: NotificationKind;
  urgency: NotificationUrgency;
  state: InboxState;
  aggregateId: string;
  sourceRevision: string | number | bigint;
  createdAt: Date | string;
  updatedAt: Date | string;
  expiresAt: Date | string;
}

interface PreferencesRow {
  version: number;
  emailEnabled: boolean;
  quietHoursEnabled: boolean;
  quietStartMinute: number;
  quietEndMinute: number;
  timeZone: string;
  updatedAt: Date | string;
}

export type RecordOutcome = "recorded" | "duplicate" | "stale" | "ignored";

export interface InboxPage {
  items: InboxItem[];
  next?: { createdAt: Date; id: string };
}

function toItem(row: ItemRow): InboxItem {
  return {
    id: row.id,
    kind: row.kind,
    urgency: row.urgency,
    state: row.state,
    applicationId: row.aggregateId,
    sourceRevision: Number(row.sourceRevision),
    createdAt: asDate(row.createdAt),
    updatedAt: asDate(row.updatedAt),
    expiresAt: asDate(row.expiresAt),
  };
}

function toPreferences(row: PreferencesRow): NotificationPreferences {
  return {
    version: row.version,
    inAppEnabled: true,
    emailEnabled: row.emailEnabled,
    quietHours: {
      enabled: row.quietHoursEnabled,
      startMinute: row.quietStartMinute,
      endMinute: row.quietEndMinute,
      timeZone: row.timeZone,
    },
    updatedAt: asDate(row.updatedAt),
  };
}

// Every selected column is aliased to camelCase, so rows read the same whether or not the client is
// created with `postgres.camel`, which the shared Gateway and workflows client is.
const ITEM_COLUMNS = `id, kind, urgency, state, aggregate_id AS "aggregateId", source_revision AS "sourceRevision", created_at AS "createdAt", updated_at AS "updatedAt", expires_at AS "expiresAt"`;
const PREFERENCE_COLUMNS = `version, email_enabled AS "emailEnabled", quiet_hours_enabled AS "quietHoursEnabled", quiet_start_minute AS "quietStartMinute", quiet_end_minute AS "quietEndMinute", time_zone AS "timeZone", updated_at AS "updatedAt"`;

export class PostgresNotificationsStore {
  constructor(private readonly client: postgres.Sql) {}

  /**
   * Applies one source event atomically: a replay changes nothing, an older revision is stale, and
   * a newer one opens or resolves items. Per-application serialization keeps order deterministic.
   */
  async recordSourceEvent(
    projection: SourceProjection,
    now: Date,
  ): Promise<{
    outcome: RecordOutcome;
    itemId?: string;
  }> {
    return this.client.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(hashtext(${`notifications:${projection.ownerUserId}:${projection.applicationId}`}))
      `;
      const inserted = await transaction`
        INSERT INTO notifications.source_receipts
          (source_service, source_event_id, owner_user_id, event_type, received_at, outcome)
        VALUES ('applications', ${projection.eventId}, ${projection.ownerUserId}::uuid,
          'application.status', ${iso(now)}::timestamptz, 'recorded')
        ON CONFLICT (source_service, source_event_id) DO NOTHING
        RETURNING source_event_id
      `;
      if (inserted.length === 0) return { outcome: "duplicate" as const };
      const setOutcome = async (outcome: RecordOutcome) => {
        if (outcome === "recorded") return;
        await transaction`
          UPDATE notifications.source_receipts SET outcome = ${outcome}
          WHERE source_service = 'applications' AND source_event_id = ${projection.eventId}
        `;
      };
      const [cursor] = await transaction<{ lastRevision: string }[]>`
        SELECT last_revision AS "lastRevision" FROM notifications.source_cursors
        WHERE owner_user_id = ${projection.ownerUserId}::uuid
          AND source_service = 'applications' AND aggregate_id = ${projection.applicationId}::uuid
        FOR UPDATE
      `;
      if (cursor && Number(cursor.lastRevision) > projection.revision) {
        await setOutcome("stale");
        return { outcome: "stale" as const };
      }
      await transaction`
        INSERT INTO notifications.source_cursors
          (owner_user_id, source_service, aggregate_id, last_revision, updated_at)
        VALUES (${projection.ownerUserId}::uuid, 'applications', ${projection.applicationId}::uuid,
          ${projection.revision}, ${iso(now)}::timestamptz)
        ON CONFLICT (owner_user_id, source_service, aggregate_id)
        DO UPDATE SET last_revision = EXCLUDED.last_revision, updated_at = EXCLUDED.updated_at
      `;
      if (projection.resolves.length > 0) {
        await transaction`
          UPDATE notifications.inbox_items SET state = 'expired', updated_at = ${iso(now)}::timestamptz
          WHERE owner_user_id = ${projection.ownerUserId}::uuid AND source_service = 'applications'
            AND aggregate_id = ${projection.applicationId}::uuid
            AND kind = ANY(${[...projection.resolves]}::text[])
            AND state IN ('unread', 'acknowledged')
            AND source_revision <= ${projection.revision}
        `;
      }
      if (!projection.open) {
        await setOutcome("ignored");
        return { outcome: "ignored" as const };
      }
      const id = uuidv7();
      const created = await transaction<{ id: string }[]>`
        INSERT INTO notifications.inbox_items
          (id, owner_user_id, kind, urgency, state, source_service, aggregate_id, source_revision,
           dedupe_key, created_at, updated_at, expires_at)
        VALUES (${id}::uuid, ${projection.ownerUserId}::uuid, ${projection.open.kind},
          ${projection.open.urgency}, 'unread', 'applications', ${projection.applicationId}::uuid,
          ${projection.revision},
          ${`${projection.open.kind}:${projection.applicationId}:${projection.revision}`},
          ${iso(now)}::timestamptz, ${iso(now)}::timestamptz,
          ${iso(new Date(now.getTime() + projection.open.lifetimeMs))}::timestamptz)
        ON CONFLICT (owner_user_id, dedupe_key) DO NOTHING
        RETURNING id
      `;
      if (!created[0]) return { outcome: "duplicate" as const };
      await scheduleDeliveries(transaction, {
        ownerUserId: projection.ownerUserId,
        itemId: created[0].id,
        urgency: projection.open.urgency,
        now,
      });
      return { outcome: "recorded" as const, itemId: created[0].id };
    });
  }

  async listInbox(
    ownerUserId: string,
    options: {
      states?: readonly InboxState[];
      limit: number;
      after?: { createdAt: Date; id: string };
    },
  ): Promise<InboxPage> {
    const states = [...(options.states ?? (["unread", "acknowledged"] as const))];
    const limit = Math.max(1, Math.min(100, Math.trunc(options.limit)));
    const rows = await this.client<ItemRow[]>`
      SELECT ${this.client.unsafe(ITEM_COLUMNS)}
      FROM notifications.inbox_items
      WHERE owner_user_id = ${ownerUserId}::uuid AND state = ANY(${states}::text[])
        ${
          options.after
            ? this
                .client`AND (created_at, id) < (${iso(options.after.createdAt)}::timestamptz, ${options.after.id}::uuid)`
            : this.client``
        }
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit + 1}
    `;
    const items = rows.slice(0, limit).map(toItem);
    const last = items.at(-1);
    return {
      items,
      ...(rows.length > limit && last ? { next: { createdAt: last.createdAt, id: last.id } } : {}),
    };
  }

  async countUnread(ownerUserId: string): Promise<number> {
    const [row] = await this.client<{ count: string }[]>`
      SELECT count(*)::text AS count FROM notifications.inbox_items
      WHERE owner_user_id = ${ownerUserId}::uuid AND state = 'unread'
    `;
    return Number(row?.count ?? 0);
  }

  /**
   * Candidate acknowledgement or dismissal. Never touches the source fact. A terminal item
   * (dismissed or expired) is returned unchanged; an unknown or foreign id returns null.
   */
  async setItemState(
    ownerUserId: string,
    itemId: string,
    to: "acknowledged" | "dismissed",
    now: Date,
  ): Promise<InboxItem | null> {
    return this.client.begin(async (transaction) => {
      const [current] = await transaction<ItemRow[]>`
        SELECT ${transaction.unsafe(ITEM_COLUMNS)} FROM notifications.inbox_items
        WHERE id = ${itemId}::uuid AND owner_user_id = ${ownerUserId}::uuid FOR UPDATE
      `;
      if (!current) return null;
      const allowed =
        current.state === "unread" || (current.state === "acknowledged" && to === "dismissed");
      if (!allowed) return toItem(current);
      const [updated] = await transaction<ItemRow[]>`
        UPDATE notifications.inbox_items SET state = ${to}, updated_at = GREATEST(updated_at, ${iso(now)}::timestamptz)
        WHERE id = ${itemId}::uuid AND owner_user_id = ${ownerUserId}::uuid
        RETURNING ${transaction.unsafe(ITEM_COLUMNS)}
      `;
      return updated ? toItem(updated) : null;
    });
  }

  /** Items past their lifetime stop being offered. Returns how many changed. */
  async expireDue(now: Date): Promise<number> {
    const rows = await this.client`
      UPDATE notifications.inbox_items SET state = 'expired', updated_at = GREATEST(updated_at, ${iso(now)}::timestamptz)
      WHERE expires_at <= ${iso(now)}::timestamptz AND state IN ('unread', 'acknowledged')
      RETURNING id
    `;
    return rows.length;
  }

  async readPreferences(ownerUserId: string, now: Date): Promise<NotificationPreferences> {
    const [row] = await this.client<PreferencesRow[]>`
      SELECT ${this.client.unsafe(PREFERENCE_COLUMNS)}
      FROM notifications.preferences WHERE owner_user_id = ${ownerUserId}::uuid
    `;
    return row
      ? toPreferences(row)
      : {
          version: 0,
          inAppEnabled: true,
          emailEnabled: false,
          quietHours: { ...defaultQuietHours },
          updatedAt: now,
        };
  }

  /** Compare-and-set on the version (0 for a first write). Returns null on a version conflict. */
  async updatePreferences(
    ownerUserId: string,
    expectedVersion: number,
    update: { emailEnabled: boolean; quietHours: QuietHours },
    now: Date,
  ): Promise<NotificationPreferences | null> {
    const values = {
      email: update.emailEnabled,
      quiet: update.quietHours.enabled,
      start: update.quietHours.startMinute,
      end: update.quietHours.endMinute,
      zone: update.quietHours.timeZone,
    };
    const rows =
      expectedVersion === 0
        ? await this.client<PreferencesRow[]>`
            INSERT INTO notifications.preferences
              (owner_user_id, version, in_app_enabled, email_enabled, push_enabled,
               quiet_hours_enabled, quiet_start_minute, quiet_end_minute, time_zone, updated_at)
            VALUES (${ownerUserId}::uuid, 1, true, ${values.email}, false, ${values.quiet},
              ${values.start}, ${values.end}, ${values.zone}, ${iso(now)}::timestamptz)
            ON CONFLICT (owner_user_id) DO NOTHING
            RETURNING ${this.client.unsafe(PREFERENCE_COLUMNS)}
          `
        : await this.client<PreferencesRow[]>`
            UPDATE notifications.preferences SET version = version + 1,
              email_enabled = ${values.email},
              quiet_hours_enabled = ${values.quiet}, quiet_start_minute = ${values.start},
              quiet_end_minute = ${values.end}, time_zone = ${values.zone}, updated_at = ${iso(now)}::timestamptz
            WHERE owner_user_id = ${ownerUserId}::uuid AND version = ${expectedVersion}
            RETURNING ${this.client.unsafe(PREFERENCE_COLUMNS)}
          `;
    return rows[0] ? toPreferences(rows[0]) : null;
  }
}
