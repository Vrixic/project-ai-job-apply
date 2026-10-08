import { describe, expect, it } from "vitest";
import { validateNativeMaterialReady } from "./native-material-ready.js";

const id = (n: number) => `019a4000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const ready = {
  schemaVersion: 1,
  material: {
    schemaVersion: 1,
    kind: "cover_letter",
    generationId: id(1),
    ownerUserId: id(2),
    applicationId: id(3),
    version: 2,
    contentSha256: "a".repeat(64),
    completedAtMs: 1700000000000,
    expiresAtMs: 1700001800000,
  },
  sourceFactIds: [id(4)],
  confidence: 1,
};
describe("scalar native ready receipt", () => {
  it("accepts grounded original second-generation metadata", () =>
    expect(validateNativeMaterialReady(ready)).toBe(true));
  it.each([
    { ...ready, paragraphs: ["forbidden"] },
    { ...ready, confidence: 0 },
    { ...ready, confidence: Number.NaN },
    { ...ready, confidence: 1.01 },
    { ...ready, sourceFactIds: [] },
    { ...ready, sourceFactIds: [id(4), id(4)] },
    { ...ready, sourceFactIds: ["invented"] },
    { ...ready, sourceFactIds: Array(1) },
    { ...ready, material: { ...ready.material, expiresAtMs: ready.material.expiresAtMs + 1 } },
  ])("rejects malformed, ungrounded or content-bearing receipt", (bad) =>
    expect(validateNativeMaterialReady(bad)).toBe(false),
  );
  it("never evaluates candidate accessors", () => {
    let effects = 0;
    const bad = Object.defineProperty({ ...ready }, "sourceFactIds", {
      enumerable: true,
      get() {
        effects++;
        return [id(4)];
      },
    });
    expect(validateNativeMaterialReady(bad)).toBe(false);
    expect(effects).toBe(0);
    const facts = Object.defineProperty([id(4)], "0", {
      enumerable: true,
      get() {
        effects++;
        return id(4);
      },
    });
    expect(validateNativeMaterialReady({ ...ready, sourceFactIds: facts })).toBe(false);
    expect(effects).toBe(0);
  });
});
