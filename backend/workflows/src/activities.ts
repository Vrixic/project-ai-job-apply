import { calculateProfileReadiness } from "@ai-job-apply/domain";
import { activeTraceparent, withTraceSpan } from "@ai-job-apply/observability";
import type { ProfileStore } from "@ai-job-apply/profile-service";

export interface ProfileReadinessInput {
  preferenceSetId: string;
  operationId: string;
  traceparent?: string;
}

export interface ProfileReadinessActivities {
  markRunning(input: ProfileReadinessInput): Promise<void>;
  calculateAndPersist(input: ProfileReadinessInput): Promise<void>;
}

type ProfileReadinessActivitiesStore = Pick<
  ProfileStore,
  "markOperationRunning" | "getPreferencesById" | "completeReadinessOperation"
>;

export function createProfileReadinessActivities(
  store: ProfileReadinessActivitiesStore,
): ProfileReadinessActivities {
  return {
    async markRunning(input) {
      await withTraceSpan("profile-readiness.mark-running", input.traceparent, async () => {
        await store.markOperationRunning(input.operationId, input.preferenceSetId);
      });
    },
    async calculateAndPersist(input) {
      await withTraceSpan(
        "profile-readiness.calculate-and-persist",
        input.traceparent,
        async () => {
          const preferences = await store.getPreferencesById(input.preferenceSetId);
          if (!preferences) {
            throw new Error("The requested preference set was not found");
          }
          const readiness = calculateProfileReadiness(preferences, new Date());
          await store.completeReadinessOperation(
            input.operationId,
            input.preferenceSetId,
            readiness,
            activeTraceparent(),
          );
        },
      );
    },
  };
}
