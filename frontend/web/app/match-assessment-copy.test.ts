import { describe, expect, it } from "vitest";
import { matchAssessmentNonclaim, matchEvidenceCopy, matchGateCopy } from "./match-assessment-copy";

describe("match-assessment fixed copy", () => {
  it("maps every reason code to exact static candidate-facing text", () => {
    expect(matchEvidenceCopy).toEqual({
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
      qualification_evidence_unavailable:
        "Qualification evidence is not assessed by this baseline.",
    });
    expect(Object.keys(matchEvidenceCopy)).toHaveLength(15);
  });

  it("keeps both gate summaries conservative and the nonclaim explicit", () => {
    expect(matchGateCopy).toEqual({
      excluded: {
        heading: "Known preference conflict",
        summary: "At least one exact stated job attribute conflicts with your saved preferences.",
      },
      review_required: {
        heading: "Review the available evidence",
        summary: "No exact hard conflict was found in the currently comparable attributes.",
      },
    });
    expect(matchAssessmentNonclaim).toBe(
      "This is deterministic evidence, not a score, eligibility decision, ranking, or application outcome. Unknown evidence never counts as a conflict.",
    );
    expect(
      JSON.stringify({ matchEvidenceCopy, matchGateCopy, matchAssessmentNonclaim }),
    ).not.toMatch(/\b\d+%|strong match|hiring probability|qualified for|will receive\b/i);
  });
});
