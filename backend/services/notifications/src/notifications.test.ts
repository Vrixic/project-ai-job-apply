import { describe, expect, it, vi } from "vitest";
import { isValidTimeZone, quietHoursEnd, routeChannels } from "./routing.js";
import { NotificationsError, NotificationsService, validatePreferencesUpdate } from "./service.js";
import { projectApplicationEvent } from "./source-events.js";
import { defaultQuietHours } from "./types.js";

const APP = "019d04cf-1f80-7000-8000-00000000a001";
const USER = "019d04cf-1f80-7000-8000-00000000b001";
const event = (status: string, revision = 3, type = "application.status_changed.v1") => ({
  eventId: "evt-0000000001",
  type,
  data: { applicationId: APP, userId: USER, revision, status },
});

describe("projectApplicationEvent (minimal versioned Applications events only)", () => {
  it.each([
    ["review_required", "application_review_needed", "normal", []],
    [
      "reconciliation_required",
      "application_outcome_needed",
      "high",
      ["application_review_needed"],
    ],
    [
      "applied",
      "application_confirmed",
      "low",
      ["application_review_needed", "application_outcome_needed"],
    ],
  ])("%s opens %s (%s)", (status, kind, urgency, resolves) => {
    const projection = projectApplicationEvent(event(status));
    expect(projection).toMatchObject({
      ownerUserId: USER,
      applicationId: APP,
      revision: 3,
      open: { kind, urgency },
      resolves,
    });
  });

  it.each(["preparing", "approved", "submitting", "takeover", "cancelled"])(
    "%s opens nothing and resolves the review item",
    (status) => {
      const projection = projectApplicationEvent(event(status));
      expect(projection?.open).toBeNull();
      expect(projection?.resolves).toContain("application_review_needed");
    },
  );

  it("treats application.applied.v1 like an applied status and refuses a mismatch", () => {
    expect(projectApplicationEvent(event("applied", 4, "application.applied.v1"))?.open?.kind).toBe(
      "application_confirmed",
    );
    expect(projectApplicationEvent(event("approved", 4, "application.applied.v1"))).toBeNull();
  });

  it.each([
    ["an unknown type", { ...event("applied"), type: "job.expired.v1" }],
    ["a bad event id", { ...event("applied"), eventId: "x" }],
    ["an unknown status", event("hired")],
    ["a bad revision", event("applied", 0)],
    ["extra keys", { ...event("applied"), data: { ...event("applied").data, note: "x" } }],
    ["missing keys", { ...event("applied"), data: { applicationId: APP, userId: USER } }],
    ["a non-uuid owner", { ...event("applied"), data: { ...event("applied").data, userId: "u" } }],
    ["null data", { ...event("applied"), data: null }],
  ])("refuses %s", (_name, value) => {
    expect(projectApplicationEvent(value)).toBeNull();
  });

  it("carries no hiring outcome or candidate content", () => {
    const projection = JSON.stringify(projectApplicationEvent(event("applied")));
    expect(projection).not.toMatch(/interview|offer|reject|recruiter|hired/iu);
  });
});

