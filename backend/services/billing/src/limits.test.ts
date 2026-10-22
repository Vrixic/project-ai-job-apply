import { describe, expect, it } from "vitest";
import { EntitlementUnavailableError } from "./cache.js";
import { evaluateEntitlement } from "./evaluator.js";
import { resolvePlanLimits } from "./limits.js";
import {
  type EntitlementEvaluation,
  type EntitlementSchedule,
  planLimits,
  planLimitsVersion,
} from "./types.js";

const userId = "019d04cf-1f80-7000-8000-000000000101";
const accountId = "019d04cf-1f80-7000-8000-000000000102";
const pro: EntitlementSchedule = {
  accountId,
  userId,
  version: 3,
  plan: "pro",
  effectiveAt: new Date("2026-08-15T12:00:00.000Z"),
  accessThrough: new Date("2026-09-15T12:00:00.000Z"),
  graceThrough: new Date("2026-09-18T12:00:00.000Z"),
};

const authorizerFor = (schedule: EntitlementSchedule) => ({
  evaluate: async (_userId: string, now: Date): Promise<EntitlementEvaluation> =>
    evaluateEntitlement(schedule, now),
});

describe("plan limits (ADR-032)", () => {
  it("gives Free one stored resume and keeps the table immutable and versioned", () => {
    expect(planLimits.free).toEqual({ maxStoredResumes: 1 });
    expect(planLimitsVersion).toBe(2);
    expect(Object.isFrozen(planLimits)).toBe(true);
    expect(Object.isFrozen(planLimits.free)).toBe(true);
    expect(Object.isFrozen(planLimits.pro)).toBe(true);
  });

  it("carries the limits of the plan each evaluation lands on, including after expiry", () => {
    const at = (iso: string) => evaluateEntitlement(pro, new Date(iso));
    const implicit = evaluateEntitlement(
      { userId, version: 0, plan: "free" },
      new Date("2026-08-15T12:00:00.000Z"),
    );
    for (const [label, evaluation, plan] of [
      ["implicit Free", implicit, "free"],
      ["before the subscription starts", at("2026-08-15T11:59:59.999Z"), "free"],
      ["active Pro", at("2026-08-16T12:00:00.000Z"), "pro"],
      ["Pro grace", at("2026-09-16T12:00:00.000Z"), "pro"],
      ["expired Pro", at("2026-09-18T12:00:00.000Z"), "free"],
    ] as const) {
      expect(evaluation.valid, label).toBe(true);
      expect(evaluation.valid && evaluation.limits, label).toBe(planLimits[plan]);
    }
  });

  it("resolves the limit for a candidate and follows the plan, not a hard-coded value", async () => {
    await expect(
      resolvePlanLimits(authorizerFor(pro), userId, new Date("2026-08-16T12:00:00.000Z")),
    ).resolves.toEqual(planLimits.pro);
    await expect(
      resolvePlanLimits(authorizerFor(pro), userId, new Date("2026-09-18T12:00:00.000Z")),
    ).resolves.toEqual(planLimits.free);
  });

  it("fails closed when the entitlement or its limits cannot be evaluated", async () => {
    await expect(
      resolvePlanLimits(authorizerFor(pro), userId, new Date(Number.NaN)),
    ).rejects.toBeInstanceOf(EntitlementUnavailableError);
    await expect(
      resolvePlanLimits(
        authorizerFor({ ...pro, accessThrough: new Date("2026-08-01T00:00:00.000Z") }),
        userId,
        new Date("2026-08-16T12:00:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(EntitlementUnavailableError);
    for (const bad of [-1, 1.5, Number.NaN, undefined, "1"]) {
      const malformed = {
        evaluate: async () =>
          ({
            valid: true,
            plan: "free",
            accessState: "active",
            grants: [],
            limits: { maxStoredResumes: bad },
            version: 0,
            evaluatedAt: "2026-08-16T12:00:00.000Z",
          }) as unknown as EntitlementEvaluation,
      };
      await expect(
        resolvePlanLimits(malformed, userId, new Date("2026-08-16T12:00:00.000Z")),
      ).rejects.toBeInstanceOf(EntitlementUnavailableError);
    }
    const missing = {
      evaluate: async () =>
        ({ valid: true, plan: "free", accessState: "active", grants: [], version: 0 }) as never,
    };
    await expect(
      resolvePlanLimits(missing, userId, new Date("2026-08-16T12:00:00.000Z")),
    ).rejects.toBeInstanceOf(EntitlementUnavailableError);
  });
});
