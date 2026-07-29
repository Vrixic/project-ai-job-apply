import { calculateProfileReadiness } from "@ai-job-apply/domain";
import type { ProfileStore } from "@ai-job-apply/profile-service";

export interface ProfileReadinessInput {
  preferenceSetId: string;
  operationId: string;
  traceId: string;
}

export interface ProfileReadinessActivities {
  markRunning(operationId: string): Promise<void>;
  calculateAndPersist(input: ProfileReadinessInput): Promise<void>;
}

export function createProfileReadinessActivities(store: ProfileStore): ProfileReadinessActivities {
  return {
    async markRunning(operationId) {
      await store.markOperationRunning(operationId);
    },
    async calculateAndPersist(input) {
      const preferences = await store.getPreferencesById(input.preferenceSetId);
      if (!preferences) {
        throw new Error(`Preference set ${input.preferenceSetId} was not found`);
      }
      const readiness = calculateProfileReadiness(preferences, new Date());
      await store.completeReadinessOperation(
        input.operationId,
        input.preferenceSetId,
        readiness,
        input.traceId,
      );
    },
  };
}
