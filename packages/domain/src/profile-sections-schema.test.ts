import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import * as addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";

const userId = "019d04cf-1f80-7000-8000-000000000001";
const entryId = "019d04cf-1f80-7000-8000-000000000002";
const now = "2026-10-22T12:00:00.000Z";

async function definition(name: string) {
  const schema = JSON.parse(
    await readFile(new URL("../schemas/v1/profile-sections.schema.json", import.meta.url), "utf8"),
  ) as { $defs: object };
  const ajv = new Ajv2020({ strict: true });
  const addFormats = addFormatsModule.default as unknown as (instance: Ajv2020) => Ajv2020;
  addFormats(ajv);
  return ajv.compile({ $ref: `#/$defs/${name}`, $defs: schema.$defs });
}

describe("profile sections domain schema (ADR-052)", () => {
  it("registers the schema as Profile-owned confidential data", async () => {
    const registry = JSON.parse(
      await readFile(new URL("../schemas/v1/registry.json", import.meta.url), "utf8"),
    ) as { schemas: Array<{ name: string; file: string; owner: string; classification: string }> };
    expect(registry.schemas.find((entry) => entry.name === "ProfileSections")).toEqual({
      name: "ProfileSections",
      file: "profile-sections.schema.json",
      owner: "profile",
      classification: "confidential",
    });
  });

  it("carries the owner on every stored record and refuses sensitivity classes", async () => {
    const validate = await definition("workExperienceEntry");
    const record = {
      userId,
      id: entryId,
      company: "Synthetic Systems",
      title: "Engineer",
      startDate: "2020-01-15",
      bullets: ["Built a synthetic pipeline."],
      version: 1,
      origin: "entered",
      displayOrder: 0,
      createdAt: now,
      updatedAt: now,
    };
    expect(validate(record)).toBe(true);
    const { userId: _owner, ...withoutOwner } = record;
    expect(validate(withoutOwner)).toBe(false);
    for (const patch of [
      { sensitivity: "restricted" },
      { verification: "confirmed" },
      { confidence: 1 },
    ]) {
      expect(validate({ ...record, ...patch })).toBe(false);
    }
  });

  it("stores the Personal record once per owner with no version-zero state", async () => {
    const validate = await definition("personal");
    const record = { userId, version: 1, origin: "entered", createdAt: now, updatedAt: now };
    expect(validate(record)).toBe(true);
    expect(validate({ ...record, version: 0 })).toBe(false);
    expect(validate({ ...record, dateOfBirth: "2000-01-01" })).toBe(false);
  });

  it("keeps import drafts separate from profile records", async () => {
    const validate = await definition("importDraft");
    const draft = {
      userId,
      id: entryId,
      importId: "019d04cf-1f80-7000-8000-000000000003",
      section: "skill",
      values: { name: "TypeScript" },
      createdAt: now,
    };
    expect(validate(draft)).toBe(true);
    expect(validate({ ...draft, section: "applicationAnswer" })).toBe(false);
    expect(validate({ ...draft, version: 1 })).toBe(false);
  });

  it("references entries by section, id and version, and never by restricted answers", async () => {
    const validate = await definition("entryReference");
    expect(validate({ section: "education", entryId, version: 2 })).toBe(true);
    expect(validate({ section: "personal", version: 1 })).toBe(true);
    expect(validate({ section: "restrictedAnswer", entryId, version: 1 })).toBe(false);
  });
});
