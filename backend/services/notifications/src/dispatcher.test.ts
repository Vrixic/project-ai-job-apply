import { describe, expect, it, vi } from "vitest";
import { DeliveryProviderError, type EmailProvider } from "./delivery.js";
import { NotificationDispatcher } from "./dispatcher.js";

const attempt = {
  id: "attempt-1",
  ownerUserId: "owner-1",
  inboxItemId: "item-1",
  channel: "email" as const,
  attemptCount: 1,
};

function dispatcherWith(email: EmailProvider, log: (entry: unknown) => void) {
  const store = {
    claimDue: vi.fn().mockResolvedValue([attempt]),
    loadContext: vi.fn().mockResolvedValue({
      kind: "test_notification",
      urgency: "normal",
      itemState: "unread",
      itemExpiresAt: new Date("2030-01-01T00:00:00.000Z"),
      emailEnabled: true,
      quietHours: { enabled: false, startMinute: 0, endMinute: 0, timeZone: "UTC" },
      email: { address: "person@example.com", state: "verified" },
    }),
    finishAttempt: vi.fn().mockResolvedValue(undefined),
    rescheduleAttempt: vi.fn().mockResolvedValue(undefined),
    suppressEmail: vi.fn().mockResolvedValue(undefined),
  };
  const dispatcher = new NotificationDispatcher({
    store,
    email,
    webBaseUrl: "https://app.example.com",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    log,
  });
  return { dispatcher, store };
}

describe("NotificationDispatcher diagnostics", () => {
  it("reports the provider code of a retried send, never the address", async () => {
    const log = vi.fn();
    const { dispatcher, store } = dispatcherWith(
      {
        send: async () => {
          throw new DeliveryProviderError(false, "ses_AccessDeniedException");
        },
      },
      log,
    );
    expect(await dispatcher.run()).toMatchObject({ retried: 1, sent: 0 });
    expect(log).toHaveBeenCalledWith({
      event: "notification_delivery_error",
      reason: "ses_AccessDeniedException",
      permanent: false,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("person@example.com");
    expect(store.rescheduleAttempt).toHaveBeenCalledOnce();
  });

  it("reports only the error class for a failure that is not from the provider", async () => {
    const log = vi.fn();
    const { dispatcher } = dispatcherWith(
      {
        send: async () => {
          throw new TypeError("could not reach person@example.com");
        },
      },
      log,
    );
    await dispatcher.run();
    expect(log).toHaveBeenCalledWith({
      event: "notification_delivery_error",
      reason: "TypeError",
      permanent: false,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("person@example.com");
  });

  it("marks a permanent rejection and stays silent after a successful send", async () => {
    const log = vi.fn();
    const rejected = dispatcherWith(
      {
        send: async () => {
          throw new DeliveryProviderError(true, "ses_MessageRejected");
        },
      },
      log,
    );
    expect(await rejected.dispatcher.run()).toMatchObject({ failed: 1 });
    expect(log).toHaveBeenCalledWith({
      event: "notification_delivery_error",
      reason: "ses_MessageRejected",
      permanent: true,
    });

    const quiet = vi.fn();
    const ok = dispatcherWith({ send: async () => ({ reference: "ref-1" }) }, quiet);
    expect(await ok.dispatcher.run()).toMatchObject({ sent: 1 });
    expect(quiet).not.toHaveBeenCalled();
  });
});
