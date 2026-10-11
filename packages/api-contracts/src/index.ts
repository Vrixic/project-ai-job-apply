import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import * as addFormatsModule from "ajv-formats";
import type { components, paths } from "../generated/platform.js";
import contract from "../openapi/platform.v1.json" with { type: "json" };

export {
  COVER_LETTER_DISCLOSURE_TEXT,
  COVER_LETTER_DISCLOSURE_VERSION,
} from "./cover-letter-disclosure.js";

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
export type CoverLetterDisclosureAcknowledgement =
  components["schemas"]["CoverLetterDisclosureAcknowledgement"];
export type RequestedApplicationCoverLetter =
  components["schemas"]["RequestedApplicationCoverLetter"];
export type ApplicationPacketPreparation = components["schemas"]["ApplicationPacketPreparation"];
export type ApplicationCoverLetterPreview = components["schemas"]["ApplicationCoverLetterPreview"];
export type ApplicationCoverLetterFile = components["schemas"]["ApplicationCoverLetterFile"];
export type ApplicationTemporaryMaterialAuthorization =
  components["schemas"]["ApplicationTemporaryMaterialAuthorization"];
export type ApplicationTemporaryMaterialLocation =
  components["schemas"]["ApplicationTemporaryMaterialLocation"];
export type ApplicationTemporaryMaterial = components["schemas"]["ApplicationTemporaryMaterial"];
export type ApplicationNativeTransferBegin =
  components["schemas"]["ApplicationNativeTransferBegin"];
export type ApplicationNativeTransferAdmission =
  components["schemas"]["ApplicationNativeTransferAdmission"];
export type ApplicationNativeTransferCommit =
  components["schemas"]["ApplicationNativeTransferCommit"];
export type ApplicationNativeTransferReceipt =
  components["schemas"]["ApplicationNativeTransferReceipt"];
export type ApplicationNativeTransferDiscard =
  components["schemas"]["ApplicationNativeTransferDiscard"];
export type ApplicationNativeTransferCancel =
  components["schemas"]["ApplicationNativeTransferCancel"];
export type CurrentUser = components["schemas"]["CurrentUser"];
export type ProfileFact = components["schemas"]["ProfileFact"];
export type ProfileFactCollection = components["schemas"]["ProfileFactCollection"];
export type CreateProfileFactRequest = components["schemas"]["CreateProfileFactRequest"];
export type UpdateProfileFactRequest = components["schemas"]["UpdateProfileFactRequest"];
export type RestrictedAnswer = components["schemas"]["RestrictedAnswer"];
export type RestrictedAnswerCollection = components["schemas"]["RestrictedAnswerCollection"];
export type SaveRestrictedAnswerRequest = components["schemas"]["SaveRestrictedAnswerRequest"];
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
export type CreatePrivateSavedPageCaptureRequest =
  components["schemas"]["CreatePrivateSavedPageCaptureRequest"];
export type PrivateSavedPageCapture = components["schemas"]["PrivateSavedPageCapture"];
export type PrivateSavedPageCaptureSource = components["schemas"]["PrivateSavedPageCaptureSource"];
export type PrivateSavedPageCaptureSnapshot =
  components["schemas"]["PrivateSavedPageCaptureSnapshot"];
export type PrivateSavedPageCaptureResolution =
  components["schemas"]["PrivateSavedPageCaptureResolution"];
export type CreateJobReportRequest = components["schemas"]["CreateJobReportRequest"];
export type CreateJobContributionRequest = components["schemas"]["CreateJobContributionRequest"];
export type JobContribution = components["schemas"]["JobContribution"];
export type JobContributionHistory = components["schemas"]["JobContributionHistory"];
export type CancelJobContributionRequest = components["schemas"]["CancelJobContributionRequest"];
export type ContributionCapabilityPolicy = components["schemas"]["ContributionCapabilityPolicy"];
export type SignedContributionCapabilityPolicy =
  components["schemas"]["SignedContributionCapabilityPolicy"];
