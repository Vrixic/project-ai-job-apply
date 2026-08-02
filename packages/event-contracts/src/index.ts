import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import * as addFormatsModule from "ajv-formats";
import preferencesUpdatedSchema from "../schemas/profile.preferences.updated.v1.json" with {
  type: "json",
};
import readinessCalculatedSchema from "../schemas/profile.readiness.calculated.v1.json" with {
  type: "json",
};
import outboxNudgeSchema from "../schemas/platform.outbox.nudge.v1.json" with { type: "json" };

export const eventTypes = {
  profilePreferencesUpdated: "profile.preferences.updated.v1",
  profileReadinessCalculated: "profile.readiness.calculated.v1",
} as const;

export const outboxNudgeSchemaVersion = 1 as const;

export interface OutboxNudgeV1 {
  schemaVersion: typeof outboxNudgeSchemaVersion;
  eventId: string;
  eventType: string;
  traceparent?: string;
  integrity: {
    algorithm: "sha256";
    digest: string;
  };
}

export type OutboxNudgeIntegrityFields = Omit<OutboxNudgeV1, "integrity">;

/** Returns the stable, value-free byte input covered by an outbox nudge digest. */
export function outboxNudgeIntegrityInput(fields: OutboxNudgeIntegrityFields): string {
  return JSON.stringify({
    schemaVersion: fields.schemaVersion,
    eventId: fields.eventId,
    eventType: fields.eventType,
    ...(fields.traceparent ? { traceparent: fields.traceparent } : {}),
  });
}

export interface CloudEvent<TType extends string, TData> {
  specversion: "1.0";
  id: string;
  source: string;
  type: TType;
  subject: string;
  time: string;
  datacontenttype: "application/json";
  dataschema: string;
  traceparent?: string;
  data: TData;
}

export interface ProfilePreferencesUpdatedData {
  preferenceSetId: string;
  version: number;
  operationId: string;
}

export interface ProfileReadinessCalculatedData {
  preferenceSetId: string;
  operationId: string;
  completionPercent: number;
  missingFields: Array<"locations" | "salary">;
}

export type ProfilePreferencesUpdatedEvent = CloudEvent<
  typeof eventTypes.profilePreferencesUpdated,
  ProfilePreferencesUpdatedData
>;

const ajv = new Ajv2020({ allErrors: true, strict: true });
const addFormats = addFormatsModule.default as unknown as (instance: Ajv2020) => Ajv2020;
addFormats(ajv);

const validators = new Map<string, ValidateFunction<unknown>>([
  [eventTypes.profilePreferencesUpdated, ajv.compile(preferencesUpdatedSchema)],
  [eventTypes.profileReadinessCalculated, ajv.compile(readinessCalculatedSchema)],
]);
const outboxNudgeValidator = ajv.compile<OutboxNudgeV1>(outboxNudgeSchema);

export function validateEventData(type: string, data: unknown): boolean {
  const validator = validators.get(type);
  return validator ? validator(data) : false;
}

export function validateOutboxNudge(value: unknown): value is OutboxNudgeV1 {
  return outboxNudgeValidator(value);
}
