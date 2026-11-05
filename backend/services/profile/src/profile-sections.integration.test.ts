import {
  candidateDataExportValidationIssue,
  validateCandidateDataExportV1,
} from "@ai-job-apply/domain";
import { v7 as uuidv7 } from "uuid";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "./index.js";
import {
  PostgresProfileSectionStore,
  ProfileSectionDuplicateError,
  ProfileSectionIdempotencyConflictError,
  ProfileSectionInputError,
  ProfileSectionLimitError,
  ProfileSectionNotFoundError,
  ProfileSectionOrderError,
  ProfileSectionVersionConflictError,
} from "./profile-sections.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("PostgresProfileSectionStore (ADR-052)", () => {
  const database = createDatabase(databaseUrl ?? "postgres://invalid");
  const store = new PostgresProfileSectionStore(database.client);
  const trace = "synthetic-profile-sections-test";
  const key = () => `profile-sections-${uuidv7()}`;

  async function user(): Promise<string> {
    const id = uuidv7();
    await database.client`INSERT INTO identity.users (id) VALUES (${id}::uuid)`;
    return id;
  }

  afterAll(async () => {
    await database.client.end();
  });

  const work = {
    company: "Synthetic Systems",
    title: "Engineer",
    startDate: "2020-01-15",
    bullets: ["Built a synthetic pipeline."],
  };

  it("saves the Personal record once per owner, with version and idempotency checks", async () => {
    const owner = await user();
    const other = await user();
    expect(await store.getPersonal(owner)).toBeNull();
    const body = { expectedVersion: 0, fullName: "Synthetic Person", email: "p@example.test" };
    const k = key();
    const first = await store.putPersonal(owner, body, k, trace);
    expect(first).toMatchObject({ version: 1, origin: "entered", fullName: "Synthetic Person" });
    // Replay of the same key and body returns the first response without a new version.
    expect(await store.putPersonal(owner, body, k, trace)).toEqual(first);
    await expect(
      store.putPersonal(owner, { ...body, fullName: "Other" }, k, trace),
    ).rejects.toThrow(ProfileSectionIdempotencyConflictError);
    // A stale write is a conflict, and a correct write creates the next immutable version.
    await expect(store.putPersonal(owner, body, key(), trace)).rejects.toThrow(
      ProfileSectionVersionConflictError,
    );
    const second = await store.putPersonal(
      owner,
      { expectedVersion: 1, phone: "+1 555 0100" },
      key(),
      trace,
    );
    expect(second.version).toBe(2);
    expect(second.fullName).toBeUndefined();
    expect(second.createdAt).toBe(first.createdAt);
    expect(await store.getPersonal(other)).toBeNull();
    await expect(
      database.client`UPDATE profile.personal_versions SET origin = 'imported' WHERE user_id = ${owner}`,
    ).rejects.toThrow(/immutable/);
  });

  it("creates, updates, reorders and deletes entries for the owner only", async () => {
    const owner = await user();
    const other = await user();
    const a = await store.createEntry(owner, "workExperience", work, key(), trace);
    const b = await store.createEntry(
      owner,
      "workExperience",
      { ...work, company: "Second Co" },
      key(),
      trace,
    );
    expect(a).toMatchObject({ version: 1, displayOrder: 0, origin: "entered" });
    expect(b).toMatchObject({ displayOrder: 1 });
    expect((await store.listEntries(owner, "workExperience")).map((e) => e.id)).toEqual([
      a.id,
      b.id,
    ]);
    expect(await store.listEntries(other, "workExperience")).toEqual([]);

    // Optional fields clear with null; required fields cannot; the end date cannot precede the start.
    const updated = await store.updateEntry(
      owner,
      "workExperience",
      a.id,
      { expectedVersion: 1, endDate: "2022-03-01", location: "Remote" },
      key(),
      trace,
    );
    expect(updated).toMatchObject({ version: 2, endDate: "2022-03-01", location: "Remote" });
    const cleared = await store.updateEntry(
      owner,
      "workExperience",
      a.id,
      { expectedVersion: 2, endDate: null },
      key(),
      trace,
    );
    expect(cleared.version).toBe(3);
    expect("endDate" in cleared).toBe(false);
    await expect(
      store.updateEntry(
        owner,
        "workExperience",
        a.id,
        { expectedVersion: 3, endDate: "2019-01-01" },
        key(),
        trace,
      ),
    ).rejects.toThrow(ProfileSectionInputError);
    await expect(
      store.updateEntry(
        owner,
        "workExperience",
        a.id,
        { expectedVersion: 1, location: "x" },
        key(),
        trace,
      ),
    ).rejects.toThrow(ProfileSectionVersionConflictError);
    // A no-op update does not create a version.
    const noop = await store.updateEntry(
      owner,
      "workExperience",
      a.id,
      { expectedVersion: 3, company: work.company },
      key(),
      trace,
    );
    expect(noop.version).toBe(3);

    // Another user cannot read, change, reorder or delete the owner's entry.
    await expect(
      store.updateEntry(
        other,
        "workExperience",
        a.id,
        { expectedVersion: 3, location: "x" },
        key(),
        trace,
      ),
    ).rejects.toThrow(ProfileSectionNotFoundError);
    await expect(store.deleteEntry(other, "workExperience", a.id, 3, key(), trace)).rejects.toThrow(
      ProfileSectionNotFoundError,
    );
    await expect(
      store.reorderEntries(other, "workExperience", [a.id, b.id], key(), trace),
    ).rejects.toThrow(ProfileSectionOrderError);
    // An entry of one section cannot be addressed through another section.
    await expect(
      store.updateEntry(
        owner,
        "education",
        a.id,
        { expectedVersion: 3, degree: "x" },
        key(),
        trace,
      ),
    ).rejects.toThrow(ProfileSectionNotFoundError);

    const reordered = await store.reorderEntries(
      owner,
      "workExperience",
      [b.id, a.id],
      key(),
      trace,
    );
    expect(reordered.map((e) => e.id)).toEqual([b.id, a.id]);
    await expect(
      store.reorderEntries(owner, "workExperience", [b.id], key(), trace),
    ).rejects.toThrow(ProfileSectionOrderError);
    await expect(
      store.reorderEntries(owner, "workExperience", [b.id, b.id], key(), trace),
    ).rejects.toThrow(ProfileSectionOrderError);

    // Deleting erases the entry and every version of its text.
    await store.deleteEntry(owner, "workExperience", a.id, 3, key(), trace);
    const [counted] = await database.client<{ remaining: number }[]>`
      SELECT count(*)::int AS remaining FROM profile.entry_versions WHERE entry_id = ${a.id}
    `;
    expect(counted?.remaining).toBe(0);
    // No replay record keeps the erased text either.
    const [leftover] = await database.client<{ n: number }[]>`
      SELECT count(*)::int AS n FROM platform.idempotency_keys
      WHERE user_id = ${owner} AND response::text LIKE '%Built a synthetic pipeline%'
        AND response::text LIKE ${`%${a.id}%`}
    `;
    expect(leftover?.n).toBe(0);
    expect((await store.listEntries(owner, "workExperience")).map((e) => e.id)).toEqual([b.id]);
  });

  it("keeps skills unique per owner and caps each section", async () => {
    const owner = await user();
    await store.createEntry(owner, "skill", { name: "TypeScript" }, key(), trace);
    await expect(
      store.createEntry(owner, "skill", { name: "  typescript " }, key(), trace),
    ).rejects.toThrow(ProfileSectionDuplicateError);
    for (let i = 0; i < 19; i++) {
      await store.createEntry(owner, "education", { school: `School ${i}` }, key(), trace);
    }
    await store.createEntry(owner, "education", { school: "School 19" }, key(), trace);
    await expect(
      store.createEntry(owner, "education", { school: "One too many" }, key(), trace),
    ).rejects.toThrow(ProfileSectionLimitError);
  });

  it("refuses restricted questions and duplicate normalized questions in Application answers", async () => {
    const owner = await user();
    const saved = await store.createEntry(
      owner,
      "applicationAnswer",
      { question: "Why do you want to work here?", answer: "Synthetic reason." },
      key(),
      trace,
    );
    expect(saved).toMatchObject({ questionKey: "why do you want to work here", version: 1 });
    expect("displayOrder" in saved).toBe(false);
    await expect(
      store.createEntry(
        owner,
        "applicationAnswer",
        { question: "WHY DO YOU WANT TO WORK HERE", answer: "Again." },
        key(),
        trace,
      ),
    ).rejects.toThrow(ProfileSectionDuplicateError);
    // Screening questions are ordinary saved answers: the candidate's own, reused as given.
    for (const question of [
      "Are you legally authorized to work in the United States?",
      "Will you require visa sponsorship?",
    ]) {
      await expect(
        store.createEntry(owner, "applicationAnswer", { question, answer: "Yes" }, key(), trace),
      ).resolves.toMatchObject({ question, answer: "Yes" });
    }
    await expect(
      store.updateEntry(
        owner,
        "applicationAnswer",
        saved.id,
        { expectedVersion: 1, question: "Do you require sponsorship?" },
        key(),
        trace,
      ),
    ).resolves.toMatchObject({ question: "Do you require sponsorship?" });
  });

  it("matches a saved answer only by the exact normalized question key, for its owner", async () => {
    const owner = await user();
    const other = await user();
    const saved = await store.createEntry(
      owner,
      "applicationAnswer",
      { question: "Why do you want to work here?", answer: "Synthetic reason." },
      key(),
      trace,
    );
    const asked = await store.matchApplicationAnswer(owner, "  WHY do you want to work here?? ");
    expect(asked).toMatchObject({ id: saved.id, answer: "Synthetic reason." });
    // Similar wording and other owners never match.
    expect(await store.matchApplicationAnswer(owner, "Why do you want to join us?")).toBeNull();
    expect(await store.matchApplicationAnswer(other, "Why do you want to work here?")).toBeNull();
    expect(
      await store.matchApplicationAnswer(owner, "Are you authorized to work in the US?"),
    ).toBeNull();
    await store.createEntry(
      owner,
      "applicationAnswer",
      { question: "Are you authorized to work in the US?", answer: "Yes" },
      key(),
      trace,
    );
    expect(
      await store.matchApplicationAnswer(owner, "are you authorized to work in the us"),
    ).toMatchObject({ answer: "Yes" });
    expect(await store.matchApplicationAnswer(owner, "   ")).toBeNull();
    // An edited answer is what matches afterwards; a deleted one no longer does.
    await store.updateEntry(
      owner,
      "applicationAnswer",
      saved.id,
      { expectedVersion: 1, answer: "Edited." },
      key(),
      trace,
    );
    expect(await store.matchApplicationAnswer(owner, "why do you want to work here")).toMatchObject(
      {
        answer: "Edited.",
        version: 2,
      },
    );
    await store.deleteEntry(owner, "applicationAnswer", saved.id, 2, key(), trace);
    expect(await store.matchApplicationAnswer(owner, "Why do you want to work here?")).toBeNull();
  });

  it("reads grounding facts from saved records only, for the owner only", async () => {
    const owner = await user();
    const other = await user();
    await store.putPersonal(
      owner,
      { expectedVersion: 0, fullName: "Grounded Person", email: "grounded@example.test" },
      key(),
      trace,
    );
    const job = await store.createEntry(owner, "workExperience", work, key(), trace);
    await store.createEntry(owner, "skill", { name: "Grounded Skill" }, key(), trace);
    await store.createDraft(owner, uuidv7(), "skill", { name: "Unsaved Draft Skill" });
    await store.createEntry(other, "skill", { name: "Other Candidate Skill" }, key(), trace);

    const facts = await store.listGroundingFacts(owner);
    const text = JSON.stringify(facts);
    expect(text).toContain("Grounded Skill");
    expect(text).toContain("Synthetic Systems");
    expect(text).toContain("grounded@example.test");
    expect(text).not.toContain("Unsaved Draft Skill");
    expect(text).not.toContain("Other Candidate Skill");
    const role = facts.find((fact) => fact.id === job.id);
    expect(role).toMatchObject({ kind: "employment", key: "role", verification: "confirmed" });
    expect(role?.source.reference).toBe(`profile-entry:workExperience:${job.id}:v1`);
    expect(await store.listGroundingFacts(await user())).toEqual([]);

    // An edit changes the evidence the next read returns.
    await store.updateEntry(
      owner,
      "workExperience",
      job.id,
      { expectedVersion: 1, title: "Staff Engineer" },
      key(),
      trace,
    );
    const edited = await store.listGroundingFacts(owner);
    expect(JSON.stringify(edited.find((fact) => fact.id === job.id)?.value)).toContain(
      "Staff Engineer",
    );
    expect(edited.find((fact) => fact.id === job.id)?.version).toBe(2);
  });

  it("makes the database refuse invalid content even if the API check is bypassed", async () => {
    const owner = await user();
    const id = uuidv7();
    await database.client`
      INSERT INTO profile.entries (id, user_id, section) VALUES (${id}, ${owner}, 'education')
    `;
    const insert = (content: object) => database.client`
      INSERT INTO profile.entry_versions (entry_id, version, content, origin)
      VALUES (${id}, 1, ${JSON.stringify(content)}::jsonb, 'entered')
    `;
    await expect(insert({ school: "S", sensitivity: "restricted" })).rejects.toThrow(
      /unknown field/,
    );
    await expect(insert({ degree: "BS" })).rejects.toThrow(/required field/);
    await expect(
      insert({ school: "S", startDate: "2020-02-01", endDate: "2020-01-01" }),
    ).rejects.toThrow(/reversed/);
    await insert({ school: "S" });
    await expect(
      database.client`UPDATE profile.entry_versions SET content = '{"school":"X"}'::jsonb WHERE entry_id = ${id}`,
    ).rejects.toThrow(/immutable/);
  });

  it("holds the active-candidate lease on every write", async () => {
    const owner = await user();
    await database.client`
      UPDATE identity.users SET account_state = 'quarantined', quarantined_at = now() WHERE id = ${owner}
    `;
    await expect(store.createEntry(owner, "skill", { name: "Go" }, key(), trace)).rejects.toThrow();
    await expect(
      store.putPersonal(owner, { expectedVersion: 0, fullName: "Synthetic Person" }, key(), trace),
    ).rejects.toThrow();
    expect(await store.listEntries(owner, "skill")).toEqual([]);
  });

  it("stores import drafts apart from the profile until the candidate saves them", async () => {
    const owner = await user();
    const other = await user();
    const importId = uuidv7();
    const education = await store.createDraft(owner, importId, "education", {
      school: "Draft University",
    });
    const skill = await store.createDraft(owner, importId, "skill", { name: "Go" });
    const personal = await store.createDraft(owner, importId, "personal", {
      fullName: "Draft Person",
    });
    await expect(store.createDraft(owner, importId, "skill", { name: "" })).rejects.toThrow(
      ProfileSectionInputError,
    );
    expect((await store.listDrafts(owner)).map((d) => d.id)).toEqual([
      education.id,
      skill.id,
      personal.id,
    ]);
    expect(await store.listDrafts(other)).toEqual([]);
    // No consumer sees a draft as a profile record.
    expect(await store.listEntries(owner, "education")).toEqual([]);
    expect(await store.getPersonal(owner)).toBeNull();

    await expect(store.saveDraft(other, education.id, {}, key(), trace)).rejects.toThrow(
      ProfileSectionNotFoundError,
    );
    await expect(store.discardDraft(other, skill.id, key(), trace)).rejects.toThrow(
      ProfileSectionNotFoundError,
    );

    const k = key();
    const reference = await store.saveDraft(
      owner,
      education.id,
      { values: { school: "Edited University", degree: "BS" } },
      k,
      trace,
    );
    expect(reference).toMatchObject({ section: "education", version: 1 });
    expect(
      await store.saveDraft(
        owner,
        education.id,
        { values: { school: "Edited University", degree: "BS" } },
        k,
        trace,
      ),
    ).toEqual(reference);
    const [saved] = await store.listEntries(owner, "education");
    expect(saved).toMatchObject({ school: "Edited University", origin: "imported", importId });
    await expect(
      store.saveDraft(owner, skill.id, { values: { school: "Wrong shape" } }, key(), trace),
    ).rejects.toThrow(ProfileSectionInputError);

    await expect(store.saveDraft(owner, personal.id, {}, key(), trace)).rejects.toThrow(
      ProfileSectionInputError,
    );
    const personalRef = await store.saveDraft(
      owner,
      personal.id,
      { expectedPersonalVersion: 0 },
      key(),
      trace,
    );
    expect(personalRef).toEqual({ section: "personal", version: 1 });
    expect(await store.getPersonal(owner)).toMatchObject({
      fullName: "Draft Person",
      origin: "imported",
    });

    await store.discardDraft(owner, skill.id, key(), trace);
    expect(await store.listDrafts(owner)).toEqual([]);
  });

  it("removes every section record when the account is deleted", async () => {
    const owner = await user();
    const entry = await store.createEntry(owner, "skill", { name: "Rust" }, key(), trace);
    await store.putPersonal(
      owner,
      { expectedVersion: 0, fullName: "Synthetic Person" },
      key(),
      trace,
    );
    await store.createDraft(owner, uuidv7(), "skill", { name: "Zig" });
    await database.client`DELETE FROM identity.users WHERE id = ${owner}`;
    const [counts] = await database.client<{ n: number }[]>`
      SELECT (
        (SELECT count(*) FROM profile.entries WHERE user_id = ${owner}) +
        (SELECT count(*) FROM profile.entry_versions WHERE entry_id = ${entry.id}) +
        (SELECT count(*) FROM profile.personal_versions WHERE user_id = ${owner}) +
        (SELECT count(*) FROM profile.import_drafts WHERE user_id = ${owner})
      )::int AS n
    `;
    expect(counts?.n).toBe(0);
  });

  async function authorizeCandidateDeletion(userId: string): Promise<string> {
    const operationId = uuidv7();
    const requestId = uuidv7();
    await database.client`
      INSERT INTO platform.operations (id, user_id, kind, state)
      VALUES (${operationId}::uuid, ${userId}::uuid, 'account_deletion', 'queued')
    `;
    await database.client`
      INSERT INTO profile.account_deletion_requests (
        id, user_id, operation_id, policy_version, state, version,
        confirmed_at, backup_expires_at
      ) VALUES (
        ${requestId}::uuid, ${userId}::uuid, ${operationId}::uuid,
        'profile-sections-test.v1', 'quarantined', 1,
        '2026-09-01T15:00:00.000Z'::timestamptz,
        '2026-09-08T15:00:00.000Z'::timestamptz
      )
    `;
    await database.client`
      INSERT INTO privacy.account_deletion_ledger (
        request_id, subject_digest, policy_version, policy_sha256, state,
        owner_inventory, subprocessor_inventory, confirmed_at, backup_expires_at
      ) VALUES (
        ${requestId}::uuid, ${"a".repeat(64)}, 'profile-sections-test.v1', ${"b".repeat(64)},
        'quarantined', '{}'::jsonb, '{}'::jsonb,
        '2026-09-01T15:00:00.000Z'::timestamptz, '2026-09-08T15:00:00.000Z'::timestamptz
      )
    `;
    return requestId;
  }

  it("exports every saved section in the portable format and erases all of it on deletion", async () => {
    const owner = await user();
    await store.putPersonal(
      owner,
      {
        expectedVersion: 0,
        fullName: "Synthetic Person",
        links: [{ kind: "github", url: "https://example.test/x" }],
      },
      key(),
      trace,
    );
    const school = await store.createEntry(
      owner,
      "education",
      { school: "Export University" },
      key(),
      trace,
    );
    await store.createEntry(owner, "workExperience", work, key(), trace);
    await store.createEntry(owner, "skill", { name: "Export Skill" }, key(), trace);
    await store.createEntry(
      owner,
      "applicationAnswer",
      { question: "Why do you want to work here?", answer: "Export answer text." },
      key(),
      trace,
    );
    await store.createDraft(owner, uuidv7(), "skill", { name: "Draft Skill" });

    const [exported] = await database.client<Array<{ data: { profile: Record<string, unknown> } }>>`
      SELECT profile.export_candidate_data(${owner}::uuid) AS data
    `;
    const profile = exported?.data.profile as Record<string, unknown[] & Record<string, unknown>>;
    expect(profile.personal).toMatchObject({
      fullName: "Synthetic Person",
      version: 1,
      origin: "entered",
    });
    expect(profile.education).toMatchObject([
      { id: school.id, school: "Export University", displayOrder: 0 },
    ]);
    expect(profile.workExperience).toMatchObject([
      { company: "Synthetic Systems", bullets: work.bullets },
    ]);
    expect(profile.skills).toMatchObject([{ name: "Export Skill" }]);
    expect(profile.applicationAnswers).toMatchObject([
      { question: "Why do you want to work here?", questionKey: "why do you want to work here" },
    ]);
    expect(profile.importDrafts).toMatchObject([
      { section: "skill", values: { name: "Draft Skill" } },
    ]);
    const at = "2026-10-22T12:00:00.000Z";
    const portable = {
      schemaVersion: 1,
      format: "candidate-data-export-v1",
      exportId: uuidv7(),
      policyVersion: "synthetic-v1",
      generatedAt: at,
      candidate: { createdAt: at, connectedAccounts: [] },
      profile: exported?.data.profile,
      documents: { resumes: [] },
      jobs: { reports: [] },
      matching: { savedJobs: [] },
      billing: { entitlement: { plan: "free", version: 0, effectiveAt: at } },
      audit: { events: [] },
    };
    expect(candidateDataExportValidationIssue(portable)).toBeUndefined();
    expect(validateCandidateDataExportV1(portable)).toBe(true);

    const other = await user();
    const [otherExport] = await database.client<
      Array<{ data: { profile: Record<string, unknown> } }>
    >`
      SELECT profile.export_candidate_data(${other}::uuid) AS data
    `;
    expect(otherExport?.data.profile).toMatchObject({
      personal: null,
      education: [],
      workExperience: [],
      skills: [],
      applicationAnswers: [],
      importDrafts: [],
    });

    await store.createEntry(other, "skill", { name: "Other Skill" }, key(), trace);
    const requestId = await authorizeCandidateDeletion(owner);
    await database.client`
      SELECT profile.delete_candidate_data(${owner}::uuid, ${requestId}::uuid)
    `;
    const [left] = await database.client<{ n: number }[]>`
      SELECT (
        (SELECT count(*) FROM profile.entries WHERE user_id = ${owner}) +
        (SELECT count(*) FROM profile.entry_versions WHERE entry_id = ${school.id}) +
        (SELECT count(*) FROM profile.personal_versions WHERE user_id = ${owner}) +
        (SELECT count(*) FROM profile.import_drafts WHERE user_id = ${owner}) +
        (SELECT count(*) FROM platform.idempotency_keys
          WHERE user_id = ${owner}
            AND (scope LIKE 'profile.entry.%' OR scope LIKE 'profile.personal.%' OR scope LIKE 'profile.draft.%'))
      )::int AS n
    `;
    expect(left?.n).toBe(0);
    // Another candidate's records are untouched by this deletion.
    expect((await store.listEntries(other, "skill")).length).toBe(1);
  });
});
