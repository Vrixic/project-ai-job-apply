import type {
  Operation,
  ProfileReadiness,
  PutJobPreferencesRequest,
} from "@ai-job-apply/api-contracts";

export * from "./answer-vault.js";
export {
  restrictedAnswerExportFieldKeys,
  validateCandidateDataExportV1,
} from "./candidate-data-export.js";
export * from "./fact-graph.js";
export * from "./temporary-material.js";

export type UserId = string & { readonly __brand: "UserId" };
export type PreferenceSetId = string & { readonly __brand: "PreferenceSetId" };
export type OperationId = string & { readonly __brand: "OperationId" };
export type EntitlementPlan = "free" | "pro";

interface EntitlementAccountBaseV1 {
  schemaVersion: 1;
  id: string;
  userId: string;
  version: number;
  effectiveAt: string;
}

export type EntitlementAccountV1 = EntitlementAccountBaseV1 &
  (
    | { plan: "free"; accessThrough?: never; graceThrough?: never }
    | { plan: "pro"; accessThrough: string; graceThrough?: string }
  );

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
