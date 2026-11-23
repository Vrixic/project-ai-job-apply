/**
 * The recurring application questions a candidate answers once in their Profile (ADR-062, amended
 * 2026-11-23): work authorization and eligibility on the Screening tab, voluntary self-identification
 * on the Equal employment tab. Each is a fixed choice (Yes/No, a list, or countries), saved as an
 * ordinary saved answer under the exact question text below, so the web app, the Gateway and the
 * planner read the same thing. Nothing here is inferred: an unanswered question has no value.
 *
 * The two United States questions keep the wording candidates have already saved them under.
 */

export type ProfileQuestionKind = "yes_no" | "choice" | "countries";
export type ProfileQuestionGroup = "screening" | "equal_employment";

export interface ProfileQuestion {
  fieldKey: string;
  question: string;
  /** Short text for the Profile form. */
  label: string;
  kind: ProfileQuestionKind;
  group: ProfileQuestionGroup;
  options?: readonly string[];
  /** Asked before Apply. Self-identification never is. */
  required?: true;
  help?: string;
}

export const PREFER_NOT_TO_SAY = "I prefer not to say";

export const PROFILE_QUESTIONS: readonly ProfileQuestion[] = [
  {
    fieldKey: "authorization.us_authorized",
    question: "Are you legally authorized to work in the United States?",
    label: "Are you legally authorized to work in the United States?",
    kind: "yes_no",
    group: "screening",
    required: true,
  },
  {
    fieldKey: "authorization.sponsorship_required",
    question:
      "Will you now or in the future require visa sponsorship to work in the United States?",
    label: "Will you now or in the future require visa sponsorship to work in the United States?",
    kind: "yes_no",
    group: "screening",
    required: true,
  },
  {
    fieldKey: "authorization.work_countries",
    question: "In which countries can you work without visa sponsorship? (ApplyDash profile)",
    label: "Countries where you can work without visa sponsorship",
    kind: "countries",
    group: "screening",
    required: true,
  },
  {
    fieldKey: "authorization.citizenship",
    question: "What are your countries of citizenship? (ApplyDash profile)",
    label: "Countries of citizenship",
    kind: "countries",
    group: "screening",
  },
  {
    fieldKey: "eligibility.age_18_or_over",
    question: "Are you 18 years of age or older? (ApplyDash profile)",
    label: "Are you 18 years of age or older?",
    kind: "yes_no",
    group: "screening",
  },
  {
    fieldKey: "disclosure.security_clearance",
    question: "What security clearance do you hold? (ApplyDash profile)",
    label: "Active security clearance",
    kind: "choice",
    group: "screening",
    options: ["None", "Confidential", "Secret", "Top Secret", "Top Secret/SCI", "Other"],
  },
  {
    fieldKey: "demographic.gender",
    question: "What is your gender? (ApplyDash profile)",
    label: "Gender",
    kind: "choice",
    group: "equal_employment",
    options: ["Man", "Woman", "Non-binary", "Another gender identity", PREFER_NOT_TO_SAY],
  },
  {
    fieldKey: "demographic.race_ethnicity",
    question: "What is your race or ethnicity? (ApplyDash profile)",
    label: "Race or ethnicity",
    kind: "choice",
    group: "equal_employment",
    options: [
      "American Indian or Alaska Native",
      "Asian",
      "Black or African American",
      "Hispanic or Latino",
      "Middle Eastern or North African",
      "Native Hawaiian or Other Pacific Islander",
      "White",
      "Two or more races",
      PREFER_NOT_TO_SAY,
    ],
  },
  {
    fieldKey: "demographic.hispanic_latino",
    question: "Are you Hispanic or Latino? (ApplyDash profile)",
    label: "Hispanic or Latino",
    kind: "choice",
    group: "equal_employment",
    options: ["Yes", "No", PREFER_NOT_TO_SAY],
  },
  {
    fieldKey: "demographic.veteran",
    question: "What is your veteran status? (ApplyDash profile)",
    label: "Veteran status",
    kind: "choice",
    group: "equal_employment",
    options: ["I am a protected veteran", "I am not a protected veteran", PREFER_NOT_TO_SAY],
  },
  {
    fieldKey: "demographic.disability",
    question: "What is your disability status? (ApplyDash profile)",
    label: "Disability status",
    kind: "choice",
    group: "equal_employment",
    options: [
      "Yes, I have a disability (or previously had one)",
      "No, I do not have a disability",
      PREFER_NOT_TO_SAY,
    ],
  },
  {
    fieldKey: "demographic.sexual_orientation",
    question: "What is your sexual orientation? (ApplyDash profile)",
    label: "Sexual orientation",
    kind: "choice",
    group: "equal_employment",
    options: [
      "Heterosexual or straight",
      "Gay or lesbian",
      "Bisexual",
      "Queer",
      "Asexual",
      "Another sexual orientation",
      PREFER_NOT_TO_SAY,
    ],
  },
  {
    fieldKey: "demographic.transgender",
    question: "Do you identify as transgender? (ApplyDash profile)",
    label: "Transgender",
    kind: "choice",
    group: "equal_employment",
    options: ["Yes", "No", PREFER_NOT_TO_SAY],
  },
];

const normalize = (text: string) => text.trim().replace(/\s+/gu, " ").toLowerCase();

const byQuestion = new Map(PROFILE_QUESTIONS.map((item) => [normalize(item.question), item]));
const byFieldKey = new Map(PROFILE_QUESTIONS.map((item) => [item.fieldKey, item]));

/** The Profile question a saved answer was saved under, if it is one. */
export function profileQuestionFor(question: string): ProfileQuestion | undefined {
  return byQuestion.get(normalize(question));
}

export function profileQuestionByFieldKey(fieldKey: string): ProfileQuestion | undefined {
  return byFieldKey.get(fieldKey);
}

/** Two-letter country codes as "US, CA"; undefined when any part is not one, or there are none. */
export function formatCountryCodes(codes: readonly string[]): string | undefined {
  const clean = [...new Set(codes.map((code) => code.trim().toUpperCase()))].filter(Boolean);
  if (!clean.length || clean.length > 30 || clean.some((code) => !/^[A-Z]{2}$/u.test(code)))
    return undefined;
  return clean.join(", ");
}

/** "US, CA" as ["US", "CA"]; an empty list when the text is not a country list. */
export function parseCountryCodes(text: string | undefined): string[] {
  const formatted = formatCountryCodes((text ?? "").split(/[\s,;]+/u));
  return formatted ? formatted.split(", ") : [];
}

/**
 * The value a saved answer gives its question: a boolean for Yes/No, the chosen option, or the
 * countries as "US, CA". Anything that is not one of the question's answers has no value.
 */
export function profileQuestionValue(
  item: ProfileQuestion,
  answer: string | undefined,
): boolean | string | undefined {
  const text = answer?.trim() ?? "";
  if (item.kind === "yes_no") {
    const lower = text.toLowerCase();
    return lower === "yes" ? true : lower === "no" ? false : undefined;
  }
  if (item.kind === "countries") return formatCountryCodes(text.split(/[\s,;]+/u));
  return item.options?.find((option) => option === text);
}

/** The candidate's answered Profile questions, keyed by field. */
export function profileQuestionAnswers(
  saved: ReadonlyArray<{ question: string; answer: string }>,
): Record<string, boolean | string> {
  const answers: Record<string, boolean | string> = {};
  for (const entry of saved) {
    const item = profileQuestionFor(entry.question);
    if (!item) continue;
    const value = profileQuestionValue(item, entry.answer);
    if (value !== undefined) answers[item.fieldKey] = value;
  }
  return answers;
}
