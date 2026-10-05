import { createHash } from "node:crypto";
import { coverLetterContext, type GenerationResult } from "@ai-job-apply/ai-sdk";
import type { ApplicationCoverLetterFile } from "@ai-job-apply/api-contracts";
import type { GraphFact } from "@ai-job-apply/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { coverLetterFile } from "./cover-letter.js";
import { TemporaryCoverLetterService } from "./temporary-cover-letter.js";
import {
  GENERATED_MATERIAL_LIFETIME_MS,
  type TemporaryMaterialCompletionAuthority,
  type TemporaryMaterialReference,
  TemporaryMaterialStore,
  TemporaryMaterialUnavailable,
} from "./temporary-materials.js";

const NOW = Date.parse("2026-10-04T12:00:00Z");
const FACT = "019d04cf-1f80-7000-8000-000000000001";
const OWNER = "019d04cf-1f80-7000-8000-000000000002";
const APP = "019d04cf-1f80-7000-8000-000000000003";
const GENERATION = "019d04cf-1f80-7000-8000-000000000004";
const OTHER = "019d04cf-1f80-7000-8000-000000000005";
const TEXT = "I have experience with TypeScript.";
const fact: GraphFact = {
  id: FACT,
  kind: "skill",
  key: "skill",
  value: "TypeScript",
  verification: "confirmed",
  sensitivity: "standard",
  source: { type: "user", reference: "synthetic" },
  version: 1,
};
const job = { title: "Engineer", company: "Synthetic", description: "Build reliable systems." };
const generation = (): GenerationResult => ({
  status: "needs_review",
  purpose: "cover_letter",
  reviewRequired: true,
  paragraphs: [{ text: TEXT, factIds: [FACT] }],
  findings: [],
  sourceFactIds: [FACT],
  confidence: 1,
  promptVersion: "cover_letter.v1",
  model: { provider: "openai", model: "gpt-6-luna", version: "gpt-6-luna" },
});
type Renderer = NonNullable<ConstructorParameters<typeof TemporaryCoverLetterService>[5]>;
const syntheticRenderer: Renderer = async (_document, _owner, _app, contentSha256, format) => ({
  format,
  contentSha256,
  mediaType:
    format === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  fileName: `cover-letter.${format}`,
  sha256: "b".repeat(64),
  sizeBytes: 9,
  contentBase64: "c3ludGhldGlj",
});
const stores: TemporaryMaterialStore[] = [];
function setup(
  options: {
    enabled?: boolean;
    render?: Renderer;
    completion?: TemporaryMaterialCompletionAuthority;
  } = {},
) {
  let now = NOW;
  let enabled = options.enabled ?? true;
  let evidence = { facts: [structuredClone(fact)], job: { ...job } };
  const store = new TemporaryMaterialStore({ wallNow: () => now, monotonicNow: () => now });
  stores.push(store);
  const source = { load: vi.fn(async (_owner: string, _app: string) => evidence) };
  const render = vi.fn(options.render ?? syntheticRenderer);
  const completed = new Map<string, string>();
  const completion = options.completion ?? {
    claimOriginalCompletion: vi.fn(async (reference: Readonly<TemporaryMaterialReference>) => {
      const original = completed.get(reference.generationId);
      if (original)
        return original === JSON.stringify(reference)
          ? ("already_completed" as const)
          : ("unavailable" as const);
      completed.set(reference.generationId, JSON.stringify(reference));
      return "claimed" as const;
    }),
  };
  const service = new TemporaryCoverLetterService(
    store,
    source,
    completion,
    () => enabled,
    () => new Date(now),
    render,
  );
  const context = coverLetterContext({ ...evidence, now: new Date(now) });
  const identity = {
    id: GENERATION,
    ownerUserId: OWNER,
    applicationId: APP,
    version: 1,
    jobRevision: context.jobContextHash,
    confirmedFactsHash: context.confirmedFactsHash,
  };
  return {
    service,
    completion,
    store,
    source,
    render,
    identity,
    setNow: (value: number) => {
      now = value;
    },
    disable: () => {
      enabled = false;
    },
    changeEvidence: () => {
      evidence = { ...evidence, job: { ...job, description: "Changed job" } };
    },
  };
}
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
});

