import {
  evaluateEntitlement,
  isEntitlementCapability,
  isEntitlementSchedule,
} from "./evaluator.js";
import type {
  EntitlementAuthorizer,
  EntitlementEvaluation,
  EntitlementReader,
  EntitlementSchedule,
} from "./types.js";

interface CacheEntry {
  schedule: EntitlementSchedule;
  cachedAt: number;
  freshUntil: number;
}

interface OwnerReadState {
  generation: bigint;
  activeReads: number;
}

function cloneDate(value: Date): Date {
  return new Date(value.getTime());
}

function cloneSchedule(schedule: EntitlementSchedule): EntitlementSchedule {
  if (!("accountId" in schedule)) {
    return Object.freeze({ userId: schedule.userId, version: 0, plan: "free" });
  }
  if (schedule.plan === "free") {
    return Object.freeze({
      accountId: schedule.accountId,
      userId: schedule.userId,
      version: schedule.version,
      plan: "free",
      effectiveAt: cloneDate(schedule.effectiveAt),
    });
  }
  return Object.freeze({
    accountId: schedule.accountId,
    userId: schedule.userId,
    version: schedule.version,
    plan: "pro",
    effectiveAt: cloneDate(schedule.effectiveAt),
    accessThrough: cloneDate(schedule.accessThrough),
    ...(schedule.graceThrough ? { graceThrough: cloneDate(schedule.graceThrough) } : {}),
  });
}

function sameSchedule(left: EntitlementSchedule, right: EntitlementSchedule): boolean {
  if (
    left.userId !== right.userId ||
    left.version !== right.version ||
    left.plan !== right.plan ||
    ("accountId" in left ? left.accountId : undefined) !==
      ("accountId" in right ? right.accountId : undefined)
  ) {
    return false;
  }
  if (!("effectiveAt" in left) || !("effectiveAt" in right)) return true;
  if (left.effectiveAt.getTime() !== right.effectiveAt.getTime()) return false;
  if (left.plan === "free" || right.plan === "free") return left.plan === right.plan;
  return (
    left.accessThrough.getTime() === right.accessThrough.getTime() &&
    left.graceThrough?.getTime() === right.graceThrough?.getTime()
  );
}

function nextBoundary(schedule: EntitlementSchedule, nowMs: number): number | undefined {
  if (schedule.version === 0 || schedule.plan === "free") return undefined;
  const candidates = [
    schedule.effectiveAt.getTime(),
    schedule.accessThrough.getTime(),
    schedule.graceThrough?.getTime(),
  ].filter((value): value is number => value !== undefined && value > nowMs);
  return candidates.length === 0 ? undefined : Math.min(...candidates);
}

export class EntitlementCache {
  readonly #capacity: number;
  readonly #freshTtlMs: number;
  readonly #entries = new Map<string, CacheEntry>();
  readonly #ownerReads = new Map<string, OwnerReadState>();

  constructor(input: { capacity: number; freshTtlMs: number }) {
    if (!Number.isSafeInteger(input.capacity) || input.capacity < 1 || input.capacity > 10_000) {
      throw new Error("Entitlement cache capacity must be between 1 and 10000");
    }
    if (
      !Number.isSafeInteger(input.freshTtlMs) ||
      input.freshTtlMs < 1 ||
      input.freshTtlMs > 60_000
    ) {
      throw new Error("Entitlement cache fresh TTL must be between 1 and 60000 milliseconds");
    }
    this.#capacity = input.capacity;
    this.#freshTtlMs = input.freshTtlMs;
  }

  get size(): number {
    return this.#entries.size;
  }

  beginRead(userId: string): bigint {
    const state = this.#ownerReads.get(userId) ?? { generation: 0n, activeReads: 0 };
    state.activeReads += 1;
    this.#ownerReads.set(userId, state);
    return state.generation;
  }

  finishRead(userId: string, generation: bigint): boolean {
    const state = this.#ownerReads.get(userId);
    if (!state || state.activeReads < 1) {
      throw new Error("Entitlement cache read state is invalid");
    }
    const current = state.generation === generation;
    state.activeReads -= 1;
    if (state.activeReads === 0) this.#ownerReads.delete(userId);
    return current;
  }

