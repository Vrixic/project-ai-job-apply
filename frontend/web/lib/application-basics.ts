import type { ProfileEducationEntry, ProfilePersonal } from "@ai-job-apply/api-contracts";
import { SCREENING_QUESTIONS, type ScreeningFieldKey } from "./screening-questions";

/** The Profile tab where the candidate completes a missing basic. */
export type BasicsSection = "personal" | "education" | "screening";

export interface MissingBasic {
  key: string;
  label: string;
  section: BasicsSection;
}

const filled = (value: string | undefined) => typeof value === "string" && value.trim() !== "";

/**
 * What a candidate must have in their Profile before applying: the basics and screening answers every
 * application asks. Nothing is inferred; a missing item is named so the candidate can add it. An
 * application uses the first saved education entry, so that is the one that has to be complete.
 */
export function missingBasics(input: {
  personal: ProfilePersonal | undefined;
  education: readonly ProfileEducationEntry[];
  screening: Partial<Record<ScreeningFieldKey, boolean>>;
}): MissingBasic[] {
  const missing: MissingBasic[] = [];
  const words = (input.personal?.fullName ?? "").trim().split(/\s+/u).filter(Boolean);
  if (words.length < 2)
    missing.push({ key: "name", label: "Your first and last name", section: "personal" });
  if (!filled(input.personal?.email))
    missing.push({ key: "email", label: "Your email address", section: "personal" });
  if (!filled(input.personal?.phone))
    missing.push({ key: "phone", label: "Your phone number", section: "personal" });
  const first = [...input.education].sort((a, b) => a.displayOrder - b.displayOrder)[0];
  if (!first || !filled(first.school) || !filled(first.degree) || !filled(first.fieldOfStudy))
    missing.push({
      key: "education",
      label: "Your first education entry with its school, degree and field of study",
      section: "education",
    });
  for (const item of SCREENING_QUESTIONS) {
    if (input.screening[item.fieldKey] === undefined)
      missing.push({ key: item.fieldKey, label: item.question, section: "screening" });
  }
  return missing;
}
