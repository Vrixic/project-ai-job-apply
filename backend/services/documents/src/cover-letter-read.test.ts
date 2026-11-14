import { coverLetterContext } from "@ai-job-apply/ai-sdk";
import type { GraphFact } from "@ai-job-apply/domain";
import { describe, expect, it, vi } from "vitest";
import { CoverLetterIntegrityError, createCoverLetterDocument } from "./cover-letter.js";
import { CoverLetterReadService, type CoverLetterReadStore } from "./cover-letter-read.js";

const now = new Date("2026-10-02T12:00:00Z");
const owner = "019d04cf-1f80-7000-8000-000000000001";
const application = "019d04cf-1f80-7000-8000-000000000002";
const fact: GraphFact = {
  id: "019d04cf-1f80-7000-8000-000000000003",
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
    job: { title: "Engineer", company: "Synthetic", description: "Build systems." },
  };
  const context = coverLetterContext({ ...evidence, now });
  const document = createCoverLetterDocument(
    {
      id: "019d04cf-1f80-7000-8000-000000000004",
      ownerUserId: owner,
      applicationId: application,
      version: 1,
      jobRevision: context.jobContextHash,
      confirmedFactsHash: context.confirmedFactsHash,
    },
    {
      status: "needs_review",
      purpose: "cover_letter",
      reviewRequired: true,
      paragraphs: [{ text: "I have experience with TypeScript.", factIds: [fact.id] }],
      findings: [],
      sourceFactIds: [fact.id],
      confidence: 1,
      promptVersion: "cover_letter.v1",
      model: {
        provider: "bedrock",
        model: "us.anthropic.claude-sonnet-4-6",
        version: "us.anthropic.claude-sonnet-4-6",
      },
    },
    now,
  );
  let leased = false;
  const read = vi.fn(async (app: string, hash: string) => {
    expect(leased).toBe(true);
    return app === application && hash === document.contentSha256 ? document : null;
  });
  const load = vi.fn(async (user: string, app: string) => {
    expect(leased).toBe(true);
    expect(user).toBe(owner);
    expect(app).toBe(application);
    return evidence;
  });
  const store: CoverLetterReadStore = {
    withReadLease: async (user, run) => {
      expect(user).toBe(owner);
      expect(leased).toBe(false);
      leased = true;
      try {
        return await run({ read });
      } finally {
        leased = false;
      }
    },
  };
  return {
    service: new CoverLetterReadService(store, { load }, () => now),
    store,
    read,
    load,
    document,
    evidence,
    context,
  };
}

describe("private cover-letter read boundary", () => {
  it("serves all four existing reads with only read/evidence capabilities and no nested lease", async () => {
    const f = fixture();
    expect(await f.service.context({ ownerUserId: owner, applicationId: application })).toEqual(
      f.context,
    );
    expect(await f.service.binding(owner, application, f.document.contentSha256)).toBe(
      f.document.contentSha256,
    );
    expect(await f.service.preview(owner, application, f.document.contentSha256)).toMatchObject({
      status: "ready",
      matchesPacket: true,
      reviewRequired: true,
    });
    for (const format of ["pdf", "docx"] as const) {
      expect(
        await f.service.file(owner, application, f.document.contentSha256, format),
      ).toMatchObject({ format, contentSha256: f.document.contentSha256 });
    }
    expect(Object.getOwnPropertyNames(CoverLetterReadService.prototype).sort()).toEqual([
      "binding",
      "constructor",
      "context",
      "file",
      "matches",
      "ownedContext",
      "preview",
    ]);
  });

  it("preserves empty and missing exact-packet behavior without loading evidence", async () => {
    const f = fixture();
    expect(await f.service.binding(owner, application, undefined)).toBeUndefined();
    expect(await f.service.preview(owner, application, undefined)).toEqual({
      status: "no_cover_letter",
      matchesPacket: false,
    });
    expect(f.read).not.toHaveBeenCalled();
    expect(await f.service.binding(owner, application, "a".repeat(64))).toBeUndefined();
    await expect(f.service.file(owner, application, "a".repeat(64), "pdf")).rejects.toThrow(
      CoverLetterIntegrityError,
    );
    expect(f.load).not.toHaveBeenCalled();
  });

  it("invalidates binding/files but preserves reviewable stale previews", async () => {
    const f = fixture();
    f.evidence.job.description += " Changed.";
    expect(await f.service.binding(owner, application, f.document.contentSha256)).toBeUndefined();
    expect(await f.service.preview(owner, application, f.document.contentSha256)).toMatchObject({
      status: "ready",
      matchesPacket: false,
    });
    await expect(
      f.service.file(owner, application, f.document.contentSha256, "docx"),
    ).rejects.toThrow(CoverLetterIntegrityError);
  });

  it("refuses all reads before evidence or object access when candidate lease is denied", async () => {
    const f = fixture();
    f.store.withReadLease = async () => {
      throw new Error("Synthetic inactive candidate");
    };
    await expect(
      f.service.context({ ownerUserId: owner, applicationId: application }),
    ).rejects.toThrow("Synthetic inactive candidate");
    await expect(f.service.binding(owner, application, f.document.contentSha256)).rejects.toThrow(
      "Synthetic inactive candidate",
    );
    await expect(f.service.preview(owner, application, undefined)).rejects.toThrow(
      "Synthetic inactive candidate",
    );
    await expect(
      f.service.file(owner, application, f.document.contentSha256, "pdf"),
    ).rejects.toThrow("Synthetic inactive candidate");
    expect(f.load).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
  });
});
