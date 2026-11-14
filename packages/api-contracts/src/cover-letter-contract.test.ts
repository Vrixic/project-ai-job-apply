import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  COVER_LETTER_DISCLOSURE_TEXT,
  COVER_LETTER_DISCLOSURE_VERSION,
  compileComponentValidator,
  contract,
} from "./index.js";

const disclosure = { noticeVersion: "bedrock-cover-letter.v1", acknowledged: true };
const now = "2026-10-02T12:00:00.000Z";

describe("explicit cover-letter preparation", () => {
  const validate = compileComponentValidator("PrepareApplicationPacketRequest");

  it("binds acknowledgement to the published provider, retention and mandatory-review notice", () => {
    expect(disclosure.noticeVersion).toBe(COVER_LETTER_DISCLOSURE_VERSION);
    expect(COVER_LETTER_DISCLOSURE_TEXT).toContain("Amazon Bedrock");
    expect(COVER_LETTER_DISCLOSURE_TEXT).toContain("Claude Sonnet 4.6");
    expect(COVER_LETTER_DISCLOSURE_TEXT).not.toContain("OpenAI");
    expect(COVER_LETTER_DISCLOSURE_TEXT).toContain("non-restricted");
    expect(COVER_LETTER_DISCLOSURE_TEXT).toContain("train models");
    expect(COVER_LETTER_DISCLOSURE_TEXT).toContain("those terms can change");
    expect(COVER_LETTER_DISCLOSURE_TEXT).toContain("within 30 minutes");
    expect(COVER_LETTER_DISCLOSURE_TEXT).toContain("You must review");
    expect(COVER_LETTER_DISCLOSURE_TEXT).toContain("You can decline");
  });

  it("preserves requests without generation and requires exact affirmative disclosure", () => {
    expect(validate({ expectedRevision: 1 })).toBe(true);
    expect(validate({ expectedRevision: 1, coverLetter: { disclosure } })).toBe(true);
    for (const coverLetter of [
      true,
      false,
      {},
      null,
      { disclosure: {} },
      { disclosure: { ...disclosure, acknowledged: false } },
      { disclosure: { ...disclosure, noticeVersion: "old-notice" } },
      { disclosure: { ...disclosure, approvedAt: now } },
      { disclosure, provider: "other" },
      { disclosure, model: "other" },
    ]) {
      expect(validate({ expectedRevision: 1, coverLetter })).toBe(false);
    }
  });

  it("keeps the synchronous response and defines a separate accepted operation", () => {
    const responses = contract.paths["/applications/{applicationId}/packets"].post.responses;
    expect(responses["201"].content["application/json"].schema.$ref).toBe(
      "#/components/schemas/Application",
    );
    expect(responses["202"].content["application/json"].schema.$ref).toBe(
      "#/components/schemas/ApplicationPacketPreparation",
    );
    expect(responses["202"].headers["Cache-Control"].schema.enum).toEqual(["no-store"]);
  });
});

describe("durable preparation status", () => {
  const validate = compileComponentValidator("ApplicationPacketPreparation");
  const base = { id: randomUUID(), applicationId: randomUUID(), createdAt: now, updatedAt: now };
  const result = {
    packetId: randomUUID(),
    revision: 3,
  };

  it("requires successful state to carry an immutable packet reference, not mutable application state", () => {
    expect(validate({ ...base, state: "succeeded", result })).toBe(true);
    expect(validate({ ...base, state: "succeeded" })).toBe(false);
    expect(validate({ ...base, state: "succeeded", result: { ...result, paragraphs: [] } })).toBe(
      false,
    );
    expect(validate({ ...base, state: "succeeded", result: { packetId: result.packetId } })).toBe(
      false,
    );
    expect(validate({ ...base, state: "succeeded", result, errorCode: "render_failed" })).toBe(
      false,
    );
  });

  it("requires fixed failure codes and withholds draft text from incomplete operations", () => {
    expect(validate({ ...base, state: "failed", errorCode: "grounding_failed" })).toBe(true);
    for (const state of ["queued", "running"]) {
      expect(validate({ ...base, state })).toBe(true);
      expect(validate({ ...base, state, result })).toBe(false);
      expect(validate({ ...base, state, errorCode: "render_failed" })).toBe(false);
    }
    expect(validate({ ...base, state: "failed" })).toBe(false);
    expect(validate({ ...base, state: "failed", errorCode: "raw provider error" })).toBe(false);
    expect(validate({ ...base, state: "running", prompt: "candidate text" })).toBe(false);
  });
});

describe("immutable cover-letter preview", () => {
  const validate = compileComponentValidator("ApplicationCoverLetterPreview");
  const ready = {
    status: "ready",
    documentId: randomUUID(),
    version: 1,
    contentSha256: "a".repeat(64),
    matchesPacket: true,
    reviewRequired: true,
    paragraphs: [{ text: "I build synthetic test systems.", factIds: [randomUUID()] }],
    model: {
      provider: "bedrock",
      model: "us.anthropic.claude-sonnet-4-6",
      version: "us.anthropic.claude-sonnet-4-6",
    },
    promptVersion: "cover_letter.v1",
  };

  it("requires provenance and review, with no text when a letter is absent", () => {
    expect(validate(ready)).toBe(true);
    expect(validate({ ...ready, reviewRequired: false })).toBe(false);
    expect(validate({ ...ready, paragraphs: [{ text: "Unsupported.", factIds: [] }] })).toBe(false);
    expect(validate({ ...ready, model: { ...ready.model, model: "other" } })).toBe(false);
    expect(validate({ status: "no_cover_letter", matchesPacket: false })).toBe(true);
    expect(validate({ status: "no_cover_letter", matchesPacket: true })).toBe(false);
    expect(
      validate({ status: "no_cover_letter", matchesPacket: false, paragraphs: ready.paragraphs }),
    ).toBe(false);
  });
});
