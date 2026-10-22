import type { EntitlementPlan } from "@ai-job-apply/domain";

export const coreCapabilities = Object.freeze([
  "profile.manage",
  "jobs.search",
  "jobs.save",
  "applications.history",
] as const);
export const maximumEntitlementVersion = Number.MAX_SAFE_INTEGER;
export const maximumEntitlementOutboxAttempts = 5;

/**
 * Quantities a plan allows (ADR-032). Billing owns this table and returns the evaluated plan's limits with every
 * valid entitlement evaluation; the context that owns the thing being limited enforces it. Limits are derived from
 * the plan, so an expired Pro subscription evaluates as Free and gets Free limits.
 */
export interface PlanLimits {
  /** Resumes a candidate may keep (uploading, scanning, parsing, or parsed) at once. */
  readonly maxStoredResumes: number;
}

export const planLimitsVersion = 3;
export const planLimits: Readonly<Record<EntitlementPlan, PlanLimits>> = Object.freeze({
  free: Object.freeze({ maxStoredResumes: 1 }),
  // Pro is the one paid product (D6-008): the same capabilities with room for tailored resume variants.
  pro: Object.freeze({ maxStoredResumes: 2 }),
});

export type EntitlementCapability = (typeof coreCapabilities)[number];
export type EntitlementAccessState = "active" | "grace";

interface EntitlementScheduleBase {
  userId: string;
  version: number;
  plan: EntitlementPlan;
}

export interface ImplicitFreeEntitlementSchedule extends EntitlementScheduleBase {
  version: 0;
  plan: "free";
}

export interface StoredFreeEntitlementSchedule extends EntitlementScheduleBase {
  accountId: string;
  plan: "free";
  effectiveAt: Date;
}

export interface StoredProEntitlementSchedule extends EntitlementScheduleBase {
  accountId: string;
  plan: "pro";
  effectiveAt: Date;
  accessThrough: Date;
  graceThrough?: Date;
}

export type EntitlementSchedule =
  | ImplicitFreeEntitlementSchedule
  | StoredFreeEntitlementSchedule
  | StoredProEntitlementSchedule;

export type EntitlementEvaluation =
  | {
      valid: false;
      reason: "invalid_clock" | "invalid_schedule";
      grants: readonly [];
    }
  | {
      valid: true;
      plan: EntitlementPlan;
      accessState: EntitlementAccessState;
      grants: readonly EntitlementCapability[];
      limits: PlanLimits;
      version: number;
      evaluatedAt: string;
      accessThrough?: string;
      graceThrough?: string;
    };

export interface EntitlementReader {
  readEntitlement(userId: string): Promise<EntitlementSchedule>;
}

export interface EntitlementAuthorizer {
  evaluate(userId: string, now: Date): Promise<EntitlementEvaluation>;
  allows(userId: string, capability: string, now: Date): Promise<boolean>;
}

export interface EntitlementReadService extends EntitlementAuthorizer {
  ping(): Promise<void>;
}
