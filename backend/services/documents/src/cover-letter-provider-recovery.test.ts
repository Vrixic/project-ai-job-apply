import { coverLetterContext, prepareCoverLetterPrompt } from "@ai-job-apply/ai-sdk";
import type { GraphFact } from "@ai-job-apply/domain";
import { describe, expect, it, vi } from "vitest";
import { CoverLetterIntegrityError } from "./cover-letter.js";
import {
  COVER_LETTER_PROVIDER_MODEL,
  type CoverLetterProviderDispatch,
  type CoverLetterProviderRequest,
  type CoverLetterProviderResult,
  type CoverLetterProviderSlot,
  coverLetterProviderSha256,
  encodeCoverLetterProviderObject,
} from "./cover-letter-provider-contract.js";
import { CoverLetterProviderRecovery } from "./cover-letter-provider-recovery.js";
import type { CoverLetterMetadata } from "./cover-letter-store.js";

const id = "019a4000-0000-7000-8000-000000000001";
const now = new Date("2026-10-02T12:00:00.000Z");
const fact: GraphFact = {
  id: "synthetic-fact",
  kind: "skill",
  key: "skill",
  value: "TypeScript",
  verification: "confirmed",
  sensitivity: "standard",
  source: { type: "user", reference: "synthetic" },
  version: 1,
};

function fixture() {
  const evidence = {
    facts: [fact],
    job: { title: "Engineer", company: "Synthetic", description: "Build reliable systems." },
    now,
  };
  const binding = coverLetterContext(evidence);
  const identity = {
    id,
    ownerUserId: "synthetic-owner",
    applicationId: "synthetic-application",
    ...binding,
    noticeVersion: "bedrock-cover-letter.v1",
    approvedAt: now,
    expiresAt: new Date(now.getTime() + 15 * 60_000),
  };
  const prompt = prepareCoverLetterPrompt(evidence);
  if (!prompt) throw new Error("Synthetic prompt missing");
  const request: CoverLetterProviderRequest = {
    schemaVersion: 1,
    documentId: id,
    noticeVersion: "bedrock-cover-letter.v1",
    promptVersion: "1.0.0",
    ...binding,
    approvedAt: now.toISOString(),
    expiresAt: identity.expiresAt.toISOString(),
    ...prompt,
    maxOutputChars: 8_000,
  };
  const slots = new Map<CoverLetterProviderSlot, Uint8Array>();
  const saveRequest = () => {
    const bytes = encodeCoverLetterProviderObject("request", request);
    slots.set("request", bytes);
    return coverLetterProviderSha256(bytes);
  };
  const hash = saveRequest();
  const dispatch: CoverLetterProviderDispatch = {
    schemaVersion: 1,
    documentId: id,
    requestSha256: hash,
    state: "claimed",
    dispatchedAt: now.toISOString(),
  };
  const text = JSON.stringify({
    paragraphs: [{ text: "I have experience with TypeScript.", factIds: [fact.id] }],
  });
  const result: CoverLetterProviderResult = {
    schemaVersion: 1,
    documentId: id,
    requestSha256: hash,
    state: "ready",
    dispatchedAt: now.toISOString(),
    text,
    model: COVER_LETTER_PROVIDER_MODEL,
    outputCharacters: text.length,
  };
  const save = () => {
    const hash = saveRequest();
    dispatch.requestSha256 = hash;
    result.requestSha256 = hash;
    slots.set("dispatch", encodeCoverLetterProviderObject("dispatch", dispatch));
    slots.set("result", encodeCoverLetterProviderObject("result", result));
  };
  save();
  const find = vi.fn(async (documentId: string, slot: CoverLetterProviderSlot) => {
    expect(documentId).toBe(id);
    const bytes = slots.get(slot);
    return bytes
      ? {
          objectVersion: "synthetic-version",
          etag: '"synthetic-etag"',
          sha256: coverLetterProviderSha256(bytes),
          sizeBytes: bytes.byteLength,
        }
      : undefined;
  });
  const read = vi.fn(async (_documentId: string, slot: CoverLetterProviderSlot) => {
    const bytes = slots.get(slot);
    if (!bytes) throw new Error("Synthetic missing slot");
    return bytes;
  });
  const metadata: CoverLetterMetadata = {
    id,
    ownerUserId: identity.ownerUserId,
    applicationId: identity.applicationId,
    version: 1,
    jobRevision: binding.jobContextHash,
    confirmedFactsHash: binding.confirmedFactsHash,
    status: "pending",
    objectKey: `normalized/${id}/cover-letter.v1.json`,
    objectVersion: null,
    objectSha256: null,
    contentSha256: null,
    sizeBytes: null,
    promptVersion: null,
    createdAt: now,
  };
  const recovery = new CoverLetterProviderRecovery({ find, read });
  const run = () => recovery.recover(metadata, identity, evidence);
  return {
    run,
    recovery,
    identity,
    metadata,
    evidence,
    request,
    dispatch,
    result,
    slots,
    save,
    find,
    read,
  };
}

