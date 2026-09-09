import { createHash } from "node:crypto";
import {
  eventTypes,
  type OutboxNudgeV1,
  outboxNudgeIntegrityInput,
  validateOutboxNudge,
} from "@ai-job-apply/event-contracts";
import type {
  ContributionProcessingStore,
  TrustContributionDecision,
} from "./contribution-processing.js";
import type { ContributionProcessingQueueStore } from "./contribution-processing-runner.js";

const POLICY_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{2,99}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface TrustDecisionAuthorityPort {
  readSignal(decisionId: string): Promise<{ decisionId: string; contributionId: string } | null>;
  readDecision(input: {
    decisionId: string;
    contributionId: string;
    contributorUserId: string;
  }): Promise<{
    status: "needs_review" | "accepted" | "rejected" | "withdrawn" | "taken_down";
    contributionId: string;
    decisionId: string;
    policyVersion: string;
    decidedAt: string;
    evidenceDigestSha256?: string;
    independentEvidenceDigestSha256?: string;
  } | null>;
}

export interface ContributionTrustSignalMetrics {
  handled: number;
  copied: number;
  requeued: number;
}

function exactInstant(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function validNudge(nudge: OutboxNudgeV1): boolean {
  if (
    !validateOutboxNudge(nudge) ||
    nudge.eventType !== eventTypes.trustContributionDecisionChanged
  ) {
    return false;
  }
  const fields = {
    schemaVersion: nudge.schemaVersion,
    eventId: nudge.eventId,
    eventType: nudge.eventType,
    ...(nudge.traceparent ? { traceparent: nudge.traceparent } : {}),
  };
  return (
    createHash("sha256").update(outboxNudgeIntegrityInput(fields)).digest("hex") ===
    nudge.integrity.digest
  );
}

/**
 * Consumes one identifier-only Trust nudge. Jobs resolves its own owner, exact-reads Trust, copies
 * actionable decision truth through the Jobs store, then explicitly wakes parked processing.
 */
export class ContributionTrustDecisionSignalConsumer {
  constructor(
    private readonly trust: TrustDecisionAuthorityPort,
    private readonly jobs: Pick<ContributionProcessingStore, "load" | "recordTrustDecision">,
    private readonly queue: Pick<ContributionProcessingQueueStore, "requeue">,
    private readonly processingPolicyVersion: string,
  ) {
    if (!POLICY_VERSION_PATTERN.test(processingPolicyVersion)) {
      throw new TypeError("An explicit contribution processing policy version is required");
    }
  }

  async consume(nudge: OutboxNudgeV1, nowInput: Date): Promise<ContributionTrustSignalMetrics> {
    if (!validNudge(nudge)) throw new Error("The Trust decision nudge is invalid");
    if (!(nowInput instanceof Date) || !Number.isFinite(nowInput.getTime())) {
      throw new TypeError("The Trust signal consumer clock is invalid");
    }
    const now = new Date(nowInput.getTime());
    const signal = await this.trust.readSignal(nudge.eventId);
    if (
      !signal ||
      signal.decisionId !== nudge.eventId ||
      !UUID_PATTERN.test(signal.contributionId)
    ) {
      throw new Error("The authoritative Trust decision signal is unavailable");
    }
    const contribution = await this.jobs.load(signal.contributionId);
    if (!contribution || contribution.contributionId !== signal.contributionId) {
      throw new Error("The Jobs contribution identity is unavailable");
    }
    const decision = await this.trust.readDecision({
      decisionId: signal.decisionId,
      contributionId: signal.contributionId,
      contributorUserId: contribution.ownerUserId,
    });
    if (
      !decision ||
      decision.decisionId !== signal.decisionId ||
      decision.contributionId !== signal.contributionId ||
      !POLICY_VERSION_PATTERN.test(decision.policyVersion) ||
      !exactInstant(decision.decidedAt)
    ) {
      throw new Error("The exact authoritative Trust decision is unavailable");
    }

    if (
      decision.status === "accepted" &&
      !/^[a-f0-9]{64}$/u.test(decision.independentEvidenceDigestSha256 ?? "")
    ) {
      const copied = contribution.trustDecision;
      // The authoritative reader binds this immutable event ID to its exact case/version.
      // SQL0023 only made an already copied singleton basis explicit. A replay may acknowledge
      // that same decision, but cannot derive a basis, copy again, wake work, or alter a case.
      if (
        decision.independentEvidenceDigestSha256 === undefined &&
        copied?.status === "accepted" &&
        copied.decisionId === decision.decisionId &&
        copied.contributionId === decision.contributionId &&
        copied.policyVersion === decision.policyVersion &&
        copied.decidedAt === decision.decidedAt &&
        /^[a-f0-9]{64}$/u.test(copied.independentEvidenceDigestSha256 ?? "")
      )
        return Object.freeze({ handled: 1, copied: 0, requeued: 0 });
      throw new Error("The exact authoritative Trust decision is unavailable");
    }

    let copied = 0;
    if (decision.status !== "needs_review") {
      const actionable: Exclude<
        TrustContributionDecision,
        { status: "unavailable" | "needs_review" }
      > = {
        ...decision,
        status: decision.status as "accepted" | "rejected" | "withdrawn" | "taken_down",
      };
      await this.jobs.recordTrustDecision({
        contributionId: signal.contributionId,
        decision: actionable,
        processingPolicyVersion: this.processingPolicyVersion,
        occurredAt: now,
      });
      copied = 1;
    }
    const requeued = await this.queue.requeue({
      contributionId: signal.contributionId,
      now,
      signal:
        decision.status === "withdrawn"
          ? "withdrawal"
          : decision.status === "taken_down"
            ? "takedown"
            : "trust_decision",
    });
    return Object.freeze({ handled: 1, copied, requeued: requeued ? 1 : 0 });
  }
}
