import { isValidTimeZone, type RoutingDecision, routeChannels } from "./routing.js";
import { projectApplicationEvent } from "./source-events.js";
import type { InboxPage, PostgresNotificationsStore, RecordOutcome } from "./store.js";
import type { InboxItem, InboxState, NotificationPreferences, QuietHours } from "./types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class NotificationsError extends Error {
  constructor(
    readonly code: "invalid_request" | "not_found" | "version_conflict",
    message = code,
  ) {
    super(message);
    this.name = "NotificationsError";
  }
}

export interface PreferencesUpdate {
  emailEnabled: boolean;
  pushEnabled: boolean;
  quietHours: QuietHours;
}

type Store = Pick<
  PostgresNotificationsStore,
  | "recordSourceEvent"
  | "listInbox"
  | "countUnread"
  | "setItemState"
  | "expireDue"
  | "readPreferences"
  | "updatePreferences"
>;

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value))
    throw new NotificationsError("invalid_request");
  return value;
}

function minute(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1439)
    throw new NotificationsError("invalid_request");
  return value;
}

export function validatePreferencesUpdate(input: PreferencesUpdate): PreferencesUpdate {
  if (
    typeof input?.emailEnabled !== "boolean" ||
    typeof input.pushEnabled !== "boolean" ||
    typeof input.quietHours?.enabled !== "boolean" ||
    typeof input.quietHours.timeZone !== "string" ||
    !isValidTimeZone(input.quietHours.timeZone)
  )
    throw new NotificationsError("invalid_request");
  const startMinute = minute(input.quietHours.startMinute);
  const endMinute = minute(input.quietHours.endMinute);
  if (input.quietHours.enabled && startMinute === endMinute)
    throw new NotificationsError("invalid_request");
  return {
    emailEnabled: input.emailEnabled,
    pushEnabled: input.pushEnabled,
    quietHours: {
      enabled: input.quietHours.enabled,
      startMinute,
      endMinute,
      timeZone: input.quietHours.timeZone,
    },
  };
}

function encodeCursor(after: { createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ v: 1, at: after.createdAt.toISOString(), id: after.id }),
  ).toString("base64url");
}

function decodeCursor(value: string): { createdAt: Date; id: string } {
  try {
    if (!/^[A-Za-z0-9_-]{1,300}$/u.test(value)) throw new Error();
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const record = parsed as Record<string, unknown>;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Object.keys(record).sort().join(",") !== "at,id,v" ||
      record.v !== 1 ||
      typeof record.at !== "string" ||
      typeof record.id !== "string" ||
      !UUID_PATTERN.test(record.id)
    )
      throw new Error();
    const createdAt = new Date(record.at);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== record.at)
      throw new Error();
    return { createdAt, id: record.id };
  } catch {
    throw new NotificationsError("invalid_request");
  }
}

export class NotificationsService {
  private readonly now: () => Date;

  constructor(
    private readonly store: Store,
    options: { now?: () => Date } = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Consumes one minimal versioned Applications event. A malformed or unsupported event is
   * rejected without effect. Never changes or fabricates source truth.
   */
  async ingestApplicationEvent(event: {
    id: unknown;
    type: unknown;
    data: unknown;
  }): Promise<{ outcome: RecordOutcome | "rejected"; itemId?: string }> {
    const projection = projectApplicationEvent({
      eventId: event.id,
      type: event.type,
      data: event.data,
    });
    if (!projection) return { outcome: "rejected" };
    return this.store.recordSourceEvent(projection, this.now());
  }

  async listInbox(
    ownerUserId: string,
    options: { states?: readonly InboxState[]; limit?: number; cursor?: string } = {},
  ): Promise<{ items: InboxItem[]; nextCursor?: string; unreadCount: number }> {
    const owner = uuid(ownerUserId);
    const limit = options.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new NotificationsError("invalid_request");
    const page: InboxPage = await this.store.listInbox(owner, {
      ...(options.states ? { states: options.states } : {}),
      limit,
      ...(options.cursor ? { after: decodeCursor(options.cursor) } : {}),
    });
    return {
      items: page.items,
      ...(page.next ? { nextCursor: encodeCursor(page.next) } : {}),
      unreadCount: await this.store.countUnread(owner),
    };
  }

  async acknowledge(ownerUserId: string, itemId: string): Promise<InboxItem> {
    return this.transition(ownerUserId, itemId, "acknowledged");
  }

  async dismiss(ownerUserId: string, itemId: string): Promise<InboxItem> {
    return this.transition(ownerUserId, itemId, "dismissed");
  }

  private async transition(
    ownerUserId: string,
    itemId: string,
    to: "acknowledged" | "dismissed",
  ): Promise<InboxItem> {
    const item = await this.store.setItemState(uuid(ownerUserId), uuid(itemId), to, this.now());
    if (!item) throw new NotificationsError("not_found");
    return item;
  }

  async expireDue(): Promise<number> {
    return this.store.expireDue(this.now());
  }

  async getPreferences(ownerUserId: string): Promise<NotificationPreferences> {
    return this.store.readPreferences(uuid(ownerUserId), this.now());
  }

  async updatePreferences(
    ownerUserId: string,
    expectedVersion: number,
    update: PreferencesUpdate,
  ): Promise<NotificationPreferences> {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0)
      throw new NotificationsError("invalid_request");
    const saved = await this.store.updatePreferences(
      uuid(ownerUserId),
      expectedVersion,
      validatePreferencesUpdate(update),
      this.now(),
    );
    if (!saved) throw new NotificationsError("version_conflict");
    return saved;
  }

  /** Which channels may carry this item now, from the candidate's own preferences. */
  async routeFor(ownerUserId: string, item: Pick<InboxItem, "urgency">): Promise<RoutingDecision> {
    const preferences = await this.getPreferences(ownerUserId);
    return routeChannels({ urgency: item.urgency, preferences, now: this.now() });
  }
}
