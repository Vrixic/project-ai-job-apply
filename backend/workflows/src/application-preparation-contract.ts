import { eventTypes, validateEventData } from "@ai-job-apply/event-contracts";

export const APPLICATION_PREPARATION_DEFINITION_VERSION = 1 as const;
export interface ApplicationPreparationDurableInput {
  schemaVersion: 1;
  eventId: string;
  eventType: typeof eventTypes.applicationPacketPreparationRequested;
  data: { preparationId: string };
}
export interface ApplicationPreparationActivityInput {
  schemaVersion: 1;
  workflowDefinitionVersion: 1;
  eventId: string;
  preparationId: string;
  action: "advance" | "fail";
}
export const preparationRetryCodes = [
  "generation_in_progress",
  "context_unavailable",
  "artifact_unavailable",
  "store_unavailable",
] as const;
export const preparationRejectionCodes = [
  "preparation_missing",
  "candidate_inactive",
  "activity_failed",
] as const;
export type ApplicationPreparationActivityResult = {
  schemaVersion: 1;
  action: ApplicationPreparationActivityInput["action"];
  preparationId: string;
} & (
  | { outcome: "completed" }
  | { outcome: "retryable_failure"; errorCode: (typeof preparationRetryCodes)[number] }
  | { outcome: "non_retryable_failure"; errorCode: (typeof preparationRejectionCodes)[number] }
);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** Strict data-only records: never evaluate an injected accessor or accept hidden/symbol fields. */
function record(
  value: unknown,
  keys: readonly string[],
  required = keys,
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  if (!required.every((key) => Object.hasOwn(value, key))) return false;
  return Reflect.ownKeys(value).every(
    (key) =>
      typeof key === "string" &&
      keys.includes(key) &&
      Object.getOwnPropertyDescriptor(value, key)?.enumerable === true &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, "value"),
  );
}

export function validateApplicationPreparationDurableInput(
  value: unknown,
): value is ApplicationPreparationDurableInput {
  return (
    record(value, ["schemaVersion", "eventId", "eventType", "data"]) &&
    value.schemaVersion === 1 &&
    uuid(value.eventId) &&
    value.eventType === eventTypes.applicationPacketPreparationRequested &&
    record(value.data, ["preparationId"]) &&
    validateEventData(value.eventType, value.data)
  );
}
export function validateApplicationPreparationActivityInput(
  value: unknown,
): value is ApplicationPreparationActivityInput {
  return (
    record(value, [
      "schemaVersion",
      "workflowDefinitionVersion",
      "eventId",
      "preparationId",
      "action",
    ]) &&
    value.schemaVersion === 1 &&
    value.workflowDefinitionVersion === APPLICATION_PREPARATION_DEFINITION_VERSION &&
    uuid(value.eventId) &&
    uuid(value.preparationId) &&
    (value.action === "advance" || value.action === "fail")
  );
}
export function validateApplicationPreparationActivityResult(
  value: unknown,
  expected: ApplicationPreparationActivityInput,
): value is ApplicationPreparationActivityResult {
  if (
    !record(
      value,
      ["schemaVersion", "action", "preparationId", "outcome", "errorCode"],
      ["schemaVersion", "action", "preparationId", "outcome"],
    ) ||
    value.schemaVersion !== 1 ||
    value.action !== expected.action ||
    value.preparationId !== expected.preparationId
  )
    return false;
  if (value.outcome === "completed") return !Object.hasOwn(value, "errorCode");
  if (value.outcome === "retryable_failure")
    return (
      typeof value.errorCode === "string" &&
      preparationRetryCodes.some((code) => code === value.errorCode)
    );
  return (
    value.outcome === "non_retryable_failure" &&
    typeof value.errorCode === "string" &&
    preparationRejectionCodes.some((code) => code === value.errorCode)
  );
}