export type OwnerTrustCase = components["schemas"]["OwnerTrustCase"];
export type ReviewerTrustCase = components["schemas"]["ReviewerTrustCase"];
export type ReviewerTrustCaseQueueRequest = components["schemas"]["ReviewerTrustCaseQueueRequest"];
export type ReviewerTrustCasePage = components["schemas"]["ReviewerTrustCasePage"];
export type IndependentJobReviewEvidence = components["schemas"]["IndependentJobReviewEvidence"];
export type ReviewerTrustEvidence = components["schemas"]["ReviewerTrustEvidence"];
export type WithdrawTrustContributionRequest =
  components["schemas"]["WithdrawTrustContributionRequest"];
export type FileTrustAppealRequest = components["schemas"]["FileTrustAppealRequest"];
export type OpenTrustCaseRequest = components["schemas"]["OpenTrustCaseRequest"];
export type DecideTrustCaseRequest = components["schemas"]["DecideTrustCaseRequest"];
export type TakeDownTrustCaseRequest = components["schemas"]["TakeDownTrustCaseRequest"];
export type ResolveTrustAppealRequest = components["schemas"]["ResolveTrustAppealRequest"];
export type GrantUgcContributionConsentRequest =
  components["schemas"]["GrantUgcContributionConsentRequest"];
export type UgcContributionConsentGrant = components["schemas"]["UgcContributionConsentGrant"];
export type RevokeUgcContributionConsentRequest =
  components["schemas"]["RevokeUgcContributionConsentRequest"];
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
export type ApplicationStatus = components["schemas"]["ApplicationStatus"];
export type ApplicationCurrentAction = components["schemas"]["ApplicationCurrentAction"];
export type ApplicationPacketField = components["schemas"]["ApplicationPacketField"];
export type ApplicationFormBinding = components["schemas"]["ApplicationFormBinding"];
export type ApplicationPacket = components["schemas"]["ApplicationPacket"];
export type ApplicationApproval = components["schemas"]["ApplicationApproval"];
export type ApplicationAttempt = components["schemas"]["ApplicationAttempt"];
export type ApplicationExecutionInspect = components["schemas"]["ApplicationExecutionInspect"];
export type ApplicationExecutionInspection =
  components["schemas"]["ApplicationExecutionInspection"];
export type ApplicationExecutionCommand = components["schemas"]["ApplicationExecutionCommand"];
export type ApplicationExecutionProof = components["schemas"]["ApplicationExecutionProof"];
export type ApplicationExecutionProofResult =
  components["schemas"]["ApplicationExecutionProofResult"];
export type ApplicationExecutionResult = components["schemas"]["ApplicationExecutionResult"];
export type ApplicationExecutionCancel = components["schemas"]["ApplicationExecutionCancel"];
export type Application = components["schemas"]["Application"];
export type ApplicationPage = components["schemas"]["ApplicationPage"];
export type ApplicationHistoryEntry = components["schemas"]["ApplicationHistoryEntry"];
export type ApplicationHistoryPage = components["schemas"]["ApplicationHistoryPage"];
export type ApplicationResumeBullet = components["schemas"]["ApplicationResumeBullet"];
export type ApplicationResumeEntry = components["schemas"]["ApplicationResumeEntry"];
export type ApplicationResumeSection = components["schemas"]["ApplicationResumeSection"];
export type ApplicationResumePreview = components["schemas"]["ApplicationResumePreview"];
export type ApplicationResumeFile = components["schemas"]["ApplicationResumeFile"];
export type CreateApplicationRequest = components["schemas"]["CreateApplicationRequest"];
export type ApplicationSearchRequest = components["schemas"]["ApplicationSearchRequest"];
export type PrepareApplicationPacketRequest =
  components["schemas"]["PrepareApplicationPacketRequest"];
export type ApproveApplicationPacketRequest =
  components["schemas"]["ApproveApplicationPacketRequest"];
export type ApplicationRevisionRequest = components["schemas"]["ApplicationRevisionRequest"];
export type StartApplicationSubmissionRequest =
  components["schemas"]["StartApplicationSubmissionRequest"];
export type StartManualApplicationSubmissionRequest =
  components["schemas"]["StartManualApplicationSubmissionRequest"];
export type ApplicationSubmissionStart = components["schemas"]["ApplicationSubmissionStart"];
export type ApplicationSubmissionResultRequest =
  components["schemas"]["ApplicationSubmissionResultRequest"];
export type ReconcileApplicationAttemptRequest =
  components["schemas"]["ReconcileApplicationAttemptRequest"];
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

export type NativeMaterialWithdrawal = components["schemas"]["NativeMaterialWithdrawal"];
