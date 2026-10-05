import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type CoverLetterGeneration,
  CoverLetterIntegrityError,
  CoverLetterRenderError,
  coverLetterFile,
  coverLetterPreview,
  createCoverLetterDocument,
  decodeCoverLetterDocument,
  encodeCoverLetterDocument,
} from "./cover-letter.js";

const identity = {
  id: randomUUID(),
  ownerUserId: randomUUID(),
  applicationId: randomUUID(),
  version: 1,
  jobRevision: "a".repeat(64),
  confirmedFactsHash: "b".repeat(64),
};
const factId = randomUUID();
const now = new Date("2026-10-02T12:00:00.000Z");
const generation: CoverLetterGeneration = {
  status: "needs_review",
  purpose: "cover_letter",
  reviewRequired: true,
  paragraphs: [{ text: "I build reliable backend systems.", factIds: [factId] }],
  findings: [],
  sourceFactIds: [factId],
  confidence: 0.95,
  promptVersion: "cover_letter.v1",
  model: { provider: "openai", model: "gpt-6-luna", version: "gpt-6-luna" },
};
const draft = () => createCoverLetterDocument(identity, generation, now);

describe("immutable grounded cover letters", () => {
  it("round-trips a bounded closed payload and refuses corruption without reflecting it", () => {
    const document = draft();
    expect(decodeCoverLetterDocument(encodeCoverLetterDocument(document))).toEqual(document);
    for (const bytes of [
      new Uint8Array(),
      new Uint8Array(32_769),
      new Uint8Array([0xff]),
      new TextEncoder().encode("synthetic invalid JSON"),
      new TextEncoder().encode(JSON.stringify({ ...document, prompt: "synthetic hidden text" })),
      new TextEncoder().encode(JSON.stringify({ ...document, ownerUserId: null })),
      new TextEncoder().encode(JSON.stringify({ ...document, paragraphs: null })),
      new TextEncoder().encode(JSON.stringify({ ...document, contentSha256: "c".repeat(64) })),
    ]) {
      expect(() => decodeCoverLetterDocument(bytes)).toThrow(CoverLetterIntegrityError);
    }
  });
  it("withholds unavailable, ungrounded, non-cover-letter and unreviewable drafts", () => {
    for (const changes of [
      { status: "rejected" },
      { status: "refused" },
      { status: "unavailable" },
      { purpose: "narrative_answer" },
      { reviewRequired: false },
      { findings: [{ code: "unknown_fact" }] },
      { sourceFactIds: [] },
      { confidence: Number.NaN },
      { confidence: -0.1 },
      { confidence: 1.1 },
      { model: undefined },
      { model: { ...generation.model, model: "other" } },
      { paragraphs: [] },
      { paragraphs: [{ text: "", factIds: [factId] }] },
      { paragraphs: [{ text: "x".repeat(1201), factIds: [factId] }] },
    ]) {
      expect(() =>
        createCoverLetterDocument(
          identity,
          { ...generation, ...changes } as CoverLetterGeneration,
          now,
        ),
      ).toThrow(CoverLetterIntegrityError);
    }
    expect(() => createCoverLetterDocument(identity, generation, new Date(Number.NaN))).toThrow(
      CoverLetterIntegrityError,
    );
  });

  it("binds text, citations, job, confirmed evidence and prompt version", () => {
    const original = draft();
    for (const changes of [
      { jobRevision: "c".repeat(64) },
      { confirmedFactsHash: "d".repeat(64) },
    ]) {
      expect(
        createCoverLetterDocument({ ...identity, ...changes }, generation, now).contentSha256,
      ).not.toBe(original.contentSha256);
    }
    for (const changes of [
      { promptVersion: "cover_letter.v2" },
      { paragraphs: [{ text: "I build reliable APIs.", factIds: [factId] }] },
    ]) {
      expect(
        createCoverLetterDocument(identity, { ...generation, ...changes }, now).contentSha256,
      ).not.toBe(original.contentSha256);
    }
    const otherFact = randomUUID();
    expect(
      createCoverLetterDocument(
        identity,
        {
          ...generation,
          paragraphs: [{ text: generation.paragraphs[0]?.text ?? "", factIds: [otherFact] }],
          sourceFactIds: [otherFact],
        },
        now,
      ).contentSha256,
    ).not.toBe(original.contentSha256);
    expect(
      createCoverLetterDocument(
        { ...identity, id: randomUUID(), version: 2 },
        generation,
        new Date("2026-10-02T12:01:00.000Z"),
      ).contentSha256,
    ).toBe(original.contentSha256);
  });

  it("detaches candidate previews and requires owner, application and hash integrity", () => {
    const document = draft();
    const preview = coverLetterPreview(
      document,
      identity.ownerUserId,
      identity.applicationId,
      document.contentSha256,
    );
    expect(preview).toMatchObject({ status: "ready", matchesPacket: true, reviewRequired: true });
    if (preview.status !== "ready") throw new Error("Expected synthetic draft");
    preview.paragraphs[0]?.factIds.push(randomUUID());
    expect(document.paragraphs[0]?.factIds).toEqual([factId]);
    expect(
      coverLetterPreview(document, identity.ownerUserId, identity.applicationId, "e".repeat(64))
        .matchesPacket,
    ).toBe(false);
    for (const [owner, app] of [
      [randomUUID(), identity.applicationId],
      [identity.ownerUserId, randomUUID()],
    ]) {
      expect(() =>
        coverLetterPreview(document, owner ?? "", app ?? "", document.contentSha256),
      ).toThrow(CoverLetterIntegrityError);
    }
    const altered = { ...document, paragraphs: [{ text: "Invented claim.", factIds: [factId] }] };
    expect(() =>
      coverLetterPreview(
        altered,
        identity.ownerUserId,
        identity.applicationId,
        document.contentSha256,
      ),
    ).toThrow(CoverLetterIntegrityError);
  });
});

