import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { compileComponentValidator, contract } from "./index.js";

const now = "2026-10-22T12:00:00.000Z";

type Operation = {
  operationId: string;
  security: Array<Record<string, string[]>>;
  parameters?: Array<{ in: string; name: string; required?: boolean }>;
  responses: Record<string, { headers?: Record<string, unknown> }>;
};

const profileOperations = Object.entries(
  contract.paths as unknown as Record<string, Record<string, Operation>>,
)
  .filter(([path]) =>
    /^\/profile\/(personal|education-entries|work-experience-entries|skill-entries|application-answers|import-drafts)/.test(
      path,
    ),
  )
  .flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({ path, method, operation })),
  );

describe("structured Profile OpenAPI contract (ADR-052)", () => {
  it("declares every section, answer and draft operation", () => {
    expect(profileOperations.map(({ operation }) => operation.operationId).sort()).toEqual([
      "createProfileApplicationAnswer",
      "createProfileEducationEntry",
      "createProfileSkillEntry",
      "createProfileWorkExperienceEntry",
      "deleteProfileApplicationAnswer",
      "deleteProfileEducationEntry",
      "deleteProfileSkillEntry",
      "deleteProfileWorkExperienceEntry",
      "discardProfileImportDraft",
      "getProfilePersonal",
      "listProfileApplicationAnswers",
      "listProfileEducationEntries",
      "listProfileImportDrafts",
      "listProfileSkillEntries",
      "listProfileWorkExperienceEntries",
      "putProfilePersonal",
      "reorderProfileEducationEntries",
      "reorderProfileSkillEntries",
      "reorderProfileWorkExperienceEntries",
      "saveProfileImportDraft",
      "updateProfileApplicationAnswer",
      "updateProfileEducationEntry",
      "updateProfileSkillEntry",
      "updateProfileWorkExperienceEntry",
    ]);
  });

  it("scopes reads and writes, requires idempotency on every write, and forbids caching", () => {
    for (const { path, method, operation } of profileOperations) {
      const label = `${method} ${path}`;
      const write = method !== "get";
      expect(operation.security, label).toEqual([
        { oidc: [write ? "profile:write" : "profile:read"] },
      ]);
      const idempotency = operation.parameters?.some(
        (parameter) =>
          parameter.in === "header" && parameter.name === "Idempotency-Key" && parameter.required,
      );
      expect(Boolean(idempotency), label).toBe(write);
      for (const [status, response] of Object.entries(operation.responses)) {
        if (!/^20[014]$/.test(status)) continue;
        expect(response.headers, `${label} ${status}`).toHaveProperty("Cache-Control");
      }
      expect(operation.responses, label).toHaveProperty("401");
      expect(operation.responses, label).toHaveProperty("403");
    }
  });

  it("uses optimistic versions on updates and deletes", () => {
    const deletes = profileOperations.filter(
      ({ method, path }) => method === "delete" && /\{(entryId|answerId)\}$/.test(path),
    );
    expect(deletes).toHaveLength(4);
    for (const { path, operation } of deletes) {
      expect(
        operation.parameters?.some(
          (p) => p.in === "query" && p.name === "expectedVersion" && p.required,
        ),
        path,
      ).toBe(true);
    }
    for (const name of [
      "UpdateProfileEducationEntryRequest",
      "UpdateProfileWorkExperienceEntryRequest",
      "UpdateProfileSkillEntryRequest",
      "UpdateProfileApplicationAnswerRequest",
    ] as const) {
      const validate = compileComponentValidator(name);
      expect(validate({ expectedVersion: 1 }), `${name} needs a change`).toBe(false);
      expect(validate({ title: "x" }), `${name} needs expectedVersion`).toBe(false);
    }
  });
});

