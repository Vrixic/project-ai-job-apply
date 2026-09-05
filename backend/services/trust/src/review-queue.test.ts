import { describe, expect, it, vi } from "vitest";
import { TrustApplicationService, type TrustApplicationStore } from "./application.js";
import { openTrustCase } from "./policy.js";
import { parseTrustReviewQueue, trustReviewQueueCursor } from "./review-queue.js";

const id = "019d04cf-1f80-7000-8000-000000000010";
const ownerId = "019d04cf-1f80-7000-8000-000000000011";
const reviewerId = "019d04cf-1f80-7000-8000-000000000012";
const current = openTrustCase({
  caseId: id,
  contributionId: id,
  contributorUserId: ownerId,
  systemActorId: reviewerId,
  policy: { version: "synthetic-v1", appealWindowMilliseconds: 1_000 },
  occurredAt: new Date("2026-09-05T12:00:00.000Z"),
}).trustCase;
const evidence = {
  contributionId: id,
  evidenceDigestSha256: "a".repeat(64),
  verifiedAt: current.createdAt.toISOString(),
  provider: "greenhouse" as const,
  sourceUrl: "https://job-boards.greenhouse.io/synthetic/jobs/123",
  title: "Synthetic role",
  companyName: "Synthetic company",
  locations: [],
  description: "Complete verified public job evidence.",
};

describe("reviewer queue and readable evidence", () => {
  it("roundtrips a bounded filter-bound continuation and rejects malformed requests", () => {
    const query = parseTrustReviewQueue({ pageSize: 2 });
    const cursor = trustReviewQueueCursor(query, current);
    expect(parseTrustReviewQueue({ pageSize: 2, cursor }).after).toEqual({
      id,
      updatedAt: current.updatedAt.toISOString(),
    });
    for (const value of [
      { pageSize: 0 },
      { pageSize: 26 },
      { pageSize: 1.5 },
      { state: "accepted" },
      { cursor: "x".repeat(401) },
      { cursor: `${cursor}=` },
      { cursor, pageSize: 3 },
      { cursor, pageSize: 2, state: "appeal_pending" },
    ])
      expect(() => parseTrustReviewQueue(value)).toThrow();
  });

  it("denies unassigned readers before touching either owning data port", async () => {
    const listReviewerCases = vi.fn();
    const readReviewerCase = vi.fn();
    const service = new TrustApplicationService({
      store: { listReviewerCases, readReviewerCase } as unknown as TrustApplicationStore,
    });
    await expect(service.listReviewerCases({ reviewerId })).rejects.toMatchObject({
      code: "access_denied",
    });
    await expect(service.readReviewerEvidence({ reviewerId, caseId: id })).rejects.toMatchObject({
      code: "access_denied",
    });
    expect(listReviewerCases).not.toHaveBeenCalled();
    expect(readReviewerCase).not.toHaveBeenCalled();
  });

  it("bounds queue pages and derives the continuation without exposing extra rows", async () => {
    const listReviewerCases = vi.fn(async () => [current, { ...current, id: ownerId }]);
    const service = new TrustApplicationService({
      store: { listReviewerCases } as unknown as TrustApplicationStore,
      reviewerAuthority: { authorize: async ({ role }) => role === "case_reader" },
    });
    const page = await service.listReviewerCases({ reviewerId, pageSize: 1 });
    expect(page.items).toEqual([current]);
    if (!page.nextCursor) throw new Error("Expected bounded queue continuation");
    expect(parseTrustReviewQueue({ pageSize: 1, cursor: page.nextCursor }).after?.id).toBe(id);
    expect(listReviewerCases).toHaveBeenCalledWith({ pageSize: 1, state: "needs_review" });
  });

  it("binds readable evidence to the exact owner, contribution, case version, and verified digest", async () => {
    const readReviewEvidence = vi.fn(async () => evidence);
    const readReviewerCase = vi.fn(async () => current);
    const verifyEvidence = vi.fn(async () => true);
    const service = new TrustApplicationService({
      store: { readReviewerCase } as unknown as TrustApplicationStore,
      reviewerAuthority: { authorize: async () => true },
      contributionEvidence: {
        readEligibility: async () => null,
        readReviewEvidence,
        verifyEvidence,
      },
    });
    expect(await service.readReviewerEvidence({ reviewerId, caseId: id })).toEqual({
      caseId: id,
      caseVersion: 1,
      evidence,
    });
    expect(readReviewEvidence).toHaveBeenCalledWith({
      contributionId: id,
      contributorUserId: ownerId,
    });
    expect(verifyEvidence).toHaveBeenCalledWith({
      contributionId: id,
      evidenceDigestSha256: evidence.evidenceDigestSha256,
      purpose: "independent_verification",
    });
    readReviewerCase
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ ...current, version: 2 });
    await expect(service.readReviewerEvidence({ reviewerId, caseId: id })).rejects.toMatchObject({
      code: "version_conflict",
    });
    readReviewEvidence.mockResolvedValueOnce({ ...evidence, contributionId: ownerId });
    await expect(service.readReviewerEvidence({ reviewerId, caseId: id })).rejects.toMatchObject({
      code: "dependency_unavailable",
    });
    verifyEvidence.mockResolvedValueOnce(false);
    await expect(service.readReviewerEvidence({ reviewerId, caseId: id })).rejects.toMatchObject({
      code: "evidence_not_verified",
    });
  });
});
