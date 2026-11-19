import type { ProfileEducationEntry, ProfilePersonal } from "@ai-job-apply/api-contracts";
import { SCREENING_QUESTIONS, type ScreeningFieldKey } from "./screening-questions";

/** The Profile tab where the candidate completes a missing basic. */
export type BasicsSection =
  | "personal"
  | "education"
  | "screening"
  | "salary"
  | "workExperience"
  | "preferences"
  | "sensitive";

/** The saved Job preferences an application reads (ADR-062); null when none are saved. */
export interface BasicsPreferences {
  relocation?: boolean | undefined;
  noticePeriod?: string | undefined;
  availableStartDate?: string | undefined;
}

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
  /** Off until the Profile service accepts the screening questions as saved answers. */
  requireScreening?: boolean;
  /** The annual salary the candidate set, or undefined when none is saved. */
  salary: number | undefined;
  /** Saved work-experience entries; years of experience come from them (ADR-062). */
  workExperienceCount?: number;
  /** The saved Job preferences, or null when none are saved. Undefined skips these checks. */
  preferences?: BasicsPreferences | null;
  /** Which sensitive answers are saved; undefined while the Sensitive answers tab is off. */
  sensitive?: { workCountries: boolean; sponsorship: boolean };
}): MissingBasic[] {
  const missing: MissingBasic[] = [];
  const words = (input.personal?.fullName ?? "").trim().split(/\s+/u).filter(Boolean);
  if (words.length < 2)
    missing.push({ key: "name", label: "Your first and last name", section: "personal" });
  if (!filled(input.personal?.email))
    missing.push({ key: "email", label: "Your email address", section: "personal" });
  if (!filled(input.personal?.phone))
    missing.push({ key: "phone", label: "Your phone number", section: "personal" });
  if (!filled(input.personal?.address?.country))
    missing.push({ key: "country", label: "Your country of residence", section: "personal" });
  const first = [...input.education].sort((a, b) => a.displayOrder - b.displayOrder)[0];
  if (!first || !filled(first.school) || !filled(first.degree) || !filled(first.fieldOfStudy))
    missing.push({
      key: "education",
      label: "Your first education entry with its school, degree and field of study",
      section: "education",
    });
  // Every salary question is answered from it, so an application waits for it.
  if (input.salary === undefined)
    missing.push({ key: "salary", label: "Your desired annual salary", section: "salary" });
  for (const item of SCREENING_QUESTIONS) {
    if (input.requireScreening === true && input.screening[item.fieldKey] === undefined)
      missing.push({ key: item.fieldKey, label: item.question, section: "screening" });
  }
  // ADR-062: what most applications ask that only the candidate can say.
  if (input.workExperienceCount !== undefined && input.workExperienceCount < 1)
    missing.push({
      key: "workExperience",
      label: "At least one job in your work experience",
      section: "workExperience",
    });
  if (input.preferences === null)
    missing.push({
      key: "preferences",
      label: "Your job preferences, including relocation and your earliest start date",
      section: "preferences",
    });
  else if (input.preferences) {
    if (typeof input.preferences.relocation !== "boolean")
      missing.push({
        key: "relocation",
        label: "Whether you are open to relocation",
        section: "preferences",
      });
    if (!filled(input.preferences.availableStartDate) && !filled(input.preferences.noticePeriod))
      missing.push({
        key: "start",
        label: "Your earliest start date or notice period",
        section: "preferences",
      });
  }
  if (input.sensitive) {
    if (!input.sensitive.workCountries)
      missing.push({
        key: "authorization.work_countries",
        label: "The countries where you can work without sponsorship",
        section: "sensitive",
      });
    // Answered either as a screening question or as a sensitive answer.
    if (
      !input.sensitive.sponsorship &&
      input.screening["authorization.sponsorship_required"] === undefined &&
      input.requireScreening !== true
    )
      missing.push({
        key: "authorization.sponsorship_required",
        label: "Whether you need visa sponsorship now or in the future",
        section: "sensitive",
      });
  }
  return missing;
}
