import taxonomy from "./application-fields.v1.json" with { type: "json" };
import type { FieldDefinition } from "./field-policy.js";

/**
 * The application field ontology bundled with the service. `data/taxonomies/application-fields.v1.json`
 * is the source of truth; a test fails if this copy drifts from it.
 */
export function defaultFieldDefinitions(): ReadonlyMap<string, FieldDefinition> {
  return new Map((taxonomy.fields as FieldDefinition[]).map((field) => [field.key, field]));
}