describe("packet-bound cover-letter rendering", () => {
  it.each(["pdf", "docx"] as const)(
    "verifies %s using the production parser without generation",
    async (format) => {
      const document = draft();
      const artifact = await coverLetterFile(
        document,
        identity.ownerUserId,
        identity.applicationId,
        document.contentSha256,
        format,
      );
      expect(artifact.contentSha256).toBe(document.contentSha256);
      expect(artifact.sizeBytes).toBe(Buffer.from(artifact.contentBase64, "base64").length);
      expect(artifact.sizeBytes).toBeGreaterThan(0);
      if (format === "pdf") {
        expect(Buffer.from(artifact.contentBase64, "base64").subarray(0, 5).toString()).toBe(
          "%PDF-",
        );
      }
      expect(artifact.fileName).toBe(`cover-letter.${format}`);
      expect(
        await coverLetterFile(
          document,
          identity.ownerUserId,
          identity.applicationId,
          document.contentSha256,
          format,
        ),
      ).toEqual(artifact);
    },
  );

  it("refuses wrong packet and owner before rendering", async () => {
    const document = draft();
    await expect(
      coverLetterFile(
        document,
        identity.ownerUserId,
        identity.applicationId,
        "e".repeat(64),
        "docx",
      ),
    ).rejects.toThrow(CoverLetterIntegrityError);
    await expect(
      coverLetterFile(
        document,
        randomUUID(),
        identity.applicationId,
        document.contentSha256,
        "pdf",
      ),
    ).rejects.toThrow(CoverLetterIntegrityError);
  });

  it("returns fixed render failure without reflecting unsupported candidate text", async () => {
    const document = createCoverLetterDocument(
      identity,
      {
        ...generation,
        paragraphs: [{ text: "Synthetic 😀 private text.", factIds: [factId] }],
      },
      now,
    );
    await expect(
      coverLetterFile(
        document,
        identity.ownerUserId,
        identity.applicationId,
        document.contentSha256,
        "pdf",
      ),
    ).rejects.toThrow(CoverLetterRenderError);
  });
});
