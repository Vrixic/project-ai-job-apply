import { coverLetterContext, ModelGateway, type ModelProvider } from "@ai-job-apply/ai-sdk";
import type { GraphFact } from "@ai-job-apply/domain";
import { describe, expect, it, vi } from "vitest";
import { type CoverLetterDocument, CoverLetterIntegrityError } from "./cover-letter.js";
import {
  CoverLetterGenerationService,
  type CoverLetterGenerationStore,
  type CoverLetterPreparationIdentity,
} from "./cover-letter-generation.js";
import type { CoverLetterMetadata, PostgresCoverLetterStore } from "./cover-letter-store.js";

const NOW = new Date("2026-10-02T12:00:00Z");
const fact: GraphFact = {
  id: "019d04cf-1f80-7000-8000-000000000001",
  kind: "skill",
  key: "skill",
  value: "TypeScript",
  verification: "confirmed",
  sensitivity: "standard",
  source: { type: "user", reference: "synthetic" },
  version: 1,
};
const job = { title: "Engineer", company: "Synthetic", description: "Build reliable systems." };
const text = "I have experience with TypeScript.";

function setup(options: { enabled?: boolean; output?: string; facts?: GraphFact[] } = {}) {
  let now = NOW;
  const facts = options.facts ?? [fact];
  const source = { load: vi.fn(async () => ({ facts, job })) };
  const identity: CoverLetterPreparationIdentity = {
    id: "019d04cf-1f80-7000-8000-000000000002",
    ownerUserId: "019d04cf-1f80-7000-8000-000000000003",
    applicationId: "019d04cf-1f80-7000-8000-000000000004",
    ...coverLetterContext({ facts, job, now }),
    noticeVersion: "openai-cover-letter.v1",
    approvedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 15 * 60_000),
  };
  let metadata: CoverLetterMetadata | null = null;
  let saved: CoverLetterDocument | null = null;
  const store = {
    reserveGeneration: vi.fn<PostgresCoverLetterStore["reserveGeneration"]>(async (input) => {
      if (metadata) return { kind: "already_reserved", metadata };
      metadata = {
        ...input,
        version: 1,
        status: "pending",
        objectKey: `normalized/${input.id}/cover-letter.v1.json`,
        objectVersion: null,
        objectSha256: null,
        contentSha256: null,
        sizeBytes: null,
        promptVersion: null,
        createdAt: NOW,
      };
      return { kind: "claimed", metadata };
    }),
    withGenerationLease: vi.fn<CoverLetterGenerationStore["withGenerationLease"]>(
      async (_owner, run) => run(),
    ),
    complete: vi.fn<PostgresCoverLetterStore["complete"]>(async (document) => {
      saved = document;
      if (!metadata) throw new Error("Synthetic missing reservation");
      metadata = { ...metadata, status: "ready", contentSha256: document.contentSha256 };
      return metadata;
    }),
    recover: vi.fn<PostgresCoverLetterStore["recover"]>(async (input) =>
      saved?.id === input.id &&
      saved.ownerUserId === input.ownerUserId &&
      saved.applicationId === input.applicationId
        ? saved
        : null,
    ),
    read: vi.fn<PostgresCoverLetterStore["read"]>(async (owner, application, hash) =>
      saved?.ownerUserId === owner &&
      saved.applicationId === application &&
      saved.contentSha256 === hash
        ? saved
        : null,
    ),
  };
  // Offline transport only. The fixed identity exercises Documents validation, not a live model.
  const complete = vi.fn<ModelProvider["complete"]>(async () => ({
    text: options.output ?? JSON.stringify({ paragraphs: [{ text, factIds: [fact.id] }] }),
  }));
  const provider: ModelProvider = {
    identity: { provider: "openai", model: "gpt-6-luna", version: "gpt-6-luna" },
    complete,
  };
  const gateway = new ModelGateway(provider, {
    enabled: () => options.enabled === true,
    clock: () => now,
  });
  const service = new CoverLetterGenerationService(store, source, gateway, () => now);
  return {
    service,
    store,
    source,
    complete,
    identity,
    clock: (value: Date) => {
      now = value;
    },
    saved: () => saved,
  };
}

