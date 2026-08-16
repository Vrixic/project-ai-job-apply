import { describe, expect, it } from "vitest";
import { evaluateEntitlement, isEntitlementCapability } from "./evaluator.js";
import { coreCapabilities, type EntitlementSchedule, maximumEntitlementVersion } from "./types.js";

const userId = "019d04cf-1f80-7000-8000-000000000101";
const accountId = "019d04cf-1f80-7000-8000-000000000102";

function proSchedule(): EntitlementSchedule {
  return {
    accountId,
    userId,
    version: 3,
    plan: "pro",
    effectiveAt: new Date("2026-08-15T12:00:00.000Z"),
    accessThrough: new Date("2026-09-15T12:00:00.000Z"),
    graceThrough: new Date("2026-09-18T12:00:00.000Z"),
  };
}

describe("entitlement evaluator", () => {
  it("uses exact active, grace, and Free boundary instants", () => {
    const schedule = proSchedule();
    expect(evaluateEntitlement(schedule, new Date("2026-08-15T11:59:59.999Z"))).toMatchObject({
      valid: true,
      plan: "free",
      accessState: "active",
    });
    expect(evaluateEntitlement(schedule, new Date("2026-08-15T12:00:00.000Z"))).toMatchObject({
      valid: true,
      plan: "pro",
      accessState: "active",
    });
    expect(evaluateEntitlement(schedule, new Date("2026-09-15T12:00:00.000Z"))).toMatchObject({
      valid: true,
      plan: "pro",
      accessState: "grace",
    });
    expect(evaluateEntitlement(schedule, new Date("2026-09-18T12:00:00.000Z"))).toMatchObject({
      valid: true,
      plan: "free",
      accessState: "active",
    });
  });

  it("gives both plans the same core keys and denies unknown keys", () => {
    const implicit = evaluateEntitlement(
      { userId, version: 0, plan: "free" },
      new Date("2026-08-15T12:00:00.000Z"),
    );
    const pro = evaluateEntitlement(proSchedule(), new Date("2026-08-16T12:00:00.000Z"));
    expect(implicit.valid && implicit.grants).toEqual(coreCapabilities);
    expect(pro.valid && pro.grants).toEqual(coreCapabilities);
    expect(isEntitlementCapability("jobs.save")).toBe(true);
    expect(isEntitlementCapability("billing.checkout")).toBe(false);
    expect(Object.isFrozen(coreCapabilities)).toBe(true);
  });

  it("fails closed for invalid clocks and schedules", () => {
    expect(evaluateEntitlement(proSchedule(), new Date(Number.NaN))).toEqual({
      valid: false,
      reason: "invalid_clock",
      grants: [],
    });
    expect(
      evaluateEntitlement(
        {
          ...proSchedule(),
          accessThrough: new Date("2026-08-01T12:00:00.000Z"),
        } as unknown as EntitlementSchedule,
        new Date("2026-08-15T12:00:00.000Z"),
      ),
    ).toEqual({ valid: false, reason: "invalid_schedule", grants: [] });
    expect(
      evaluateEntitlement(
        {
          ...proSchedule(),
          graceThrough: new Date("2026-09-01T12:00:00.000Z"),
        } as unknown as EntitlementSchedule,
        new Date("2026-08-15T12:00:00.000Z"),
      ),
    ).toEqual({ valid: false, reason: "invalid_schedule", grants: [] });
  });

  it.each([
    ["an unknown plan", { ...proSchedule(), plan: "enterprise" }],
    ["an extra provider field", { ...proSchedule(), provider: "stripe" }],
    ["a serialized date", { ...proSchedule(), effectiveAt: "2026-08-15T12:00:00.000Z" }],
    ["a noncanonical owner", { ...proSchedule(), userId: userId.toUpperCase() }],
    ["an invalid account", { ...proSchedule(), accountId: "not-an-account-id" }],
    ["an unsafe version", { ...proSchedule(), version: maximumEntitlementVersion + 1 }],
  ])("rejects runtime schedule input with %s", (_label, malformed) => {
    expect(
      evaluateEntitlement(
        malformed as unknown as EntitlementSchedule,
        new Date("2026-08-15T12:00:00.000Z"),
      ),
    ).toEqual({ valid: false, reason: "invalid_schedule", grants: [] });
  });

  it("fails closed for a future-effective stored Free schedule", () => {
    expect(
      evaluateEntitlement(
        {
          accountId,
          userId,
          version: 4,
          plan: "free",
          effectiveAt: new Date("2026-08-16T12:00:00.000Z"),
        },
        new Date("2026-08-15T12:00:00.000Z"),
      ),
    ).toEqual({ valid: false, reason: "invalid_schedule", grants: [] });
  });
});