describe("Documents temporary cover-letter completion and reads", () => {
  it("verifies both production renderers, returns metadata only, and downloads nonempty verified bytes", async () => {
    const f = setup({ render: coverLetterFile });
    const completed = await f.service.complete(f.identity, generation(), NOW);
    expect(JSON.stringify(completed)).not.toContain(TEXT);
    expect(completed.reference).toMatchObject({
      generationId: GENERATION,
      completedAtMs: NOW,
      expiresAtMs: NOW + GENERATED_MATERIAL_LIFETIME_MS,
    });
    expect(completed.letter.sourceFactIds).toEqual([FACT]);
    const preview = await f.service.preview(completed.reference);
    expect(preview.value).toMatchObject({
      status: "ready",
      matchesPacket: true,
      reviewRequired: true,
      paragraphs: [{ text: TEXT, factIds: [FACT] }],
    });
    for (const format of ["pdf", "docx"] as const) {
      const file = await f.service.file(completed.reference, format);
      const bytes = Buffer.from(file.value.contentBase64, "base64");
      expect(bytes.length).toBeGreaterThan(0);
      expect(file.value.sizeBytes).toBe(bytes.length);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.value.sha256);
      if (format === "pdf") expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
      expect(file.reference).toEqual(completed.reference);
    }
    expect(f.render.mock.calls.map((args) => args[4])).toEqual(["pdf", "docx", "pdf", "docx"]);
  });

  it("default-off refuses before evidence or render access", async () => {
    const f = setup();
    const off = new TemporaryCoverLetterService(f.store, f.source);
    await expect(off.complete(f.identity, generation(), NOW)).rejects.toThrow(
      "TemporaryMaterialUnavailable",
    );
    expect(f.source.load).not.toHaveBeenCalled();
    expect(f.render).not.toHaveBeenCalled();
  });

  it("requires original-completion authority even when enabled", async () => {
    const f = setup();
    const missing = new TemporaryCoverLetterService(f.store, f.source, undefined, () => true);
    await expect(missing.complete(f.identity, generation(), NOW)).rejects.toThrow(
      "TemporaryMaterialUnavailable",
    );
    expect(f.source.load).not.toHaveBeenCalled();
    const refusal = setup({ completion: { claimOriginalCompletion: async () => "unavailable" } });
    await expect(refusal.service.complete(refusal.identity, generation(), NOW)).rejects.toThrow(
      "TemporaryMaterialUnavailable",
    );
    expect(refusal.source.load).not.toHaveBeenCalled();
    expect(refusal.render).not.toHaveBeenCalled();
  });

  it("original completion replay cannot recreate a draft after process memory loss or renew its deadline", async () => {
    const f = setup();
    const original = await f.service.complete(f.identity, generation(), NOW);
    f.store.dispose();
    const restarted = setup({ completion: f.completion });
    await expect(restarted.service.complete(restarted.identity, generation(), NOW)).rejects.toThrow(
      "TemporaryMaterialUnavailable",
    );
    expect(restarted.source.load).not.toHaveBeenCalled();
    expect(restarted.render).not.toHaveBeenCalled();
    const later = setup({ completion: f.completion });
    later.setNow(original.reference.expiresAtMs + 1);
    await expect(
      later.service.complete(later.identity, generation(), original.reference.expiresAtMs + 1),
    ).rejects.toThrow("TemporaryMaterialUnavailable");
    expect(later.source.load).not.toHaveBeenCalled();
    expect(later.render).not.toHaveBeenCalled();
  });

  it("uses original generation completion rather than validation/read time", async () => {
    const f = setup();
    const completedAt = NOW - 120_000;
    f.render.mockImplementation(async (...args) => {
      f.setNow(NOW + 30_000);
      return syntheticRenderer(...args);
    });
    const result = await f.service.complete(f.identity, generation(), completedAt);
    expect(result.reference.expiresAtMs).toBe(completedAt + GENERATED_MATERIAL_LIFETIME_MS);
    f.setNow(result.reference.expiresAtMs - 1);
    await f.service.binding(result.reference);
    await f.service.preview(result.reference);
    f.render.mockImplementation(syntheticRenderer);
    await f.service.file(result.reference, "pdf");
    f.setNow(result.reference.expiresAtMs);
    for (const read of [
      () => f.service.binding(result.reference),
      () => f.service.preview(result.reference),
      () => f.service.file(result.reference, "pdf"),
    ])
      await expect(read()).rejects.toBeInstanceOf(TemporaryMaterialUnavailable);
  });

  it("never exposes unverified material while completion is blocked", async () => {
    const f = setup();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.source.load.mockImplementationOnce(async () => {
      await wait;
      return { facts: [fact], job };
    });
    const completion = f.service.complete(f.identity, generation(), NOW);
    expect(f.render).not.toHaveBeenCalled();
    release();
    const result = await completion;
    expect(f.store.has(result.reference)).toBe(true);
  });

  it("validation failure discards content and never permits same-generation restoration", async () => {
    const f = setup();
    f.render.mockRejectedValue(Error(`Synthetic renderer failure: ${TEXT}`));
    await expect(f.service.complete(f.identity, generation(), NOW)).rejects.toThrow(
      "TemporaryMaterialUnavailable",
    );
    f.render.mockImplementation(syntheticRenderer);
    await expect(f.service.complete(f.identity, generation(), NOW)).rejects.toThrow(
      "TemporaryMaterialUnavailable",
    );
  });

  it.each(["cancel", "logout", "submitted"])(
    "%s during validation discards bytes and decoded paragraphs",
    async (action) => {
      const f = setup();
      let held: Parameters<Renderer>[0] | undefined;
      let heldSignal: AbortSignal | undefined;
      f.render.mockImplementation(async (document, ...args) => {
        held = document;
        heldSignal = args[4];
        if (action === "logout") f.store.discardOwner(OWNER);
        else f.store.discardApplication(OWNER, APP);
        return syntheticRenderer(document, ...args);
      });
      await expect(f.service.complete(f.identity, generation(), NOW)).rejects.toThrow(
        "TemporaryMaterialUnavailable",
      );
      expect(held?.paragraphs).toEqual([]);
      expect(heldSignal?.aborted).toBe(true);
      expect(f.render).toHaveBeenCalledTimes(1);
    },
  );

  it("refuses completion that expires during rendering and clears transient artifact content", async () => {
    const f = setup();
    let artifact: ApplicationCoverLetterFile | undefined;
    f.render.mockImplementation(async (...args) => {
      artifact = await syntheticRenderer(...args);
      f.setNow(NOW + GENERATED_MATERIAL_LIFETIME_MS);
      return artifact;
    });
    await expect(f.service.complete(f.identity, generation(), NOW)).rejects.toBeInstanceOf(
      TemporaryMaterialUnavailable,
    );
    expect(artifact?.contentBase64).toBe("");
  });

  it("idle expiry clears decoded draft copies even while a renderer is stalled", async () => {
    vi.useFakeTimers();
    const f = setup();
    let document: Parameters<Renderer>[0] | undefined;
    let signal: AbortSignal | undefined;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.render.mockImplementation(async (draft, ...args) => {
      document = draft;
      signal = args[4];
      await waiting;
      return syntheticRenderer(draft, ...args);
    });
    const completing = f.service.complete(f.identity, generation(), NOW);
    const refused = expect(completing).rejects.toThrow("TemporaryMaterialUnavailable");
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(document?.paragraphs).toHaveLength(1);
      f.setNow(NOW + GENERATED_MATERIAL_LIFETIME_MS);
      await vi.advanceTimersByTimeAsync(GENERATED_MATERIAL_LIFETIME_MS);
      expect(document?.paragraphs).toEqual([]);
      expect(signal?.aborted).toBe(true);
      release();
      await refused;
    } finally {
      release();
      f.store.dispose();
      vi.useRealTimers();
    }
  });

  it("refuses downloads that expire after asynchronous rendering and clears late output", async () => {
    const f = setup();
    const result = await f.service.complete(f.identity, generation(), NOW);
    let artifact: ApplicationCoverLetterFile | undefined;
    f.render.mockImplementation(async (...args) => {
      artifact = await syntheticRenderer(...args);
      f.setNow(result.reference.expiresAtMs);
      return artifact;
    });
    await expect(f.service.file(result.reference, "pdf")).rejects.toBeInstanceOf(
      TemporaryMaterialUnavailable,
    );
    expect(artifact?.contentBase64).toBe("");
  });

  it("rechecks enablement and current evidence before returning content", async () => {
    const f = setup();
    const result = await f.service.complete(f.identity, generation(), NOW);
    f.changeEvidence();
    await expect(f.service.preview(result.reference)).rejects.toBeInstanceOf(
      TemporaryMaterialUnavailable,
    );
    const g = setup();
    const ready = await g.service.complete(g.identity, generation(), NOW);
    g.render.mockImplementation(async (...args) => {
      g.disable();
      return syntheticRenderer(...args);
    });
    await expect(g.service.file(ready.reference, "docx")).rejects.toBeInstanceOf(
      TemporaryMaterialUnavailable,
    );
  });

  it("snapshots generated content and metadata across an asynchronous evidence read", async () => {
    const f = setup();
    const output = generation();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.source.load.mockImplementationOnce(async () => {
      await wait;
      return { facts: [fact], job };
    });
    const completing = f.service.complete(f.identity, output, NOW);
    const paragraph = output.paragraphs[0];
    if (!paragraph) throw Error("Synthetic fixture missing paragraph");
    paragraph.text = "Synthetic caller mutation";
    f.identity.ownerUserId = OTHER;
    release();
    const result = await completing;
    expect(result.reference.ownerUserId).toBe(OWNER);
    expect((await f.service.preview(result.reference)).value).toMatchObject({
      paragraphs: [{ text: TEXT }],
    });
    const ref = { ...result.reference };
    f.source.load.mockImplementationOnce(async () => {
      ref.ownerUserId = OTHER;
      return { facts: [fact], job };
    });
    expect((await f.service.preview(ref)).reference.ownerUserId).toBe(OWNER);
  });

  it("same content in a replacement generation cannot satisfy the old reference", async () => {
    const f = setup();
    const old = await f.service.complete(f.identity, generation(), NOW);
    f.store.discard(old.reference);
    const replacement = await f.service.complete(
      { ...f.identity, id: OTHER, version: 2 },
      generation(),
      NOW,
    );
    expect(replacement.letter.contentSha256).toBe(old.letter.contentSha256);
    expect(replacement.reference.generationId).not.toBe(old.reference.generationId);
    await expect(f.service.binding(old.reference)).rejects.toBeInstanceOf(
      TemporaryMaterialUnavailable,
    );
    expect(await f.service.binding(replacement.reference)).toEqual(replacement.reference);
  });

  it("does not recover content in a restarted service or call a provider/renderer to reconstruct it", async () => {
    const f = setup();
    const old = await f.service.complete(f.identity, generation(), NOW);
    f.store.dispose();
    const restarted = setup();
    await expect(restarted.service.preview(old.reference)).rejects.toBeInstanceOf(
      TemporaryMaterialUnavailable,
    );
    expect(restarted.source.load).not.toHaveBeenCalled();
    expect(restarted.render).not.toHaveBeenCalled();
  });

  it("withholds rejected generation, stale evidence, invalid completion timestamps and accessor references", async () => {
    for (const output of [
      generation(),
      { ...generation(), status: "rejected" as const },
      { ...generation(), purpose: "narrative_answer" as const },
    ]) {
      const f = setup();
      f.changeEvidence();
      await expect(f.service.complete(f.identity, output, NOW)).rejects.toThrow(
        "TemporaryMaterialUnavailable",
      );
    }
    for (const completion of [NaN, NOW + 1, NOW - GENERATED_MATERIAL_LIFETIME_MS]) {
      const f = setup();
      await expect(f.service.complete(f.identity, generation(), completion)).rejects.toThrow(
        "TemporaryMaterialUnavailable",
      );
    }
    const f = setup();
    const old = await f.service.complete(f.identity, generation(), NOW);
    await expect(
      f.service.preview({
        ...old.reference,
        get ownerUserId(): string {
          throw Error(TEXT);
        },
      }),
    ).rejects.toThrow("TemporaryMaterialUnavailable");
  });
});
