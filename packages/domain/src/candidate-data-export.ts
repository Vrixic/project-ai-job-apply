import { Ajv2020 } from "ajv/dist/2020.js";
import * as addFormatsModule from "ajv-formats";
import schema from "../schemas/v1/candidate-data-export.schema.json" with { type: "json" };

const ajv = new Ajv2020({ strict: true });
const addFormats = addFormatsModule.default as unknown as (instance: Ajv2020) => Ajv2020;
addFormats(ajv);
const validate = ajv.compile(schema);
const exportSections = [
  "candidate",
  "profile",
  "documents",
  "jobs",
  "matching",
  "billing",
  "trust",
  "applications",
  "audit",
] as const;
const sectionValidators = exportSections.map((section) => {
  const validateSection = ajv.getSchema(`${schema.$id}#/properties/${section}`);
  if (!validateSection) throw new Error("CandidateExportSectionSchemaUnavailable");
  return { section, validate: validateSection };
});
const trustedSchemaPaths = new Set<string>();
function collectSchemaPaths(value: unknown, path = "#"): void {
  trustedSchemaPaths.add(path);
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    collectSchemaPaths(child, `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`);
  }
}
collectSchemaPaths(schema);
// Ajv's separately compiled local references report paths relative to their definition root.
for (const definition of Object.values(schema.$defs)) collectSchemaPaths(definition);
for (const section of exportSections) collectSchemaPaths(schema.properties[section]);
const diagnosticKeywords = new Set([
  "additionalProperties",
  "allOf",
  "anyOf",
  "const",
  "dependentRequired",
  "enum",
  "false schema",
  "format",
  "if",
  "maxItems",
  "maxLength",
  "maximum",
  "minItems",
  "minLength",
  "minimum",
  "oneOf",
  "pattern",
  "required",
  "type",
  "uniqueItems",
]);
export interface CandidateDataExportValidationIssue {
  readonly section: "root" | (typeof exportSections)[number];
  readonly schemaPath: string;
  readonly keyword: string;
}

/** The same established restricted/never_infer fields offered by candidate vault settings. */
export const restrictedAnswerExportFieldKeys: readonly string[] = [
  "authorization.us_authorized",
  "authorization.sponsorship_required",
  "authorization.export_control",
  "disclosure.non_compete",
  "disclosure.conflict_of_interest",
  "demographic.gender",
  "demographic.race_ethnicity",
  "demographic.veteran",
  "demographic.disability",
];

/** Validates the exact portable export at the final pre-artifact boundary. */
export function validateCandidateDataExportV1(value: unknown): boolean {
  return validate(value);
}

/** Returns only a bounded location in the trusted schema, never candidate paths or Ajv details. */
export function candidateDataExportValidationIssue(
  value: unknown,
): CandidateDataExportValidationIssue | undefined {
  if (validate(value)) return undefined;
  const rootIssue = trustedValidationIssue("root", validate.errors);
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    for (const { section, validate: validateSection } of sectionValidators) {
      // Optional legacy sections may be absent; the whole-envelope validator owns required fields.
      if (
        Object.hasOwn(value, section) &&
        !validateSection((value as Record<string, unknown>)[section])
      )
        return trustedValidationIssue(section, validateSection.errors);
    }
  }
  return rootIssue;
}

function trustedValidationIssue(
  section: CandidateDataExportValidationIssue["section"],
  errors: readonly { schemaPath: string; keyword: string }[] | null | undefined,
): CandidateDataExportValidationIssue {
  // Snapshot synchronously: the compiled validator's errors are replaced by its next call.
  const { schemaPath, keyword } = errors?.[0] ?? {};
  if (
    typeof schemaPath !== "string" ||
    schemaPath.length > 256 ||
    !trustedSchemaPaths.has(schemaPath) ||
    typeof keyword !== "string" ||
    keyword.length > 40 ||
    !diagnosticKeywords.has(keyword)
  )
    return Object.freeze({ section, schemaPath: "#", keyword: "validation" });
  return Object.freeze({ section, schemaPath, keyword });
}
