import type {
  Operation,
  ProfileReadiness,
  PutJobPreferencesRequest,
} from "@ai-job-apply/api-contracts";

export type UserId = string & { readonly __brand: "UserId" };
export type PreferenceSetId = string & { readonly __brand: "PreferenceSetId" };
export type OperationId = string & { readonly __brand: "OperationId" };

export interface ExternalIdentity {
  issuer: string;
  subject: string;
  email?: string;
}

export function calculateProfileReadiness(
  preferences: PutJobPreferencesRequest,
  now: Date,
): ProfileReadiness {
  const missingFields: ProfileReadiness["missingFields"] = [];
  if (preferences.locations.length === 0) {
    missingFields.push("locations");
  }
  if (preferences.salaryMinimum === undefined) {
    missingFields.push("salary");
  }

  const requiredSignals = 6;
  const presentSignals =
    4 + Number(preferences.locations.length > 0) + Number(preferences.salaryMinimum !== undefined);

  return {
    completionPercent: Math.round((presentSignals / requiredSignals) * 100),
    missingFields,
    calculatedAt: now.toISOString(),
  };
}

export function isTerminalOperation(state: Operation["state"]): boolean {
  return state === "succeeded" || state === "failed";
}
