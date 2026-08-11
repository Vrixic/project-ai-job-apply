import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import * as addFormatsModule from "ajv-formats";
import contract from "../openapi/platform.v1.json" with { type: "json" };
import type { components, paths } from "../generated/platform.js";

export type ApiComponents = components;
export type ApiPaths = paths;
export type PutJobPreferencesRequest = components["schemas"]["PutJobPreferencesRequest"];
export type JobPreferenceSet = components["schemas"]["JobPreferenceSet"];
export type PutJobPreferencesResponse = components["schemas"]["PutJobPreferencesResponse"];
export type ProfileReadiness = components["schemas"]["ProfileReadiness"];
export type Operation = components["schemas"]["Operation"];
export type CurrentUser = components["schemas"]["CurrentUser"];
export type CanonicalJobDetail = components["schemas"]["CanonicalJobDetail"];
export type ProblemDetails = components["schemas"]["ProblemDetails"];

const ajv = new Ajv2020({ allErrors: true, strict: true });
const addFormats = addFormatsModule.default as unknown as (instance: Ajv2020) => Ajv2020;
addFormats(ajv);

const schemas = contract.components.schemas;
const validationSchemas = JSON.parse(
  JSON.stringify(schemas).replaceAll("#/components/schemas/", "#/$defs/"),
) as typeof schemas;

export function compileComponentValidator(name: keyof typeof schemas): ValidateFunction<unknown> {
  return ajv.compile({
    $ref: `#/$defs/${name}`,
    $defs: validationSchemas,
  });
}

export function formatValidationErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
}

export { contract };
