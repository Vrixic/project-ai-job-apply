import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import * as addFormatsModule from "ajv-formats";
import type { components, paths } from "../generated/platform.js";
import contract from "../openapi/platform.v1.json" with { type: "json" };

export type ApiComponents = components;
export type ApiPaths = paths;
export type PutJobPreferencesRequest = components["schemas"]["PutJobPreferencesRequest"];
export type JobPreferenceSet = components["schemas"]["JobPreferenceSet"];
export type PutJobPreferencesResponse = components["schemas"]["PutJobPreferencesResponse"];
export type CreateCandidateDataExportRequest =
  components["schemas"]["CreateCandidateDataExportRequest"];
export type CandidateDataExport = components["schemas"]["CandidateDataExport"];
export type CandidateDataExportAccess = components["schemas"]["CandidateDataExportAccess"];
export type CandidateDataExportDownloadGrant =
  components["schemas"]["CandidateDataExportDownloadGrant"];
export type CreateAccountDeletionRequest = components["schemas"]["CreateAccountDeletionRequest"];
export type ConfirmAccountDeletionRequest = components["schemas"]["ConfirmAccountDeletionRequest"];
export type AccountDeletionRequest = components["schemas"]["AccountDeletionRequest"];
export type ProfileReadiness = components["schemas"]["ProfileReadiness"];
export type Operation = components["schemas"]["Operation"];
export type CurrentUser = components["schemas"]["CurrentUser"];
export type ProfileFact = components["schemas"]["ProfileFact"];
export type ProfileFactCollection = components["schemas"]["ProfileFactCollection"];
export type CreateProfileFactRequest = components["schemas"]["CreateProfileFactRequest"];
export type UpdateProfileFactRequest = components["schemas"]["UpdateProfileFactRequest"];
export type CreateResumeUploadRequest = components["schemas"]["CreateResumeUploadRequest"];
export type CreateResumeUploadResponse = components["schemas"]["CreateResumeUploadResponse"];
export type ResumeDocument = components["schemas"]["ResumeDocument"];
export type ResumeDocumentCollection = components["schemas"]["ResumeDocumentCollection"];
export type ResumeUploadGrant = components["schemas"]["ResumeUploadGrant"];
export type JobSearchRequest = components["schemas"]["JobSearchRequest"];
export type JobSearchPage = components["schemas"]["JobSearchPage"];
export type CanonicalJobSummary = components["schemas"]["CanonicalJobSummary"];
export type CanonicalJobDetail = components["schemas"]["CanonicalJobDetail"];
export type PublicJobDetail = components["schemas"]["PublicJobDetail"];
export type PublicJobDetailResponse = components["schemas"]["PublicJobDetailResponse"];
export type PublicJobSitemapItem = components["schemas"]["PublicJobSitemapItem"];
export type PublicJobSitemapFeedResponse = components["schemas"]["PublicJobSitemapFeedResponse"];
export type CreateSavedJobRequest = components["schemas"]["CreateSavedJobRequest"];
export type CreateJobReportRequest = components["schemas"]["CreateJobReportRequest"];
export type JobReport = components["schemas"]["JobReport"];
export type OpenModerationCaseRequest = components["schemas"]["OpenModerationCaseRequest"];
export type ResolveModerationCaseRequest = components["schemas"]["ResolveModerationCaseRequest"];
export type ModerationCaseSearchRequest = components["schemas"]["ModerationCaseSearchRequest"];
export type ModerationCase = components["schemas"]["ModerationCase"];
export type ModerationCasePage = components["schemas"]["ModerationCasePage"];
export type JobReportSummary = components["schemas"]["JobReportSummary"];
export type SavedJobSearchRequest = components["schemas"]["SavedJobSearchRequest"];
export type SavedJob = components["schemas"]["SavedJob"];
export type SavedJobSnapshot = components["schemas"]["SavedJobSnapshot"];
export type SavedJobPage = components["schemas"]["SavedJobPage"];
export type MatchAssessment = components["schemas"]["MatchAssessment"];
export type EntitlementSummary = components["schemas"]["EntitlementSummary"];
export type ProblemDetails = components["schemas"]["ProblemDetails"];

const ajv = new Ajv2020({ allErrors: true, strict: true });
const addFormats = addFormatsModule.default as unknown as (instance: Ajv2020) => Ajv2020;
addFormats(ajv);

const schemas = contract.components.schemas;
const validationSchemas = JSON.parse(
  JSON.stringify(schemas).replaceAll("#/components/schemas/", "#/$defs/"),
) as typeof schemas;

export function compileComponentValidator(name: keyof typeof schemas): ValidateFunction<unknown> {
  return ajv.compile({
    $ref: `#/$defs/${name}`,
    $defs: validationSchemas,
  });
}

export function formatValidationErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
}

export { contract };
