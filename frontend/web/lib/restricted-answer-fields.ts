import type { SaveRestrictedAnswerRequest } from "@ai-job-apply/api-contracts";

export interface RestrictedAnswerFieldDefinition {
  key: string;
  label: string;
  valueType: SaveRestrictedAnswerRequest["valueType"];
  /** Where the question is listed. */
  group: "Work authorization" | "Eligibility and disclosures" | "Voluntary self-identification";
  /** Fixed answers to choose from; the saved value is the chosen text. */
  options?: readonly string[];
  /** Two-letter country codes, saved as "US, CA". */
  countries?: true;
}

const PREFER_NOT = "I prefer not to say";

/**
 * Candidate-manageable restricted fields from application-fields.v1 (ADR-010, ADR-062). Consent
 * artifacts and technical challenges are deliberately absent because they must always be answered
 * fresh. Self-identification is voluntary: every option list includes "I prefer not to say", and
 * nothing here is required.
 */
export const restrictedAnswerFields: readonly RestrictedAnswerFieldDefinition[] = [
  {
    key: "authorization.work_countries",
    label: "Countries where you can work without sponsorship",
    valueType: "string",
    group: "Work authorization",
    countries: true,
  },
  {
    key: "authorization.sponsorship_required",
    label: "Need visa sponsorship now or in the future",
    valueType: "boolean",
    group: "Work authorization",
  },
  {
    key: "authorization.us_authorized",
    label: "Authorized to work in the United States",
    valueType: "boolean",
    group: "Work authorization",
  },
  {
    key: "authorization.citizenship",
    label: "Countries of citizenship",
    valueType: "string",
    group: "Work authorization",
    countries: true,
  },
  {
    key: "authorization.export_control",
    label: "Export-control status",
    valueType: "enum",
    group: "Work authorization",
  },
  {
    key: "disclosure.security_clearance",
    label: "Security clearance",
    valueType: "enum",
    group: "Eligibility and disclosures",
    options: ["None", "Confidential", "Secret", "Top Secret", "Top Secret/SCI", "Other"],
  },
  {
    key: "eligibility.age_18_or_over",
    label: "18 years or older",
    valueType: "boolean",
    group: "Eligibility and disclosures",
  },
  {
    key: "disclosure.non_compete",
    label: "Bound by a non-compete or similar agreement",
    valueType: "boolean",
    group: "Eligibility and disclosures",
  },
  {
    key: "disclosure.conflict_of_interest",
    label: "Potential conflict of interest",
    valueType: "boolean",
    group: "Eligibility and disclosures",
  },
  {
    key: "demographic.gender",
    label: "Gender",
    valueType: "enum",
    group: "Voluntary self-identification",
    options: ["Man", "Woman", "Non-binary", "Another gender identity", PREFER_NOT],
  },
  {
    key: "demographic.race_ethnicity",
    label: "Race or ethnicity",
    valueType: "enum",
    group: "Voluntary self-identification",
    options: [
      "American Indian or Alaska Native",
      "Asian",
      "Black or African American",
      "Hispanic or Latino",
      "Middle Eastern or North African",
      "Native Hawaiian or Other Pacific Islander",
      "White",
      "Two or more races",
      PREFER_NOT,
    ],
  },
  {
    key: "demographic.hispanic_latino",
    label: "Hispanic or Latino",
    valueType: "enum",
    group: "Voluntary self-identification",
    options: ["Yes", "No", PREFER_NOT],
  },
  {
    key: "demographic.veteran",
    label: "Veteran status",
    valueType: "enum",
    group: "Voluntary self-identification",
    options: ["I am a protected veteran", "I am not a protected veteran", PREFER_NOT],
  },
  {
    key: "demographic.disability",
    label: "Disability status",
    valueType: "enum",
    group: "Voluntary self-identification",
    options: [
      "Yes, I have a disability (or previously had one)",
      "No, I do not have a disability",
      PREFER_NOT,
    ],
  },
  {
    key: "demographic.sexual_orientation",
    label: "Sexual orientation",
    valueType: "enum",
    group: "Voluntary self-identification",
    options: [
      "Heterosexual or straight",
      "Gay or lesbian",
      "Bisexual",
      "Queer",
      "Asexual",
      "Another sexual orientation",
      PREFER_NOT,
    ],
  },
  {
    key: "demographic.transgender",
    label: "Transgender",
    valueType: "enum",
    group: "Voluntary self-identification",
    options: ["Yes", "No", PREFER_NOT],
  },
] as const;

/** "us, ca" or "US CA" as "US, CA", or undefined when any part is not a two-letter code. */
export function normalizeCountryList(value: string): string | undefined {
  const codes = value
    .split(/[\s,;]+/u)
    .map((part) => part.trim().toUpperCase())
    .filter((part) => part.length > 0);
  if (codes.length === 0 || codes.length > 30 || codes.some((code) => !/^[A-Z]{2}$/u.test(code)))
    return undefined;
  return [...new Set(codes)].join(", ");
}

const restrictedAnswerFieldsByKey = new Map(
  restrictedAnswerFields.map((definition) => [definition.key, definition]),
);

export function restrictedAnswerField(key: string): RestrictedAnswerFieldDefinition | undefined {
  return restrictedAnswerFieldsByKey.get(key);
}

export function isCanonicalRestrictedAnswerContext(value: string): boolean {
  if (value.length < 1 || value.length > 120) return false;

  let atSegmentStart = true;
  for (const character of value) {
    if (character === ".") {
      if (atSegmentStart) return false;
      atSegmentStart = true;
      continue;
    }

    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) return false;
    const isLowercaseLetter = codePoint >= 97 && codePoint <= 122;
    if (atSegmentStart) {
      if (!isLowercaseLetter) return false;
      atSegmentStart = false;
      continue;
    }

    const isDigit = codePoint >= 48 && codePoint <= 57;
    if (!isLowercaseLetter && !isDigit && character !== "_") return false;
  }

  return !atSegmentStart;
}

export function restrictedAnswerContext(searchParams: URLSearchParams): string | undefined | null {
  const entries = [...searchParams.entries()];
  if (entries.length === 0) return undefined;
  if (entries.length !== 1 || entries[0]?.[0] !== "context") return null;
  const value = entries[0]?.[1] ?? "";
  return isCanonicalRestrictedAnswerContext(value) ? value : null;
}

export function isRestrictedAnswerVaultUiEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.NEXT_PUBLIC_RESTRICTED_ANSWER_VAULT_UI === "enabled";
}
