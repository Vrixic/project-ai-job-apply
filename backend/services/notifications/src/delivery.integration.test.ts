import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DeliveryProviderError,
  type EmailMessage,
  type EmailProvider,
  type PushProvider,
  type PushResult,
} from "./delivery.js";
import { PostgresDeliveryStore } from "./delivery-store.js";
import { NotificationDispatcher } from "./dispatcher.js";
import { NotificationsService } from "./service.js";
import { PostgresNotificationsStore } from "./store.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

class FakeEmail implements EmailProvider {
  readonly sent: EmailMessage[] = [];
  next: DeliveryProviderError | undefined;
  async send(message: EmailMessage) {
    if (this.next) {
      const error = this.next;
      throw error;
    }
    this.sent.push(message);
    return { reference: `ref-${this.sent.length}` };
  }
  to(address: string) {
    return this.sent.filter((message) => message.to === address);
  }
}

class FakePush implements PushProvider {
  readonly posted: string[] = [];
  results = new Map<string, PushResult | DeliveryProviderError>();
  async send(endpoint: string): Promise<PushResult> {
    this.posted.push(endpoint);
    const result = this.results.get(endpoint) ?? "delivered";
    if (result instanceof DeliveryProviderError) throw result;
    return result;
  }
}

describeWithDatabase("Notification delivery over PostgreSQL", () => {
  const client = postgres(databaseUrl ?? "postgres://invalid", {
    max: 6,
    onnotice: () => undefined,
  });
  const store = new PostgresNotificationsStore(client);
  const delivery = new PostgresDeliveryStore(client);
  let clock = new Date("2026-10-23T12:00:00.000Z");
  const now = () => clock;
  const advance = (milliseconds: number) => {
    clock = new Date(clock.getTime() + milliseconds);
  };
  const minute = 60_000;
  const service = new NotificationsService(store, { now, delivery });
  const email = new FakeEmail();
  const push = new FakePush();
  const dispatcher = new NotificationDispatcher({
    store: delivery,
    email,
    push,
    webBaseUrl: "https://app.example.test",
    now,
    batchSize: 500,
  });

  beforeAll(async () => {
    const executable = fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url));
    await execFileAsync(process.execPath, [executable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
  });
  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  const addressOf = (owner: string) => `${owner}@example.test`;
  const quietOff = { enabled: false, startMinute: 1320, endMinute: 420, timeZone: "UTC" };

  async function confirmedEmailOwner(options: { push?: boolean; quiet?: boolean } = {}) {
    const owner = uuidv7();
    await service.setAccountEmail(owner, addressOf(owner));
    await service.updatePreferences(owner, 0, {
      emailEnabled: true,
      pushEnabled: options.push ?? false,
      quietHours: options.quiet
        ? { enabled: true, startMinute: 1320, endMinute: 420, timeZone: "UTC" }
        : quietOff,
    });
    return owner;
  }

  async function openItem(owner: string, status = "review_required") {
    const application = uuidv7();
    const result = await service.ingestApplicationEvent({
      id: `evt-${uuidv7()}`,
      type: "application.status_changed.v1",
      data: { applicationId: application, userId: owner, revision: 2, status },
    });
    expect(result.outcome).toBe("recorded");
    return { application, itemId: result.itemId as string };
  }

  const attemptOf = async (itemId: string, channel: string) => {
    const [row] = await client<
      {
        state: string;
        outcome_code: string | null;
        attempt_count: number;
        not_before: Date;
        provider_reference: string | null;
      }[]
    >`
      SELECT state, outcome_code, attempt_count, not_before, provider_reference
      FROM notifications.delivery_attempts
      WHERE inbox_item_id = ${itemId}::uuid AND channel = ${channel}
    `;
    return row;
  };

  it("records the verified account address, normalized and idempotently", async () => {
    const owner = uuidv7();
    await service.setAccountEmail(owner, `  ${addressOf(owner).toUpperCase()} `);
    expect((await service.getDeliveryStatus(owner)).email).toEqual({
      address: addressOf(owner),
      state: "verified",
    });
    const [row] = await client<{ verified_at: Date }[]>`
      SELECT verified_at FROM notifications.email_destinations WHERE owner_user_id = ${owner}::uuid
    `;
    advance(minute);
    await service.setAccountEmail(owner, addressOf(owner));
    const [again] = await client<{ verified_at: Date }[]>`
      SELECT verified_at FROM notifications.email_destinations WHERE owner_user_id = ${owner}::uuid
    `;
    expect(again?.verified_at).toEqual(row?.verified_at);
    // No code is emailed: the identity provider already verified the address.
    await dispatcher.run();
    expect(email.to(addressOf(owner))).toHaveLength(0);
  });

  it("rejects a malformed or missing address before touching storage", async () => {
    const owner = uuidv7();
    for (const address of ["not-an-address", undefined, 42]) {
      await expect(service.setAccountEmail(owner, address)).rejects.toMatchObject({
        code: "invalid_request",
      });
    }
    expect((await service.getDeliveryStatus(owner)).email).toBeUndefined();
  });

  it("emails a new inbox item once, with generic wording only", async () => {
    const owner = await confirmedEmailOwner();
    const { application, itemId } = await openItem(owner);
    expect(await attemptOf(itemId, "email")).toMatchObject({ state: "scheduled" });
    const summary = await dispatcher.run();
    expect(summary.sent).toBeGreaterThanOrEqual(1);
    const mails = email.to(addressOf(owner)).filter((mail) => mail.subject.includes("application"));
    expect(mails).toHaveLength(1);
    expect(mails[0]?.subject).toBe("An application is waiting for your review");
    expect(mails[0]?.text).not.toContain(application);
    expect(await attemptOf(itemId, "email")).toMatchObject({
      state: "sent",
      outcome_code: "delivered",
      attempt_count: 1,
    });
    await dispatcher.run();
    expect(
      email.to(addressOf(owner)).filter((mail) => mail.subject.includes("application")),
    ).toHaveLength(1);
  });

  it("delivers a candidate-requested test item to the channels that are on, and limits them", async () => {
    const owner = await confirmedEmailOwner();
    const sent = await service.sendTestNotification(owner);
    const inbox = await service.listInbox(owner);
    expect(inbox.items.map((item) => item.id)).toContain(sent.id);
    expect(inbox.items.find((item) => item.id === sent.id)).toMatchObject({
      kind: "test_notification",
      state: "unread",
    });
    expect(await attemptOf(sent.id, "email")).toMatchObject({ state: "scheduled" });
    await dispatcher.run();
    const mails = email
      .to(addressOf(owner))
      .filter((mail) => mail.subject === "A test notification from your settings");
    expect(mails).toHaveLength(1);
    expect(mails[0]?.text).not.toContain(owner);
    expect(await attemptOf(sent.id, "email")).toMatchObject({ state: "sent" });

    for (let index = 1; index < 5; index += 1) await service.sendTestNotification(owner);
    await expect(service.sendTestNotification(owner)).rejects.toMatchObject({
      code: "rate_limited",
    });
    // The hour passes and another is allowed. Other candidates are never affected.
    await expect(service.sendTestNotification(uuidv7())).resolves.toMatchObject({
      id: expect.any(String),
    });
    advance(61 * minute);
    await expect(service.sendTestNotification(owner)).resolves.toMatchObject({
      id: expect.any(String),
    });
  });

  it("does not email a test item to a candidate whose email is off", async () => {
    const owner = uuidv7();
    const sent = await service.sendTestNotification(owner);
    expect(await attemptOf(sent.id, "email")).toBeUndefined();
    expect((await service.listInbox(owner)).items).toHaveLength(1);
  });

  it("does not schedule a channel that is off or has no verified destination", async () => {
    const off = uuidv7();
    await service.updatePreferences(off, 0, {
      emailEnabled: false,
      pushEnabled: false,
      quietHours: quietOff,
    });
    const first = await openItem(off);
    expect(await attemptOf(first.itemId, "email")).toBeUndefined();

    const unverified = uuidv7();
    await service.updatePreferences(unverified, 0, {
      emailEnabled: true,
      pushEnabled: true,
      quietHours: quietOff,
    });
    const second = await openItem(unverified);
    expect(await attemptOf(second.itemId, "email")).toBeUndefined();
    expect(await attemptOf(second.itemId, "push")).toBeUndefined();
  });

  it("skips an item the candidate already handled and a channel turned off since", async () => {
    const owner = await confirmedEmailOwner();
    const handled = await openItem(owner);
    await service.acknowledge(owner, handled.itemId);
    const later = await openItem(owner, "reconciliation_required");
    const preferences = await service.getPreferences(owner);
    await service.updatePreferences(owner, preferences.version, {
      emailEnabled: false,
      pushEnabled: false,
      quietHours: quietOff,
    });
    const before = email.to(addressOf(owner)).length;
    await dispatcher.run();
    expect(email.to(addressOf(owner))).toHaveLength(before);
    expect(await attemptOf(handled.itemId, "email")).toMatchObject({
      state: "skipped",
      outcome_code: "item_resolved",
    });
    expect(await attemptOf(later.itemId, "email")).toMatchObject({
      state: "skipped",
      outcome_code: "channel_off",
    });
  });

  it("defers a normal item through quiet hours but not an urgent one", async () => {
    clock = new Date("2026-10-24T23:30:00.000Z");
    const owner = await confirmedEmailOwner({ quiet: true });
    const normal = await openItem(owner);
    const urgent = await openItem(owner, "reconciliation_required");
    const normalAttempt = await attemptOf(normal.itemId, "email");
    expect(normalAttempt?.not_before.toISOString()).toBe("2026-10-25T07:00:00.000Z");
    await dispatcher.run();
    expect(await attemptOf(urgent.itemId, "email")).toMatchObject({ state: "sent" });
    expect(await attemptOf(normal.itemId, "email")).toMatchObject({ state: "scheduled" });
    advance(7.6 * 60 * minute);
    await dispatcher.run();
    expect(await attemptOf(normal.itemId, "email")).toMatchObject({ state: "sent" });
  });

  it("re-defers an attempt whose quiet hours began after it was scheduled", async () => {
    clock = new Date("2026-10-26T12:00:00.000Z");
    const owner = await confirmedEmailOwner();
    const { itemId } = await openItem(owner);
    const preferences = await service.getPreferences(owner);
    await service.updatePreferences(owner, preferences.version, {
      emailEnabled: true,
      pushEnabled: false,
      quietHours: { enabled: true, startMinute: 11 * 60, endMinute: 13 * 60, timeZone: "UTC" },
    });
    await dispatcher.run();
    const attempt = await attemptOf(itemId, "email");
    expect(attempt).toMatchObject({ state: "scheduled", outcome_code: "deferred_quiet_hours" });
    expect(attempt?.attempt_count).toBe(0);
    expect(attempt?.not_before.toISOString()).toBe("2026-10-26T13:00:00.000Z");
  });

  it("suppresses an address after a permanent rejection and keeps the inbox item", async () => {
    const owner = await confirmedEmailOwner();
    const { itemId } = await openItem(owner);
    email.next = new DeliveryProviderError(true, "ses_MessageRejected");
    try {
      await dispatcher.run();
    } finally {
      email.next = undefined;
    }
    expect(await attemptOf(itemId, "email")).toMatchObject({
      state: "failed",
      outcome_code: "rejected_permanent",
    });
    expect((await service.getDeliveryStatus(owner)).email).toMatchObject({ state: "suppressed" });
    // Recording the same address again does not lift the suppression; a changed one replaces it.
    await service.setAccountEmail(owner, addressOf(owner));
    expect((await service.getDeliveryStatus(owner)).email).toMatchObject({ state: "suppressed" });
    await service.setAccountEmail(owner, `new-${addressOf(owner)}`);
    expect((await service.getDeliveryStatus(owner)).email).toEqual({
      address: `new-${addressOf(owner)}`,
      state: "verified",
    });
    const inbox = await service.listInbox(owner);
    expect(inbox.items.map((item) => item.id)).toContain(itemId);
    expect(inbox.items.find((item) => item.id === itemId)?.state).toBe("unread");
  });

  it("retries a transient failure with backoff and gives up after five tries", async () => {
    clock = new Date("2026-10-27T12:00:00.000Z");
    const owner = await confirmedEmailOwner();
    const { itemId } = await openItem(owner);
    email.next = new DeliveryProviderError(false, "ses_TooManyRequestsException");
    try {
      const delays = [1, 5, 30, 120];
      for (const [index, delay] of delays.entries()) {
        await dispatcher.run();
        const attempt = await attemptOf(itemId, "email");
        expect(attempt).toMatchObject({ state: "scheduled", attempt_count: index + 1 });
        expect(attempt?.not_before.getTime()).toBe(clock.getTime() + delay * minute);
        // Not due yet: nothing happens a moment later.
        advance(delay * minute - 1000);
        await dispatcher.run();
        expect((await attemptOf(itemId, "email"))?.attempt_count).toBe(index + 1);
        advance(1000);
      }
      await dispatcher.run();
      expect(await attemptOf(itemId, "email")).toMatchObject({
        state: "failed",
        outcome_code: "attempts_exhausted",
        attempt_count: 5,
      });
    } finally {
      email.next = undefined;
    }
    // A transient failure never suppresses the address.
    expect((await service.getDeliveryStatus(owner)).email).toMatchObject({ state: "verified" });
  });

  it("keeps concurrent dispatchers from claiming the same attempt and reclaims an expired lease", async () => {
    clock = new Date("2026-10-28T12:00:00.000Z");
    const owners: string[] = [];
    for (let index = 0; index < 4; index += 1) owners.push(await confirmedEmailOwner());
    const ids: string[] = [];
    for (const owner of owners) ids.push((await openItem(owner)).itemId);
    const [first, second] = await Promise.all([
      delivery.claimDue(now(), 1000),
      delivery.claimDue(now(), 1000),
    ]);
    const firstIds = new Set(first.map((attempt) => attempt.id));
    expect(second.filter((attempt) => firstIds.has(attempt.id))).toEqual([]);
    expect(first.length + second.length).toBeGreaterThanOrEqual(4);
    // The crashed claimers never finish: after the lease the attempts are claimable again.
    advance(minute);
    expect(await delivery.claimDue(now(), 1000)).toEqual([]);
    advance(2 * minute);
    const reclaimed = await delivery.claimDue(now(), 1000);
    expect(reclaimed.length).toBe(first.length + second.length);
    // Earlier tests may leave their own attempts due; only this test's four are counted here.
    const mine = reclaimed.filter((attempt) => ids.includes(attempt.inboxItemId));
    expect(mine).toHaveLength(4);
    expect(mine.every((attempt) => attempt.attemptCount === 2)).toBe(true);
    for (const attempt of reclaimed)
      await delivery.finishAttempt(attempt.id, "skipped", "item_resolved", now());
    expect(ids).toHaveLength(4);
  });

  it("skips scheduled mail when the account address changes", async () => {
    const replaced = await confirmedEmailOwner();
    const second = await openItem(replaced);
    await service.setAccountEmail(replaced, `new-${addressOf(replaced)}`);
    expect(await attemptOf(second.itemId, "email")).toMatchObject({
      state: "skipped",
      outcome_code: "no_destination",
    });
  });

  describe("push", () => {
    const endpointFor = (label: string) =>
      `https://fcm.googleapis.com/fcm/send/${label}-${uuidv7()}`;

    it("subscribes, delivers a payload-less push and records the success", async () => {
      const owner = await confirmedEmailOwner({ push: true });
      const endpoint = endpointFor("ok");
      const { id } = await service.addPushSubscription(owner, endpoint);
      const { itemId } = await openItem(owner);
      expect(await attemptOf(itemId, "push")).toMatchObject({ state: "scheduled" });
      await dispatcher.run();
      expect(push.posted).toContain(endpoint);
      expect(await attemptOf(itemId, "push")).toMatchObject({
        state: "sent",
        provider_reference: "subscriptions:1",
      });
      const status = await service.getDeliveryStatus(owner);
      expect(status.pushSubscriptions).toEqual([expect.objectContaining({ id, state: "active" })]);
      const [row] = await client<{ last_success_at: Date | null }[]>`
        SELECT last_success_at FROM notifications.push_subscriptions WHERE id = ${id}::uuid
      `;
      expect(row?.last_success_at).not.toBeNull();
    });

    it("expires a gone subscription and falls back to the inbox", async () => {
      const owner = await confirmedEmailOwner({ push: true });
      const endpoint = endpointFor("gone");
      push.results.set(endpoint, "gone");
      await service.addPushSubscription(owner, endpoint);
      const { itemId } = await openItem(owner);
      await dispatcher.run();
      expect(await attemptOf(itemId, "push")).toMatchObject({
        state: "skipped",
        outcome_code: "no_destination",
      });
      expect((await service.getDeliveryStatus(owner)).pushSubscriptions[0]?.state).toBe("expired");
      expect((await service.listInbox(owner)).items.map((item) => item.id)).toContain(itemId);
    });

    it("delivers when one of several subscriptions is gone", async () => {
      const owner = await confirmedEmailOwner({ push: true });
      const gone = endpointFor("gone");
      const live = endpointFor("live");
      push.results.set(gone, "gone");
      await service.addPushSubscription(owner, gone);
      await service.addPushSubscription(owner, live);
      const { itemId } = await openItem(owner);
      await dispatcher.run();
      expect(await attemptOf(itemId, "push")).toMatchObject({ state: "sent" });
      const states = (await service.getDeliveryStatus(owner)).pushSubscriptions.map((s) => s.state);
      expect(states.sort()).toEqual(["active", "expired"]);
    });

    it("retries when the push service is unavailable and never expires the subscription", async () => {
      clock = new Date("2026-10-29T12:00:00.000Z");
      const owner = await confirmedEmailOwner({ push: true });
      const endpoint = endpointFor("down");
      push.results.set(endpoint, new DeliveryProviderError(false, "push_status_503"));
      await service.addPushSubscription(owner, endpoint);
      const { itemId } = await openItem(owner);
      await dispatcher.run();
      expect(await attemptOf(itemId, "push")).toMatchObject({
        state: "scheduled",
        attempt_count: 1,
      });
      expect((await service.getDeliveryStatus(owner)).pushSubscriptions[0]?.state).toBe("active");
      push.results.set(endpoint, "delivered");
      advance(2 * minute);
      await dispatcher.run();
      expect(await attemptOf(itemId, "push")).toMatchObject({ state: "sent", attempt_count: 2 });
    });

    it("refuses endpoints outside the push services and more than five subscriptions", async () => {
      const owner = uuidv7();
      await expect(
        service.addPushSubscription(owner, "https://evil.example.com/fcm.googleapis.com/x"),
      ).rejects.toMatchObject({ code: "invalid_request" });
      for (let index = 0; index < 5; index += 1)
        await service.addPushSubscription(owner, endpointFor(`n${index}`));
      await expect(service.addPushSubscription(owner, endpointFor("n5"))).rejects.toMatchObject({
        code: "limit_reached",
      });
      // Re-subscribing an existing endpoint is not a sixth subscription.
      const again = endpointFor("again");
      const other = uuidv7();
      const { id } = await service.addPushSubscription(other, again);
      await expect(service.addPushSubscription(other, again)).resolves.toEqual({ id });
    });

    it("moves a browser endpoint to the candidate who subscribed last and removes only your own", async () => {
      const first = uuidv7();
      const second = uuidv7();
      const endpoint = endpointFor("shared");
      const { id } = await service.addPushSubscription(first, endpoint);
      await expect(service.addPushSubscription(second, endpoint)).resolves.toEqual({ id });
      expect((await service.getDeliveryStatus(first)).pushSubscriptions).toEqual([]);
      await expect(service.removePushSubscription(first, id)).rejects.toMatchObject({
        code: "not_found",
      });
      await expect(service.removePushSubscription(second, id)).resolves.toBeUndefined();
    });

    it("skips scheduled push when the last subscription is removed", async () => {
      const owner = await confirmedEmailOwner({ push: true });
      const { id } = await service.addPushSubscription(owner, endpointFor("rm"));
      const { itemId } = await openItem(owner);
      await service.removePushSubscription(owner, id);
      expect(await attemptOf(itemId, "push")).toMatchObject({
        state: "skipped",
        outcome_code: "no_destination",
      });
    });
  });

  it("answers not_found when delivery is not configured", async () => {
    const unconfigured = new NotificationsService(store, { now });
    await expect(unconfigured.getDeliveryStatus(uuidv7())).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("exposes the public push key only when configured", async () => {
    const configured = new NotificationsService(store, {
      now,
      delivery,
      pushPublicKey: "BPublicKey",
    });
    expect((await configured.getDeliveryStatus(uuidv7())).pushPublicKey).toBe("BPublicKey");
    expect((await service.getDeliveryStatus(uuidv7())).pushPublicKey).toBeUndefined();
  });
});