  set(userId: string, schedule: EntitlementSchedule, now: Date): EntitlementSchedule {
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs)) throw new Error("Entitlement cache clock is invalid");
    if (!isEntitlementSchedule(schedule)) throw new EntitlementUnavailableError();
    if (schedule.userId !== userId) {
      throw new Error("Entitlement cache owner mismatch");
    }
    const existing = this.#entries.get(userId);
    if (existing && existing.schedule.version > schedule.version) {
      return cloneSchedule(existing.schedule);
    }
    if (
      existing &&
      existing.schedule.version === schedule.version &&
      !sameSchedule(existing.schedule, schedule)
    ) {
      throw new EntitlementUnavailableError();
    }
    const boundary = nextBoundary(schedule, nowMs);
    const freshUntil = Math.min(nowMs + this.#freshTtlMs, boundary ?? Number.POSITIVE_INFINITY);
    this.#entries.delete(userId);
    this.#entries.set(userId, {
      schedule: cloneSchedule(schedule),
      cachedAt: nowMs,
      freshUntil,
    });
    while (this.#entries.size > this.#capacity) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    return cloneSchedule(schedule);
  }

  getFresh(userId: string, now: Date): EntitlementSchedule | undefined {
    const entry = this.#entries.get(userId);
    const nowMs = now.getTime();
    if (!entry || !Number.isFinite(nowMs) || nowMs >= entry.freshUntil) return undefined;
    this.#entries.delete(userId);
    this.#entries.set(userId, entry);
    return cloneSchedule(entry.schedule);
  }

  getOutageFallback(userId: string, now: Date): EntitlementSchedule | undefined {
    const entry = this.#entries.get(userId);
    const nowMs = now.getTime();
    if (!entry || !Number.isFinite(nowMs)) return undefined;
    if (nowMs < entry.freshUntil) return cloneSchedule(entry.schedule);
    if (entry.schedule.plan !== "pro") return undefined;
    if (nowMs < entry.schedule.effectiveAt.getTime()) return undefined;
    const fallbackThrough = entry.schedule.graceThrough ?? entry.schedule.accessThrough;
    if (nowMs >= fallbackThrough.getTime()) return undefined;
    return cloneSchedule(entry.schedule);
  }

  evict(userId: string): void {
    this.#entries.delete(userId);
    const state = this.#ownerReads.get(userId);
    if (state) state.generation += 1n;
  }
}

export class EntitlementUnavailableError extends Error {
  constructor() {
    super("Entitlement state is temporarily unavailable");
    this.name = "EntitlementUnavailableError";
  }
}

export class CachedEntitlementAuthorizer implements EntitlementAuthorizer {
  constructor(
    private readonly reader: EntitlementReader,
    private readonly cache: EntitlementCache,
  ) {}

  async evaluate(userId: string, now: Date): Promise<EntitlementEvaluation> {
    if (!Number.isFinite(now.getTime())) {
      return evaluateEntitlement({ userId, version: 0, plan: "free" }, now);
    }
    const fresh = this.cache.getFresh(userId, now);
    if (fresh) return evaluateEntitlement(fresh, now);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const generation = this.cache.beginRead(userId);
      let schedule: EntitlementSchedule;
      try {
        schedule = await this.reader.readEntitlement(userId);
      } catch {
        const current = this.cache.finishRead(userId, generation);
        if (!current) continue;
        const fallback = this.cache.getOutageFallback(userId, now);
        if (!fallback) throw new EntitlementUnavailableError();
        return evaluateEntitlement(fallback, now);
      }
      if (!this.cache.finishRead(userId, generation)) continue;
      const evaluation = evaluateEntitlement(schedule, now);
      if (!evaluation.valid) return evaluation;
      const acceptedSchedule = this.cache.set(userId, schedule, now);
      return evaluateEntitlement(acceptedSchedule, now);
    }
    throw new EntitlementUnavailableError();
  }

  async allows(userId: string, capability: string, now: Date): Promise<boolean> {
    if (!isEntitlementCapability(capability)) return false;
    const evaluation = await this.evaluate(userId, now);
    return evaluation.valid && evaluation.grants.includes(capability);
  }
}
