import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NotificationsService } from "./service.js";
import { PostgresNotificationsStore } from "./store.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

interface Authorization {
  operationId: string;
  requestId: string;
}

describeWithDatabase("Notifications candidate rights", () => {
  const client = postgres(databaseUrl ?? "postgres://invalid", {
    max: 2,
    onnotice: () => undefined,
  });
  const service = new NotificationsService(new PostgresNotificationsStore(client));

  beforeAll(async () => {
    // Rights assertions need Profile's privacy ledger, not package execution order.
    await execFileAsync(
      process.execPath,
      [fileURLToPath(new URL("../../profile/dist/src/migrate.js", import.meta.url))],
      { env: { ...process.env, DATABASE_URL: databaseUrl } },
    );
    const executable = fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url));
    const first = await execFileAsync(process.execPath, [executable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    const replay = await execFileAsync(process.execPath, [executable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    expect(first.stdout.trim()).toBe(
      "Notifications migrations through 0003_delivery applied and verified.",
    );
    expect(replay.stdout.trim()).toBe(first.stdout.trim());
  });
  afterAll(async () => {
    await client.end();
  });

  async function authorizeDeletion(userId: string): Promise<Authorization> {
    const operationId = uuidv7();
    const requestId = uuidv7();
    const confirmedAt = new Date(Date.now() - 1_000);
    const backupExpiresAt = new Date(confirmedAt.getTime() + 35 * 24 * 60 * 60 * 1_000);
    await client`INSERT INTO identity.users (id) VALUES (${userId})`;
    await client`
      INSERT INTO platform.operations (id, user_id, kind, state)
      VALUES (${operationId}, ${userId}, 'account_deletion', 'queued')
    `;
    await client`
      INSERT INTO profile.account_deletion_requests (
        id, user_id, operation_id, policy_version, state, version,
        requested_at, updated_at, confirmed_at, backup_expires_at
      ) VALUES (
        ${requestId}, ${userId}, ${operationId}, 'synthetic-notifications-rights-v1',
        'quarantined', 2, ${confirmedAt}, ${confirmedAt}, ${confirmedAt}, ${backupExpiresAt}
      )
    `;
    await client`
      INSERT INTO privacy.account_deletion_ledger (
        request_id, subject_digest, policy_version, policy_sha256, state,
        owner_inventory, subprocessor_inventory, confirmed_at, backup_expires_at, updated_at
      ) VALUES (
        ${requestId}, ${"1".repeat(64)}, 'synthetic-notifications-rights-v1', ${"2".repeat(64)},
        'quarantined', ${client.json({ notifications: "pending" })}, ${client.json({})},
        ${confirmedAt}, ${backupExpiresAt}, ${confirmedAt}
      )
    `;
    return { operationId, requestId };
  }

  async function removeAuthorization(userId: string, authorization: Authorization) {
    await client`DELETE FROM privacy.account_deletion_ledger WHERE request_id = ${authorization.requestId}`;
    await client`DELETE FROM identity.users WHERE id = ${userId}`;
  }

  async function seed(owner: string) {
    const application = uuidv7();
    await service.ingestApplicationEvent({
      id: `evt-${uuidv7()}`,
      type: "application.status_changed.v1",
      data: { applicationId: application, userId: owner, revision: 2, status: "review_required" },
    });
    await service.updatePreferences(owner, 0, {
      emailEnabled: true,
      quietHours: { enabled: true, startMinute: 1320, endMinute: 420, timeZone: "UTC" },
    });
    const now = new Date();
    // The store test sweeps expiry across the shared database; keep these items alive.
    await client`
      UPDATE notifications.inbox_items
      SET expires_at = ${new Date(now.getTime() + 5 * 365 * 24 * 60 * 60 * 1000)}
      WHERE owner_user_id = ${owner}::uuid
    `;
    const mailbox = `person-${uuidv7().slice(-12)}`;
    await client`
      INSERT INTO notifications.email_destinations
        (owner_user_id, address, state, verified_at, request_window_started_at, created_at, updated_at)
      VALUES (${owner}::uuid, ${`${mailbox}@example.test`}, 'verified', ${now}, ${now}, ${now}, ${now})
    `;
    await client`
      INSERT INTO notifications.push_subscriptions
        (id, owner_user_id, endpoint, endpoint_hash, state, created_at)
      VALUES (${uuidv7()}::uuid, ${owner}::uuid, ${`https://fcm.googleapis.com/fcm/send/${owner}`},
        ${owner.replaceAll("-", "").repeat(2)}, 'active', ${now})
    `;
    await client`
      INSERT INTO notifications.delivery_attempts
        (id, owner_user_id, inbox_item_id, channel, state, not_before, created_at, updated_at)
      SELECT ${uuidv7()}::uuid, owner_user_id, id, 'email', 'scheduled',
        ${new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)}, ${now}, ${now}
      FROM notifications.inbox_items WHERE owner_user_id = ${owner}::uuid
    `;
    return application;
  }

  it("exports only the exact candidate's inbox and preferences", async () => {
    const owner = uuidv7();
    const other = uuidv7();
    const application = await seed(owner);
    await seed(other);
    const [exported] = await client<{ data: Record<string, unknown> }[]>`
      SELECT notifications.export_candidate_data(${owner}::uuid) AS data
    `;
    const section = (exported as { data: { notifications: Record<string, unknown> } }).data
      .notifications;
    expect(section.preferences).toMatchObject({
      version: 1,
      inAppEnabled: true,
      emailEnabled: true,
      quietHours: { enabled: true, startMinute: 1320, endMinute: 420, timeZone: "UTC" },
    });
    const inbox = section.inbox as Record<string, unknown>[];
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      kind: "application_review_needed",
      state: "unread",
      applicationId: application,
    });
    // No owner identifier, dedupe key, source event id or revision leaves with the export.
    expect(JSON.stringify(exported?.data)).not.toContain(owner);
    expect(Object.keys(inbox[0] ?? {}).sort()).toEqual([
      "applicationId",
      "createdAt",
      "expiresAt",
      "id",
      "kind",
      "state",
      "urgency",
    ]);
    const [empty] = await client<{ data: Record<string, unknown> }[]>`
      SELECT notifications.export_candidate_data(${uuidv7()}::uuid) AS data
    `;
    expect(empty?.data).toEqual({
      notifications: {
        preferences: null,
        inbox: [],
        emailDestination: null,
        pushSubscriptions: [],
        deliveries: [],
      },
    });
    expect(section.emailDestination).toMatchObject({
      address: expect.stringMatching(/^person-[0-9a-f]{12}@example.test$/),
      state: "verified",
    });
    // A push endpoint is a capability URL: only its host and identifier are exported.
    const subscriptions = section.pushSubscriptions as Record<string, unknown>[];
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]).toMatchObject({ endpointHost: "fcm.googleapis.com", state: "active" });
    expect(JSON.stringify(subscriptions)).not.toContain("/fcm/send/");
    expect(section.deliveries).toHaveLength(1);
    expect(section.deliveries).toEqual([
      expect.objectContaining({ channel: "email", state: "scheduled" }),
    ]);
  });

  it("deletes only the authorized candidate's data and refuses an unauthorized request", async () => {
    const owner = uuidv7();
    const other = uuidv7();
    await seed(owner);
    await seed(other);
    const ownerAuthorization = await authorizeDeletion(owner);
    const otherAuthorization = await authorizeDeletion(other);
    try {
      await expect(
        client`SELECT notifications.delete_candidate_data(${owner}, ${uuidv7()})`,
      ).rejects.toThrow("candidate deletion is not authorized");
      // Another candidate's authorization never covers this one.
      await expect(
        client`SELECT notifications.delete_candidate_data(${owner}, ${otherAuthorization.requestId})`,
      ).rejects.toThrow("candidate deletion is not authorized");

      const [deleted] = await client<{ result: Record<string, unknown> }[]>`
        SELECT notifications.delete_candidate_data(${owner}, ${ownerAuthorization.requestId}) AS result
      `;
      expect(deleted?.result).toEqual({
        owner: "notifications",
        itemsDeleted: 1,
        preferencesDeleted: 1,
        receiptsDeleted: 1,
        cursorsDeleted: 1,
        deliveriesDeleted: 1,
        emailDestinationsDeleted: 1,
        pushSubscriptionsDeleted: 1,
      });
      const [replay] = await client<{ result: Record<string, unknown> }[]>`
        SELECT notifications.delete_candidate_data(${owner}, ${ownerAuthorization.requestId}) AS result
      `;
      expect(replay?.result).toEqual({
        owner: "notifications",
        itemsDeleted: 0,
        preferencesDeleted: 0,
        receiptsDeleted: 0,
        cursorsDeleted: 0,
        deliveriesDeleted: 0,
        emailDestinationsDeleted: 0,
        pushSubscriptionsDeleted: 0,
      });
      const [remaining] = await client<
        { items: number; preferences: number; email: number; push: number; deliveries: number }[]
      >`
        SELECT (SELECT count(*)::int FROM notifications.inbox_items
                WHERE owner_user_id = ${other}::uuid) AS items,
               (SELECT count(*)::int FROM notifications.preferences
                WHERE owner_user_id = ${other}::uuid) AS preferences,
               (SELECT count(*)::int FROM notifications.email_destinations
                WHERE owner_user_id = ${other}::uuid) AS email,
               (SELECT count(*)::int FROM notifications.push_subscriptions
                WHERE owner_user_id = ${other}::uuid) AS push,
               (SELECT count(*)::int FROM notifications.delivery_attempts
                WHERE owner_user_id = ${other}::uuid) AS deliveries
      `;
      expect(remaining).toEqual({ items: 1, preferences: 1, email: 1, push: 1, deliveries: 1 });
    } finally {
      await removeAuthorization(owner, ownerAuthorization);
      await removeAuthorization(other, otherAuthorization);
    }
  });

  it("keeps the rights functions executable only through grants, not PUBLIC", async () => {
    const [row] = await client<{ violations: number }[]>`
      SELECT count(*)::int AS violations
      FROM pg_proc procedure
      CROSS JOIN LATERAL aclexplode(
        COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
      ) AS privilege
      WHERE procedure.oid = ANY(ARRAY[
        to_regprocedure('notifications.export_candidate_data(uuid)'),
        to_regprocedure('notifications.delete_candidate_data(uuid,uuid)')
      ]) AND privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
    `;
    expect(row?.violations).toBe(0);
  });
});
