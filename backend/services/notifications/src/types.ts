export const notificationKinds = Object.freeze([
  "application_review_needed",
  "application_outcome_needed",
  "application_confirmed",
  "test_notification",
] as const);
export const notificationUrgencies = Object.freeze(["low", "normal", "high"] as const);
export const inboxStates = Object.freeze([
  "unread",
  "acknowledged",
  "dismissed",
  "expired",
] as const);

export type NotificationKind = (typeof notificationKinds)[number];
export type NotificationUrgency = (typeof notificationUrgencies)[number];
export type InboxState = (typeof inboxStates)[number];

/** A derived projection: a classification and an opaque reference, never candidate content. */
export interface InboxItem {
  id: string;
  kind: NotificationKind;
  urgency: NotificationUrgency;
  state: InboxState;
  /** The Applications aggregate this item points at. Resolve details through Applications. */
  applicationId: string;
  sourceRevision: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export interface QuietHours {
  enabled: boolean;
  /** Minutes after local midnight, 0 to 1439. The window may wrap midnight. */
  startMinute: number;
  endMinute: number;
  /** IANA time zone, for example America/New_York. */
  timeZone: string;
}

export interface NotificationPreferences {
  version: number;
  /** Always true: the in-app inbox is the fallback when external delivery fails. */
  inAppEnabled: true;
  emailEnabled: boolean;
  pushEnabled: boolean;
  quietHours: QuietHours;
  updatedAt: Date;
}

export const defaultQuietHours: QuietHours = Object.freeze({
  enabled: false,
  startMinute: 1320,
  endMinute: 420,
  timeZone: "UTC",
});

export const itemLifetimeMilliseconds = Object.freeze({
  action: 30 * 24 * 60 * 60 * 1000,
  info: 7 * 24 * 60 * 60 * 1000,
});
