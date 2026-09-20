import { type EntitlementAuthorizer, resolvePlanLimits } from "@ai-job-apply/billing-service";
import type { ResumeLimits } from "@ai-job-apply/documents-service";

/**
 * Supplies Documents its resume limit from Billing (ADR-032). This composition is the only place the two meet, so
 * Documents never imports Billing. It fails closed: an entitlement that cannot be evaluated rejects the upload with
 * `EntitlementUnavailableError` (503 `entitlement_unavailable`) instead of allowing it.
 */
export function resumeLimitsFromEntitlements(
  entitlements: Pick<EntitlementAuthorizer, "evaluate">,
  clock: () => Date = () => new Date(),
): ResumeLimits {
  return {
    async maxStoredResumes(userId: string): Promise<number> {
      return (await resolvePlanLimits(entitlements, userId, clock())).maxStoredResumes;
    },
  };
}
