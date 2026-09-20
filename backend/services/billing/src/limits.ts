import { EntitlementUnavailableError } from "./cache.js";
import type { EntitlementAuthorizer, PlanLimits } from "./types.js";

/**
 * The limits of the plan a candidate is evaluated on at `now` (ADR-032). It fails closed: an entitlement that cannot
 * be evaluated is unavailable, never an implicit allowance, so a caller enforcing a limit refuses instead of guessing.
 */
export async function resolvePlanLimits(
  authorizer: Pick<EntitlementAuthorizer, "evaluate">,
  userId: string,
  now: Date,
): Promise<PlanLimits> {
  const evaluation = await authorizer.evaluate(userId, now);
  if (!evaluation.valid) throw new EntitlementUnavailableError();
  const limit = evaluation.limits?.maxStoredResumes;
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 0) {
    throw new EntitlementUnavailableError();
  }
  return evaluation.limits;
}
