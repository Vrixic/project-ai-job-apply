import type { NotificationPreferences, NotificationUrgency, QuietHours } from "./types.js";

export type ChannelDecision =
  | { action: "send_now" }
  | { action: "defer_until"; at: Date }
  | { action: "skip"; reason: "channel_off" };

export interface RoutingDecision {
  /** Always recorded: the inbox is the fallback when external delivery fails. */
  inApp: true;
  email: ChannelDecision;
  push: ChannelDecision;
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value.length >= 1 && value.length <= 64;
  } catch {
    return false;
  }
}

/** Minutes after local midnight in the zone at this instant. */
function localMinute(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(at);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return hour * 60 + minute;
}

function within(minute: number, start: number, end: number): boolean {
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/** When quiet hours end, as an instant, or undefined when `now` is not inside the window. */
export function quietHoursEnd(quiet: QuietHours, now: Date): Date | undefined {
  if (!quiet.enabled || !isValidTimeZone(quiet.timeZone)) return undefined;
  const minute = localMinute(now, quiet.timeZone);
  if (!within(minute, quiet.startMinute, quiet.endMinute)) return undefined;
  const wait = (quiet.endMinute - minute + 1440) % 1440 || 1440;
  // Whole minutes are enough: delivery is scheduled, not timed to the second.
  const rounded = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  return new Date(rounded.getTime() + wait * 60_000);
}

/**
 * Which channels may carry an item now. External channels are off unless the candidate turned
 * them on; quiet hours defer them except for an urgent item; nothing here can remove the in-app
 * record or change the source fact.
 */
export function routeChannels(input: {
  urgency: NotificationUrgency;
  preferences: Pick<NotificationPreferences, "emailEnabled" | "pushEnabled" | "quietHours">;
  now: Date;
}): RoutingDecision {
  const quietEnd =
    input.urgency === "high" ? undefined : quietHoursEnd(input.preferences.quietHours, input.now);
  const decide = (enabled: boolean): ChannelDecision =>
    !enabled
      ? { action: "skip", reason: "channel_off" }
      : quietEnd
        ? { action: "defer_until", at: quietEnd }
        : { action: "send_now" };
  return {
    inApp: true,
    email: decide(input.preferences.emailEnabled),
    push: decide(input.preferences.pushEnabled),
  };
}
