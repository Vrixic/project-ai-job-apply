import type { ApplicationTemporaryMaterial } from "@ai-job-apply/api-contracts";
import { expect, it } from "vitest";
import { materialDeadline, materialsExpired, sameMaterial } from "./application-material-lifetime";

const material: ApplicationTemporaryMaterial = {
  schemaVersion: 1,
  kind: "tailored_resume",
  generationId: "019d04cf-1f80-7000-8000-000000000001",
  version: 1,
  contentSha256: "a".repeat(64),
  completedAtMs: 1000,
  expiresAtMs: 1_801_000,
};

it("expires at the original deadline, including malformed and extended deadlines", () => {
  expect(materialsExpired([material], material.expiresAtMs - 1)).toBe(false);
  expect(materialsExpired([material], material.expiresAtMs)).toBe(true);
  for (const expiresAtMs of [NaN, Infinity, material.expiresAtMs + 1, 0]) {
    expect(materialDeadline({ ...material, expiresAtMs })).toBe(0);
    expect(materialsExpired([{ ...material, expiresAtMs }], 1)).toBe(true);
  }
});
it("compares every original scalar without depending on object key order", () => {
  expect(sameMaterial(material, { ...material })).toBe(true);
  for (const changed of [
    { generationId: "different" },
    { contentSha256: "b".repeat(64) },
    { version: 2 },
    { completedAtMs: 2 },
    { expiresAtMs: 3 },
    { kind: "cover_letter" as const },
  ])
    expect(sameMaterial(material, { ...material, ...changed })).toBe(false);
  expect(sameMaterial(material, undefined)).toBe(false);
});
