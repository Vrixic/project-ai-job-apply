import {
  coreCapabilities,
  type EntitlementCapability,
  type EntitlementEvaluation,
  type EntitlementSchedule,
  maximumEntitlementVersion,
  planLimits,
} from "./types.js";

const immutableCoreGrants = Object.freeze([...coreCapabilities]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isValidDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

function invalid(reason: "invalid_clock" | "invalid_schedule"): EntitlementEvaluation {
  return { valid: false, reason, grants: [] };
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  return (
    actual.length === canonical.length && actual.every((key, index) => key === canonical[index])
  );
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export function isEntitlementSchedule(value: unknown): value is EntitlementSchedule {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.userId !== "string" || !UUID_PATTERN.test(candidate.userId)) return false;
  if (
    typeof candidate.version !== "number" ||
    !Number.isSafeInteger(candidate.version) ||
    candidate.version < 0 ||
    candidate.version > maximumEntitlementVersion
  ) {
    return false;
  }
  if (candidate.version === 0) {
    return candidate.plan === "free" && hasExactKeys(candidate, ["userId", "version", "plan"]);
  }
  if (typeof candidate.accountId !== "string" || !UUID_PATTERN.test(candidate.accountId)) {
    return false;
  }
  if (!validDate(candidate.effectiveAt)) return false;
  if (candidate.plan === "free") {
    return hasExactKeys(candidate, ["accountId", "userId", "version", "plan", "effectiveAt"]);
  }
  if (candidate.plan !== "pro" || !validDate(candidate.accessThrough)) return false;
  if (candidate.effectiveAt >= candidate.accessThrough) return false;
  if (
    candidate.graceThrough !== undefined &&
    (!validDate(candidate.graceThrough) || candidate.graceThrough < candidate.accessThrough)
  ) {
    return false;
  }
  return hasExactKeys(candidate, [
    "accountId",
    "userId",
    "version",
    "plan",
    "effectiveAt",
    "accessThrough",
    ...(candidate.graceThrough === undefined ? [] : ["graceThrough"]),
  ]);
}

export function isEntitlementCapability(value: string): value is EntitlementCapability {
  return (coreCapabilities as readonly string[]).includes(value);
}

export function evaluateEntitlement(
  schedule: EntitlementSchedule,
  now: Date,
): EntitlementEvaluation {
  if (!isValidDate(now)) return invalid("invalid_clock");
  if (!isEntitlementSchedule(schedule)) return invalid("invalid_schedule");

  const evaluatedAt = now.toISOString();
  if (schedule.version === 0) {
    return {
      valid: true,
      plan: "free",
      accessState: "active",
      grants: immutableCoreGrants,
      limits: planLimits.free,
      version: 0,
      evaluatedAt,
    };
  }

  if (schedule.plan === "free") {
    if (!("effectiveAt" in schedule) || schedule.effectiveAt > now) {
      return invalid("invalid_schedule");
    }
    return {
      valid: true,
      plan: "free",
      accessState: "active",
      grants: immutableCoreGrants,
      limits: planLimits.free,
      version: schedule.version,
      evaluatedAt,
    };
  }

  if (now < schedule.effectiveAt) {
    return {
      valid: true,
      plan: "free",
      accessState: "active",
      grants: immutableCoreGrants,
      limits: planLimits.free,
      version: schedule.version,
      evaluatedAt,
    };
  }
  if (now < schedule.accessThrough) {
    return {
      valid: true,
      plan: "pro",
      accessState: "active",
      grants: immutableCoreGrants,
      limits: planLimits.pro,
      version: schedule.version,
      evaluatedAt,
      accessThrough: schedule.accessThrough.toISOString(),
      ...(schedule.graceThrough ? { graceThrough: schedule.graceThrough.toISOString() } : {}),
    };
  }
  if (schedule.graceThrough !== undefined && now < schedule.graceThrough) {
    return {
      valid: true,
      plan: "pro",
      accessState: "grace",
      grants: immutableCoreGrants,
      limits: planLimits.pro,
      version: schedule.version,
      evaluatedAt,
      accessThrough: schedule.accessThrough.toISOString(),
      graceThrough: schedule.graceThrough.toISOString(),
    };
  }
  return {
    valid: true,
    plan: "free",
    accessState: "active",
    grants: immutableCoreGrants,
    limits: planLimits.free,
    version: schedule.version,
    evaluatedAt,
  };
}
