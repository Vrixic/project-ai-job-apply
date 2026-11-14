import { describe, expect, it, vi } from "vitest";
import type { PreparationRecord } from "./preparation.js";
import {
  type CoverLetterPreparationPort,
  createPreparationActivity,
  type PreparationActivityStore,
} from "./preparation-activity.js";

const preparation: PreparationRecord = {
  id: "019d04cf-1f80-7000-8000-000000000070",
  ownerUserId: "019d04cf-1f80-7000-8000-000000000071",
  applicationId: "019d04cf-1f80-7000-8000-000000000072",
  basePacketId: "019d04cf-1f80-7000-8000-000000000073",
  expectedRevision: 2,
  jobContextHash: "a".repeat(64),
  confirmedFactsHash: "b".repeat(64),
  noticeVersion: "bedrock-cover-letter.v1",
  approvedAt: new Date("2026-10-02T12:00:00.000Z"),
  expiresAt: new Date("2026-10-02T12:15:00.000Z"),
  generationClaimedAt: null,
  state: "queued",
  resultPacketId: null,
  errorCode: null,
  createdAt: new Date("2026-10-02T12:00:00.000Z"),
  updatedAt: new Date("2026-10-02T12:00:00.000Z"),
};
const context = {
  jobContextHash: preparation.jobContextHash,
  confirmedFactsHash: preparation.confirmedFactsHash,
};
const letter = { contentSha256: "c".repeat(64), sourceFactIds: [preparation.id], confidence: 0.95 };

function setup() {
  const running = {
    ...preparation,
    state: "running" as const,
    generationClaimedAt: preparation.approvedAt,
  };
  const store = {
    getPreparationVaultReferences: vi.fn<PreparationActivityStore["getPreparationVaultReferences"]>(
      async () => [],
    ),
    getPreparationForEvent: vi.fn(async () => ({ ...preparation })),
    claimPreparationGeneration: vi.fn(async () => ({
      kind: "claimed" as const,
      preparation: running,
    })),
    completePreparation: vi.fn<PreparationActivityStore["completePreparation"]>(async () => ({
      ...running,
      state: "succeeded" as const,
      resultPacketId: preparation.basePacketId,
    })),
    failPreparation: vi.fn(async () => ({
      ...running,
      state: "failed" as const,
      errorCode: "generation_unavailable" as const,
    })),
  };
  const documents = {
    context: vi.fn(async () => context),
    recover: vi.fn<CoverLetterPreparationPort["recover"]>(async () => letter),
    generate: vi.fn<CoverLetterPreparationPort["generate"]>(async () => ({
      kind: "ready" as const,
      letter,
    })),
  };
  return { store, documents, running };
}

