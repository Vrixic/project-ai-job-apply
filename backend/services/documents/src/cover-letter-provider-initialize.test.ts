import { coverLetterContext } from "@ai-job-apply/ai-sdk";
import type { GraphFact } from "@ai-job-apply/domain";
import { describe, expect, it, vi } from "vitest";
import {
  COVER_LETTER_PROVIDER_MODEL,
  type CoverLetterProviderReference,
  type CoverLetterProviderSlot,
  coverLetterProviderSha256,
  decodeCoverLetterProviderObject,
  encodeCoverLetterProviderObject,
} from "./cover-letter-provider-contract.js";
import { CoverLetterProviderInitializer } from "./cover-letter-provider-initialize.js";
import type { CoverLetterMetadata, PostgresCoverLetterStore } from "./cover-letter-store.js";
import type { PostgresCoverLetterWorkStore } from "./cover-letter-work-store.js";

const now = new Date("2026-10-02T12:00:00.000Z");
const id = "019a4000-0000-7000-8000-000000000001";
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
function fixture(
  settings: {
    defaultOff?: boolean;
    withoutWork?: boolean;
    facts?: GraphFact[];
    timeoutMs?: number;
  } = {},
) {
  let clock = now;
  let enabled = true;
  let reserved = false;
  let lease = 0;
  let quarantined = false;
  let loseAck: CoverLetterProviderSlot | undefined;
  let afterPut = () => undefined;
  const evidence = {
    facts: settings.facts ?? [fact],
    job: { title: "Engineer", company: "Synthetic", description: "Build reliable systems." },
  };
  const identity = {
    id,
    ownerUserId: "synthetic-owner",
    applicationId: "synthetic-application",
    ...coverLetterContext({ ...evidence, now }),
    noticeVersion: "openai-cover-letter.v1",
    approvedAt: now,
    expiresAt: new Date(now.getTime() + 15 * 60_000),
  };
  const metadata: CoverLetterMetadata = {
    id,
    ownerUserId: identity.ownerUserId,
    applicationId: identity.applicationId,
    version: 1,
    jobRevision: identity.jobContextHash,
    confirmedFactsHash: identity.confirmedFactsHash,
    status: "pending",
    objectKey: `normalized/${id}/cover-letter.v1.json`,
    objectVersion: null,
    objectSha256: null,
    contentSha256: null,
    sizeBytes: null,
    promptVersion: null,
    createdAt: now,
  };
  const store: Pick<PostgresCoverLetterStore, "reserveGeneration" | "withGenerationLease"> = {
    reserveGeneration: async () => {
      if (quarantined) throw new Error("Synthetic quarantine");
      const kind = reserved ? "already_reserved" : "claimed";
      reserved = true;
      return { kind, metadata: structuredClone(metadata) };
    },
    withGenerationLease: async (_owner, run) => {
      if (quarantined) throw new Error("Synthetic quarantine");
      lease++;
      try {
        return await run();
      } finally {
        lease--;
      }
    },
  };
  const reserve = vi.spyOn(store, "reserveGeneration");
  const source = { load: vi.fn(async () => evidence) };
  const slots = new Map<CoverLetterProviderSlot, Uint8Array>();
  const reference = (bytes: Uint8Array): CoverLetterProviderReference => ({
    objectVersion: "synthetic-version",
    etag: `"${coverLetterProviderSha256(bytes)}"`,
    sha256: coverLetterProviderSha256(bytes),
    sizeBytes: bytes.length,
  });
  const work = {
    issue: vi.fn<PostgresCoverLetterWorkStore["issue"]>(async (input) => ({
      kind: "issued",
      authorization: {
        ...input,
        id,
        state: "issued",
        issuedAt: clock,
        expiresAt: new Date(Math.min(clock.getTime() + 90_000, input.consentExpiresAt.getTime())),
        startedAt: null,
        terminalAt: null,
      },
    })),
    claim: vi.fn<PostgresCoverLetterWorkStore["claim"]>(async () => ({ kind: "claimed" })),
    recordSettled: vi.fn<PostgresCoverLetterWorkStore["recordSettled"]>(async () => undefined),
  };
  const put = vi.fn(
    async (documentId: string, slot: CoverLetterProviderSlot, bytes: Uint8Array) => {
      expect(reserved).toBe(true);
      expect(work.claim).toHaveBeenCalledTimes(1);
      expect(lease).toBeGreaterThan(0);
      expect(documentId).toBe(id);
      const existing = slots.get(slot);
      if (existing) return { created: false, reference: reference(existing) };
      slots.set(slot, Uint8Array.from(bytes));
      afterPut();
      if (loseAck === slot) {
        loseAck = undefined;
        throw new Error("Synthetic private lost acknowledgement");
      }
      return { created: true, reference: reference(bytes) };
    },
  );
  const find = vi.fn(async (_id: string, slot: CoverLetterProviderSlot) => {
    expect(lease).toBeGreaterThan(0);
    const bytes = slots.get(slot);
    return bytes ? reference(bytes) : undefined;
  });
  const read = vi.fn(async (_id: string, slot: CoverLetterProviderSlot) => {
    expect(lease).toBeGreaterThan(0);
    const bytes = slots.get(slot);
    if (!bytes) throw new Error("Synthetic missing slot");
    return bytes;
  });
  const objects = { putIfAbsent: put, find, read };
  const initializer = new CoverLetterProviderInitializer(
    store,
    source,
    objects,
    settings.defaultOff ? undefined : () => enabled,
    () => clock,
    settings.timeoutMs,
    settings.withoutWork ? undefined : work,
  );
  return {
    run: () => initializer.initialize(identity),
    identity,
    metadata,
    evidence,
    reserve,
    source,
    put,
    find,
    read,
    work,
    slots,
    clock: (value: Date) => {
      clock = value;
    },
    disable: () => {
      enabled = false;
    },
    quarantine: () => {
      quarantined = true;
    },
    afterPut: (run: () => undefined) => {
      afterPut = run;
    },
    loseAck: (slot: CoverLetterProviderSlot) => {
      loseAck = slot;
    },
  };
}

