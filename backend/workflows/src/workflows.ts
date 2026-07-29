import { proxyActivities } from "@temporalio/workflow";
import type { ProfileReadinessActivities, ProfileReadinessInput } from "./activities.js";

const activities = proxyActivities<ProfileReadinessActivities>({
  startToCloseTimeout: "30 seconds",
  retry: {
    initialInterval: "1 second",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
    maximumAttempts: 5,
  },
});

export async function profileReadinessWorkflow(input: ProfileReadinessInput): Promise<void> {
  await activities.markRunning(input.operationId);
  await activities.calculateAndPersist(input);
}
