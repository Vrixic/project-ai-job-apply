import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ApplyEntitlementChangeInput,
  EntitlementChronologyError,
  EntitlementIdempotencyConflictError,
  EntitlementOutboxClaimError,
  EntitlementVersionConflictError,
  EntitlementVersionExhaustedError,
  PostgresBillingStore,
} from "./store.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

describeWithDatabase("PostgresBillingStore", () => {
  const client = postgres(databaseUrl ?? "postgres://invalid", {
    max: 4,
    onnotice: () => undefined,
  });
  const store = new PostgresBillingStore(client, () => new Date("2026-08-15T23:59:59.999Z"));
  const userA = uuidv7();
  const userB = uuidv7();
  const actorReference = uuidv7();
  const occurredAt = new Date("2026-08-15T12:00:00.000Z");

  function command(
    overrides: Partial<ApplyEntitlementChangeInput> = {},
  ): ApplyEntitlementChangeInput {
    return {
      userId: userA,
      expectedVersion: 0,
      idempotencyKey: "entitlement-integration-0001",
      grant: {
        plan: "pro",
        effectiveAt: occurredAt,
        accessThrough: new Date("2026-09-15T12:00:00.000Z"),
        graceThrough: new Date("2026-09-18T12:00:00.000Z"),
      },
      reasonCode: "synthetic_grant",
      actor: { kind: "system", reference: actorReference },
      occurredAt,
      traceId: uuidv7(),
      ...overrides,
    } as ApplyEntitlementChangeInput;
  }

  beforeAll(async () => {
    const migrationExecutable = fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url));
    const profileMigrationExecutable = fileURLToPath(
      new URL("../../profile/dist/src/migrate.js", import.meta.url),
    );
    const environment = { ...process.env, DATABASE_URL: databaseUrl };
    // Guard rejection must come from authorization, not an absent privacy schema.
    const profile = await execFileAsync(process.execPath, [profileMigrationExecutable], {
      env: environment,
    });
    expect(profile.stdout.trim()).toBe(
      "Database migrations through 0011_active_candidate_lease applied and verified.",
    );
    const first = await execFileAsync(process.execPath, [migrationExecutable], {
      env: environment,
    });
    const replay = await execFileAsync(process.execPath, [migrationExecutable], {
      env: environment,
    });
    expect(first.stdout.trim()).toBe(
      "Billing migrations through 0002_candidate_rights applied and verified.",
    );
    expect(replay.stdout.trim()).toBe(
      "Billing migrations through 0002_candidate_rights applied and verified.",
    );
    await store.ping();
  });

  afterAll(async () => {
    await store.close();
  });

  it("reads absent owners as Free without writing and isolates owners", async () => {
    await expect(store.readEntitlement(userA)).resolves.toEqual({
      userId: userA,
      version: 0,
      plan: "free",
    });
    await expect(store.readEntitlement(userB)).resolves.toEqual({
      userId: userB,
      version: 0,
      plan: "free",
    });
    const [aggregate] = await client<{ count: string }[]>`
      SELECT count(*)::text AS count FROM billing.entitlement_accounts
      WHERE user_id IN (${userA}, ${userB})
    `;
    expect(aggregate?.count).toBe("0");
  });

  it("atomically creates, exactly replays, versions, audits, and emits identifier-only events", async () => {
    const original = command();
    if (original.reasonCode !== "synthetic_grant") {
      throw new Error("Expected the default integration command to be a synthetic grant");
    }
    const created = await store.applyEntitlementChange(original);
    const replay = await store.applyEntitlementChange(original);
    expect(replay).toEqual({ ...created, replayed: true });
    expect(await store.readEntitlement(userA)).toEqual(created.schedule);

    await expect(
      store.applyEntitlementChange({
        ...original,
        expectedVersion: 1,
        idempotencyKey: "entitlement-future-free-0001",
        grant: { plan: "free", effectiveAt: new Date("2026-08-16T12:00:00.000Z") },
        reasonCode: "synthetic_revoke",
        occurredAt: new Date("2026-08-16T12:00:00.000Z"),
        traceId: uuidv7(),
      }),
    ).rejects.toThrow(EntitlementChronologyError);
    await expect(
      store.applyEntitlementChange({
        ...original,
        expectedVersion: 1,
        idempotencyKey: "entitlement-future-pro-0001",
        grant: {
          ...original.grant,
          effectiveAt: new Date("2026-08-16T12:00:00.000Z"),
        },
        occurredAt: new Date("2026-08-16T12:00:00.000Z"),
        traceId: uuidv7(),
      }),
    ).rejects.toThrow(EntitlementChronologyError);
    await expect(
      store.applyEntitlementChange({
        ...original,
        expectedVersion: 1,
        idempotencyKey: "entitlement-backdated-pro-0001",
        grant: {
          ...original.grant,
          effectiveAt: new Date("2026-08-15T11:59:59.999Z"),
        },
        occurredAt: new Date("2026-08-15T11:59:59.999Z"),
        traceId: uuidv7(),
      }),
    ).rejects.toThrow(EntitlementChronologyError);
    expect(await store.readEntitlement(userA)).toEqual(created.schedule);

    await expect(
      store.applyEntitlementChange({
        ...original,
        occurredAt: new Date("2026-08-16T12:00:01.000Z"),
        traceId: uuidv7(),
      } as ApplyEntitlementChangeInput),
    ).resolves.toEqual({ ...created, replayed: true });
    await expect(
      store.applyEntitlementChange({
        ...original,
        grant: {
          plan: "pro",
          effectiveAt: occurredAt,
          accessThrough: new Date("2026-09-16T12:00:00.000Z"),
          graceThrough: new Date("2026-09-18T12:00:00.000Z"),
        },
      }),
    ).rejects.toThrow(EntitlementIdempotencyConflictError);
    await expect(
      store.applyEntitlementChange(
        command({ idempotencyKey: "entitlement-wrong-version-0001", expectedVersion: 0 }),
      ),
    ).rejects.toThrow(EntitlementVersionConflictError);

    const revoked = await store.applyEntitlementChange(
      command({
        expectedVersion: 1,
        idempotencyKey: "entitlement-integration-0002",
        grant: { plan: "free", effectiveAt: new Date("2026-08-15T12:00:02.000Z") },
        reasonCode: "synthetic_revoke",
        occurredAt: new Date("2026-08-15T12:00:02.000Z"),
        traceId: uuidv7(),
      }),
    );
    expect(revoked.schedule).toMatchObject({ userId: userA, version: 2, plan: "free" });
    await expect(store.applyEntitlementChange(original)).resolves.toEqual({
      ...created,
      replayed: true,
    });

    const [aggregates] = await client<
      { changes: string; events: string; receipts: string; leakedPayloads: string }[]
    >`
      SELECT
        (SELECT count(*)::text FROM billing.entitlement_changes WHERE user_id = ${userA}) AS changes,
        (SELECT count(*)::text FROM billing.entitlement_outbox WHERE user_id = ${userA}) AS events,
        (SELECT count(*)::text FROM billing.entitlement_command_receipts WHERE user_id = ${userA}) AS receipts,
        (SELECT count(*)::text FROM billing.entitlement_outbox
          WHERE user_id = ${userA} AND (
            payload ? 'plan' OR payload ? 'provider' OR payload ? 'accessThrough'
          )) AS "leakedPayloads"
    `;
    expect(aggregates).toEqual({ changes: "2", events: "2", receipts: "2", leakedPayloads: "0" });
  });

  it("serializes concurrent commands and rolls back the losing version", async () => {
    const concurrentUser = uuidv7();
    const first = command({
      userId: concurrentUser,
      idempotencyKey: "entitlement-concurrent-0001",
      traceId: uuidv7(),
    });
    const second = command({
      userId: concurrentUser,
      idempotencyKey: "entitlement-concurrent-0002",
      traceId: uuidv7(),
    });
    const results = await Promise.allSettled([
      store.applyEntitlementChange(first),
      store.applyEntitlementChange(second),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect(results.find((item) => item.status === "rejected")).toMatchObject({
      reason: expect.any(EntitlementVersionConflictError),
    });
    const [counts] = await client<{ accounts: string; changes: string; events: string }[]>`
      SELECT
        (SELECT count(*)::text FROM billing.entitlement_accounts WHERE user_id = ${concurrentUser}) AS accounts,
        (SELECT count(*)::text FROM billing.entitlement_changes WHERE user_id = ${concurrentUser}) AS changes,
        (SELECT count(*)::text FROM billing.entitlement_outbox WHERE user_id = ${concurrentUser}) AS events
    `;
    expect(counts).toEqual({ accounts: "1", changes: "1", events: "1" });
  });

  it("claims, retries, publishes, and refuses stale outbox claims", async () => {
    const claimAt = new Date("2026-08-15T12:00:01.000Z");
    const claimed = await store.claimOutbox({ now: claimAt, limit: 100, leaseMilliseconds: 5_000 });
    expect(claimed.length).toBeGreaterThanOrEqual(2);
    expect(
      claimed.every(
        (event) =>
          event.type === "subscription.entitlement_changed.v1" &&
          event.subject === `entitlement-account/${event.data.entitlementAccountId}` &&
          Object.keys(event.data).sort().join(",") === "entitlementAccountId,userId,version",
      ),
    ).toBe(true);

    const retry = claimed[0];
    const publish = claimed[1];
    if (!retry || !publish) throw new Error("Expected at least two outbox events");
    await expect(
      store.releaseOutbox({
        id: retry.id,
        claimToken: retry.claimToken,
        now: claimAt,
        retryAt: claimAt,
        errorCode: "transient",
      }),
    ).rejects.toThrow(EntitlementOutboxClaimError);
    await expect(
      store.markOutboxPublished({
        id: publish.id,
        claimToken: publish.claimToken,
        publishedAt: new Date("2026-08-15T11:59:59.999Z"),
      }),
    ).rejects.toThrow(EntitlementOutboxClaimError);
    await store.releaseOutbox({
      id: retry.id,
      claimToken: retry.claimToken,
      now: claimAt,
      retryAt: new Date("2026-08-15T12:00:10.000Z"),
      errorCode: "transient",
    });
    await store.markOutboxPublished({
      id: publish.id,
      claimToken: publish.claimToken,
      publishedAt: new Date("2026-08-15T12:00:02.000Z"),
    });
    await expect(
      store.markOutboxPublished({
        id: publish.id,
        claimToken: publish.claimToken,
        publishedAt: new Date("2026-08-15T12:00:03.000Z"),
      }),
    ).rejects.toThrow(EntitlementOutboxClaimError);
    const reclaimed = await store.claimOutbox({
      now: new Date("2026-08-15T12:00:10.000Z"),
      limit: 100,
      leaseMilliseconds: 5_000,
    });
    const reclaimedRetry = reclaimed.find((event) => event.id === retry.id);
    expect(reclaimedRetry?.attemptCount).toBe(2);
    if (!reclaimedRetry) throw new Error("Expected the retry event to be reclaimed");
    await expect(
      store.markOutboxPublished({
        id: reclaimedRetry.id,
        claimToken: retry.claimToken,
        publishedAt: new Date("2026-08-15T12:00:11.000Z"),
      }),
    ).rejects.toThrow(EntitlementOutboxClaimError);
    await expect(
      store.markOutboxPublished({
        id: reclaimedRetry.id,
        claimToken: reclaimedRetry.claimToken,
        publishedAt: new Date("2026-08-15T12:00:15.000Z"),
      }),
    ).rejects.toThrow(EntitlementOutboxClaimError);
    await expect(
      store.releaseOutbox({
        id: reclaimedRetry.id,
        claimToken: reclaimedRetry.claimToken,
        now: new Date("2026-08-15T12:00:15.000Z"),
        retryAt: new Date("2026-08-15T12:00:20.000Z"),
        errorCode: "publisher_unavailable",
      }),
    ).rejects.toThrow(EntitlementOutboxClaimError);
    const reclaimedAfterExpiry = await store.claimOutbox({
      now: new Date("2026-08-15T12:00:15.000Z"),
      limit: 100,
      leaseMilliseconds: 5_000,
    });
    const finalClaim = reclaimedAfterExpiry.find((event) => event.id === retry.id);
    expect(finalClaim?.attemptCount).toBe(3);
    if (!finalClaim) throw new Error("Expected the expired event to be reclaimed");
    expect(finalClaim.claimToken).not.toBe(reclaimedRetry.claimToken);
    await store.markOutboxPublished({
      id: finalClaim.id,
      claimToken: finalClaim.claimToken,
      publishedAt: new Date("2026-08-15T12:00:15.001Z"),
    });
  });

  it("terminalizes explicit and expired poison events after five attempts", async () => {
    async function createPoison(userId: string, key: string) {
      return store.applyEntitlementChange(
        command({ userId, idempotencyKey: key, traceId: uuidv7() }),
      );
    }

    async function claimThroughAttemptFive(eventId: string, initialNow: Date) {
      let now = initialNow;
      let fifthClaim: Awaited<ReturnType<typeof store.claimOutbox>>[number] | undefined;
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const claimed = await store.claimOutbox({ now, limit: 100, leaseMilliseconds: 1_000 });
        const event = claimed.find((candidate) => candidate.id === eventId);
        expect(event?.attemptCount).toBe(attempt);
        if (!event) throw new Error(`Expected poison event attempt ${attempt}`);
        if (attempt === 5) {
          fifthClaim = event;
          break;
        }
        await store.releaseOutbox({
          id: event.id,
          claimToken: event.claimToken,
          now,
          retryAt: new Date(now.getTime() + 2_000),
          errorCode: "transient",
        });
        now = new Date(now.getTime() + 2_000);
      }
      if (!fifthClaim) throw new Error("Expected a fifth poison-event claim");
      return { fifthClaim, now };
    }

    const explicit = await createPoison(uuidv7(), "entitlement-poison-explicit-0001");
    const explicitFifth = await claimThroughAttemptFive(
      explicit.outboxEventId,
      new Date("2026-10-01T12:00:00.000Z"),
    );
    await store.releaseOutbox({
      id: explicitFifth.fifthClaim.id,
      claimToken: explicitFifth.fifthClaim.claimToken,
      now: explicitFifth.now,
      retryAt: new Date(explicitFifth.now.getTime() + 2_000),
      errorCode: "publisher_unavailable",
    });

    const expired = await createPoison(uuidv7(), "entitlement-poison-expired-0001");
    const expiredFifth = await claimThroughAttemptFive(
      expired.outboxEventId,
      new Date("2026-10-02T12:00:00.000Z"),
    );
    const afterExpiredLease = new Date(expiredFifth.now.getTime() + 1_000);
    const reclaimed = await store.claimOutbox({
      now: afterExpiredLease,
      limit: 100,
      leaseMilliseconds: 1_000,
    });
    expect(reclaimed.some((event) => event.id === expired.outboxEventId)).toBe(false);

    const terminalRows = await client<
      Array<{
        id: string;
        status: string;
        attemptCount: number;
        errorCode: string | null;
        failedAt: Date | null;
      }>
    >`
      SELECT id, status, attempt_count AS "attemptCount", last_error_code AS "errorCode",
        failed_at AS "failedAt"
      FROM billing.entitlement_outbox
      WHERE id IN (${explicit.outboxEventId}, ${expired.outboxEventId})
      ORDER BY id
    `;
    expect(terminalRows).toHaveLength(2);
    expect(terminalRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: explicit.outboxEventId,
          status: "failed",
          attemptCount: 5,
          errorCode: "publisher_unavailable",
          failedAt: expect.any(Date),
        }),
        expect.objectContaining({
          id: expired.outboxEventId,
          status: "failed",
          attemptCount: 5,
          errorCode: "lease_expired",
          failedAt: expect.any(Date),
        }),
      ]),
    );
    await expect(client`
      UPDATE billing.entitlement_outbox
      SET status = 'pending', attempt_count = 4, failed_at = NULL,
        last_error_code = 'publisher_unavailable'
      WHERE id = ${explicit.outboxEventId}
    `).rejects.toThrow();
    await expect(client`
      UPDATE billing.entitlement_outbox
      SET status = 'pending', published_at = NULL, last_error_code = 'transient'
      WHERE status = 'published'
    `).rejects.toThrow();
  });

  it("enforces append-only audit, receipt, and event payload boundaries", async () => {
    await expect(client`UPDATE billing.entitlement_changes SET plan = 'free'`).rejects.toThrow();
    await expect(client`DELETE FROM billing.entitlement_command_receipts`).rejects.toThrow(
      "billing history is append-only",
    );
    await expect(
      client`UPDATE billing.entitlement_outbox SET payload = payload || '{"plan":"pro"}'::jsonb`,
    ).rejects.toThrow();
    await expect(client`DELETE FROM billing.entitlement_outbox`).rejects.toThrow(
      "billing history is append-only",
    );
  });

  it("enforces owner-consistent account relationships in persistence", async () => {
    const ownerB = await store.applyEntitlementChange(
      command({
        userId: userB,
        idempotencyKey: "entitlement-owner-b-0001",
        traceId: uuidv7(),
      }),
    );
    await expect(
      store.applyEntitlementChange(
        command({
          userId: userB.toUpperCase(),
          idempotencyKey: "entitlement-owner-b-upper-0001",
          traceId: uuidv7(),
        }),
      ),
    ).rejects.toThrow("canonical lowercase UUID");
    expect(await store.readEntitlement(userB)).toEqual(ownerB.schedule);

    await expect(client`
      UPDATE billing.entitlement_accounts SET user_id = ${uuidv7()} WHERE user_id = ${userA}
    `).rejects.toThrow();
    await expect(client`
      UPDATE billing.entitlement_command_receipts
      SET entitlement_account_id = ${uuidv7()} WHERE user_id = ${userA}
    `).rejects.toThrow();

    const [ownerARecord] = await client<
      Array<{
        accountId: string;
        changeId: string;
        outboxEventId: string;
        version: string;
        effectiveAt: Date;
        accessThrough: Date | null;
        graceThrough: Date | null;
        plan: "free" | "pro";
      }>
    >`
      SELECT account.id AS "accountId", change.id AS "changeId", event.id AS "outboxEventId",
        change.version::text AS version, change.effective_at AS "effectiveAt",
        change.access_through AS "accessThrough", change.grace_through AS "graceThrough",
        change.plan
      FROM billing.entitlement_accounts AS account
      JOIN billing.entitlement_changes AS change
        ON change.entitlement_account_id = account.id AND change.user_id = account.user_id
      JOIN billing.entitlement_outbox AS event
        ON event.entitlement_account_id = account.id AND event.user_id = account.user_id
          AND event.account_version = change.version
      WHERE account.user_id = ${userA}
      ORDER BY change.version
      LIMIT 1
    `;
    const [ownerBRecord] = await client<{ changeId: string; outboxEventId: string }[]>`
      SELECT change.id AS "changeId", event.id AS "outboxEventId"
      FROM billing.entitlement_changes AS change
      JOIN billing.entitlement_outbox AS event
        ON event.entitlement_account_id = change.entitlement_account_id
          AND event.user_id = change.user_id AND event.account_version = change.version
      WHERE change.user_id = ${userB}
      LIMIT 1
    `;
    if (!ownerARecord || !ownerBRecord) throw new Error("Expected owner-bound billing records");
    await expect(client`
      INSERT INTO billing.entitlement_command_receipts (
        user_id, idempotency_key, request_hash, entitlement_account_id, response_version,
        change_id, outbox_event_id, created_at
      ) VALUES (
        ${userA}, ${"entitlement-cross-owner-0001"}, ${"a".repeat(64)},
        ${ownerARecord.accountId}, ${Number(ownerARecord.version)},
        ${ownerBRecord.changeId}, ${ownerBRecord.outboxEventId}, ${occurredAt}
      )
    `).rejects.toThrow();

    const directUser = uuidv7();
    const directAccount = uuidv7();
    const directChange = uuidv7();
    const databaseFutureAt = new Date(Date.now() + 86_400_000);
    await client`
      INSERT INTO billing.entitlement_accounts (
        id, user_id, version, plan, effective_at, updated_at
      ) VALUES (${directAccount}, ${directUser}, 1, 'free', ${occurredAt}, ${occurredAt})
    `;
    await expect(client`
      UPDATE billing.entitlement_accounts
      SET effective_at = ${databaseFutureAt}, updated_at = ${databaseFutureAt}
      WHERE id = ${directAccount}
    `).rejects.toThrow();
    await expect(client`
      UPDATE billing.entitlement_accounts
      SET effective_at = ${new Date("2026-08-15T11:59:59.999Z")},
        updated_at = ${new Date("2026-08-15T11:59:59.999Z")}
      WHERE id = ${directAccount}
    `).rejects.toThrow();
    await expect(client`
      INSERT INTO billing.entitlement_changes (
        id, entitlement_account_id, user_id, version, prior_plan, plan, effective_at,
        reason_code, actor_kind, actor_reference, trace_id, occurred_at
      ) VALUES (
        ${uuidv7()}, ${directAccount}, ${directUser}, 1, NULL, 'free',
        ${databaseFutureAt}, 'reconciliation', 'system',
        ${actorReference}, ${uuidv7()}, ${occurredAt}
      )
    `).rejects.toThrow();
    await expect(client`
      INSERT INTO billing.entitlement_changes (
        id, entitlement_account_id, user_id, version, prior_plan, plan, effective_at,
        reason_code, actor_kind, actor_reference, trace_id, occurred_at
      ) VALUES (
        ${uuidv7()}, ${directAccount}, ${directUser}, 1, NULL, 'free',
        ${databaseFutureAt}, 'reconciliation', 'system',
        ${actorReference}, ${uuidv7()}, ${databaseFutureAt}
      )
    `).rejects.toThrow();
    await expect(client`
      INSERT INTO billing.entitlement_changes (
        id, entitlement_account_id, user_id, version, prior_plan, plan, effective_at,
        reason_code, actor_kind, actor_reference, trace_id, occurred_at
      ) VALUES (
        ${uuidv7()}, ${directAccount}, ${directUser}, 1, NULL, 'free',
        ${new Date("2026-08-15T11:59:59.999Z")}, 'reconciliation', 'system',
        ${actorReference}, ${uuidv7()}, ${new Date("2026-08-15T11:59:59.999Z")}
      )
    `).rejects.toThrow();
    await expect(client`
      INSERT INTO billing.entitlement_changes (
        id, entitlement_account_id, user_id, version, prior_plan, plan, effective_at,
        reason_code, actor_kind, actor_reference, trace_id, occurred_at
      ) VALUES (
        ${uuidv7()}, ${directAccount}, ${directUser}, 1, NULL, 'free', ${occurredAt},
        'support_adjustment', 'provider_adapter', ${actorReference}, ${uuidv7()}, ${occurredAt}
      )
    `).rejects.toThrow();
    await expect(client`
      INSERT INTO billing.entitlement_changes (
        id, entitlement_account_id, user_id, version, prior_plan, plan, effective_at,
        access_through, reason_code, actor_kind, actor_reference, trace_id, occurred_at
      ) VALUES (
        ${uuidv7()}, ${directAccount}, ${directUser}, 1, NULL, 'pro', ${occurredAt},
        ${new Date("2026-09-15T12:00:00.000Z")}, 'synthetic_revoke', 'system',
        ${actorReference}, ${uuidv7()}, ${occurredAt}
      )
    `).rejects.toThrow();
    await client`
      INSERT INTO billing.entitlement_changes (
        id, entitlement_account_id, user_id, version, prior_plan, plan, effective_at,
        reason_code, actor_kind, actor_reference, trace_id, occurred_at
      ) VALUES (
        ${directChange}, ${directAccount}, ${directUser}, 1, NULL, 'free', ${occurredAt},
        'reconciliation', 'system', ${actorReference}, ${uuidv7()}, ${occurredAt}
      )
    `;
    const directPayload = {
      entitlementAccountId: directAccount,
      userId: directUser,
      version: 1,
    };
    await expect(client`
      INSERT INTO billing.entitlement_outbox (
        id, entitlement_account_id, user_id, account_version, event_type, subject, payload,
        occurred_at, available_at
      ) VALUES (
        ${uuidv7()}, ${directAccount}, ${directUser}, 1, 'subscription.entitlement_changed.v1',
        ${`entitlement-account/${directAccount}`},
        ${client.json({ ...directPayload, version: "1" })}, ${occurredAt}, ${occurredAt}
      )
    `).rejects.toThrow();
    await expect(client`
      INSERT INTO billing.entitlement_outbox (
        id, entitlement_account_id, user_id, account_version, event_type, subject, payload,
        occurred_at, available_at
      ) VALUES (
        ${uuidv7()}, ${directAccount}, ${directUser}, 1, 'subscription.entitlement_changed.v1',
        ${`entitlement-account/${directAccount}`},
        ${client.json({ ...directPayload, provider: "stripe" })}, ${occurredAt}, ${occurredAt}
      )
    `).rejects.toThrow();
    await expect(client`
      INSERT INTO billing.entitlement_outbox (
        id, entitlement_account_id, user_id, account_version, event_type, subject, payload,
        occurred_at, available_at
      ) VALUES (
        ${uuidv7()}, ${directAccount}, ${directUser}, 1, 'subscription.entitlement_changed.v1',
        ${`entitlement-account/${directAccount}`},
        ${client.json({ ...directPayload, userId: 42 })}, ${occurredAt}, ${occurredAt}
      )
    `).rejects.toThrow();
    await expect(client`
      INSERT INTO billing.entitlement_outbox (
        id, entitlement_account_id, user_id, account_version, event_type, subject, payload,
        occurred_at, available_at
      ) VALUES (
        ${uuidv7()}, ${directAccount}, ${directUser}, 2, 'subscription.entitlement_changed.v1',
        ${`entitlement-account/${directAccount}`},
        ${client.json({ ...directPayload, version: 2 })}, ${occurredAt}, ${occurredAt}
      )
    `).rejects.toThrow();

    const directOutbox = uuidv7();
    await client`
      INSERT INTO billing.entitlement_outbox (
        id, entitlement_account_id, user_id, account_version, event_type, subject, payload,
        occurred_at, available_at
      ) VALUES (
        ${directOutbox}, ${directAccount}, ${directUser}, 1,
        'subscription.entitlement_changed.v1', ${`entitlement-account/${directAccount}`},
        ${client.json(directPayload)}, ${occurredAt}, ${occurredAt}
      )
    `;
    await expect(client`
      UPDATE billing.entitlement_outbox SET last_error_code = 'transient'
      WHERE id = ${directOutbox}
    `).rejects.toThrow();
    await expect(client`
      UPDATE billing.entitlement_outbox
      SET status = 'processing', claim_token = ${uuidv7()},
        lease_expires_at = ${new Date("2026-08-15T12:00:05.000Z")}, attempt_count = 1,
        last_error_code = 'transient'
      WHERE id = ${directOutbox}
    `).rejects.toThrow();
    await expect(client`
      UPDATE billing.entitlement_outbox
      SET status = 'published', published_at = ${occurredAt}, attempt_count = 1,
        last_error_code = 'transient'
      WHERE id = ${directOutbox}
    `).rejects.toThrow();
    await client`
      UPDATE billing.entitlement_outbox
      SET status = 'processing', claim_token = ${uuidv7()},
        lease_expires_at = ${new Date("2026-08-15T12:00:05.000Z")}, attempt_count = 1
      WHERE id = ${directOutbox}
    `;
    await expect(client`
      UPDATE billing.entitlement_outbox
      SET claim_token = ${uuidv7()}, lease_expires_at = ${new Date("2026-08-15T12:00:06.000Z")}
      WHERE id = ${directOutbox}
    `).rejects.toThrow();

    const maxUser = uuidv7();
    const maxAccount = uuidv7();
    await client`
      INSERT INTO billing.entitlement_accounts (
        id, user_id, version, plan, effective_at, updated_at
      ) VALUES (
        ${maxAccount}, ${maxUser}, ${Number.MAX_SAFE_INTEGER}, 'free', ${occurredAt}, ${occurredAt}
      )
    `;
    await expect(
      store.applyEntitlementChange({
        userId: maxUser,
        expectedVersion: Number.MAX_SAFE_INTEGER,
        idempotencyKey: "entitlement-max-version-0001",
        grant: { plan: "free", effectiveAt: occurredAt },
        reasonCode: "synthetic_revoke",
        actor: { kind: "system", reference: actorReference },
        occurredAt,
        traceId: uuidv7(),
      }),
    ).rejects.toThrow(EntitlementVersionExhaustedError);
    await expect(client`
      INSERT INTO billing.entitlement_accounts (
        id, user_id, version, plan, effective_at, updated_at
      ) VALUES (
        ${uuidv7()}, ${uuidv7()}, ${"9007199254740992"}, 'free', ${occurredAt}, ${occurredAt}
      )
    `).rejects.toThrow();
  });

  it("fails readiness for a missing or stale ledger and a missing required relation", async () => {
    const checksum = "05368bb42a9c6ed3007b61f80a980a921d1f02bbcac633a4ecfd0b4c7dcf0ba0";
    const [ledger] = await client<{ appliedAt: Date }[]>`
      SELECT applied_at AS "appliedAt"
      FROM billing.schema_migrations
      WHERE version = '0001_entitlement_projection'
    `;
    expect(ledger?.appliedAt).toBeInstanceOf(Date);

    try {
      await client`
        UPDATE billing.schema_migrations SET checksum = ${"f".repeat(64)}
        WHERE version = '0001_entitlement_projection'
      `;
      await expect(store.ping()).rejects.toThrow("Billing schema boundary is unavailable");
    } finally {
      await client`
        UPDATE billing.schema_migrations SET checksum = ${checksum}
        WHERE version = '0001_entitlement_projection'
      `;
    }

    try {
      await client`
        DELETE FROM billing.schema_migrations WHERE version = '0001_entitlement_projection'
      `;
      await expect(store.ping()).rejects.toThrow("Billing schema boundary is unavailable");
    } finally {
      await client`
        INSERT INTO billing.schema_migrations (version, checksum, applied_at)
        VALUES ('0001_entitlement_projection', ${checksum}, ${ledger?.appliedAt as Date})
      `;
    }

    try {
      await client.unsafe(
        "ALTER TABLE billing.entitlement_accounts RENAME TO entitlement_accounts_readiness_probe",
      );
      await expect(store.ping()).rejects.toThrow("Billing schema boundary is unavailable");
    } finally {
      await client.unsafe(
        "ALTER TABLE billing.entitlement_accounts_readiness_probe RENAME TO entitlement_accounts",
      );
    }
    await expect(store.ping()).resolves.toBeUndefined();
  });
});