describe("structured Profile request and record shapes", () => {
  const work = {
    company: "Synthetic Systems",
    title: "Engineer",
    startDate: "2020-01-15",
    bullets: ["Built a synthetic pipeline."],
  };

  it("accepts a work experience entry and refuses unknown, ownership and sensitivity fields", () => {
    const validate = compileComponentValidator("CreateProfileWorkExperienceEntryRequest");
    expect(validate(work)).toBe(true);
    expect(validate({ ...work, endDate: "2022-03-01", location: "Remote" })).toBe(true);
    for (const patch of [
      { userId: randomUUID() },
      { sensitivity: "restricted" },
      { verification: "confirmed" },
      { displayOrder: 1 },
      { bullets: Array.from({ length: 21 }, () => "x") },
      { bullets: [""] },
      { bullets: ["x".repeat(501)] },
      { startDate: "01/15/2020" },
      { company: "   " },
    ]) {
      expect(validate({ ...work, ...patch }), JSON.stringify(Object.keys(patch))).toBe(false);
    }
    expect(validate({ company: "Synthetic Systems", title: "Engineer" })).toBe(false);
  });

  it("allows optional fields to be cleared with null on update only", () => {
    const update = compileComponentValidator("UpdateProfileWorkExperienceEntryRequest");
    expect(update({ expectedVersion: 2, endDate: null, location: null, bullets: [] })).toBe(true);
    expect(update({ expectedVersion: 2, company: null })).toBe(false);
    const create = compileComponentValidator("CreateProfileWorkExperienceEntryRequest");
    expect(create({ ...work, endDate: null })).toBe(false);
  });

  it("validates education, skills and application answers", () => {
    const education = compileComponentValidator("CreateProfileEducationEntryRequest");
    expect(education({ school: "Synthetic University", degree: "BS" })).toBe(true);
    expect(education({ degree: "BS" })).toBe(false);
    const skill = compileComponentValidator("CreateProfileSkillEntryRequest");
    expect(skill({ name: "TypeScript", category: "Languages" })).toBe(true);
    expect(skill({ name: "" })).toBe(false);
    const answer = compileComponentValidator("CreateProfileApplicationAnswerRequest");
    expect(answer({ question: "Why this company?", answer: "Synthetic reason." })).toBe(true);
    expect(answer({ question: "Why this company?" })).toBe(false);
    expect(answer({ question: "q", answer: "a", questionKey: "q" })).toBe(false);
    expect(answer({ question: "q", answer: "a".repeat(2001) })).toBe(false);
  });

  it("requires an expected version for Personal and accepts only https links and ISO countries", () => {
    const validate = compileComponentValidator("PutProfilePersonalRequest");
    const personal = {
      expectedVersion: 0,
      fullName: "Synthetic Person",
      email: "person@example.test",
      phone: "+1 (555) 010-0100",
      address: { city: "Synthetic City", region: "SC", country: "US" },
      links: [{ kind: "github", url: "https://example.test/synthetic" }],
    };
    expect(validate(personal)).toBe(true);
    expect(validate({ fullName: "Synthetic Person" })).toBe(false);
    for (const patch of [
      { links: [{ kind: "github", url: "http://example.test/x" }] },
      { links: [{ kind: "other", url: "javascript:alert(1)" }] },
      { address: { country: "usa" } },
      { email: "not-an-email" },
      { phone: "call me" },
      { links: Array.from({ length: 11 }, () => ({ kind: "other", url: "https://example.test" })) },
      { dateOfBirth: "2000-01-01" },
      { ssn: "000-00-0000" },
    ]) {
      expect(validate({ ...personal, ...patch }), JSON.stringify(Object.keys(patch))).toBe(false);
    }
  });

  it("returns versioned records with provenance and a server-derived answer key", () => {
    const id = randomUUID();
    const base = { id, version: 1, origin: "entered", createdAt: now, updatedAt: now };
    expect(
      compileComponentValidator("ProfileSkillEntry")({
        ...base,
        name: "TypeScript",
        displayOrder: 0,
      }),
    ).toBe(true);
    expect(compileComponentValidator("ProfileSkillEntry")({ ...base, name: "TypeScript" })).toBe(
      false,
    );
    const answer = compileComponentValidator("ProfileApplicationAnswer");
    const record = { ...base, question: "Why?", answer: "Because.", questionKey: "why" };
    expect(answer(record)).toBe(true);
    expect(answer({ ...record, questionKey: undefined })).toBe(false);
    expect(answer({ ...record, origin: "guessed" })).toBe(false);
    expect(answer({ ...record, importId: randomUUID() })).toBe(true);
  });

  it("references entries by section, id and version", () => {
    const validate = compileComponentValidator("ProfileEntryReference");
    const entryId = randomUUID();
    expect(validate({ section: "workExperience", entryId, version: 3 })).toBe(true);
    expect(validate({ section: "personal", version: 1 })).toBe(true);
    expect(validate({ section: "personal", entryId, version: 1 })).toBe(false);
    expect(validate({ section: "workExperience", version: 1 })).toBe(false);
    expect(validate({ section: "restrictedAnswer", entryId, version: 1 })).toBe(false);
    expect(validate({ section: "skill", entryId, version: 0 })).toBe(false);
  });

  it("requires the full ordered id list to reorder and refuses duplicates", () => {
    const validate = compileComponentValidator("ReorderProfileEntriesRequest");
    const a = randomUUID();
    const b = randomUUID();
    expect(validate({ orderedEntryIds: [a, b] })).toBe(true);
    expect(validate({ orderedEntryIds: [a, a] })).toBe(false);
    expect(validate({ orderedEntryIds: [] })).toBe(false);
    expect(validate({ orderedEntryIds: [a], extra: true })).toBe(false);
  });

  it("describes import drafts that are not profile records", () => {
    const draft = compileComponentValidator("ProfileImportDraft");
    const base = { id: randomUUID(), importId: randomUUID(), createdAt: now };
    expect(
      draft({ ...base, section: "education", values: { school: "Synthetic University" } }),
    ).toBe(true);
    expect(draft({ ...base, section: "skill", values: { name: "Go" } })).toBe(true);
    expect(
      draft({ ...base, section: "applicationAnswer", values: { question: "q", answer: "a" } }),
    ).toBe(false);
    expect(draft({ ...base, section: "skill", values: { name: "Go" }, version: 1 })).toBe(false);
    const save = compileComponentValidator("SaveProfileImportDraftRequest");
    expect(save({})).toBe(true);
    expect(save({ values: { name: "Go" } })).toBe(true);
    expect(save({ expectedPersonalVersion: 0 })).toBe(true);
    expect(save({ expectedPersonalVersion: -1 })).toBe(false);
    expect(save({ sensitivity: "restricted" })).toBe(false);
  });
});
