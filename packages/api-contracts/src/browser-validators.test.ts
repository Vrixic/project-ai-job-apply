import {
  validateApplication,
  validateApplicationTemporaryMaterialAuthorization,
  validateCanonicalJobDetail,
} from "@ai-job-apply/api-contracts/browser-validators";
import { describe, expect, it } from "vitest";
import { compileComponentValidator } from "./index.js";

describe("precompiled browser contract validators", () => {
  const proof = {
    schemaVersion: 1,
    packetId: "00000000-0000-7000-8000-000000000001",
    packetHash: "a".repeat(64),
    temporaryMaterial: {
      schemaVersion: 1,
      kind: "cover_letter",
      generationId: "00000000-0000-7000-8000-000000000002",
      version: 1,
      contentSha256: "b".repeat(64),
      completedAtMs: 1000,
      expiresAtMs: 1_801_000,
    },
  };
  it("matches server validation for strict material proofs without runtime compilation", () => {
    const server = compileComponentValidator("ApplicationTemporaryMaterialAuthorization");
    for (const input of [
      proof,
      null,
      {},
      { ...proof, paragraphs: ["forbidden"] },
      { ...proof, packetHash: "wrong" },
      { ...proof, temporaryMaterial: { ...proof.temporaryMaterial, ownerUserId: "forbidden" } },
    ]) {
      expect(validateApplicationTemporaryMaterialAuthorization(input)).toBe(server(input));
    }
    expect(validateApplicationTemporaryMaterialAuthorization(proof)).toBe(true);
  });
  it.each([
    ["Application", validateApplication],
    ["CanonicalJobDetail", validateCanonicalJobDetail],
  ] as const)("rejects incomplete or future %s shapes like the server", (name, browser) => {
    const server = compileComponentValidator(name);
    for (const input of [null, [], {}, { id: "invalid", ownerUserId: "forbidden" }]) {
      expect(browser(input)).toBe(false);
      expect(browser(input)).toBe(server(input));
    }
  });
});