describe("identifier-only preparation activity", () => {
  it("passes original scalar material authority to completion while keeping workflow output identifier-only", async () => {
    const { store, documents } = setup();
    const temporaryMaterial = {
      schemaVersion: 1 as const,
      kind: "cover_letter" as const,
      generationId: preparation.id,
      ownerUserId: preparation.ownerUserId,
      applicationId: preparation.applicationId,
      version: 1,
      contentSha256: letter.contentSha256,
      completedAtMs: preparation.approvedAt.getTime(),
      expiresAtMs: preparation.approvedAt.getTime() + 1_800_000,
    };
    documents.generate.mockResolvedValue({
      kind: "ready",
      letter: { ...letter, temporaryMaterial },
    });
    const result = await createPreparationActivity(store, documents)("event", preparation.id);
    expect(store.completePreparation).toHaveBeenCalledWith("event", preparation.id, context, {
      ...letter,
      temporaryMaterial,
    });
    expect(result).toEqual({ preparationId: preparation.id, outcome: "completed" });
    expect(store.completePreparation.mock.calls[0]?.[3].temporaryMaterial).not.toBe(
      temporaryMaterial,
    );
  });

  it("withholds generation when a selected-answer metadata capability is unavailable", async () => {
    const { store, documents } = setup();
    store.getPreparationVaultReferences.mockResolvedValue([
      {
        fieldKey: "authorization.us_authorized",
        id: preparation.id,
        version: 1,
        context: "us",
        questionHash: "a".repeat(64),
        meaningConfirmed: true,
        validUntilEpochMs: null,
      },
    ]);
    expect(
      await createPreparationActivity(store, documents)("event", preparation.id),
    ).toMatchObject({ outcome: "retryable_failure", errorCode: "context_unavailable" });
    expect(documents.generate).not.toHaveBeenCalled();
    expect(store.claimPreparationGeneration).not.toHaveBeenCalled();
  });

  it("rechecks selected metadata before completion without sending answer values to Documents", async () => {
    const { store, documents } = setup();
    const reference = {
      fieldKey: "authorization.us_authorized",
      id: preparation.id,
      version: 1,
      context: "us",
      questionHash: "a".repeat(64),
      meaningConfirmed: true as const,
      validUntilEpochMs: null,
    };
    store.getPreparationVaultReferences.mockResolvedValue([reference]);
    let calls = 0;
    const vault = { readCurrentReference: async () => (++calls === 1 ? reference : undefined) };
    await createPreparationActivity(store, documents, vault)("event", preparation.id);
    expect(store.claimPreparationGeneration).toHaveBeenCalledWith("event", preparation.id, {
      ...context,
      vaultReferences: [reference],
    });
    expect(store.completePreparation).toHaveBeenCalledWith(
      "event",
      preparation.id,
      { ...context, vaultReferences: [] },
      letter,
    );
    expect(documents.generate).toHaveBeenCalledWith(
      expect.objectContaining({ id: preparation.id }),
    );
    expect(documents.generate.mock.calls[0]?.[0]).not.toHaveProperty("vaultReferences");
    expect(calls).toBe(2);
  });

  it("polls an already-reserved Documents dispatch instead of failing or generating again", async () => {
    const { store, documents } = setup();
    const port: CoverLetterPreparationPort = {
      ...documents,
      generate: async () => ({ kind: "in_progress" }),
    };
    expect(await createPreparationActivity(store, port)("event", preparation.id)).toEqual({
      preparationId: preparation.id,
      outcome: "retryable_failure",
      errorCode: "generation_in_progress",
    });
    expect(store.completePreparation).not.toHaveBeenCalled();
    expect(store.failPreparation).not.toHaveBeenCalled();
  });
  it("claims before model access, preserves disclosure time and returns no content", async () => {
    const { store, documents, running } = setup();
    const result = await createPreparationActivity(store, documents)("event", preparation.id);
    expect(result).toEqual({ preparationId: preparation.id, outcome: "completed" });
    expect(documents.generate).toHaveBeenCalledWith(running);
    expect(store.claimPreparationGeneration.mock.invocationCallOrder[0]).toBeLessThan(
      documents.generate.mock.invocationCallOrder[0] ?? 0,
    );
    expect(store.completePreparation).toHaveBeenCalledWith(
      "event",
      preparation.id,
      context,
      letter,
    );
    expect(documents.recover).not.toHaveBeenCalled();
    expect(documents.context).toHaveBeenCalledTimes(2);
  });

  it.each(["succeeded", "failed"] as const)("does nothing for terminal %s", async (state) => {
    const { store, documents } = setup();
    store.getPreparationForEvent.mockResolvedValue({ ...preparation, state });
    await createPreparationActivity(store, documents)("event", preparation.id);
    expect(documents.context).not.toHaveBeenCalled();
    expect(documents.generate).not.toHaveBeenCalled();
  });

  it("never generates on expired or invalidated claims", async () => {
    const { store, documents } = setup();
    const port: PreparationActivityStore = {
      ...store,
      claimPreparationGeneration: async () => ({
        kind: "terminal",
        preparation: { ...preparation, state: "failed", errorCode: "disclosure_expired" },
      }),
    };
    await createPreparationActivity(port, documents)("event", preparation.id);
    expect(documents.generate).not.toHaveBeenCalled();
    expect(store.completePreparation).not.toHaveBeenCalled();
  });

  it("recovers a saved draft without another model call after repeated delivery", async () => {
    const { store, documents, running } = setup();
    const port: PreparationActivityStore = {
      ...store,
      claimPreparationGeneration: async () => ({ kind: "already_claimed", preparation: running }),
    };
    await createPreparationActivity(port, documents)("event", preparation.id);
    expect(documents.recover).toHaveBeenCalledOnce();
    expect(documents.generate).not.toHaveBeenCalled();
    expect(store.completePreparation).toHaveBeenCalledOnce();
  });

  it("polls an in-progress claim and retries unavailable artifacts without regeneration", async () => {
    const { store, documents, running } = setup();
    const port: PreparationActivityStore = {
      ...store,
      claimPreparationGeneration: async () => ({ kind: "already_claimed", preparation: running }),
    };
    const activity = createPreparationActivity(port, documents);
    documents.recover.mockResolvedValueOnce(null);
    expect(await activity("event", preparation.id)).toMatchObject({
      outcome: "retryable_failure",
      errorCode: "generation_in_progress",
    });
    documents.recover.mockRejectedValueOnce(new Error("synthetic artifact details"));
    expect(await activity("event", preparation.id)).toMatchObject({
      outcome: "retryable_failure",
      errorCode: "artifact_unavailable",
    });
    expect(documents.generate).not.toHaveBeenCalled();
    expect(store.failPreparation).not.toHaveBeenCalled();
  });

  it("retries context I/O before and after generation without renewing consent", async () => {
    const { store, documents } = setup();
    const activity = createPreparationActivity(store, documents);
    documents.context.mockRejectedValueOnce(new Error("synthetic context error"));
    expect(await activity("event", preparation.id)).toMatchObject({
      outcome: "retryable_failure",
      errorCode: "context_unavailable",
    });
    expect(store.claimPreparationGeneration).not.toHaveBeenCalled();
    documents.context
      .mockResolvedValueOnce(context)
      .mockRejectedValueOnce(new Error("synthetic later error"));
    expect(await activity("event", preparation.id)).toMatchObject({
      outcome: "retryable_failure",
      errorCode: "context_unavailable",
    });
    expect(documents.generate).toHaveBeenCalledOnce();
    expect(store.completePreparation).not.toHaveBeenCalled();
  });

  it("makes an ambiguous generation error terminal without reflecting it", async () => {
    const { store, documents } = setup();
    documents.generate.mockRejectedValueOnce(
      new Error("synthetic candidate prompt and provider credential"),
    );
    const result = await createPreparationActivity(store, documents)("event", preparation.id);
    expect(result).toEqual({ preparationId: preparation.id, outcome: "completed" });
    expect(store.failPreparation).toHaveBeenCalledWith(
      "event",
      preparation.id,
      "generation_unavailable",
    );
    expect(store.completePreparation).not.toHaveBeenCalled();
  });

  it("records a fixed refusal without exposing ungrounded paragraphs", async () => {
    const { store, documents } = setup();
    const port: CoverLetterPreparationPort = {
      ...documents,
      generate: async () => ({ kind: "failed", errorCode: "grounding_failed" }),
    };
    await createPreparationActivity(store, port)("event", preparation.id);
    expect(store.failPreparation).toHaveBeenCalledWith("event", preparation.id, "grounding_failed");
    expect(store.completePreparation).not.toHaveBeenCalled();
  });
});
