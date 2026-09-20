import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { GraphFact } from "@ai-job-apply/domain";
import { describe, expect, it } from "vitest";
import type { FieldDefinition } from "./field-policy.js";
import { assemblePacket } from "./packet.js";
import { FACT_FIELD_MAP, FactBackedPacketSource, jobRevisionHash } from "./packet-source.js";
import type { ApplicationRecord } from "./store.js";
import {
  APPLICATION_ID,
  definitions,
  HASH_B,
  HASH_C,
  JOB_ID,
  NOW,
  PACKET_ID,
  USER_ID,
} from "./test-support.js";

const application: ApplicationRecord = {
  id: APPLICATION_ID,
  ownerUserId: USER_ID,
  canonicalJobId: JOB_ID,
  status: "preparing",
  revision: 1,
  currentPacketId: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function fact(id: string, overrides: Partial<GraphFact> = {}): GraphFact {
  return {
    id,
    kind: "identity",
    key: "email",
    value: "candidate@example.test",
    verification: "confirmed",
    sensitivity: "confidential",
    source: { type: "user", reference: "direct-entry" },
    version: 1,
    ...overrides,
  };
}

function source(facts: GraphFact[]) {
  return new FactBackedPacketSource({
    facts: async () => facts,
    jobRevision: async () => jobRevisionHash({ title: "Engineer" }),
    artifacts: async () => ({ resume: HASH_C }),
    clock: () => NOW,
  });
}

const prepare = (
  facts: GraphFact[],
  userEntries: Array<{ fieldKey: string; value: string }> = [],
) => source(facts).prepare({ ownerUserId: USER_ID, application, userEntries, form: null });

describe("FactBackedPacketSource", () => {
  it("proposes a mapped field only from exactly one confirmed usable fact, with provenance", async () => {
    const preparation = await prepare([fact("11111111-0000-7000-8000-000000000001")]);
    expect(preparation.fields).toEqual([
      {
        fieldKey: "contact.email",
        value: "candidate@example.test",
        origin: "confirmed_fact",
        sourceFactIds: ["11111111-0000-7000-8000-000000000001"],
        sourceConfirmed: true,
        confidence: 1,
      },
    ]);
    expect(preparation.artifactHashes).toEqual({ resume: HASH_C });
    expect(preparation.jobRevision).toMatch(/^[a-f0-9]{64}$/);
  });

  it("never uses proposed, rejected, invalidated, or expired facts", async () => {
    const facts = [
      fact("a", { verification: "proposed" }),
      fact("b", { verification: "rejected" }),
      fact("c", { availability: { state: "invalidated", reasonCode: "source_security_hold" } }),
      fact("d", { effectiveTo: "2020-01-01" }),
    ];
    expect((await prepare(facts)).fields).toEqual([]);
  });

  it("leaves a competing field to the candidate rather than choosing between facts", async () => {
    const preparation = await prepare([
      fact("a", { value: "one@example.test" }),
      fact("b", { value: "two@example.test" }),
    ]);
    expect(preparation.fields).toEqual([]);
  });

  it("lets candidate entries win and marks them candidate supplied", async () => {
    const preparation = await prepare(
      [fact("a")],
      [
        { fieldKey: "contact.email", value: "typed@example.test" },
        { fieldKey: "job.notice_period", value: "2 weeks" },
      ],
    );
    expect(preparation.fields.map((entry) => [entry.fieldKey, entry.origin, entry.value])).toEqual([
      ["contact.email", "user_entered", "typed@example.test"],
      ["job.notice_period", "user_entered", "2 weeks"],
    ]);
    expect(preparation.fields.every((entry) => entry.sourceFactIds.length === 0)).toBe(true);
  });

  it("does not map unrelated facts such as skills or employment", async () => {
    const preparation = await prepare([
      fact("s", { kind: "skill", key: "skill", value: "TypeScript" }),
      fact("e", { kind: "employment", key: "email", value: "not-an-email-fact" }),
    ]);
    expect(preparation.fields).toEqual([]);
  });

  it("produces packet input that assembles into an auto-approved mapped field and reviewed entries", async () => {
    const preparation = await prepare(
      [fact("a")],
      [{ fieldKey: "job.notice_period", value: "2 weeks" }],
    );
    const packet = assemblePacket(
      {
        id: PACKET_ID,
        userId: USER_ID,
        applicationId: APPLICATION_ID,
        canonicalJobId: JOB_ID,
        version: 1,
        jobRevision: preparation.jobRevision,
        form: { adapterId: "greenhouse", variantId: "board-v1", formHash: HASH_B },
        fields: preparation.fields,
        artifactHashes: preparation.artifactHashes,
        createdAt: NOW,
      },
      definitions,
    );
    const email = packet.fields.find((entry) => entry.fieldKey === "contact.email");
    expect(email).toMatchObject({ disposition: "auto", requiresReview: false });
  });

  it("hashes job facts deterministically regardless of key order", () => {
    expect(jobRevisionHash({ a: 1, b: 2 })).toBe(jobRevisionHash({ b: 2, a: 1 }));
    expect(jobRevisionHash({ a: 1 })).not.toBe(jobRevisionHash({ a: 2 }));
  });
});

describe("FACT_FIELD_MAP", () => {
  const taxonomy = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL("../../../../data/taxonomies/application-fields.v1.json", import.meta.url),
      ),
      "utf8",
    ),
  ) as {
    fields: Array<{ key: string; valueType: string; sensitivity: string; answerPolicy: string }>;
  };
  const byKey = new Map(taxonomy.fields.map((field) => [field.key, field]));

  it("is exactly the owner-approved convention", () => {
    expect(FACT_FIELD_MAP.map((m) => `${m.kind}/${m.key} -> ${m.fieldKey}`)).toEqual([
      "identity/legal_name.first -> identity.legal_name.first",
      "identity/legal_name.middle -> identity.legal_name.middle",
      "identity/legal_name.last -> identity.legal_name.last",
      "identity/preferred_name -> identity.preferred_name",
      "identity/email -> contact.email",
      "identity/phone -> contact.phone",
      "identity/address.line1 -> contact.address.line1",
      "identity/address.city -> contact.address.city",
      "identity/address.region -> contact.address.region",
      "identity/address.postal_code -> contact.address.postal_code",
      "identity/linkedin -> links.linkedin",
      "identity/portfolio -> links.portfolio",
      "identity/github -> links.github",
      "employment/current_company -> employment.current_company",
      "employment/current_title -> employment.current_title",
      "employment/start_date -> employment.start_date",
      "employment/end_date -> employment.end_date",
      "education/school -> education.school",
      "education/degree -> education.degree",
      "education/field -> education.field",
      "education/graduation_date -> education.graduation_date",
      "preference/notice_period -> job.notice_period",
      "preference/available_start_date -> job.available_start_date",
      "preference/salary_expectation -> job.salary_expectation",
      "preference/relocation -> job.relocation",
      "preference/remote_preference -> job.remote_preference",
    ]);
  });

  it("only names real fields with the declared value type, and never a restricted or never-infer field", () => {
    const seenFields = new Set<string>();
    const seenFacts = new Set<string>();
    for (const mapping of FACT_FIELD_MAP) {
      const definition = byKey.get(mapping.fieldKey);
      expect(definition, mapping.fieldKey).toBeDefined();
      expect(definition?.valueType, mapping.fieldKey).toBe(mapping.valueType);
      expect(definition?.sensitivity, mapping.fieldKey).not.toBe("restricted");
      expect(definition?.answerPolicy, mapping.fieldKey).not.toBe("never_infer");
      expect(mapping.fieldKey).not.toMatch(
        /^(authorization|disclosure|demographic|attestation|signature|questions|documents)\./u,
      );
      expect(seenFields.has(mapping.fieldKey)).toBe(false);
      expect(seenFacts.has(`${mapping.kind}/${mapping.key}`)).toBe(false);
      seenFields.add(mapping.fieldKey);
      seenFacts.add(`${mapping.kind}/${mapping.key}`);
    }
  });

  const sample: Record<string, GraphFact["value"]> = {
    string: "Springfield",
    enum: "remote",
    date: "2021-03-15",
    decimal: 120000,
    boolean: true,
  };

  it("fills every mapped field from exactly one confirmed usable fact of the right shape", async () => {
    const taxonomyDefinitions = new Map(
      taxonomy.fields.map((f) => [f.key, f as unknown as FieldDefinition]),
    );
    for (const [index, mapping] of FACT_FIELD_MAP.entries()) {
      const id = `11111111-0000-7000-8000-${String(index + 1).padStart(12, "0")}`;
      const preparation = await prepare([
        fact(id, {
          kind: mapping.kind as GraphFact["kind"],
          key: mapping.key,
          value: sample[mapping.valueType] as never,
        }),
      ]);
      expect(preparation.fields, mapping.fieldKey).toEqual([
        expect.objectContaining({
          fieldKey: mapping.fieldKey,
          value: sample[mapping.valueType],
          origin: "confirmed_fact",
          sourceFactIds: [id],
          sourceConfirmed: true,
        }),
      ]);
      expect(taxonomyDefinitions.has(mapping.fieldKey)).toBe(true);
    }
  });

  it("leaves a field to the candidate when the fact's value does not fit its type", async () => {
    const misfits: Array<[string, string, GraphFact["value"]]> = [
      ["employment", "start_date", "March 2021"],
      ["employment", "start_date", "2021-02-30"],
      ["preference", "salary_expectation", "120000"],
      ["preference", "salary_expectation", -5],
      ["preference", "relocation", "yes"],
      ["identity", "phone", 5551234],
      ["identity", "phone", "   "],
      ["identity", "linkedin", ["a", "b"]],
      ["identity", "preferred_name", "x".repeat(501)],
    ];
    for (const [kind, key, value] of misfits) {
      const preparation = await prepare([
        fact("11111111-0000-7000-8000-000000000001", {
          kind: kind as GraphFact["kind"],
          key,
          value: value as never,
        }),
      ]);
      expect(preparation.fields, `${kind}/${key}=${String(value)}`).toEqual([]);
    }
  });

  it("chooses nothing when confirmed facts compete for one field, and ignores facts that are not usable", async () => {
    const competing = await prepare([
      fact("11111111-0000-7000-8000-000000000001", {
        kind: "employment",
        key: "current_title",
        value: "Engineer",
      }),
      fact("11111111-0000-7000-8000-000000000002", {
        kind: "employment",
        key: "current_title",
        value: "Staff Engineer",
      }),
    ]);
    expect(competing.fields).toEqual([]);
    const unconfirmed = await prepare([
      fact("11111111-0000-7000-8000-000000000003", {
        kind: "education",
        key: "school",
        value: "Example University",
        verification: "proposed" as never,
      }),
    ]);
    expect(unconfirmed.fields).toEqual([]);
  });

  it("never turns a fact into a restricted or unmapped field, and lets the candidate's own entry win", async () => {
    const unmapped = await prepare([
      fact("11111111-0000-7000-8000-000000000004", { kind: "identity", key: "gender", value: "x" }),
      fact("11111111-0000-7000-8000-000000000005", {
        kind: "preference",
        key: "us_authorized",
        value: true,
      }),
      fact("11111111-0000-7000-8000-000000000006", {
        kind: "skill",
        key: "skill",
        value: "TypeScript",
      }),
    ]);
    expect(unmapped.fields).toEqual([]);
    const entered = await prepare(
      [
        fact("11111111-0000-7000-8000-000000000007", {
          kind: "preference",
          key: "notice_period",
          value: "2 weeks",
        }),
      ],
      [{ fieldKey: "job.notice_period", value: "4 weeks" }],
    );
    expect(entered.fields).toEqual([
      expect.objectContaining({
        fieldKey: "job.notice_period",
        value: "4 weeks",
        origin: "user_entered",
      }),
    ]);
  });
});
