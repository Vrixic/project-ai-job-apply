import { expect, it } from "vitest";
import { compileComponentValidator } from "./index.js";
const validate = compileComponentValidator("ApplicationTemporaryMaterialAuthorization");
const proof = {
  schemaVersion: 1,
  packetId: "019d04cf-1f80-7000-8000-000000000001",
  packetHash: "a".repeat(64),
  temporaryMaterial: {
    schemaVersion: 1,
    kind: "cover_letter",
    generationId: "019d04cf-1f80-7000-8000-000000000002",
    version: 1,
    contentSha256: "b".repeat(64),
    completedAtMs: 1000,
    expiresAtMs: 1_801_000,
  },
};
it("accepts a strict scalar original packet/material proof", () => {
  expect(validate(proof)).toBe(true);
});
it.each(["paragraphs", "contentBase64", "accessToken", "ownerUserId"])(
  "refuses %s in authorization output",
  (key) => {
    expect(validate({ ...proof, [key]: "synthetic forbidden value" })).toBe(false);
    expect(
      validate({
        ...proof,
        temporaryMaterial: { ...proof.temporaryMaterial, [key]: "synthetic forbidden value" },
      }),
    ).toBe(false);
  },
);
it.each([
  { ...proof, schemaVersion: 2 },
  { ...proof, packetHash: "bad" },
  { data: proof },
  { ...proof, packetId: "bad" },
])("refuses malformed proof identity and wrappers", (invalid) => {
  expect(validate(invalid)).toBe(false);
});
