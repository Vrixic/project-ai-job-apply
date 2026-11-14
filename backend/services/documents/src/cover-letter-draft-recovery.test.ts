import { coverLetterContext, prepareCoverLetterPrompt } from "@ai-job-apply/ai-sdk";
import type { GraphFact } from "@ai-job-apply/domain";
import { describe, expect, it, vi } from "vitest";
import { type CoverLetterDocument, CoverLetterIntegrityError } from "./cover-letter.js";
import {
  CoverLetterDraftRecoveryService,
  type CoverLetterDraftRecoveryStore,
} from "./cover-letter-draft-recovery.js";
import {
  COVER_LETTER_PROVIDER_MODEL,
  type CoverLetterProviderSlot,
  coverLetterProviderSha256,
  encodeCoverLetterProviderObject,
} from "./cover-letter-provider-contract.js";
import { CoverLetterProviderRecovery } from "./cover-letter-provider-recovery.js";
import type { CoverLetterMetadata } from "./cover-letter-store.js";

const id = "019a4000-0000-7000-8000-000000000001";
const now = new Date("2026-10-02T12:00:00.000Z");
const fact: GraphFact = {
  id: "019a4000-0000-7000-8000-000000000005",
  kind: "skill",
  key: "skill",
  value: "TypeScript",
  verification: "confirmed",
  sensitivity: "standard",
  source: { type: "user", reference: "synthetic" },
  version: 1,
};
const text = "I have experience with TypeScript.";

