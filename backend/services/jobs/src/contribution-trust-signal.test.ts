import { createHash } from "node:crypto";
import { type OutboxNudgeV1, outboxNudgeIntegrityInput } from "@ai-job-apply/event-contracts";
import { describe, expect, it, vi } from "vitest";
import { ContributionTrustDecisionSignalConsumer } from "./contribution-trust-signal.js";

const decisionId = "8c22280f-3fc3-8f8b-8a0f-1fc74152d8c9";
const contributionId = "019b4e12-7ea3-7c36-9357-aea35ab542ca";
const ownerUserId = "019b4e12-7ea3-7c36-9357-aea35ab542cb";
const now = new Date("2026-09-02T04:00:00.000Z");

function nudge(): OutboxNudgeV1 {
  const fields = {
    schemaVersion: 1 as const,
    eventId: decisionId,
    eventType: "trust.contribution-decision.changed.v1",
  };
  return {
    ...fields,
    integrity: {
      algorithm: "sha256",
      digest: createHash("sha256").update(outboxNudgeIntegrityInput(fields)).digest("hex"),
    },
  };
}

function dependencies(status: "needs_review" | "accepted" | "withdrawn" = "accepted") {
  const trust = {
    readSignal: vi.fn(async () => ({ decisionId, contributionId })),
    readDecision: vi.fn(async () => ({
      status,
      decisionId,
      contributionId,
      policyVersion: "synthetic-trust-v1",
      decidedAt: "2026-09-02T03:59:00.000Z",
      evidenceDigestSha256: "a".repeat(64),
      independentEvidenceDigestSha256: "b".repeat(64),
    })),
  };
  const jobs = {
    load: vi.fn(async () => ({ contributionId, ownerUserId })),
    recordTrustDecision: vi.fn(async () => ({ contributionId, ownerUserId })),
  };
  const queue = { requeue: vi.fn(async () => true) };
  return { trust, jobs, queue };
}

describe("ContributionTrustDecisionSignalConsumer", () => {
  function historicalReplay() {
    const value = dependencies("accepted");
    const decision = {
      status: "accepted" as const,
      decisionId,
      contributionId,
      policyVersion: "synthetic-trust-v1",
      decidedAt: "2026-09-02T03:59:00.000Z",
    };
    value.trust.readDecision = vi.fn(async () => decision) as never;
    value.jobs.load = vi.fn(async () => ({
      contributionId,
      ownerUserId,
      trustDecision: { ...decision, independentEvidenceDigestSha256: "b".repeat(64) },
    })) as never;
    return { ...value, decision };
  }

  it("acknowledges only an exact already-copied historical decision without any writes or wakeup", async () => {
    const value = historicalReplay();
    await expect(
      new ContributionTrustDecisionSignalConsumer(
        value.trust,
        value.jobs as never,
        value.queue,
        "synthetic-processing-v1",
      ).consume(nudge(), now),
    ).resolves.toEqual({ handled: 1, copied: 0, requeued: 0 });
    expect(value.jobs.recordTrustDecision).not.toHaveBeenCalled();
    expect(value.queue.requeue).not.toHaveBeenCalled();
  });

  it.each([
    "missing",
    "decision",
    "contribution",
    "status",
    "policy",
    "time",
    "basis",
    "malformed_signal",
  ])("rejects historical acceptance replay with %s mismatch", async (change) => {
    const value = historicalReplay();
    const copied = {
      ...value.decision,
      status: "accepted",
      independentEvidenceDigestSha256: "b".repeat(64),
    };
    if (change === "decision") copied.decisionId = "8c22280f-3fc3-8f8b-8a0f-1fc74152d8c8";
    if (change === "contribution") copied.contributionId = ownerUserId;
    if (change === "status") copied.status = "withdrawn";
    if (change === "policy") copied.policyVersion = "another-policy-v1";
    if (change === "time") copied.decidedAt = now.toISOString();
    if (change === "basis") copied.independentEvidenceDigestSha256 = "invalid";
    if (change === "malformed_signal")
      value.trust.readDecision = vi.fn(async () => ({
        ...value.decision,
        independentEvidenceDigestSha256: "invalid",
      })) as never;
    value.jobs.load = vi.fn(async () => ({
      contributionId,
      ownerUserId,
      ...(change === "missing" ? {} : { trustDecision: copied }),
    })) as never;
    await expect(
      new ContributionTrustDecisionSignalConsumer(
        value.trust,
        value.jobs as never,
        value.queue,
        "synthetic-processing-v1",
      ).consume(nudge(), now),
    ).rejects.toThrow("exact authoritative");
    expect(value.jobs.recordTrustDecision).not.toHaveBeenCalled();
    expect(value.queue.requeue).not.toHaveBeenCalled();
  });

  it("exact-reads with the Jobs-owned owner, copies, and explicitly requeues", async () => {
    const value = dependencies("accepted");
    const result = await new ContributionTrustDecisionSignalConsumer(
      value.trust,
      value.jobs as never,
      value.queue,
      "synthetic-processing-v1",
    ).consume(nudge(), now);
    expect(value.trust.readDecision).toHaveBeenCalledWith({
      decisionId,
      contributionId,
      contributorUserId: ownerUserId,
    });
    expect(value.jobs.recordTrustDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        contributionId,
        processingPolicyVersion: "synthetic-processing-v1",
        decision: expect.objectContaining({
          evidenceDigestSha256: "a".repeat(64),
          independentEvidenceDigestSha256: "b".repeat(64),
        }),
      }),
    );
    expect(value.queue.requeue).toHaveBeenCalledWith({
      contributionId,
      now,
      signal: "trust_decision",
    });
    expect(result).toEqual({ handled: 1, copied: 1, requeued: 1 });
  });

  it("requeues review-pending truth without copying a terminal decision", async () => {
    const value = dependencies("needs_review");
    await expect(
      new ContributionTrustDecisionSignalConsumer(
        value.trust,
        value.jobs as never,
        value.queue,
        "synthetic-processing-v1",
      ).consume(nudge(), now),
    ).resolves.toEqual({ handled: 1, copied: 0, requeued: 1 });
    expect(value.jobs.recordTrustDecision).not.toHaveBeenCalled();
  });

  it("fails closed before Jobs writes when owner-bound Trust truth is absent", async () => {
    const value = dependencies();
    value.trust.readDecision = vi.fn(async () => null) as never;
    await expect(
      new ContributionTrustDecisionSignalConsumer(
        value.trust,
        value.jobs as never,
        value.queue,
        "synthetic-processing-v1",
      ).consume(nudge(), now),
    ).rejects.toThrow("exact authoritative");
    expect(value.jobs.recordTrustDecision).not.toHaveBeenCalled();
    expect(value.queue.requeue).not.toHaveBeenCalled();
  });

  it("rejects tampered transport identity", async () => {
    const value = dependencies();
    const tampered = nudge();
    tampered.integrity.digest = "0".repeat(64);
    await expect(
      new ContributionTrustDecisionSignalConsumer(
        value.trust,
        value.jobs as never,
        value.queue,
        "synthetic-processing-v1",
      ).consume(tampered, now),
    ).rejects.toThrow("nudge is invalid");
  });
});