describe("private encrypted provider-result recovery", () => {
  it("grounds a valid original result after consent expiry without any provider or write port", async () => {
    const f = fixture();
    f.evidence.now = new Date(now.getTime() + 60 * 60_000);
    expect(await f.run()).toMatchObject({
      status: "needs_review",
      reviewRequired: true,
      sourceFactIds: [fact.id],
      model: COVER_LETTER_PROVIDER_MODEL,
    });
    expect(f.read).toHaveBeenCalledTimes(3);
  });

  it.each(["request", "dispatch", "result"] as const)(
    "returns no result for missing %s",
    async (slot) => {
      const f = fixture();
      f.slots.delete(slot);
      expect(await f.run()).toBeNull();
    },
  );

  it("returns no result for a claimed pending operation", async () => {
    const f = fixture();
    f.slots.set(
      "result",
      encodeCoverLetterProviderObject("result", {
        schemaVersion: 1,
        documentId: id,
        requestSha256: f.result.requestSha256,
        state: "pending",
      }),
    );
    expect(await f.run()).toBeNull();
  });

  it.each([
    "ownerUserId",
    "applicationId",
    "jobRevision",
    "confirmedFactsHash",
    "objectKey",
  ] as const)("rejects mismatched SQL %s before object access", async (field) => {
    const f = fixture();
    f.metadata[field] = "synthetic-mismatch";
    await expect(f.run()).rejects.toBeInstanceOf(CoverLetterIntegrityError);
    expect(f.find).not.toHaveBeenCalled();
  });

  it.each(["system", "user"] as const)(
    "rejects a saved %s prompt not reconstructed from owned evidence",
    async (field) => {
      const f = fixture();
      f.request[field] += " synthetic change";
      f.save();
      await expect(f.run()).rejects.toBeInstanceOf(CoverLetterIntegrityError);
    },
  );

  it("rejects changed owner evidence before object access", async () => {
    const f = fixture();
    f.evidence.facts = [{ ...fact, value: "Rust", version: 2 }];
    await expect(f.run()).rejects.toBeInstanceOf(CoverLetterIntegrityError);
    expect(f.find).not.toHaveBeenCalled();
  });

  it.each([-1, 15 * 60_000 + 1, 1])(
    "rejects unauthorized/future original dispatch offset %i",
    async (offset) => {
      const f = fixture();
      f.dispatch.dispatchedAt = new Date(now.getTime() + offset).toISOString();
      f.result.dispatchedAt = f.dispatch.dispatchedAt;
      f.save();
      await expect(f.run()).rejects.toBeInstanceOf(CoverLetterIntegrityError);
    },
  );

  it("rejects a result with a different original dispatch time", async () => {
    const f = fixture();
    f.result.dispatchedAt = new Date(now.getTime() + 1).toISOString();
    f.save();
    await expect(f.run()).rejects.toBeInstanceOf(CoverLetterIntegrityError);
  });

  it("rejects a ready result before a positive dispatch claim", async () => {
    const f = fixture();
    f.slots.set(
      "dispatch",
      encodeCoverLetterProviderObject("dispatch", {
        schemaVersion: 1,
        documentId: id,
        requestSha256: f.result.requestSha256,
        state: "issued",
      }),
    );
    await expect(f.run()).rejects.toBeInstanceOf(CoverLetterIntegrityError);
  });

  it("rejects bytes that do not match the pinned reference", async () => {
    const f = fixture();
    f.read.mockImplementation(async () => Buffer.from("synthetic corruption"));
    await expect(f.run()).rejects.toBeInstanceOf(CoverLetterIntegrityError);
    const invalid = fixture();
    invalid.find.mockResolvedValue({
      objectVersion: "",
      etag: '"synthetic-etag"',
      sha256: "f".repeat(64),
      sizeBytes: 1,
    });
    await expect(invalid.run()).rejects.toBeInstanceOf(CoverLetterIntegrityError);
    expect(invalid.read).not.toHaveBeenCalled();
  });

  it("rejects results bound to another request", async () => {
    const f = fixture();
    f.result.requestSha256 = "f".repeat(64);
    f.slots.set("result", encodeCoverLetterProviderObject("result", f.result));
    await expect(f.run()).rejects.toBeInstanceOf(CoverLetterIntegrityError);
  });

  it("withholds unsupported claims in an otherwise valid encrypted result", async () => {
    const f = fixture();
    f.result.text = JSON.stringify({
      paragraphs: [{ text: "I built 500 systems.", factIds: [fact.id] }],
    });
    f.save();
    expect(await f.run()).toMatchObject({
      status: "rejected",
      paragraphs: [],
      sourceFactIds: [],
      confidence: 0,
    });
  });

  it("maps malformed provider JSON to a fixed content-free integrity error", async () => {
    const f = fixture();
    f.result.text = "synthetic invalid JSON";
    f.save();
    await expect(f.run()).rejects.toEqual(new CoverLetterIntegrityError());
  });

  it("does not allow saved original consent to be renewed by the caller", async () => {
    const f = fixture();
    f.identity.approvedAt = new Date(now.getTime() + 60 * 60_000);
    f.identity.expiresAt = new Date(f.identity.approvedAt.getTime() + 15 * 60_000);
    await expect(f.run()).rejects.toBeInstanceOf(CoverLetterIntegrityError);
  });
});