describe("private first-reservation generation-slot initializer", () => {
  it("defaults off before evidence, reservation or object access", async () => {
    const f = fixture({ defaultOff: true });
    expect(await f.run()).toEqual({ kind: "failed", errorCode: "generation_unavailable" });
    expect(f.source.load).not.toHaveBeenCalled();
    expect(f.reserve).not.toHaveBeenCalled();
    expect(f.put).not.toHaveBeenCalled();
  });

  it("refuses missing work authority before any I/O", async () => {
    const f = fixture({ withoutWork: true });
    expect(await f.run()).toEqual({ kind: "failed", errorCode: "generation_unavailable" });
    expect(f.source.load).not.toHaveBeenCalled();
    expect(f.reserve).not.toHaveBeenCalled();
    expect(f.put).not.toHaveBeenCalled();
  });

  it("never steals previously issued authority or retries a refused claim", async () => {
    for (const refusal of ["already_issued", "unavailable"] as const) {
      const f = fixture();
      if (refusal === "already_issued") {
        const issue = f.work.issue.getMockImplementation();
        if (!issue) throw new Error("Synthetic issue missing");
        f.work.issue.mockImplementation(async (input) => ({
          ...(await issue(input)),
          kind: refusal,
        }));
      } else f.work.claim.mockResolvedValue({ kind: refusal });
      expect(await f.run()).toEqual({ kind: "in_progress" });
      expect(await f.run()).toEqual({ kind: "in_progress" });
      expect(f.work.issue).toHaveBeenCalledTimes(1);
      expect(f.work.claim).toHaveBeenCalledTimes(refusal === "already_issued" ? 0 : 1);
      expect(f.put).not.toHaveBeenCalled();
      expect(f.work.recordSettled).not.toHaveBeenCalled();
    }
  });

  it.each(["owner", "document", "digest", "purpose", "state", "expired", "renewed", "consent"])(
    "rejects an incorrectly bound %s authorization before claiming",
    async (change) => {
      const f = fixture();
      const issue = f.work.issue.getMockImplementation();
      if (!issue) throw new Error("Synthetic issue missing");
      f.work.issue.mockImplementation(async (input) => {
        const result = await issue(input);
        const auth = result.authorization;
        if (change === "owner") auth.ownerUserId = "synthetic-other-owner";
        if (change === "document") auth.documentId = "019a4000-0000-7000-8000-000000000002";
        if (change === "digest") auth.requestSha256 = "f".repeat(64);
        if (change === "purpose") auth.purpose = "provider_dispatch";
        if (change === "state") auth.state = "running";
        if (change === "expired") auth.expiresAt = now;
        if (change === "renewed") auth.expiresAt = new Date(now.getTime() + 90_001);
        if (change === "consent") auth.consentExpiresAt = new Date(now.getTime() + 1);
        return result;
      });
      expect(await f.run()).toEqual({ kind: "in_progress" });
      expect(f.work.claim).not.toHaveBeenCalled();
      expect(f.put).not.toHaveBeenCalled();
      expect(f.work.recordSettled).not.toHaveBeenCalled();
    },
  );

  it.each(["issue", "claim"] as const)(
    "keeps ambiguous %s errors private and unresolved",
    async (method) => {
      const f = fixture();
      f.work[method].mockRejectedValue(new Error("synthetic-private-control-failure"));
      expect(await f.run()).toEqual({ kind: "in_progress" });
      expect(f.put).not.toHaveBeenCalled();
      expect(f.work.recordSettled).not.toHaveBeenCalled();
    },
  );

  it("does not turn settlement failure or read-only replay into positive settlement", async () => {
    const f = fixture();
    f.work.recordSettled.mockRejectedValue(new Error("Synthetic ambiguous settlement"));
    expect(await f.run()).toEqual({ kind: "in_progress" });
    expect((await f.run()).kind).toBe("initialized");
    expect(f.put).toHaveBeenCalledTimes(3);
    expect(f.work.claim).toHaveBeenCalledTimes(1);
    expect(f.work.recordSettled).toHaveBeenCalledTimes(1);
  });

  it("awaits the original delayed claim but does not write after its local deadline", async () => {
    const f = fixture({ timeoutMs: 20 });
    f.work.claim.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { kind: "claimed" };
    });
    expect(await f.run()).toEqual({ kind: "in_progress" });
    expect(f.work.claim).toHaveBeenCalledTimes(1);
    expect(f.put).not.toHaveBeenCalled();
    expect(f.work.recordSettled).not.toHaveBeenCalled();
  });

  it("keeps a late original write unresolved after local abort and never recreates it", async () => {
    const f = fixture({ timeoutMs: 20 });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let late: Promise<Awaited<ReturnType<typeof f.put>>> | undefined;
    f.put.mockImplementation((_documentId, slot, bytes) => {
      late = gate.then(() => {
        f.slots.set(slot, Uint8Array.from(bytes));
        return {
          created: true,
          reference: {
            objectVersion: "synthetic-version",
            etag: `"${coverLetterProviderSha256(bytes)}"`,
            sha256: coverLetterProviderSha256(bytes),
            sizeBytes: bytes.length,
          },
        };
      });
      return late;
    });
    expect(await f.run()).toEqual({ kind: "in_progress" });
    release();
    await late;
    expect(f.slots.has("request")).toBe(true);
    expect(await f.run()).toEqual({ kind: "in_progress" });
    expect(f.put).toHaveBeenCalledTimes(1);
    expect(f.work.recordSettled).not.toHaveBeenCalled();
  });

  it("creates owned request/result/dispatch in order under a lease and returns references only", async () => {
    const f = fixture();
    const result = await f.run();
    expect(result).toMatchObject({
      kind: "initialized",
      input: {
        schemaVersion: 1,
        documentId: id,
        request: { sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) },
      },
    });
    expect(f.put.mock.calls.map((call) => call[1])).toEqual(["request", "result", "dispatch"]);
    expect(f.work.issue).toHaveBeenCalledWith({
      ownerUserId: f.identity.ownerUserId,
      documentId: id,
      purpose: "private_slots",
      requestSha256: coverLetterProviderSha256(f.slots.get("request") ?? new Uint8Array()),
      consentExpiresAt: f.identity.expiresAt,
    });
    expect(f.work.issue.mock.invocationCallOrder[0]).toBeLessThan(
      f.work.claim.mock.invocationCallOrder[0] ?? 0,
    );
    expect(f.work.recordSettled.mock.invocationCallOrder[0]).toBeGreaterThan(
      f.put.mock.invocationCallOrder[2] ?? 0,
    );
    expect(f.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      f.put.mock.invocationCallOrder[0] ?? 0,
    );
    expect(JSON.stringify(result)).not.toContain("TypeScript");
    expect(await f.run()).toEqual(result);
    expect(f.put).toHaveBeenCalledTimes(3);
    expect(f.work.issue).toHaveBeenCalledTimes(1);
    expect(f.work.claim).toHaveBeenCalledTimes(1);
    expect(f.work.recordSettled).toHaveBeenCalledTimes(1);
  });

  it.each(["request", "dispatch", "result"] as const)(
    "never recreates missing replay %s",
    async (slot) => {
      const f = fixture();
      await f.run();
      f.slots.delete(slot);
      expect(await f.run()).toEqual({ kind: "in_progress" });
      expect(f.put).toHaveBeenCalledTimes(3);
      expect(f.slots.has(slot)).toBe(false);
    },
  );

  it.each(["request", "result", "dispatch"] as const)(
    "does not resume creation after an ambiguous %s write",
    async (slot) => {
      const f = fixture();
      f.loseAck(slot);
      expect(await f.run()).toEqual({ kind: "in_progress" });
      const count = f.put.mock.calls.length;
      const replay = await f.run();
      expect(replay.kind).toBe(slot === "dispatch" ? "initialized" : "in_progress");
      expect(f.put).toHaveBeenCalledTimes(count);
      expect(f.work.recordSettled).not.toHaveBeenCalled();
    },
  );

  it("only lets one concurrent reservation delivery create placeholders", async () => {
    const f = fixture();
    const results = await Promise.all([f.run(), f.run(), f.run()]);
    expect(results.some((result) => result.kind === "initialized")).toBe(true);
    expect(f.put).toHaveBeenCalledTimes(3);
  });

  it("refuses current context changes before reservation", async () => {
    const f = fixture();
    f.evidence.job.description += " changed";
    expect(await f.run()).toEqual({ kind: "failed", errorCode: "bindings_changed" });
    expect(f.reserve).not.toHaveBeenCalled();
    expect(f.put).not.toHaveBeenCalled();
  });

  it("refuses no confirmed evidence before reservation", async () => {
    const f = fixture({ facts: [] });
    expect(await f.run()).toEqual({ kind: "failed", errorCode: "no_confirmed_evidence" });
    expect(f.reserve).not.toHaveBeenCalled();
  });

  it("rechecks the kill switch after loading evidence", async () => {
    const f = fixture();
    f.source.load.mockImplementation(async () => {
      f.disable();
      return f.evidence;
    });
    expect(await f.run()).toEqual({ kind: "failed", errorCode: "generation_unavailable" });
    expect(f.reserve).not.toHaveBeenCalled();
  });

  it("stops before issuing dispatch if the kill switch changes during writes", async () => {
    const f = fixture();
    f.afterPut(() => {
      f.disable();
      return undefined;
    });
    expect(await f.run()).toEqual({ kind: "failed", errorCode: "generation_unavailable" });
    expect(f.put).toHaveBeenCalledTimes(1);
    expect(f.slots.has("dispatch")).toBe(false);
  });

  it("stops before issuing dispatch if original disclosure expires during writes", async () => {
    const f = fixture();
    f.afterPut(() => {
      f.clock(new Date(now.getTime() + 15 * 60_000 + 1));
      return undefined;
    });
    expect(await f.run()).toEqual({ kind: "failed", errorCode: "disclosure_expired" });
    expect(f.put).toHaveBeenCalledTimes(1);
    expect(f.slots.has("dispatch")).toBe(false);
  });

  it("refuses expired original disclosure before any I/O", async () => {
    const f = fixture();
    f.clock(new Date(now.getTime() + 15 * 60_000 + 1));
    expect(await f.run()).toEqual({ kind: "failed", errorCode: "disclosure_expired" });
    expect(f.source.load).not.toHaveBeenCalled();
    expect(f.reserve).not.toHaveBeenCalled();
  });

  it("cannot renew an existing request with changed consent timestamps", async () => {
    const f = fixture();
    await f.run();
    f.identity.approvedAt = new Date(now.getTime() + 1);
    f.identity.expiresAt = new Date(f.identity.approvedAt.getTime() + 15 * 60_000);
    f.clock(new Date(now.getTime() + 2));
    expect(await f.run()).toEqual({ kind: "in_progress" });
    expect(f.put).toHaveBeenCalledTimes(3);
  });

  it("does not reset claimed/ready states during an original-identity replay", async () => {
    const f = fixture();
    const initialized = await f.run();
    const request = f.slots.get("request");
    if (!request) throw new Error("Synthetic request missing");
    const binding = {
      schemaVersion: 1,
      documentId: id,
      requestSha256: coverLetterProviderSha256(request),
      dispatchedAt: now.toISOString(),
    };
    f.slots.set(
      "dispatch",
      encodeCoverLetterProviderObject("dispatch", { ...binding, state: "claimed" }),
    );
    f.slots.set(
      "result",
      encodeCoverLetterProviderObject("result", {
        ...binding,
        state: "ready",
        text: '{"paragraphs":[]}',
        model: COVER_LETTER_PROVIDER_MODEL,
        outputCharacters: 17,
      }),
    );
    expect(await f.run()).toEqual(initialized);
    expect(f.put).toHaveBeenCalledTimes(3);
    const bytes = f.slots.get("dispatch");
    if (!bytes) throw new Error("Synthetic dispatch missing");
    expect(decodeCoverLetterProviderObject("dispatch", bytes)).toMatchObject({ state: "claimed" });
  });

  it("refuses mismatched owned metadata before any object access", async () => {
    const f = fixture();
    f.metadata.ownerUserId = "synthetic-other-owner";
    expect(await f.run()).toEqual({ kind: "in_progress" });
    expect(f.put).not.toHaveBeenCalled();
    expect(f.find).not.toHaveBeenCalled();
  });

  it("keeps ambiguous quarantine refusal content-free and never writes objects", async () => {
    const f = fixture();
    f.quarantine();
    expect(await f.run()).toEqual({ kind: "in_progress" });
    expect(f.put).not.toHaveBeenCalled();
  });

  it("does not give authority to a conflicting existing request", async () => {
    const f = fixture();
    f.slots.set(
      "request",
      encodeCoverLetterProviderObject("request", {
        schemaVersion: 1,
        documentId: id,
        noticeVersion: "openai-cover-letter.v1",
        promptVersion: "1.0.0",
        jobContextHash: "f".repeat(64),
        confirmedFactsHash: "a".repeat(64),
        approvedAt: now.toISOString(),
        expiresAt: f.identity.expiresAt.toISOString(),
        system: "Synthetic",
        user: "Different",
        maxOutputChars: 8_000,
      }),
    );
    expect(await f.run()).toEqual({ kind: "in_progress" });
    expect(await f.run()).toEqual({ kind: "in_progress" });
    expect(f.put).toHaveBeenCalledTimes(1);
    expect(f.slots.has("dispatch")).toBe(false);
  });

  it("bounds stalled object reads and preserves the inventory for noncreating replay", async () => {
    const f = fixture({ timeoutMs: 20 });
    f.read.mockImplementation(async () => new Promise(() => undefined));
    expect(await f.run()).toEqual({ kind: "in_progress" });
    expect(f.put).toHaveBeenCalledTimes(1);
    expect(await f.run()).toEqual({ kind: "in_progress" });
    expect(f.put).toHaveBeenCalledTimes(1);
  });
});
