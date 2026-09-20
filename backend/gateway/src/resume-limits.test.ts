import {
  type EntitlementEvaluation,
  EntitlementUnavailableError,
  planLimits,
} from "@ai-job-apply/billing-service";
import { describe, expect, it, vi } from "vitest";
import { resumeLimitsFromEntitlements } from "./resume-limits.js";

const userId = "019d04cf-1f80-7000-8000-000000000101";
const now = new Date("2026-09-20T12:00:00.000Z");

function evaluation(plan: "free" | "pro", limits = planLimits[plan]): EntitlementEvaluation {
  return {
    valid: true,
    plan,
    accessState: "active",
    grants: ["profile.manage", "jobs.search", "jobs.save", "applications.history"],
    limits,
    version: 1,
    evaluatedAt: now.toISOString(),
  };
}

describe("resumeLimitsFromEntitlements", () => {
  it("returns the candidate's plan limit, evaluated at the injected time for that candidate", async () => {
    const evaluate = vi.fn(async () => evaluation("free"));
    const limits = resumeLimitsFromEntitlements({ evaluate }, () => now);
    await expect(limits.maxStoredResumes(userId)).resolves.toBe(1);
    expect(evaluate).toHaveBeenCalledExactlyOnceWith(userId, now);
  });

  it("follows the plan, so a later Pro limit needs no change here", async () => {
    const limits = resumeLimitsFromEntitlements(
      { evaluate: async () => evaluation("pro", { maxStoredResumes: 5 }) },
      () => now,
    );
    await expect(limits.maxStoredResumes(userId)).resolves.toBe(5);
  });

  it("fails closed when the entitlement cannot be evaluated", async () => {
    const invalid = resumeLimitsFromEntitlements(
      {
        evaluate: async () => ({ valid: false, reason: "invalid_schedule", grants: [] }),
      },
      () => now,
    );
    await expect(invalid.maxStoredResumes(userId)).rejects.toBeInstanceOf(
      EntitlementUnavailableError,
    );
    const broken = resumeLimitsFromEntitlements({
      evaluate: async () => {
        throw new EntitlementUnavailableError();
      },
    });
    await expect(broken.maxStoredResumes(userId)).rejects.toBeInstanceOf(
      EntitlementUnavailableError,
    );
  });
});