describe("private grounded cover-letter generation service", () => {
  it("uses owner evidence, reserves and leases before one model call, verifies both formats and recovers", async () => {
    const fixture = setup({ enabled: true });
    const outcome = await fixture.service.generate(fixture.identity);
    expect(outcome).toEqual({
      kind: "ready",
      letter: {
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        sourceFactIds: [fact.id],
        confidence: 1,
      },
    });
    expect(JSON.stringify(outcome)).not.toContain(text);
    expect(fixture.store.reserveGeneration.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.complete.mock.invocationCallOrder[0] ?? 0,
    );
    expect(fixture.store.withGenerationLease).toHaveBeenCalledWith(
      fixture.identity.ownerUserId,
      expect.any(Function),
    );
    expect(fixture.source.load).toHaveBeenCalledWith(
      fixture.identity.ownerUserId,
      fixture.identity.applicationId,
    );
    expect(fixture.store.complete).toHaveBeenCalledTimes(1);
    expect(await fixture.service.generate(fixture.identity)).toEqual(outcome);
    expect(fixture.complete).toHaveBeenCalledTimes(1);
    expect(fixture.store.complete).toHaveBeenCalledTimes(1);
    const document = fixture.saved();
    expect(document?.paragraphs).toEqual([{ text, factIds: [fact.id] }]);
    if (!document) throw new Error("Synthetic missing draft");
    expect(
      await fixture.service.binding(
        document.ownerUserId,
        document.applicationId,
        document.contentSha256,
      ),
    ).toBe(document.contentSha256);
    expect(
      await fixture.service.preview(
        document.ownerUserId,
        document.applicationId,
        document.contentSha256,
      ),
    ).toMatchObject({ status: "ready", matchesPacket: true, reviewRequired: true });
    for (const format of ["pdf", "docx"] as const) {
      expect(
        await fixture.service.file(
          document.ownerUserId,
          document.applicationId,
          document.contentSha256,
          format,
        ),
      ).toMatchObject({ format, contentSha256: document.contentSha256 });
    }
    expect(fixture.complete).toHaveBeenCalledTimes(1);
  });

  it("leaves model access off unless the ModelGateway explicitly enables it", async () => {
    const fixture = setup();
    expect(await fixture.service.generate(fixture.identity)).toEqual({
      kind: "failed",
      errorCode: "generation_unavailable",
    });
    expect(fixture.complete).not.toHaveBeenCalled();
    expect(fixture.store.complete).not.toHaveBeenCalled();
  });

  it.each([
    "wrong_notice",
    "invalid_approval",
    "invalid_expiry",
    "invalid_clock",
    "future",
    "expired",
    "renewed_window",
  ])("refuses %s before evidence or provider access", async (reason) => {
    const fixture = setup({ enabled: true });
    const input = { ...fixture.identity };
    if (reason === "wrong_notice") input.noticeVersion = "other";
    if (reason === "invalid_approval") input.approvedAt = new Date(Number.NaN);
    if (reason === "invalid_expiry") input.expiresAt = new Date(Number.NaN);
    if (reason === "invalid_clock") fixture.clock(new Date(Number.NaN));
    if (reason === "future") fixture.clock(new Date(NOW.getTime() - 1));
    if (reason === "expired") fixture.clock(new Date(input.expiresAt.getTime() + 1));
    if (reason === "renewed_window") input.expiresAt = new Date(input.expiresAt.getTime() + 1);
    expect(await fixture.service.generate(input)).toEqual({
      kind: "failed",
      errorCode: "disclosure_expired",
    });
    expect(fixture.source.load).not.toHaveBeenCalled();
    expect(fixture.store.reserveGeneration).not.toHaveBeenCalled();
    expect(fixture.complete).not.toHaveBeenCalled();
  });

  it("rechecks unchanged consent after waiting for the generation lease", async () => {
    const fixture = setup({ enabled: true });
    fixture.store.withGenerationLease.mockImplementation(async (_owner, run) => {
      fixture.clock(new Date(fixture.identity.expiresAt.getTime() + 1));
      // Mutating the caller cannot renew the server-owned consent snapshot.
      fixture.identity.approvedAt = new Date(fixture.identity.expiresAt);
      fixture.identity.expiresAt = new Date(fixture.identity.expiresAt.getTime() + 15 * 60_000);
      return run();
    });
    expect(await fixture.service.generate(fixture.identity)).toEqual({
      kind: "failed",
      errorCode: "disclosure_expired",
    });
    expect(fixture.complete).not.toHaveBeenCalled();
  });

  it("preserves the inclusive fifteen-minute consent boundary", async () => {
    const fixture = setup({ enabled: true });
    fixture.clock(new Date(fixture.identity.expiresAt));
    expect(await fixture.service.generate(fixture.identity)).toMatchObject({ kind: "ready" });
    expect(fixture.complete).toHaveBeenCalledTimes(1);
  });

  it("refuses changed evidence before reserving or dispatching", async () => {
    const fixture = setup({ enabled: true });
    expect(
      await fixture.service.generate({ ...fixture.identity, confirmedFactsHash: "a".repeat(64) }),
    ).toEqual({ kind: "failed", errorCode: "bindings_changed" });
    expect(fixture.store.reserveGeneration).not.toHaveBeenCalled();
    expect(fixture.complete).not.toHaveBeenCalled();
  });

  it("does not regenerate an existing pending reservation", async () => {
    const fixture = setup({ enabled: true });
    await fixture.store.reserveGeneration({
      ...fixture.identity,
      jobRevision: fixture.identity.jobContextHash,
    });
    expect(await fixture.service.generate(fixture.identity)).toEqual({ kind: "in_progress" });
    expect(fixture.complete).not.toHaveBeenCalled();
    expect(fixture.store.withGenerationLease).not.toHaveBeenCalled();
  });

  it("cannot bypass quarantine by making the model call before acquiring the lease", async () => {
    const fixture = setup({ enabled: true });
    fixture.store.withGenerationLease.mockRejectedValueOnce(
      new Error("Synthetic inactive candidate"),
    );
    await expect(fixture.service.generate(fixture.identity)).rejects.toThrow(
      "Synthetic inactive candidate",
    );
    expect(fixture.complete).not.toHaveBeenCalled();
  });

  it("withholds unsupported claims and does not save or render them", async () => {
    const fixture = setup({
      enabled: true,
      output: JSON.stringify({
        paragraphs: [{ text: "I served 999 partners.", factIds: [fact.id] }],
      }),
    });
    expect(await fixture.service.generate(fixture.identity)).toEqual({
      kind: "failed",
      errorCode: "grounding_failed",
    });
    expect(fixture.store.complete).not.toHaveBeenCalled();
    expect(fixture.saved()).toBeNull();
  });

  it("refuses generation without confirmed non-restricted career evidence", async () => {
    const fixture = setup({ enabled: true, facts: [{ ...fact, sensitivity: "restricted" }] });
    expect(await fixture.service.generate(fixture.identity)).toEqual({
      kind: "failed",
      errorCode: "no_confirmed_evidence",
    });
    expect(fixture.complete).not.toHaveBeenCalled();
  });

  it("withholds an unrenderable draft before ready metadata is written", async () => {
    const fixture = setup({
      enabled: true,
      facts: [{ ...fact, value: "日本" }],
      output: JSON.stringify({
        paragraphs: [{ text: "I have experience with 日本.", factIds: [fact.id] }],
      }),
    });
    expect(await fixture.service.generate(fixture.identity)).toEqual({
      kind: "failed",
      errorCode: "render_failed",
    });
    expect(fixture.store.complete).not.toHaveBeenCalled();
  });

  it("does not repeat the model after an ambiguous persistence failure", async () => {
    const fixture = setup({ enabled: true });
    fixture.store.complete.mockRejectedValueOnce(new Error("Synthetic lost write response"));
    await expect(fixture.service.generate(fixture.identity)).rejects.toThrow(
      "Synthetic lost write response",
    );
    expect(await fixture.service.generate(fixture.identity)).toEqual({ kind: "in_progress" });
    expect(fixture.complete).toHaveBeenCalledTimes(1);
  });

  it("invalidates binding and file access on current context changes without calling a model", async () => {
    const fixture = setup({ enabled: true });
    await fixture.service.generate(fixture.identity);
    const document = fixture.saved();
    if (!document) throw new Error("Synthetic missing draft");
    fixture.source.load.mockResolvedValue({
      facts: [fact],
      job: { ...job, description: `${job.description} Changed.` },
    });
    expect(
      await fixture.service.binding(
        document.ownerUserId,
        document.applicationId,
        document.contentSha256,
      ),
    ).toBeUndefined();
    expect(
      await fixture.service.preview(
        document.ownerUserId,
        document.applicationId,
        document.contentSha256,
      ),
    ).toMatchObject({ status: "ready", matchesPacket: false });
    await expect(
      fixture.service.file(
        document.ownerUserId,
        document.applicationId,
        document.contentSha256,
        "pdf",
      ),
    ).rejects.toThrow(CoverLetterIntegrityError);
    expect(
      await fixture.service.preview(fact.id, document.applicationId, document.contentSha256),
    ).toEqual({ status: "no_cover_letter", matchesPacket: false });
    expect(fixture.complete).toHaveBeenCalledTimes(1);
  });
});
