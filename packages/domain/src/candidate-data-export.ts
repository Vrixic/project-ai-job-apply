import { Ajv2020 } from "ajv/dist/2020.js";
import * as addFormatsModule from "ajv-formats";
import schema from "../schemas/v1/candidate-data-export.schema.json" with { type: "json" };

const ajv = new Ajv2020({ strict: true });
const addFormats = addFormatsModule.default as unknown as (instance: Ajv2020) => Ajv2020;
addFormats(ajv);
const validate = ajv.compile(schema);

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
