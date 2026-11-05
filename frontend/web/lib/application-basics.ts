import type {
  ProfileEducationEntry,
  ProfilePersonal,
  RestrictedAnswer,
} from "@ai-job-apply/api-contracts";

/** Where in the Profile the candidate completes a missing basic. */
export type BasicsSection = "personal" | "education" | "restricted";

export interface MissingBasic {
  key: string;
  label: string;
  section: BasicsSection;
}

/** The saved answers an application always asks and only the candidate can give. */
export const REQUIRED_RESTRICTED_ANSWERS = [
  {
    key: "authorization.us_authorized",
    label: "Whether you are authorized to work in the United States",
  },
  {
    key: "authorization.sponsorship_required",
    label: "Whether you need visa sponsorship now or later",
  },
] as const;

const filled = (value: string | undefined) => typeof value === "string" && value.trim() !== "";

/**
 * What a candidate must have in their Profile before applying: the basics every application form
 * asks. Nothing is inferred; a missing item is named so the candidate can add it. `restricted` is
 * undefined while the saved-answer vault is not offered, so a basic nobody can give is never required.
 */
export function missingBasics(input: {
  personal: ProfilePersonal | undefined;
  education: readonly ProfileEducationEntry[];
  restricted: readonly RestrictedAnswer[] | undefined;
}): MissingBasic[] {
  const missing: MissingBasic[] = [];
  const words = (input.personal?.fullName ?? "").trim().split(/\s+/u).filter(Boolean);
  if (words.length < 2)
    missing.push({ key: "name", label: "Your first and last name", section: "personal" });
  if (!filled(input.personal?.email))
    missing.push({ key: "email", label: "Your email address", section: "personal" });
  if (!filled(input.personal?.phone))
    missing.push({ key: "phone", label: "Your phone number", section: "personal" });
  if (
    !input.education.some(
      (entry) => filled(entry.school) && filled(entry.degree) && filled(entry.fieldOfStudy),
    )
  )
    missing.push({
      key: "education",
      label: "One education entry with your school, degree and field of study",
      section: "education",
    });
  if (input.restricted) {
    for (const required of REQUIRED_RESTRICTED_ANSWERS) {
      if (
        !input.restricted.some(
          (answer) => answer.fieldKey === required.key && answer.state === "active",
        )
      )
        missing.push({ key: required.key, label: required.label, section: "restricted" });
    }
  }
  return missing;
}