function setup(output = text) {
  const evidence = {
    facts: [fact],
    job: { title: "Engineer", company: "Synthetic", description: "Build reliable systems." },
  };
  const binding = coverLetterContext({ ...evidence, now });
  const identity = {
    id,
    ownerUserId: "019a4000-0000-7000-8000-000000000002",
    applicationId: "019a4000-0000-7000-8000-000000000003",
    ...binding,
    noticeVersion: "bedrock-cover-letter.v1",
    approvedAt: now,
    expiresAt: new Date(now.getTime() + 15 * 60_000),
  };
  let metadata: CoverLetterMetadata | null = {
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
  let saved: CoverLetterDocument | null = null;
  let heldObject: CoverLetterDocument | null = null;
  let quarantine = false;
  let loseAck = false;
  let claimed = false;
  const physicalWrite = vi.fn();
  const store: CoverLetterDraftRecoveryStore = {
    generationMetadata: async (input) => {
      if (quarantine) throw new Error("Synthetic quarantine");
      return metadata?.id === input.id &&
        metadata.ownerUserId === input.ownerUserId &&
        metadata.applicationId === input.applicationId
        ? structuredClone(metadata)
        : null;
    },
    recover: async () => saved,
    withGenerationLease: async (_owner, run) => {
      if (quarantine) throw new Error("Synthetic quarantine");
      return run();
    },
    complete: async (document) => {
      if (quarantine) throw new Error("Synthetic quarantine");
      if (!metadata) throw new CoverLetterIntegrityError();
      if (claimed) throw new CoverLetterIntegrityError();
      claimed = true;
      physicalWrite();
      if (heldObject && JSON.stringify(heldObject) !== JSON.stringify(document))
        throw new CoverLetterIntegrityError();
      heldObject = structuredClone(document);
      if (loseAck) {
        loseAck = false;
        throw new Error("Synthetic lost completion acknowledgement");
      }
      saved = structuredClone(document);
      metadata = { ...metadata, status: "ready", contentSha256: document.contentSha256 };
      return metadata;
    },
  };
  const complete = vi.spyOn(store, "complete");
  const lookup = vi.spyOn(store, "generationMetadata");
  const prompt = prepareCoverLetterPrompt({ ...evidence, now });
  if (!prompt) throw new Error("Synthetic prompt missing");
  const request = encodeCoverLetterProviderObject("request", {
    schemaVersion: 1,
    documentId: id,
    noticeVersion: "bedrock-cover-letter.v1",
    promptVersion: "1.0.0",
    ...binding,
    approvedAt: now.toISOString(),
    expiresAt: identity.expiresAt.toISOString(),
    ...prompt,
    maxOutputChars: 8_000,
  });
  const hash = coverLetterProviderSha256(request);
  const draft = JSON.stringify({ paragraphs: [{ text: output, factIds: [fact.id] }] });
  const slots = new Map<CoverLetterProviderSlot, Uint8Array>([
    ["request", request],
    [
      "dispatch",
      encodeCoverLetterProviderObject("dispatch", {
        schemaVersion: 1,
        documentId: id,
        requestSha256: hash,
        state: "claimed",
        dispatchedAt: now.toISOString(),
      }),
    ],
    [
      "result",
      encodeCoverLetterProviderObject("result", {
        schemaVersion: 1,
        documentId: id,
        requestSha256: hash,
        state: "ready",
        dispatchedAt: now.toISOString(),
        text: draft,
        model: COVER_LETTER_PROVIDER_MODEL,
        outputCharacters: draft.length,
      }),
    ],
  ]);
  const find = vi.fn(async (_id: string, slot: CoverLetterProviderSlot) => {
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
  const read = vi.fn(async (_id: string, slot: CoverLetterProviderSlot) => {
    const bytes = slots.get(slot);
    if (!bytes) throw new CoverLetterIntegrityError();
    return bytes;
  });
  const provider = new CoverLetterProviderRecovery({ find, read });
  const originalRecover = provider.recover.bind(provider);
  const recover = vi.spyOn(provider, "recover");
  const source = { load: vi.fn(async () => evidence) };
  let clock = new Date(now.getTime() + 60 * 60_000);
  let enabled = true;
  const service = new CoverLetterDraftRecoveryService(
    store,
    source,
    provider,
    () => clock,
    () => enabled,
  );
  return {
    run: () => service.recover(identity),
    runDefaultOff: () =>
      new CoverLetterDraftRecoveryService(store, source, provider, () => clock).recover(identity),
    identity,
    evidence,
    slots,
    find,
    read,
    complete,
    physicalWrite,
    lookup,
    recover,
    originalRecover,
    source,
    store,
    requestSha256: hash,
    disable: () => {
      enabled = false;
    },
    saved: () => saved,
    missing: () => {
      metadata = null;
    },
    quarantine: () => {
      quarantine = true;
    },
    loseAck: () => {
      loseAck = true;
    },
    clock: (value: Date) => {
      clock = value;
    },
  };
}

describe("private cover-letter partial-result finalization", () => {
  it("cannot finalize a pending draft with recovery disabled by default", async () => {
    const f = setup();
    await expect(f.runDefaultOff()).resolves.toEqual({ kind: "in_progress" });
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.recover).not.toHaveBeenCalled();
  });
  it("grounds and parser-verifies both formats after expiry, then recovers the immutable final draft", async () => {
    const f = setup();
    const result = await f.run();
    expect(result).toMatchObject({
      kind: "ready",
      letter: { sourceFactIds: [fact.id], contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u) },
    });
    expect(JSON.stringify(result)).not.toContain(text);
    expect(f.saved()?.paragraphs).toEqual([{ text, factIds: [fact.id] }]);
    expect(f.complete).toHaveBeenCalledTimes(1);
    expect(f.complete).toHaveBeenCalledWith(expect.any(Object), { requestSha256: f.requestSha256 });
    expect(f.lookup.mock.invocationCallOrder[0]).toBeLessThan(
      f.find.mock.invocationCallOrder[0] ?? 0,
    );
    expect(await f.run()).toEqual(result);
    expect(f.complete).toHaveBeenCalledTimes(1);
    expect(f.recover).toHaveBeenCalledTimes(1);
    await expect(f.runDefaultOff()).resolves.toEqual(result);
    expect(f.complete).toHaveBeenCalledTimes(1);
  });

  it("refuses activation withdrawn after the original saved result is read", async () => {
    const f = setup();
    f.recover.mockImplementation(async (...args) => {
      const result = await f.originalRecover(...args);
      f.disable();
      return result;
    });
    expect(await f.run()).toEqual({ kind: "in_progress" });
    expect(f.complete).not.toHaveBeenCalled();
  });

  it("binds final persistence to the original snapshot despite input mutation during recovery", async () => {
    const f = setup();
    f.recover.mockImplementation(async (...args) => {
      const result = await f.originalRecover(...args);
      f.identity.id = "019a4000-0000-7000-8000-000000000004";
      f.evidence.job.description = "Synthetic changed job";
      return result;
    });
    expect((await f.run()).kind).toBe("ready");
    expect(f.complete).toHaveBeenCalledWith(expect.objectContaining({ id }), {
      requestSha256: f.requestSha256,
    });
  });

  it("never reserves a new identity when the owned reservation is missing", async () => {
    const f = setup();
    f.missing();
    expect(await f.run()).toEqual({ kind: "failed", errorCode: "generation_unavailable" });
    expect(f.source.load).not.toHaveBeenCalled();
    expect(f.find).not.toHaveBeenCalled();
    expect(f.complete).not.toHaveBeenCalled();
  });

  it("keeps a claimed operation with no saved result in progress", async () => {
    const f = setup();
    f.slots.delete("result");
    expect(await f.run()).toEqual({ kind: "in_progress" });
    expect(f.complete).not.toHaveBeenCalled();
  });

  it.each(["facts", "job"] as const)(
    "refuses changed current %s before object access",
    async (field) => {
      const f = setup();
      if (field === "facts") f.evidence.facts = [{ ...fact, value: "Rust", version: 2 }];
      else f.evidence.job.description += " synthetic change";
      expect(await f.run()).toEqual({ kind: "failed", errorCode: "bindings_changed" });
      expect(f.find).not.toHaveBeenCalled();
      expect(f.complete).not.toHaveBeenCalled();
    },
  );

  it("withholds unsupported saved claims without writing a final draft", async () => {
    const f = setup("I built 500 systems.");
    expect(await f.run()).toEqual({ kind: "failed", errorCode: "grounding_failed" });
    expect(f.complete).not.toHaveBeenCalled();
  });

  it("withholds a draft when the production parser cannot reproduce its text", async () => {
    const f = setup("I have experience with TypeScript. 🚀");
    expect(await f.run()).toEqual({ kind: "failed", errorCode: "render_failed" });
    expect(f.complete).not.toHaveBeenCalled();
  });

  it("refuses quarantine at the owner lookup before candidate content access", async () => {
    const f = setup();
    f.quarantine();
    await expect(f.run()).rejects.toThrow("Synthetic quarantine");
    expect(f.source.load).not.toHaveBeenCalled();
    expect(f.find).not.toHaveBeenCalled();
  });

  it("rechecks the active-candidate lease before reading saved provider bytes", async () => {
    const f = setup();
    f.source.load.mockImplementation(async () => {
      f.quarantine();
      return f.evidence;
    });
    await expect(f.run()).rejects.toThrow("Synthetic quarantine");
    expect(f.find).not.toHaveBeenCalled();
    expect(f.complete).not.toHaveBeenCalled();
  });

  it("cannot finalize after quarantine even if a saved result was grounded", async () => {
    const f = setup();
    f.recover.mockImplementation(async (...args) => {
      const result = await f.originalRecover(...args);
      f.quarantine();
      return result;
    });
    expect(await f.run()).toEqual({ kind: "in_progress" });
    expect(f.saved()).toBeNull();
  });

  it("retains the same original saved result without repeating writes after a lost final-write response", async () => {
    const f = setup();
    f.loseAck();
    expect(await f.run()).toEqual({ kind: "in_progress" });
    expect(f.saved()).toBeNull();
    expect((await f.run()).kind).toBe("in_progress");
    // Completion may perform a read-only replay; physical writes must remain one-shot.
    expect(f.complete).toHaveBeenCalledTimes(2);
    expect(f.physicalWrite).toHaveBeenCalledTimes(1);
    expect(f.recover).toHaveBeenCalledTimes(2);
  });

  it.each(["ownerUserId", "applicationId"] as const)(
    "does not read another %s reservation",
    async (field) => {
      const f = setup();
      f.identity[field] = "019a4000-0000-7000-8000-000000000004";
      expect(await f.run()).toEqual({ kind: "failed", errorCode: "generation_unavailable" });
      expect(f.find).not.toHaveBeenCalled();
    },
  );

  it.each(["invalid", "future", "notice", "window"])(
    "refuses invalid original disclosure: %s",
    async (kind) => {
      const f = setup();
      if (kind === "invalid") f.identity.approvedAt = new Date(Number.NaN);
      if (kind === "future") f.clock(new Date(now.getTime() - 1));
      if (kind === "notice") f.identity.noticeVersion = "synthetic-unknown";
      if (kind === "window") f.identity.expiresAt = new Date(now.getTime() + 16 * 60_000);
      expect(await f.run()).toEqual({ kind: "failed", errorCode: "disclosure_expired" });
      expect(f.lookup).not.toHaveBeenCalled();
    },
  );
});
