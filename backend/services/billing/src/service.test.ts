import { v7 as uuidv7 } from "uuid";
import { describe, expect, it, vi } from "vitest";
import { EntitlementCache } from "./cache.js";
import {
  BillingEntitlementService,
  type BillingEntitlementStore,
  type EntitlementMutationStore,
} from "./service.js";
import type { ApplyEntitlementChangeInput, ApplyEntitlementChangeResult } from "./store.js";
import type { EntitlementReader, EntitlementSchedule } from "./types.js";

describe("BillingEntitlementService", () => {
  it("evicts a cached decision after a committed entitlement mutation", async () => {
    const userId = uuidv7();
    const accountId = uuidv7();
    const free: EntitlementSchedule = { userId, version: 0, plan: "free" };
    const pro: Exclude<EntitlementSchedule, { version: 0 }> = {
      accountId,
      userId,
      version: 1,
      plan: "pro",
      effectiveAt: new Date("2026-08-15T12:00:00.000Z"),
      accessThrough: new Date("2026-09-15T12:00:00.000Z"),
    };
    const reader: EntitlementReader = { readEntitlement: vi.fn(async () => free) };
    const result: ApplyEntitlementChangeResult = {
      schedule: pro,
      changeId: uuidv7(),
      outboxEventId: uuidv7(),
      replayed: false,
    };
    const mutation: EntitlementMutationStore = {
      applyEntitlementChange: vi.fn(async () => result),
    };
    const cache = new EntitlementCache({ capacity: 10, freshTtlMs: 60_000 });
    const ping = vi.fn(async () => undefined);
    const service = new BillingEntitlementService({ ...reader, ...mutation, ping }, cache);
    const now = new Date("2026-08-15T12:00:00.000Z");
    await service.evaluate(userId, now);
    expect(cache.size).toBe(1);

    const input: ApplyEntitlementChangeInput = {
      userId,
      expectedVersion: 0,
      idempotencyKey: "entitlement-service-0001",
      grant: {
        plan: "pro",
        effectiveAt: now,
        accessThrough: new Date("2026-09-15T12:00:00.000Z"),
      },
      reasonCode: "synthetic_grant",
      actor: { kind: "system", reference: uuidv7() },
      occurredAt: now,
      traceId: uuidv7(),
    };
    await expect(service.applyEntitlementChange(input)).resolves.toEqual(result);
    expect(cache.size).toBe(0);
    await expect(service.ping()).resolves.toBeUndefined();
    expect(ping).toHaveBeenCalledOnce();
  });

  it("keeps the cached decision when the mutation rolls back", async () => {
    const userId = uuidv7();
    const reader: EntitlementReader = {
      readEntitlement: vi.fn(
        async (): Promise<EntitlementSchedule> => ({ userId, version: 0, plan: "free" }),
      ),
    };
    const mutation: EntitlementMutationStore = {
      applyEntitlementChange: vi.fn(async () => {
        throw new Error("rolled back");
      }),
    };
    const cache = new EntitlementCache({ capacity: 10, freshTtlMs: 60_000 });
    const service = new BillingEntitlementService(
      { ...reader, ...mutation, ping: vi.fn(async () => undefined) },
      cache,
    );
    const now = new Date("2026-08-15T12:00:00.000Z");
    await service.evaluate(userId, now);

    await expect(
      service.applyEntitlementChange({
        userId,
        expectedVersion: 0,
        idempotencyKey: "entitlement-service-0002",
        grant: { plan: "free", effectiveAt: now },
        reasonCode: "synthetic_revoke",
        actor: { kind: "system", reference: uuidv7() },
        occurredAt: now,
        traceId: uuidv7(),
      }),
    ).rejects.toThrow("rolled back");
    expect(cache.size).toBe(1);
  });

  it("evicts the committed owner even if the caller mutates its command while awaiting", async () => {
    const userA = uuidv7();
    const userB = uuidv7();
    const now = new Date("2026-08-15T12:00:00.000Z");
    const cache = new EntitlementCache({ capacity: 10, freshTtlMs: 60_000 });
    cache.set(userA, { userId: userA, version: 0, plan: "free" }, now);
    cache.set(userB, { userId: userB, version: 0, plan: "free" }, now);
    let resolveMutation: ((result: ApplyEntitlementChangeResult) => void) | undefined;
    const deferredMutation = new Promise<ApplyEntitlementChangeResult>((resolve) => {
      resolveMutation = resolve;
    });
    const store: BillingEntitlementStore = {
      readEntitlement: vi.fn(),
      applyEntitlementChange: vi.fn(async () => deferredMutation),
      ping: vi.fn(async () => undefined),
    };
    const service = new BillingEntitlementService(store, cache);
    const input: ApplyEntitlementChangeInput = {
      userId: userA,
      expectedVersion: 0,
      idempotencyKey: "entitlement-service-mutated-input-0001",
      grant: {
        plan: "pro",
        effectiveAt: now,
        accessThrough: new Date("2026-09-15T12:00:00.000Z"),
      },
      reasonCode: "synthetic_grant",
      actor: { kind: "system", reference: uuidv7() },
      occurredAt: now,
      traceId: uuidv7(),
    };
    const pending = service.applyEntitlementChange(input);
    input.userId = userB;
    resolveMutation?.({
      schedule: {
        accountId: uuidv7(),
        userId: userA,
        version: 1,
        plan: "pro",
        effectiveAt: now,
        accessThrough: new Date("2026-09-15T12:00:00.000Z"),
      },
      changeId: uuidv7(),
      outboxEventId: uuidv7(),
      replayed: false,
    });
    await pending;

    expect(cache.getFresh(userA, now)).toBeUndefined();
    expect(cache.getFresh(userB, now)).toMatchObject({ version: 0, plan: "free" });
  });

  it("does not resurrect a stale read after a committed mutation", async () => {
    const userId = uuidv7();
    const accountId = uuidv7();
    const free: EntitlementSchedule = { userId, version: 0, plan: "free" };
    const pro: Exclude<EntitlementSchedule, { version: 0 }> = {
      accountId,
      userId,
      version: 1,
      plan: "pro",
      effectiveAt: new Date("2026-08-15T12:00:00.000Z"),
      accessThrough: new Date("2026-09-15T12:00:00.000Z"),
    };
    let resolveFirstRead: ((schedule: EntitlementSchedule) => void) | undefined;
    const firstRead = new Promise<EntitlementSchedule>((resolve) => {
      resolveFirstRead = resolve;
    });
    const reader: EntitlementReader = {
      readEntitlement: vi
        .fn()
        .mockImplementationOnce(async () => firstRead)
        .mockResolvedValue(pro),
    };
    const result: ApplyEntitlementChangeResult = {
      schedule: pro,
      changeId: uuidv7(),
      outboxEventId: uuidv7(),
      replayed: false,
    };
    const mutation: EntitlementMutationStore = {
      applyEntitlementChange: vi.fn(async () => result),
    };
    const cache = new EntitlementCache({ capacity: 10, freshTtlMs: 60_000 });
    const service = new BillingEntitlementService(
      { ...reader, ...mutation, ping: vi.fn(async () => undefined) },
      cache,
    );
    const now = new Date("2026-08-15T12:00:00.000Z");

    const pendingEvaluation = service.evaluate(userId, now);
    await service.applyEntitlementChange({
      userId,
      expectedVersion: 0,
      idempotencyKey: "entitlement-service-race-0001",
      grant: {
        plan: "pro",
        effectiveAt: now,
        accessThrough: new Date("2026-09-15T12:00:00.000Z"),
      },
      reasonCode: "synthetic_grant",
      actor: { kind: "system", reference: uuidv7() },
      occurredAt: now,
      traceId: uuidv7(),
    });
    resolveFirstRead?.(free);

    await expect(pendingEvaluation).resolves.toMatchObject({
      valid: true,
      plan: "pro",
      version: 1,
    });
    expect(reader.readEntitlement).toHaveBeenCalledTimes(2);
    expect(cache.getFresh(userId, now)).toMatchObject({ plan: "pro", version: 1 });
  });
});
