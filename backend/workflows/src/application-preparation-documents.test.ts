import { coverLetterContext } from "@ai-job-apply/ai-sdk";
import type { PreparationRecord } from "@ai-job-apply/applications-service";
import {
  CoverLetterDraftRecoveryService,
  CoverLetterPreparationService,
  CoverLetterProviderInitializer,
} from "@ai-job-apply/documents-service/cover-letter-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIsolatedCoverLetterPreparationPort } from "./application-preparation-documents.js";

type Options = Parameters<typeof createIsolatedCoverLetterPreparationPort>[0];
const owner = "019a4000-0000-7000-8000-000000000001";
const applicationId = "019a4000-0000-7000-8000-000000000002";
const id = "019a4000-0000-7000-8000-000000000003";
const factId = "019a4000-0000-7000-8000-000000000004";
const now = new Date("2026-10-04T12:00:00Z");

function fixture(defaultOff = false) {
  let enabled = true;
  let current = now;
  const fact: Awaited<
    ReturnType<Options["owners"]["profile"]["listProfileFacts"]>
  >["facts"][number] = {
    id: factId,
    kind: "skill",
    key: "skill",
    value: "TypeScript",
    verification: "confirmed",
    sensitivity: "standard",
    source: { type: "user", reference: "synthetic" },
    version: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const facts = [fact];
  const job = {
    title: "Engineer",
    company: { name: "Synthetic" },
    description: "Build reliable systems.",
    status: "active",
    expiresAt: new Date(now.getTime() + 86400_000),
  } as Awaited<ReturnType<Options["owners"]["catalog"]["getActiveJob"]>>;
  const getApplication = vi.fn<Options["owners"]["applications"]["getApplication"]>(
    async () =>
      ({ application: { id: applicationId, ownerUserId: owner, canonicalJobId: id } }) as Awaited<
        ReturnType<Options["owners"]["applications"]["getApplication"]>
      >,
  );
  const getActiveJob = vi.fn(async () => job);
  const listProfileFacts = vi.fn(async () => ({ facts, confirmedCount: 1, proposedCount: 0 }));
  const withGenerationLease = vi.fn<Options["candidateLease"]["withGenerationLease"]>(
    async (_owner, run) => run(),
  ) as unknown as Options["candidateLease"]["withGenerationLease"];
  const generationMetadata = vi.fn<Options["documents"]["generationMetadata"]>(async () => null);
  const reserveGeneration = vi.fn<Options["documents"]["reserveGeneration"]>(async () => {
    throw Error("SyntheticUnexpectedReservation");
  });
  const complete = vi.fn<Options["documents"]["complete"]>(async () => {
    throw Error("SyntheticUnexpectedFinalWrite");
  });
  const recover = vi.fn<Options["documents"]["recover"]>(async () => null);
  const putIfAbsent = vi.fn<Options["objects"]["putIfAbsent"]>(async () => {
    throw Error("SyntheticUnexpectedSlotCreation");
  });
  const find = vi.fn<Options["objects"]["find"]>(async () => undefined);
  const read = vi.fn<Options["objects"]["read"]>(async () => {
    throw Error("SyntheticUnexpectedSlotRead");
  });
  const issue = vi.fn<Options["work"]["issue"]>(async () => {
    throw Error("SyntheticUnexpectedGrant");
  });
  const claim = vi.fn<Options["work"]["claim"]>(async () => {
    throw Error("SyntheticUnexpectedClaim");
  });
  const recordSettled = vi.fn(async () => undefined);
  const issueProviderDispatch = vi.fn<Options["work"]["issueProviderDispatch"]>(async () => ({
    kind: "unavailable",
  }));
  const invoke = vi.fn<Options["provider"]["invoke"]>(async () => {
    throw Error("SyntheticUnexpectedInvoke");
  });
  const port = createIsolatedCoverLetterPreparationPort({
    owners: {
      applications: { getApplication },
      profile: { listProfileFacts },
      catalog: { getActiveJob },
    },
    documents: { generationMetadata, reserveGeneration, complete, recover },
    candidateLease: { withGenerationLease },
    objects: { putIfAbsent, find, read },
    work: { issue, claim, recordSettled, issueProviderDispatch },
    provider: { invoke },
    ...(defaultOff ? {} : { enabled: () => enabled }),
    clock: () => current,
  });
  const context = coverLetterContext({
    facts: [{ ...fact, value: "TypeScript" }],
    job: { title: "Engineer", company: "Synthetic", description: "Build reliable systems." },
    now,
  });
  const record: PreparationRecord = {
    id,
    ownerUserId: owner,
    applicationId,
    basePacketId: factId,
    expectedRevision: 1,
    ...context,
    noticeVersion: "openai-cover-letter.v1",
    approvedAt: new Date(now),
    expiresAt: new Date(now.getTime() + 900_000),
    generationClaimedAt: new Date(now),
    state: "running",
    resultPacketId: null,
    errorCode: null,
    createdAt: now,
    updatedAt: now,
  };
  return {
    port,
    record,
    context,
    facts,
    fact,
    job,
    getApplication,
    getActiveJob,
    listProfileFacts,
    withGenerationLease,
    generationMetadata,
    reserveGeneration,
    complete,
    recover,
    putIfAbsent,
    find,
    read,
    issue,
    claim,
    recordSettled,
    issueProviderDispatch,
    invoke,
    disable: () => {
      enabled = false;
    },
    time: (at: Date) => {
      current = at;
    },
  };
}

afterEach(() => vi.restoreAllMocks());
describe("private Applications to isolated Documents preparation composition", () => {
  it.each(["provider_dispatch", "final_document"] as const)(
    "initializer cannot issue, claim or settle %s work",
    async (purpose) => {
      const f = fixture();
      vi.spyOn(CoverLetterProviderInitializer.prototype, "initialize").mockImplementationOnce(
        async function (this: CoverLetterProviderInitializer) {
          const work: Pick<Options["work"], "issue" | "claim" | "recordSettled"> = Reflect.get(
            this,
            "work",
          );
          const reference = { id: factId, documentId: id, purpose, requestSha256: "a".repeat(64) };
          await expect(
            work.issue({
              documentId: id,
              ownerUserId: owner,
              purpose,
              requestSha256: reference.requestSha256,
              consentExpiresAt: f.record.expiresAt,
            }),
          ).rejects.toThrow("CoverLetterPreparationUnavailable");
          await expect(work.claim(reference)).rejects.toThrow("CoverLetterPreparationUnavailable");
          await expect(work.recordSettled(reference)).rejects.toThrow(
            "CoverLetterPreparationUnavailable",
          );
          return { kind: "in_progress" };
        },
      );
      expect(await f.port.generate(f.record)).toEqual({ kind: "in_progress" });
      for (const call of [f.issue, f.claim, f.recordSettled, f.issueProviderDispatch, f.invoke])
        expect(call).not.toHaveBeenCalled();
    },
  );
  it("recovery receives frozen exact store and provider-read capabilities", async () => {
    const f = fixture();
    vi.spyOn(CoverLetterDraftRecoveryService.prototype, "recover").mockImplementationOnce(
      async function (this: CoverLetterDraftRecoveryService) {
        const store: unknown = Reflect.get(this, "store");
        expect(Object.keys(store as object).sort()).toEqual([
          "complete",
          "generationMetadata",
          "recover",
          "withGenerationLease",
        ]);
        expect(Object.isFrozen(store)).toBe(true);
        const reader: object = Reflect.get(this, "provider");
        const objects: object = Reflect.get(reader, "objects");
        expect(Object.keys(objects).sort()).toEqual(["find", "read"]);
        expect(Object.isFrozen(objects)).toBe(true);
        return { kind: "in_progress" };
      },
    );
    expect(await f.port.recover(f.record)).toBeNull();
  });
  it("initialization receives only frozen reservation, lease, original work and creation capabilities", async () => {
    const f = fixture();
    vi.spyOn(CoverLetterProviderInitializer.prototype, "initialize").mockImplementationOnce(
      async function (this: CoverLetterProviderInitializer) {
        for (const [field, keys] of [
          ["store", ["reserveGeneration", "withGenerationLease"]],
          ["work", ["claim", "issue", "recordSettled"]],
          ["objects", ["find", "putIfAbsent", "read"]],
        ] as const) {
          const capability: object = Reflect.get(this, field);
          expect(Object.keys(capability).sort()).toEqual(keys);
          expect(Object.isFrozen(capability)).toBe(true);
        }
        return { kind: "in_progress" };
      },
    );
    expect(await f.port.generate(f.record)).toEqual({ kind: "in_progress" });
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it("defaults off before any owner/storage/work/object/provider I/O", async () => {
    const f = fixture(true);
    await expect(f.port.context(f.record)).rejects.toThrow("CoverLetterPreparationUnavailable");
    expect(await f.port.generate(f.record)).toEqual({
      kind: "failed",
      errorCode: "generation_unavailable",
    });
    expect(await f.port.recover(f.record)).toBeNull();
    for (const call of [
      f.withGenerationLease,
      f.getApplication,
      f.generationMetadata,
      f.reserveGeneration,
      f.putIfAbsent,
      f.issue,
      f.invoke,
    ])
      expect(call).not.toHaveBeenCalled();
  });
  it("context crosses owned APIs under the independent lease and returns hashes only", async () => {
    const f = fixture();
    const result = await f.port.context(f.record);
    expect(result).toEqual(f.context);
    expect(Object.keys(result).sort()).toEqual(["confirmedFactsHash", "jobContextHash"]);
    expect(JSON.stringify(result)).not.toContain("TypeScript");
    expect(f.getApplication).toHaveBeenCalledExactlyOnceWith(owner, applicationId);
    expect(f.listProfileFacts).toHaveBeenCalledExactlyOnceWith(owner);
    expect(f.withGenerationLease).toHaveBeenCalledTimes(1);
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it.each(["id", "ownerUserId", "applicationId", "jobContextHash", "confirmedFactsHash"] as const)(
    "invalid %s refuses before owning reads",
    async (field) => {
      const f = fixture();
      const record = { ...f.record, [field]: "invalid" };
      await expect(f.port.context(record)).rejects.toThrow("CoverLetterPreparationUnavailable");
      expect(f.getApplication).not.toHaveBeenCalled();
    },
  );
  it.each(["queued", "succeeded", "failed"] as const)(
    "%s record cannot enter generation or recovery",
    async (state) => {
      const f = fixture();
      const record = { ...f.record, state };
      expect((await f.port.generate(record)).kind).toBe("failed");
      expect(await f.port.recover(record)).toBeNull();
      expect(f.generationMetadata).not.toHaveBeenCalled();
    },
  );
  it.each([null, new Date(Number.NaN)])(
    "missing/invalid original claim %s cannot start or recover work",
    async (generationClaimedAt) => {
      const f = fixture();
      const record = { ...f.record, generationClaimedAt };
      expect((await f.port.generate(record)).kind).toBe("failed");
      expect(await f.port.recover(record)).toBeNull();
      expect(f.generationMetadata).not.toHaveBeenCalled();
    },
  );
  it("recovery with absent reservation never initializes, issues or invokes", async () => {
    const f = fixture();
    expect(await f.port.recover(f.record)).toBeNull();
    expect(f.generationMetadata).toHaveBeenCalledTimes(1);
    for (const call of [
      f.reserveGeneration,
      f.putIfAbsent,
      f.issue,
      f.claim,
      f.recordSettled,
      f.issueProviderDispatch,
      f.invoke,
    ])
      expect(call).not.toHaveBeenCalled();
  });
  it("generation maps only original identity and consent, detached across async work", async () => {
    const f = fixture();
    let received: unknown;
    const generate = vi
      .spyOn(CoverLetterPreparationService.prototype, "generate")
      .mockImplementationOnce(async (identity) => {
        received = structuredClone(identity);
        f.record.approvedAt.setTime(0);
        return { kind: "in_progress" };
      });
    const before = structuredClone(f.record);
    expect(await f.port.generate(f.record)).toEqual({ kind: "in_progress" });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(received).toEqual({
      id,
      ownerUserId: owner,
      applicationId,
      ...f.context,
      noticeVersion: before.noticeVersion,
      approvedAt: before.approvedAt,
      expiresAt: before.expiresAt,
    });
    f.record.approvedAt = before.approvedAt;
  });
  it("recovery routes only to draft recovery after disclosure expiry, never generation", async () => {
    const f = fixture();
    f.time(new Date(f.record.expiresAt.getTime() + 1));
    const letter = { contentSha256: "d".repeat(64), sourceFactIds: [factId], confidence: 0.9 };
    const recover = vi
      .spyOn(CoverLetterDraftRecoveryService.prototype, "recover")
      .mockResolvedValueOnce({ kind: "ready", letter });
    const generate = vi.spyOn(CoverLetterPreparationService.prototype, "generate");
    expect(await f.port.recover(f.record)).toEqual(letter);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
    expect(f.invoke).not.toHaveBeenCalled();
    expect(f.putIfAbsent).not.toHaveBeenCalled();
  });
  it("withdrawing activation during recovery withholds its binding", async () => {
    const f = fixture();
    vi.spyOn(CoverLetterDraftRecoveryService.prototype, "recover").mockImplementationOnce(
      async () => {
        f.disable();
        return {
          kind: "ready",
          letter: { contentSha256: "d".repeat(64), sourceFactIds: [], confidence: 1 },
        };
      },
    );
    expect(await f.port.recover(f.record)).toBeNull();
  });
  it("recovery diagnostics are fixed and contain no owner/provider text", async () => {
    const f = fixture();
    f.generationMetadata.mockRejectedValueOnce(Error("SyntheticPrivateDiagnostic"));
    await expect(f.port.recover(f.record)).rejects.toThrow(/^CoverLetterPreparationUnavailable$/u);
  });
  it("changed evidence changes context and cannot be replaced by caller hashes", async () => {
    const f = fixture();
    f.fact.value = "JavaScript";
    expect((await f.port.context(f.record)).confirmedFactsHash).not.toBe(
      f.record.confirmedFactsHash,
    );
  });
});
