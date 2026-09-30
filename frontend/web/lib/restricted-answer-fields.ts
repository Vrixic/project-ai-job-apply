import type { SaveRestrictedAnswerRequest } from "@ai-job-apply/api-contracts";

export interface RestrictedAnswerFieldDefinition {
  key: string;
  label: string;
  valueType: SaveRestrictedAnswerRequest["valueType"];
}

/**
 * Candidate-manageable ADR-010 fields from application-fields.v1. Consent artifacts and technical
 * challenges are deliberately absent because they must always be answered fresh.
 */
export const restrictedAnswerFields: readonly RestrictedAnswerFieldDefinition[] = [
  {
    key: "authorization.us_authorized",
    label: "Authorized to work in the United States",
    valueType: "boolean",
  },
  {
    key: "authorization.sponsorship_required",
    label: "Requires current or future sponsorship",
    valueType: "boolean",
  },
  {
    key: "authorization.export_control",
    label: "Export-control eligibility",
    valueType: "enum",
  },
  {
    key: "disclosure.non_compete",
    label: "Non-compete or restrictive covenant",
    valueType: "boolean",
  },
  {
    key: "disclosure.conflict_of_interest",
    label: "Potential conflict of interest",
    valueType: "boolean",
  },
  { key: "demographic.gender", label: "Voluntary gender disclosure", valueType: "enum" },
  {
    key: "demographic.race_ethnicity",
    label: "Voluntary race or ethnicity disclosure",
    valueType: "enum",
  },
  { key: "demographic.veteran", label: "Voluntary veteran disclosure", valueType: "enum" },
  {
    key: "demographic.disability",
    label: "Voluntary disability disclosure",
    valueType: "enum",
  },
] as const;

const restrictedAnswerFieldsByKey = new Map(
  restrictedAnswerFields.map((definition) => [definition.key, definition]),
);

export function restrictedAnswerField(key: string): RestrictedAnswerFieldDefinition | undefined {
  return restrictedAnswerFieldsByKey.get(key);
}

export function restrictedAnswerContext(searchParams: URLSearchParams): string | undefined | null {
  const entries = [...searchParams.entries()];
  if (entries.length === 0) return undefined;
  if (entries.length !== 1 || entries[0]?.[0] !== "context") return null;
  const value = entries[0]?.[1] ?? "";
  return value.length >= 1 &&
    value.length <= 120 &&
    /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(value)
    ? value
    : null;
}

export function isRestrictedAnswerVaultUiEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.NEXT_PUBLIC_RESTRICTED_ANSWER_VAULT_UI === "enabled";
}
