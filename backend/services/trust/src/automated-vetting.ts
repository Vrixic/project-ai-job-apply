import {
  type ReviewerContributionEvidence,
  TrustApplicationError,
  type TrustApplicationService,
} from "./application.js";
import type { TrustCase } from "./policy.js";

/**
 * Automated source vetting (ADR-054). A model advises; this service decides only to ACCEPT, and
 * only through the same `decideInitialReview` path a human uses, so Trust still verifies the
 * independent provider evidence itself. Everything else stays in the human queue. It never rejects,
 * takes down or resolves an appeal, and it does nothing while its kill switch is off.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const minimumAutomaticAcceptanceConfidence = 0.9;

/** The public posting only. No candidate data, contributor identity or evidence digest. */
export interface VettingPosting {
  provider: ReviewerContributionEvidence["provider"];
  sourceUrl: string;
  title: string;
  companyName: string;
  description: string;
  locations: readonly string[];
  department?: string | undefined;
  workMode?: string | undefined;
  employmentType?: string | undefined;
}

export interface VettingAssessment {
  decision: "accept" | "defer";
  concerns: readonly string[];
  confidence: number;
  model: { provider: string; model: string; version: string };
  promptId: string;
  promptVersion: string;
}

export interface VettingAssessorPort {
  assess(posting: VettingPosting): Promise<VettingAssessment>;
}

export type AutomatedVettingOutcome =
  | "accepted"
  | "deferred"
  | "conflict"
  | "unavailable"
  | "disabled"
  | "not_pending"
  | "already_assessed";

/** No posting text: only identifiers, digests and the enumerated assessment. */
export interface VettingAuditRecord {
  kind: "assessed" | "outcome";
  caseId: string;
  contributionId: string;
  evidenceDigestSha256: string;
  decision: VettingAssessment["decision"];
  concerns: readonly string[];
  confidence: number;
  model: VettingAssessment["model"];
  promptId: string;
  promptVersion: string;
  outcome?: Exclude<AutomatedVettingOutcome, "disabled" | "not_pending" | "already_assessed">;
  at: string;
}

export interface VettingAuditSink {
  record(entry: VettingAuditRecord): Promise<void>;
  /**
   * Whether this exact evidence was already assessed with this prompt version, so a deferred case is
   * not sent to the model again on every pass. A sink that cannot say (a log) omits it, and the
   * deployment bounds cost by cadence instead; a durable sink needs the owner's schema approval.
   */
  hasAssessed?(input: {
    caseId: string;
    evidenceDigestSha256: string;
    promptVersion: string;
  }): Promise<boolean>;
}

type TrustPort = Pick<
  TrustApplicationService,
  "readReviewerCase" | "readReviewerEvidence" | "decideInitialReview" | "listReviewerCases"
>;

export interface AutomatedVettingResult {
  caseId: string;
  outcome: AutomatedVettingOutcome;
}

export class AutomatedSourceVetting {
  private readonly now: () => Date;
  private readonly minimumConfidence: number;

  constructor(
    private readonly options: {
      application: TrustPort;
      assessor: VettingAssessorPort;
      audit: VettingAuditSink;
      /** The automated reviewer identity; the runtime authority port must authorize only this. */
      reviewerId: string;
      /** Kill switch. Default-off composition must pass () => false. */
      enabled: () => boolean;
      /** The prompt version the assessor runs, used only to remember what was already assessed. */
      promptVersion: string;
      minimumConfidence?: number;
      now?: () => Date;
    },
  ) {
    if (!UUID_PATTERN.test(options.reviewerId))
      throw new TypeError("An explicit automated reviewer identity is required");
    this.now = options.now ?? (() => new Date());
    this.minimumConfidence = Math.max(
      minimumAutomaticAcceptanceConfidence,
      options.minimumConfidence ?? minimumAutomaticAcceptanceConfidence,
    );
  }

