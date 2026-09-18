import type { FieldDefinition, ProposedField } from "./field-policy.js";
import type { PacketInputs } from "./packet.js";

export const USER_ID = "0192f7c2-0000-7000-8000-000000000001";
export const APPLICATION_ID = "0192f7c2-0000-7000-8000-000000000002";
export const JOB_ID = "0192f7c2-0000-7000-8000-000000000003";
export const PACKET_ID = "0192f7c2-0000-7000-8000-000000000004";
export const FACT_A = "0192f7c2-0000-7000-8000-0000000000a1";
export const FACT_B = "0192f7c2-0000-7000-8000-0000000000a2";
export const CONSENT_ID = "0192f7c2-0000-7000-8000-0000000000c1";
export const HASH_A = "a".repeat(64);
export const HASH_B = "b".repeat(64);
export const HASH_C = "c".repeat(64);
export const NOW = new Date("2026-09-18T12:00:00.000Z");

export const definitions: ReadonlyMap<string, FieldDefinition> = new Map(
  (
    [
      ["contact.email", "string", "confidential", "confirmed_fact"],
      ["employment.start_date", "date", "confidential", "confirmed_fact"],
      ["job.remote_preference", "enum", "standard", "confirmed_fact"],
      ["job.salary_expectation", "decimal", "confidential", "explicit_each_time"],
      ["authorization.us_authorized", "boolean", "restricted", "never_infer"],
      ["attestation.truthful", "boolean", "restricted", "explicit_each_time"],
      ["questions.why_company", "text", "standard", "explicit_each_time"],
    ] as const
  ).map(([key, valueType, sensitivity, answerPolicy]) => [
    key,
    {
      key,
      label: key,
      valueType,
      sensitivity,
      answerPolicy,
      ...(key === "job.remote_preference" ? { allowedValues: ["remote", "hybrid", "onsite"] } : {}),
    } satisfies FieldDefinition,
  ]),
);

export function proposal(overrides: Partial<ProposedField> = {}): ProposedField {
  return {
    fieldKey: "contact.email",
    value: "candidate@example.test",
    origin: "confirmed_fact",
    sourceFactIds: [FACT_A],
    sourceConfirmed: true,
    confidence: 0.99,
    ...overrides,
  };
}

export function packetInputs(overrides: Partial<PacketInputs> = {}): PacketInputs {
  return {
    id: PACKET_ID,
    userId: USER_ID,
    applicationId: APPLICATION_ID,
    canonicalJobId: JOB_ID,
    version: 1,
    jobRevision: HASH_A,
    form: { adapterId: "greenhouse", variantId: "synthetic-v1", formHash: HASH_B },
    fields: [proposal()],
    artifactHashes: { resume: HASH_C },
    createdAt: NOW,
    ...overrides,
  };
}
