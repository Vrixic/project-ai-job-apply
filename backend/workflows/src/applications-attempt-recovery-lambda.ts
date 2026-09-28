import {
  createApplicationsDatabase,
  PostgresApplicationStore,
} from "@ai-job-apply/applications-service";
import { resolveLambdaDatabaseUrl } from "@ai-job-apply/profile-service";
import type { Handler } from "aws-lambda";

/**
 * Crash/replay recovery for submission attempts (D3-005/D3-008/D3-011): a scheduled sweep that
 * resolves an attempt whose worker vanished before it could report a result. `attempt.ts` already
 * makes this conservative: a "dispatched" attempt past the threshold becomes `ambiguous` (a
 * provider effect cannot be ruled out, so the candidate reconciles it); a "started" attempt that
 * never dispatched becomes `failed_no_effect` (no provider effect is possible, so it is safe to
 * retry outright). This Lambda only calls the already-tested `recoverStaleAttempts`; it adds no
 * new business rule.
 */

export interface ApplicationsAttemptRecoveryResultV1 {
  schemaVersion: 1;
  recovered: number;
}

/**
 * How long a "started" or "dispatched" attempt is trusted to still be running before it is
 * considered abandoned. An ATS form fill and submit normally completes in well under a minute;
 * 15 minutes is a generous margin over worker cold starts and slow pages, chosen to avoid
 * reconciling an attempt that is merely slow. Override with `APPLICATIONS_ATTEMPT_STALE_AFTER_MS`
 * if evidence says otherwise; this is an operational tuning value, not a security boundary.
 */
export const DEFAULT_ATTEMPT_STALE_AFTER_MS = 15 * 60 * 1000;

/** Matches the store's own default so an unset override behaves the same as a direct call. */
export const DEFAULT_ATTEMPT_RECOVERY_LIMIT = 50;

export type AttemptRecoveryStore = Pick<PostgresApplicationStore, "recoverStaleAttempts">;

/**
 * True only for the exact EventBridge scheduled-event envelope for the given rule: the same shape
 * check the candidate-rights maintenance sweep uses, so a malformed or foreign event, or a stale
 * rule ARN from a prior deployment, is rejected instead of silently recovering nothing or the
 * wrong thing.
 */
export function isApplicationsAttemptRecoveryEvent(
  value: unknown,
  expectedRuleArn: string,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  const rule =
    /^arn:(aws|aws-us-gov|aws-cn):events:([a-z]{2}(?:-[a-z]+)+-[0-9]):([0-9]{12}):rule\/[A-Za-z0-9._/-]+$/u.exec(
      expectedRuleArn,
    );
  return (
    rule !== null &&
    event.account === rule[3] &&
    event.region === rule[2] &&
    event.source === "aws.events" &&
    event["detail-type"] === "Scheduled Event" &&
    Array.isArray(event.resources) &&
    event.resources.length === 1 &&
    event.resources[0] === expectedRuleArn &&
    !!event.detail &&
    typeof event.detail === "object" &&
    !Array.isArray(event.detail) &&
    Object.keys(event.detail as object).length === 0
  );
}

export function createApplicationsAttemptRecoveryHandler(
  store: AttemptRecoveryStore,
  expectedRuleArn: string,
  options: { staleAfterMs?: number; limit?: number } = {},
): (event: unknown) => Promise<ApplicationsAttemptRecoveryResultV1> {
  if (!expectedRuleArn) throw new Error("ApplicationsAttemptRecoveryConfigurationInvalid");
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_ATTEMPT_STALE_AFTER_MS;
  const limit = options.limit ?? DEFAULT_ATTEMPT_RECOVERY_LIMIT;
  return async (event) => {
    if (!isApplicationsAttemptRecoveryEvent(event, expectedRuleArn)) {
      throw new Error("ApplicationsAttemptRecoveryEventRejected");
    }
    const result = await store.recoverStaleAttempts(staleAfterMs, limit);
    // Identifier-free: counts only, matching the candidate-rights sweep's logging shape.
    console.info({ event: "application_stale_attempts_recovered", ...result });
    return { schemaVersion: 1, ...result };
  };
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

let runtimeStore: PostgresApplicationStore | undefined;

async function getRuntimeStore(): Promise<PostgresApplicationStore> {
  if (!runtimeStore) {
    const databaseUrl = await resolveLambdaDatabaseUrl(
      {
        ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
        ...(process.env.DATABASE_SECRET_ID
          ? { DATABASE_SECRET_ID: process.env.DATABASE_SECRET_ID }
          : {}),
      },
      { ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}) },
    );
    runtimeStore = new PostgresApplicationStore(
      createApplicationsDatabase(databaseUrl, { maxConnections: 1 }),
    );
  }
  return runtimeStore;
}

export const handler: Handler<unknown, ApplicationsAttemptRecoveryResultV1> = async (event) => {
  const ruleArn = process.env.APPLICATIONS_ATTEMPT_RECOVERY_RULE_ARN;
  if (!ruleArn) throw new Error("APPLICATIONS_ATTEMPT_RECOVERY_RULE_ARN is required");
  const staleAfterMs = parsePositiveInteger(
    process.env.APPLICATIONS_ATTEMPT_STALE_AFTER_MS,
    DEFAULT_ATTEMPT_STALE_AFTER_MS,
  );
  const limit = parsePositiveInteger(
    process.env.APPLICATIONS_ATTEMPT_RECOVERY_LIMIT,
    DEFAULT_ATTEMPT_RECOVERY_LIMIT,
  );
  return createApplicationsAttemptRecoveryHandler(await getRuntimeStore(), ruleArn, {
    staleAfterMs,
    limit,
  })(event);
};
