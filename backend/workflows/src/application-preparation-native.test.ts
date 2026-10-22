import { coverLetterContext } from "@ai-job-apply/ai-sdk";
import type { PreparationRecord } from "@ai-job-apply/applications-service";
import { prepareOriginalCoverLetterRequest } from "@ai-job-apply/documents-service/cover-letter-runtime";
import { describe, expect, it, vi } from "vitest";
import { createNativeCoverLetterPreparationPort } from "./application-preparation-native.js";

type Options = Parameters<typeof createNativeCoverLetterPreparationPort>[0];
const id = (n: number) => `019a4000-0000-7000-8000-${String(n).padStart(12, "0")}`;
function fixture(defaultOff = false, launchEnabled = true) {
  let enabled = true,
    now = new Date("2026-10-06T12:00:00Z"),
    reserved = false,
    ready = false;
  const facts = [
    {
      id: id(4),
      kind: "skill" as const,
      key: "skill",
      value: "TypeScript",
      verification: "confirmed" as const,
      sensitivity: "standard" as const,
      source: { type: "user" as const, reference: "synthetic" },
      version: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  ];
  const job = { title: "Engineer", company: "Synthetic", description: "Build reliable systems." };
  const context = coverLetterContext({ facts, job, now });
  const record: PreparationRecord = {
    id: id(1),
    ownerUserId: id(2),
    applicationId: id(3),
    basePacketId: id(5),
    expectedRevision: 1,
    ...context,
    noticeVersion: "openai-cover-letter.v1",
    approvedAt: new Date(now),
    expiresAt: new Date(now.getTime() + 900_000),
    generationClaimedAt: new Date(now),
    state: "running",
    resultPacketId: null,
    errorCode: null,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };
  const receipt = {
    schemaVersion: 1 as const,
    material: {
      schemaVersion: 1 as const,
      kind: "cover_letter" as const,
      ownerUserId: record.ownerUserId,
      applicationId: record.applicationId,
      generationId: record.id,
      version: 2,
      contentSha256: "d".repeat(64),
      completedAtMs: now.getTime(),
      expiresAtMs: now.getTime() + 1_800_000,
    },
    sourceFactIds: [id(4)],
    confidence: 0.9,
  };
  const read = vi.fn<Options["ready"]["read"]>(async () =>
    ready ? structuredClone(receipt) : null,
  );
  const reserveGeneration = vi.fn<Options["documents"]["reserveGeneration"]>(async (input) => {
    const kind = reserved ? "already_reserved" : "claimed";
    reserved = true;
    return {
      kind,
      metadata: {
        ...input,
        version: 2,
        status: "pending",
        objectKey: "synthetic-unused",
        objectVersion: null,
        objectSha256: null,
        contentSha256: null,
        sizeBytes: null,
        promptVersion: null,
        createdAt: new Date(now),
      },
    };
  });
  const issue = vi.fn<Options["work"]["issue"]>(async (input) => ({
    kind: "issued",
    authorization: {
      ...input,
      id: id(6),
      issuedAt: new Date(now),
      expiresAt: new Date(now.getTime() + 90_000),
      state: "issued",
      startedAt: null,
      terminalAt: null,
    },
  }));
  const launch = vi.fn<Options["launcher"]["launch"]>(async () => {
    throw Error("SyntheticLostAck");
  });
  const readPreviousEpoch = vi.fn<Options["admission"]["readPreviousEpoch"]>(async () => null);
  const options: Options = {
    owners: {
      applications: {
        getApplication: async () =>
          ({ application: { id: id(3), ownerUserId: id(2), canonicalJobId: id(7) } }) as Awaited<
            ReturnType<Options["owners"]["applications"]["getApplication"]>
          >,
      },
      profile: { listGroundingFacts: async () => facts },
      catalog: {
        getActiveJob: async () =>
          ({
            ...job,
            company: { name: job.company },
            status: "active",
            expiresAt: new Date(record.approvedAt.getTime() + 86_400_000),
          }) as Awaited<ReturnType<Options["owners"]["catalog"]["getActiveJob"]>>,
      },
    },
    candidateLease: { withGenerationLease: async (_owner, run) => run() },
    documents: { reserveGeneration },
    work: { issue },
    ready: { read },
    admission: { readPreviousEpoch },
    launcher: { launch },
    ...(defaultOff ? {} : { enabled: () => enabled }),
    clock: () => now,
    launchEnabled: () => launchEnabled,
  };
  return {
    port: createNativeCoverLetterPreparationPort(options),
    record,
    receipt,
    facts,
    job,
    read,
    reserveGeneration,
    issue,
    launch,
    readPreviousEpoch,
    publish: () => {
      ready = true;
    },
    disable: () => {
      enabled = false;
    },
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}
describe("native preparation original flow", () => {
  it("fresh-launch shutdown keeps original recovery available without reservation or work", async () => {
    const f = fixture(false, false);
    expect(await f.port.generate(f.record)).toEqual({ kind: "in_progress" });
    expect(f.reserveGeneration).not.toHaveBeenCalled();
    expect(f.issue).not.toHaveBeenCalled();
    f.publish();
    expect(await f.port.recover(f.record)).toMatchObject({ temporaryMaterial: f.receipt.material });
    expect(f.launch).not.toHaveBeenCalled();
  });
  it("issues canonical memory request once and never retries a lost launch ACK", async () => {
    const f = fixture();
    const expected = prepareOriginalCoverLetterRequest(f.record, {
      facts: f.facts,
      job: f.job,
      now: f.record.approvedAt,
    });
    expect(await f.port.generate(f.record)).toEqual({ kind: "in_progress" });
    expect(f.issue).toHaveBeenCalledWith({
      ownerUserId: id(2),
      documentId: id(1),
      purpose: "provider_dispatch",
      requestSha256: expected?.requestSha256,
      consentExpiresAt: f.record.expiresAt,
    });
    expect(f.launch).toHaveBeenCalledOnce();
    expect(JSON.stringify(f.launch.mock.calls)).not.toContain("TypeScript");
    expect(await f.port.recover(f.record)).toBeNull();
    expect(await f.port.generate(f.record)).toEqual({ kind: "in_progress" });
    expect(f.issue).toHaveBeenCalledOnce();
    expect(f.launch).toHaveBeenCalledOnce();
  });
  it("recovers the original version/citations after consent without issuing new work", async () => {
    const f = fixture();
    f.publish();
    f.advance(900_001);
    expect(await f.port.recover(f.record)).toEqual({
      temporaryMaterial: f.receipt.material,
      contentSha256: f.receipt.material.contentSha256,
      sourceFactIds: [id(4)],
      confidence: 0.9,
    });
    expect(f.reserveGeneration).not.toHaveBeenCalled();
    expect(f.issue).not.toHaveBeenCalled();
    expect(f.launch).not.toHaveBeenCalled();
  });
  it("carries the sealed prior epoch into a fresh launch", async () => {
    const f = fixture();
    f.readPreviousEpoch.mockResolvedValue(id(8));
    await f.port.generate(f.record);
    expect(f.launch.mock.calls[0]?.[0].previousEpochId).toBe(id(8));
  });
  it("refuses an active prior epoch before reserving", async () => {
    const f = fixture();
    f.readPreviousEpoch.mockRejectedValue(Error("SyntheticAdmissionClosed"));
    expect(await f.port.generate(f.record)).toEqual({ kind: "in_progress" });
    expect(f.reserveGeneration).not.toHaveBeenCalled();
    expect(f.launch).not.toHaveBeenCalled();
  });
  it("returns ready only from the owning receipt after a positive launch ACK", async () => {
    const f = fixture();
    f.launch.mockImplementation(async () => {
      f.publish();
      return {} as Awaited<ReturnType<Options["launcher"]["launch"]>>;
    });
    expect(await f.port.generate(f.record)).toEqual({
      kind: "ready",
      letter: {
        temporaryMaterial: f.receipt.material,
        contentSha256: "d".repeat(64),
        sourceFactIds: [id(4)],
        confidence: 0.9,
      },
    });
  });
  it.each(["owner", "expired", "extra"])("refuses a %s receipt", async (kind) => {
    const f = fixture();
    f.publish();
    if (kind === "owner") f.receipt.material.ownerUserId = id(9);
    if (kind === "expired") f.advance(1_800_000);
    if (kind === "extra") Object.assign(f.receipt, { body: "SyntheticForbiddenText" });
    await expect(f.port.recover(f.record)).rejects.toThrow("CoverLetterPreparationUnavailable");
    expect(f.launch).not.toHaveBeenCalled();
  });
  it("refuses changed context before reservation", async () => {
    const f = fixture();
    f.record.confirmedFactsHash = "a".repeat(64);
    expect(await f.port.generate(f.record)).toEqual({
      kind: "failed",
      errorCode: "bindings_changed",
    });
    expect(f.reserveGeneration).not.toHaveBeenCalled();
    expect(f.issue).not.toHaveBeenCalled();
  });
  it("refuses default-off and never reaches owning ports", async () => {
    const f = fixture(true);
    await expect(f.port.context(f.record)).rejects.toThrow("CoverLetterPreparationUnavailable");
    expect(await f.port.generate(f.record)).toEqual({ kind: "in_progress" });
    expect(f.read).not.toHaveBeenCalled();
    expect(f.reserveGeneration).not.toHaveBeenCalled();
  });
  it("does not launch if disabled while issuing", async () => {
    const f = fixture();
    const original = f.issue.getMockImplementation();
    if (!original) throw Error("SyntheticIssuerMissing");
    f.issue.mockImplementation(async (input) => {
      const result = await original(input);
      f.disable();
      return result;
    });
    expect(await f.port.generate(f.record)).toEqual({ kind: "in_progress" });
    expect(f.launch).not.toHaveBeenCalled();
  });
});