describe("quiet hours and routing", () => {
  const quiet = { enabled: true, startMinute: 1320, endMinute: 420, timeZone: "America/New_York" };
  // 2026-10-22T03:30:00Z is 23:30 the evening before in New York (UTC-4 in October).
  const night = new Date("2026-10-22T03:30:00Z");
  const afternoon = new Date("2026-10-22T18:00:00Z");

  it("validates time zones", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("finds the end of a window that wraps midnight, and none outside it", () => {
    // 23:30 local until 07:00 local is 7.5 hours.
    expect(quietHoursEnd(quiet, night)?.toISOString()).toBe("2026-10-22T11:00:00.000Z");
    expect(quietHoursEnd(quiet, afternoon)).toBeUndefined();
    expect(quietHoursEnd({ ...quiet, enabled: false }, night)).toBeUndefined();
    expect(quietHoursEnd({ ...quiet, timeZone: "Not/AZone" }, night)).toBeUndefined();
  });

  it("keeps email off unless the candidate turned it on", () => {
    const decision = routeChannels({
      urgency: "normal",
      preferences: { emailEnabled: false, quietHours: defaultQuietHours },
      now: afternoon,
    });
    expect(decision).toEqual({
      inApp: true,
      email: { action: "skip", reason: "channel_off" },
    });
  });

  it("defers email during quiet hours, except for an urgent item", () => {
    const preferences = { emailEnabled: true, quietHours: quiet };
    const normal = routeChannels({ urgency: "normal", preferences, now: night });
    expect(normal.email).toEqual({
      action: "defer_until",
      at: new Date("2026-10-22T11:00:00.000Z"),
    });
    expect(routeChannels({ urgency: "high", preferences, now: night }).email).toEqual({
      action: "send_now",
    });
    expect(routeChannels({ urgency: "low", preferences, now: afternoon }).email).toEqual({
      action: "send_now",
    });
  });

  it("always keeps the in-app record, whatever the preferences say", () => {
    expect(
      routeChannels({
        urgency: "low",
        preferences: { emailEnabled: false, quietHours: quiet },
        now: night,
      }).inApp,
    ).toBe(true);
  });
});

describe("preferences validation", () => {
  const valid = {
    emailEnabled: true,
    quietHours: { enabled: true, startMinute: 1320, endMinute: 420, timeZone: "UTC" },
  };
  it("accepts a valid update", () => {
    expect(validatePreferencesUpdate(valid)).toEqual(valid);
  });
  it.each([
    ["a bad zone", { ...valid, quietHours: { ...valid.quietHours, timeZone: "Nope" } }],
    ["a minute out of range", { ...valid, quietHours: { ...valid.quietHours, startMinute: 1440 } }],
    ["a fractional minute", { ...valid, quietHours: { ...valid.quietHours, endMinute: 1.5 } }],
    ["an empty enabled window", { ...valid, quietHours: { ...valid.quietHours, endMinute: 1320 } }],
    ["a non-boolean flag", { ...valid, emailEnabled: "yes" as never }],
  ])("rejects %s", (_name, value) => {
    expect(() => validatePreferencesUpdate(value)).toThrow(NotificationsError);
  });
  it("allows an equal start and end when quiet hours are off", () => {
    expect(
      validatePreferencesUpdate({
        ...valid,
        quietHours: { ...valid.quietHours, enabled: false, endMinute: 1320 },
      }).quietHours.enabled,
    ).toBe(false);
  });
});

describe("NotificationsService", () => {
  const store = () => ({
    recordSourceEvent: vi.fn(async () => ({ outcome: "recorded" as const, itemId: "x" })),
    listInbox: vi.fn(async () => ({ items: [] })),
    countUnread: vi.fn(async () => 0),
    setItemState: vi.fn(async () => null),
    expireDue: vi.fn(async () => 0),
    readPreferences: vi.fn(),
    updatePreferences: vi.fn(async () => null),
  });
  it("rejects a malformed event without touching the store", async () => {
    const s = store();
    const service = new NotificationsService(s);
    await expect(
      service.ingestApplicationEvent({ id: "evt-0000000001", type: "other", data: {} }),
    ).resolves.toEqual({ outcome: "rejected" });
    expect(s.recordSourceEvent).not.toHaveBeenCalled();
  });
  it("maps an unknown item to not_found and a stale version to a conflict", async () => {
    const service = new NotificationsService(store());
    await expect(service.acknowledge(USER, APP)).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.updatePreferences(USER, 2, {
        emailEnabled: false,
        quietHours: defaultQuietHours,
      }),
    ).rejects.toMatchObject({ code: "version_conflict" });
  });
  it("refuses an invalid owner, item id, limit or cursor", async () => {
    const service = new NotificationsService(store());
    await expect(service.listInbox("nope")).rejects.toMatchObject({ code: "invalid_request" });
    await expect(service.listInbox(USER, { limit: 0 })).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(service.listInbox(USER, { cursor: "garbage" })).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(service.dismiss(USER, "nope")).rejects.toMatchObject({ code: "invalid_request" });
  });
});
