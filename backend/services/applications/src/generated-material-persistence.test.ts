import { describe, expect, it } from "vitest";
import type { FieldDefinition, FieldOrigin } from "./field-policy.js";
import { assemblePacket, PacketInvariantError, verifyPacketHash } from "./packet.js";
import { definitions, HASH_A, HASH_C, packetInputs, proposal } from "./test-support.js";

const documentDefinitions = new Map(definitions);
for (const key of ["documents.cover_letter", "documents.resume"])
  documentDefinitions.set(key, {
    key,
    label: "Synthetic document",
    valueType: "file",
    sensitivity: "confidential",
    answerPolicy: "explicit_each_time",
  } satisfies FieldDefinition);

const origins: FieldOrigin[] = [
  "generated",
  "user_entered",
  "confirmed_fact",
  "derived",
  "answer_vault",
];
describe("one-off document fields contain bound hashes only", () => {
  it.each(origins)("rejects document text and unrelated digests from %s", (origin) => {
    for (const fieldKey of ["documents.cover_letter", "documents.resume"]) {
      for (const value of [
        "Synthetic forbidden material",
        "https://example.test/material.pdf",
        "base64:synthetic",
        HASH_C,
        true,
        [HASH_A],
      ]) {
        expect(() =>
          assemblePacket(
            packetInputs({
              artifactHashes: { resume: HASH_A, coverLetter: HASH_A },
              fields: [proposal({ fieldKey, origin, value })],
            }),
            documentDefinitions,
          ),
        ).toThrow(PacketInvariantError);
      }
    }
  });
  it.each(["documents.cover_letter", "documents.resume"])(
    "requires a matching binding for %s",
    (fieldKey) => {
      expect(() =>
        assemblePacket(
          packetInputs({ artifactHashes: {}, fields: [proposal({ fieldKey, value: HASH_A })] }),
          documentDefinitions,
        ),
      ).toThrow("Document fields must reference their bound artifact hash");
      const packet = assemblePacket(
        packetInputs({
          artifactHashes: { resume: HASH_A, coverLetter: HASH_A },
          fields: [proposal({ fieldKey, value: HASH_A, origin: "generated" })],
        }),
        documentDefinitions,
      );
      expect(packet.fields[0]).toMatchObject({ value: HASH_A, requiresReview: true });
      expect(verifyPacketHash(packet)).toBe(true);
    },
  );
  it("preserves metadata-only unresolved document fields and separate candidate-authored answers", () => {
    const packet = assemblePacket(
      packetInputs({
        fields: [
          proposal({ fieldKey: "documents.cover_letter", value: null, origin: "generated" }),
          proposal({
            fieldKey: "questions.why_company",
            value: "Synthetic candidate-authored answer",
            origin: "user_entered",
          }),
        ],
      }),
      documentDefinitions,
    );
    expect(
      packet.fields.find((field) => field.fieldKey === "documents.cover_letter")?.value,
    ).toBeNull();
    expect(packet.fields.find((field) => field.fieldKey === "questions.why_company")?.value).toBe(
      "Synthetic candidate-authored answer",
    );
  });
});
