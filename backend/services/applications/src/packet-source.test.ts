import type { GraphFact } from "@ai-job-apply/domain";
import { describe, expect, it } from "vitest";
import { assemblePacket } from "./packet.js";
import { FactBackedPacketSource, jobRevisionHash } from "./packet-source.js";
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
