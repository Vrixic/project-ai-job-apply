import { describe, expect, it, vi } from "vitest";
import {
  CachedEntitlementAuthorizer,
  EntitlementCache,
  EntitlementUnavailableError,
} from "./cache.js";
import type {
  EntitlementReader,
  EntitlementSchedule,
  StoredProEntitlementSchedule,
} from "./types.js";

const userA = "019d04cf-1f80-7000-8000-000000000111";
const userB = "019d04cf-1f80-7000-8000-000000000112";

function pro(userId = userA): StoredProEntitlementSchedule {
  return {
    accountId: "019d04cf-1f80-7000-8000-000000000113",
    userId,
    version: 1,
    plan: "pro",
    effectiveAt: new Date("2026-08-15T12:00:00.000Z"),
    accessThrough: new Date("2026-08-15T12:01:00.000Z"),
    graceThrough: new Date("2026-08-15T12:02:00.000Z"),
  };
}

describe("entitlement cache", () => {
  it("caps freshness at the next schedule boundary and deep-copies entries", () => {
    const cache = new EntitlementCache({ capacity: 2, freshTtlMs: 60_000 });
    const schedule = pro();
    cache.set(userA, schedule, new Date("2026-08-15T12:00:30.000Z"));
    schedule.accessThrough.setUTCFullYear(2030);
    const firstRead = cache.getFresh(userA, new Date("2026-08-15T12:00:59.999Z"));
    expect(firstRead).toMatchObject({
      plan: "pro",
      version: 1,
    });
    if (firstRead?.plan !== "pro") throw new Error("Expected a Pro cache entry");
    expect(firstRead.accessThrough.toISOString()).toBe("2026-08-15T12:01:00.000Z");
    firstRead.accessThrough.setUTCFullYear(2031);
    const secondRead = cache.getFresh(userA, new Date("2026-08-15T12:00:59.999Z"));
    if (secondRead?.plan !== "pro") throw new Error("Expected a Pro cache entry");
    expect(secondRead.accessThrough.toISOString()).toBe("2026-08-15T12:01:00.000Z");
    expect(cache.getFresh(userA, new Date("2026-08-15T12:01:00.000Z"))).toBeUndefined();
  });

  it("uses bounded LRU isolation and mutation eviction", () => {
    const cache = new EntitlementCache({ capacity: 1, freshTtlMs: 60_000 });
    const now = new Date("2026-08-15T12:00:00.000Z");
    cache.set(userA, { userId: userA, version: 0, plan: "free" }, now);
    cache.set(userB, { userId: userB, version: 0, plan: "free" }, now);
    expect(cache.size).toBe(1);
    expect(cache.getFresh(userA, now)).toBeUndefined();
    expect(cache.getFresh(userB, now)).toBeDefined();
    cache.evict(userB);
    expect(cache.size).toBe(0);
  });

  it("rejects a reader result for a different owner without using outage fallback", async () => {
    const reader: EntitlementReader = { readEntitlement: vi.fn(async () => pro(userB)) };
    const cache = new EntitlementCache({ capacity: 2, freshTtlMs: 1_000 });
    cache.set(userA, pro(), new Date("2026-08-15T12:00:00.000Z"));
    const authorizer = new CachedEntitlementAuthorizer(reader, cache);
    await expect(authorizer.evaluate(userA, new Date("2026-08-15T12:00:02.000Z"))).rejects.toThrow(
      "Entitlement cache owner mismatch",
    );
  });

  it("allows stale Pro only through explicit grace and rejects stale Free", () => {
    const cache = new EntitlementCache({ capacity: 2, freshTtlMs: 1_000 });
    cache.set(userA, pro(), new Date("2026-08-15T12:00:00.000Z"));
    cache.set(
      userB,
      { userId: userB, version: 0, plan: "free" },
      new Date("2026-08-15T12:00:00.000Z"),
    );
    expect(cache.getOutageFallback(userA, new Date("2026-08-15T12:01:30.000Z"))).toBeDefined();
    expect(cache.getOutageFallback(userA, new Date("2026-08-15T12:02:00.000Z"))).toBeUndefined();
    expect(cache.getOutageFallback(userB, new Date("2026-08-15T12:00:01.000Z"))).toBeUndefined();
  });

  it("rejects stale future Pro before its effective boundary", () => {
    const cache = new EntitlementCache({ capacity: 2, freshTtlMs: 1_000 });
    cache.set(userA, pro(), new Date("2026-08-15T11:59:00.000Z"));
    expect(cache.getOutageFallback(userA, new Date("2026-08-15T11:59:01.000Z"))).toBeUndefined();
    expect(cache.getOutageFallback(userA, new Date("2026-08-15T12:00:00.000Z"))).toBeDefined();
  });

  it("uses a no-grace Pro schedule only through its paid-through boundary", () => {
    const cache = new EntitlementCache({ capacity: 2, freshTtlMs: 1_000 });
    const schedule = pro();
    delete schedule.graceThrough;
    cache.set(userA, schedule, new Date("2026-08-15T12:00:00.000Z"));
    expect(cache.getOutageFallback(userA, new Date("2026-08-15T12:00:30.000Z"))).toBeDefined();
    expect(cache.getOutageFallback(userA, new Date("2026-08-15T12:01:00.000Z"))).toBeUndefined();
  });

  it("refreshes normally and fails unavailable without an eligible fallback", async () => {
    const reader: EntitlementReader = {
      readEntitlement: vi.fn(
        async (): Promise<EntitlementSchedule> => ({ userId: userA, version: 0, plan: "free" }),
      ),
    };
    const cache = new EntitlementCache({ capacity: 2, freshTtlMs: 1_000 });
    const authorizer = new CachedEntitlementAuthorizer(reader, cache);
    expect(await authorizer.allows(userA, "jobs.save", new Date("2026-08-15T12:00:00.000Z"))).toBe(
      true,
    );
    expect(await authorizer.allows(userA, "unknown", new Date("2026-08-15T12:00:00.000Z"))).toBe(
      false,
    );
    vi.mocked(reader.readEntitlement).mockRejectedValue(new Error("db unavailable"));
    await expect(
      authorizer.evaluate(userA, new Date("2026-08-15T12:00:01.000Z")),
    ).rejects.toBeInstanceOf(EntitlementUnavailableError);
  });

  it("returns invalid-clock without repository I/O or cache mutation", async () => {
    const reader: EntitlementReader = { readEntitlement: vi.fn(async () => pro()) };
    const cache = new EntitlementCache({ capacity: 2, freshTtlMs: 1_000 });
    const authorizer = new CachedEntitlementAuthorizer(reader, cache);
    await expect(authorizer.evaluate(userA, new Date(Number.NaN))).resolves.toEqual({
      valid: false,
      reason: "invalid_clock",
      grants: [],
    });
    expect(reader.readEntitlement).not.toHaveBeenCalled();
    expect(cache.size).toBe(0);
  });

  it("fails closed without caching a malformed reader schedule", async () => {
    const malformed = { ...pro(), plan: "enterprise", provider: "stripe" };
    const reader: EntitlementReader = {
      readEntitlement: vi.fn(async () => malformed as unknown as EntitlementSchedule),
    };
    const cache = new EntitlementCache({ capacity: 2, freshTtlMs: 1_000 });
    const authorizer = new CachedEntitlementAuthorizer(reader, cache);

    await expect(authorizer.evaluate(userA, new Date("2026-08-15T12:00:00.000Z"))).resolves.toEqual(
      { valid: false, reason: "invalid_schedule", grants: [] },
    );
    expect(cache.size).toBe(0);
  });

  it("uses cached Pro during an outage only before grace end", async () => {
    const reader: EntitlementReader = { readEntitlement: vi.fn(async () => pro()) };
    const cache = new EntitlementCache({ capacity: 2, freshTtlMs: 1_000 });
    const authorizer = new CachedEntitlementAuthorizer(reader, cache);
    await authorizer.evaluate(userA, new Date("2026-08-15T12:00:00.000Z"));
    vi.mocked(reader.readEntitlement).mockRejectedValue(new Error("db unavailable"));
    await expect(
      authorizer.evaluate(userA, new Date("2026-08-15T12:01:30.000Z")),
    ).resolves.toMatchObject({ valid: true, plan: "pro", accessState: "grace" });
    await expect(
      authorizer.evaluate(userA, new Date("2026-08-15T12:02:00.000Z")),
    ).rejects.toBeInstanceOf(EntitlementUnavailableError);
  });

  it("never lets an older overlapping read replace or return over a newer version", async () => {
    let resolveOlder: ((schedule: EntitlementSchedule) => void) | undefined;
    let resolveNewer: ((schedule: EntitlementSchedule) => void) | undefined;
    const older = new Promise<EntitlementSchedule>((resolve) => {
      resolveOlder = resolve;
    });
    const newer = new Promise<EntitlementSchedule>((resolve) => {
      resolveNewer = resolve;
    });
    const newerSchedule = { ...pro(), version: 2 } as StoredProEntitlementSchedule;
    const reader: EntitlementReader = {
      readEntitlement: vi
        .fn()
        .mockImplementationOnce(async () => older)
        .mockImplementationOnce(async () => newer),
    };
    const cache = new EntitlementCache({ capacity: 2, freshTtlMs: 60_000 });
    const authorizer = new CachedEntitlementAuthorizer(reader, cache);
    const now = new Date("2026-08-15T12:00:00.000Z");
    const olderEvaluation = authorizer.evaluate(userA, now);
    const newerEvaluation = authorizer.evaluate(userA, now);

    resolveNewer?.(newerSchedule);
    await expect(newerEvaluation).resolves.toMatchObject({ valid: true, version: 2 });
    resolveOlder?.(pro());
    await expect(olderEvaluation).resolves.toMatchObject({ valid: true, version: 2 });
    expect(cache.getFresh(userA, now)).toMatchObject({ version: 2 });
  });

  it("does not let unrelated-owner evictions interfere with an active read", async () => {
    let resolveRead: ((schedule: EntitlementSchedule) => void) | undefined;
    const deferredRead = new Promise<EntitlementSchedule>((resolve) => {
      resolveRead = resolve;
    });
    const reader: EntitlementReader = { readEntitlement: vi.fn(async () => deferredRead) };
    const cache = new EntitlementCache({ capacity: 2, freshTtlMs: 60_000 });
    const authorizer = new CachedEntitlementAuthorizer(reader, cache);
    const now = new Date("2026-08-15T12:00:00.000Z");
    const evaluation = authorizer.evaluate(userA, now);

    cache.evict(userB);
    cache.evict(userB);
    cache.evict(userB);
    resolveRead?.(pro());

    await expect(evaluation).resolves.toMatchObject({ valid: true, plan: "pro", version: 1 });
    expect(reader.readEntitlement).toHaveBeenCalledTimes(1);
    expect(cache.getFresh(userA, now)).toMatchObject({ version: 1 });
  });

  it("fails closed when the same owner version has different schedule bytes", () => {
    const cache = new EntitlementCache({ capacity: 2, freshTtlMs: 60_000 });
    const now = new Date("2026-08-15T12:00:00.000Z");
    cache.set(userA, pro(), now);
    expect(() =>
      cache.set(userA, { ...pro(), accessThrough: new Date("2026-08-15T12:01:30.000Z") }, now),
    ).toThrow(EntitlementUnavailableError);
  });
});
