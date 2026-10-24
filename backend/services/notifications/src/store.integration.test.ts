import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NotificationsService } from "./service.js";
import { projectApplicationEvent } from "./source-events.js";
import { PostgresNotificationsStore } from "./store.js";
import { mirrorSharedClient } from "./test-client.js";
import { defaultQuietHours } from "./types.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

describeWithDatabase("Notifications store over PostgreSQL", () => {
  const client = postgres(databaseUrl ?? "postgres://invalid", {
    max: 4,
    onnotice: () => undefined,
  });
  mirrorSharedClient(client);
  const store = new PostgresNotificationsStore(client);
  let clock = new Date("2026-10-22T12:00:00.000Z");
  const service = new NotificationsService(store, { now: () => clock });
  const tick = (seconds = 1) => {
    clock = new Date(clock.getTime() + seconds * 1000);
  };

  beforeAll(async () => {
    const executable = fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url));
    await execFileAsync(process.execPath, [executable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
  });
  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  const owner = () => uuidv7();
  const send = (
    user: string,
    application: string,
    status: string,
    revision: number,
    id = `evt-${uuidv7()}`,
  ) =>
    service.ingestApplicationEvent({
      id,
      type: "application.status_changed.v1",
      data: { applicationId: application, userId: user, revision, status },
    });

  it("opens one item per event, ignores a replay, and lists newest first", async () => {
    const user = owner();
    const first = uuidv7();
    const second = uuidv7();
    const replayId = `evt-replay-${uuidv7()}`;
    const a = await send(user, first, "review_required", 2, replayId);
    expect(a.outcome).toBe("recorded");
    expect((await send(user, first, "review_required", 2, replayId)).outcome).toBe("duplicate");
    tick();
    expect((await send(user, second, "reconciliation_required", 5)).outcome).toBe("recorded");
    const inbox = await service.listInbox(user);
    expect(inbox.items.map((item) => item.kind)).toEqual([
      "application_outcome_needed",
      "application_review_needed",
    ]);
    expect(inbox.items[0]).toMatchObject({
      urgency: "high",
      state: "unread",
      applicationId: second,
    });
    expect(inbox.unreadCount).toBe(2);
  });

  it("does not open a second item for the same kind, application and revision", async () => {
    const user = owner();
    const application = uuidv7();
    await send(user, application, "review_required", 4);
    const again = await send(user, application, "review_required", 4);
    expect(again.outcome).toBe("duplicate");
    expect((await service.listInbox(user)).items).toHaveLength(1);
  });

  it("refuses an older revision as stale and resolves earlier items when the source moves on", async () => {
    const user = owner();
    const application = uuidv7();
    await send(user, application, "review_required", 3);
    tick();
    expect((await send(user, application, "review_required", 2)).outcome).toBe("stale");
    tick();
    // The candidate approved: the review item no longer applies.
    expect((await send(user, application, "approved", 4)).outcome).toBe("ignored");
    expect((await service.listInbox(user)).items).toHaveLength(0);
    const expired = await service.listInbox(user, { states: ["expired"] });
    expect(expired.items.map((item) => item.kind)).toEqual(["application_review_needed"]);
    tick();
    await send(user, application, "applied", 6);
    const inbox = await service.listInbox(user);
    expect(inbox.items.map((item) => item.kind)).toEqual(["application_confirmed"]);
  });

  it("serializes concurrent events for one application without losing a cursor", async () => {
    const user = owner();
    const application = uuidv7();
    const results = await Promise.all(
      [2, 3, 4, 5].map((revision) =>
        send(user, application, revision === 5 ? "applied" : "review_required", revision),
      ),
    );
    expect(
      results.every((result) => ["recorded", "ignored", "stale"].includes(result.outcome)),
    ).toBe(true);
    const [cursor] = await client<{ last_revision: string }[]>`
      SELECT last_revision FROM notifications.source_cursors
      WHERE owner_user_id = ${user}::uuid AND aggregate_id = ${application}::uuid
    `;
    expect(Number(cursor?.last_revision)).toBe(5);
  });

  it("acknowledges and dismisses only the owner's own item and never the source", async () => {
    const user = owner();
    const stranger = owner();
    const application = uuidv7();
    const { itemId } = await send(user, application, "review_required", 2);
    if (!itemId) throw new Error("expected an item");
    await expect(service.acknowledge(stranger, itemId)).rejects.toMatchObject({
      code: "not_found",
    });
    tick();
    expect((await service.acknowledge(user, itemId)).state).toBe("acknowledged");
    // Idempotent, and an acknowledged item stays listed with a lower unread count.
    expect((await service.acknowledge(user, itemId)).state).toBe("acknowledged");
    const inbox = await service.listInbox(user);
    expect(inbox.items[0]?.state).toBe("acknowledged");
    expect(inbox.unreadCount).toBe(0);
    tick();
    expect((await service.dismiss(user, itemId)).state).toBe("dismissed");
    // A dismissed item is terminal: acknowledging it changes nothing.
    expect((await service.acknowledge(user, itemId)).state).toBe("dismissed");
    expect((await service.listInbox(user)).items).toHaveLength(0);
  });

  it("expires items past their lifetime and pages with a stable cursor", async () => {
    const user = owner();
    for (let index = 0; index < 5; index++) {
      tick();
      await send(user, uuidv7(), "review_required", 2);
    }
    const first = await service.listInbox(user, { limit: 2 });
    expect(first.items).toHaveLength(2);
    const second = await service.listInbox(user, { limit: 2, cursor: first.nextCursor ?? "" });
    const third = await service.listInbox(user, { limit: 2, cursor: second.nextCursor ?? "" });
    const ids = [...first.items, ...second.items, ...third.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(5);
    expect(third.nextCursor).toBeUndefined();
    clock = new Date(clock.getTime() + 31 * 24 * 60 * 60 * 1000);
    expect(await service.expireDue()).toBeGreaterThanOrEqual(5);
    expect((await service.listInbox(user)).items).toHaveLength(0);
  });

  it("defaults preferences off, and writes them with compare-and-set", async () => {
    const user = owner();
    const initial = await service.getPreferences(user);
    expect(initial).toMatchObject({ version: 0, emailEnabled: false });
    const saved = await service.updatePreferences(user, 0, {
      emailEnabled: true,
      quietHours: {
        enabled: true,
        startMinute: 1320,
        endMinute: 420,
        timeZone: "America/New_York",
      },
    });
    expect(saved).toMatchObject({ version: 1, emailEnabled: true, inAppEnabled: true });
    await expect(
      service.updatePreferences(user, 0, {
        emailEnabled: false,
        quietHours: defaultQuietHours,
      }),
    ).rejects.toMatchObject({ code: "version_conflict" });
    const next = await service.updatePreferences(user, 1, {
      emailEnabled: true,
      quietHours: defaultQuietHours,
    });
    expect(next.version).toBe(2);
    expect((await service.routeFor(user, { urgency: "normal" })).email).toEqual({
      action: "send_now",
    });
  });

  it("holds no candidate content, only classifications and opaque references", async () => {
    const [columns] = await client<{ names: string }[]>`
      SELECT string_agg(column_name, ',' ORDER BY column_name) AS names
      FROM information_schema.columns
      WHERE table_schema = 'notifications' AND table_name = 'inbox_items'
    `;
    expect(columns?.names).toBe(
      "aggregate_id,created_at,dedupe_key,expires_at,id,kind,owner_user_id,source_revision,source_service,state,updated_at,urgency",
    );
    expect(projectApplicationEvent({ eventId: "evt-0000000009", type: "x", data: {} })).toBeNull();
  });
});
