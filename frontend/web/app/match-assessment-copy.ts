import type { MatchAssessment } from "@ai-job-apply/api-contracts";

type MatchReasonCode = MatchAssessment["evidence"][number]["reasonCode"];
type MatchGate = MatchAssessment["gate"];

export const matchEvidenceCopy: Readonly<Record<MatchReasonCode, string>> = Object.freeze({
  work_mode_selected: "The job’s stated work mode is one you selected.",
  work_mode_conflict: "The job’s stated work mode conflicts with your selections.",
  work_mode_unavailable: "The job does not provide a usable work-mode value.",
  employment_type_selected: "The job’s stated employment type is one you selected.",
  employment_type_conflict: "The job’s stated employment type conflicts with your selections.",
  employment_type_unavailable: "The job does not provide a usable employment-type value.",
  target_role_exact_overlap: "The normalized job title exactly overlaps a target role.",
  target_role_not_established: "A target-role match is not established.",
  location_exact_overlap: "A normalized job location exactly overlaps a preferred location.",
  location_not_established: "A location match is not established.",
  compensation_semantics_unavailable:
    "Compensation cannot be compared because cadence and base-versus-total meaning are unavailable.",
  authorization_sponsorship_unavailable:
    "Authorization and sponsorship are not assessed in this general-preferences boundary.",
  seniority_semantics_unavailable: "Seniority is not yet represented by a comparable taxonomy.",
  blocked_company_preferences_unavailable: "Blocked-company preferences are not available.",
  qualification_evidence_unavailable: "Qualification evidence is not assessed by this baseline.",
});

export const matchGateCopy: Readonly<
  Record<MatchGate, Readonly<{ heading: string; summary: string }>>
> = Object.freeze({
  excluded: Object.freeze({
    heading: "Known preference conflict",
    summary: "At least one exact stated job attribute conflicts with your saved preferences.",
  }),
  review_required: Object.freeze({
    heading: "Review the available evidence",
    summary: "No exact hard conflict was found in the currently comparable attributes.",
  }),
});

export const matchAssessmentNonclaim =
  "This is deterministic evidence, not a score, eligibility decision, ranking, or application outcome. Unknown evidence never counts as a conflict.";