  /** Vets one case. Never throws for an ordinary dependency or policy refusal. */
  async vet(caseId: string): Promise<AutomatedVettingResult> {
    if (!this.options.enabled()) return { caseId, outcome: "disabled" };
    const reviewerId = this.options.reviewerId;
    let trustCase: TrustCase;
    let evidence: ReviewerContributionEvidence;
    let caseVersion: number;
    try {
      trustCase = await this.options.application.readReviewerCase({ reviewerId, caseId });
      if (trustCase.state !== "needs_review") return { caseId, outcome: "not_pending" };
      const read = await this.options.application.readReviewerEvidence({ reviewerId, caseId });
      evidence = read.evidence;
      caseVersion = read.caseVersion;
    } catch {
      return { caseId, outcome: "unavailable" };
    }
    let assessment: VettingAssessment;
    try {
      if (
        await this.options.audit.hasAssessed?.({
          caseId,
          evidenceDigestSha256: evidence.evidenceDigestSha256,
          promptVersion: this.options.promptVersion,
        })
      )
        return { caseId, outcome: "already_assessed" };
      assessment = await this.options.assessor.assess({
        provider: evidence.provider,
        sourceUrl: evidence.sourceUrl,
        title: evidence.title,
        companyName: evidence.companyName,
        description: evidence.description,
        locations: evidence.locations,
        department: evidence.department,
        workMode: evidence.workMode,
        employmentType: evidence.employmentType,
      });
    } catch {
      return { caseId, outcome: "unavailable" };
    }
    const base = {
      caseId,
      contributionId: trustCase.contributionId,
      evidenceDigestSha256: evidence.evidenceDigestSha256,
      decision: assessment.decision,
      concerns: [...assessment.concerns],
      confidence: assessment.confidence,
      model: assessment.model,
      promptId: assessment.promptId,
      promptVersion: assessment.promptVersion,
    };
    // No acceptance without a durable-enough record of what the model said.
    try {
      await this.options.audit.record({ ...base, kind: "assessed", at: this.now().toISOString() });
    } catch {
      return { caseId, outcome: "unavailable" };
    }
    const acceptable =
      assessment.decision === "accept" &&
      assessment.concerns.length === 0 &&
      Number.isFinite(assessment.confidence) &&
      assessment.confidence >= this.minimumConfidence;
    let outcome: NonNullable<VettingAuditRecord["outcome"]> = "deferred";
    if (acceptable) {
      try {
        await this.options.application.decideInitialReview({
          reviewerId,
          caseId,
          expectedVersion: caseVersion,
          outcome: "accepted",
          reasonCode: "independently_verified",
          evidenceDigestSha256: evidence.evidenceDigestSha256,
        });
        outcome = "accepted";
      } catch (error) {
        // A moved case or a failed evidence proof is never an adverse decision: the human queue
        // keeps the case.
        outcome =
          error instanceof TrustApplicationError && error.code === "version_conflict"
            ? "conflict"
            : error instanceof TrustApplicationError && error.code === "evidence_not_verified"
              ? "deferred"
              : "unavailable";
      }
    }
    try {
      await this.options.audit.record({
        ...base,
        kind: "outcome",
        outcome,
        at: this.now().toISOString(),
      });
    } catch {
      // The assessment record already exists; the decision itself is a Trust case event.
    }
    return { caseId, outcome };
  }

  /** One bounded pass over the oldest pending cases. Sequential, so the model sees one at a time. */
  async vetPending(limit = 10): Promise<{
    examined: number;
    results: AutomatedVettingResult[];
  }> {
    if (!this.options.enabled()) return { examined: 0, results: [] };
    const bounded = Math.max(1, Math.min(25, Math.trunc(limit)));
    let items: TrustCase[];
    try {
      ({ items } = await this.options.application.listReviewerCases({
        reviewerId: this.options.reviewerId,
        state: "needs_review",
        pageSize: bounded,
      }));
    } catch {
      return { examined: 0, results: [] };
    }
    const results: AutomatedVettingResult[] = [];
    for (const item of items.slice(0, bounded)) {
      if (!this.options.enabled()) break;
      results.push(await this.vet(item.id));
    }
    return { examined: results.length, results };
  }
}
