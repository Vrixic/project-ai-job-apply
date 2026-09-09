import type {
  ContributionTrustDecisionPort,
  TrustContributionDecision,
} from "@ai-job-apply/jobs-service";
import type {
  AuthoritativeTrustContributionDecision,
  PostgresTrustDecisionSignalStore,
  TrustApplicationService,
} from "@ai-job-apply/trust-service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID_V8_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const POLICY_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{2,99}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

type TrustCaseOpener = Pick<TrustApplicationService, "openReview">;
type TrustDecisionReader = Pick<PostgresTrustDecisionSignalStore, "readLatestDecision">;

function validInstant(value: string): boolean {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function validDecision(
  value: AuthoritativeTrustContributionDecision | null,
  contributionId: string,
): value is AuthoritativeTrustContributionDecision {
  return Boolean(
    value &&
      value.contributionId === contributionId &&
      UUID_V8_PATTERN.test(value.decisionId) &&
      POLICY_VERSION_PATTERN.test(value.policyVersion) &&
      (value.status !== "accepted" ||
        SHA256_PATTERN.test(value.independentEvidenceDigestSha256 ?? "")) &&
      validInstant(value.decidedAt),
  );
}

/**
 * Exact, owner-bound Trust processing authority. It may open review through one explicitly
 * authorized reviewer identity, but it never decides or auto-accepts a case.
 */
export class AuthoritativeContributionTrustDecisionAdapter
  implements ContributionTrustDecisionPort
{
  constructor(
    private readonly application: TrustCaseOpener,
    private readonly decisions: TrustDecisionReader,
    private readonly caseOpenerReviewerId: string,
  ) {
    if (!UUID_PATTERN.test(caseOpenerReviewerId)) {
      throw new TypeError("An explicit Trust case-opener reviewer is required");
    }
  }

  async readForRefresh(input: {
    contributionId: string;
    contributorUserId: string;
  }): Promise<TrustContributionDecision> {
    if (!UUID_V7_PATTERN.test(input.contributionId) || !UUID_PATTERN.test(input.contributorUserId))
      return { status: "unavailable" };
    try {
      const latest = await this.decisions.readLatestDecision(input);
      if (
        !validDecision(latest, input.contributionId) ||
        (latest.status === "needs_review" && latest.initialReviewPending !== true)
      )
        return { status: "unavailable" };
      return latest;
    } catch {
      return { status: "unavailable" };
    }
  }

  async evaluate(input: {
    contributionId: string;
    contributorUserId: string;
    normalizationId: string;
    independentVerificationId: string;
    independentEvidenceDigestSha256: string;
  }): Promise<TrustContributionDecision> {
    if (
      !UUID_V7_PATTERN.test(input.contributionId) ||
      !UUID_PATTERN.test(input.contributorUserId) ||
      !UUID_V7_PATTERN.test(input.normalizationId) ||
      !UUID_V7_PATTERN.test(input.independentVerificationId) ||
      !SHA256_PATTERN.test(input.independentEvidenceDigestSha256)
    ) {
      return { status: "unavailable" };
    }
    try {
      let latest = await this.decisions.readLatestDecision({
        contributionId: input.contributionId,
        contributorUserId: input.contributorUserId,
      });
      if (!latest) {
        const opened = await this.application.openReview({
          reviewerId: this.caseOpenerReviewerId,
          contributionId: input.contributionId,
        });
        if (
          opened.contributionId !== input.contributionId ||
          opened.contributorUserId !== input.contributorUserId
        ) {
          return { status: "unavailable" };
        }
        latest = await this.decisions.readLatestDecision({
          contributionId: input.contributionId,
          contributorUserId: input.contributorUserId,
        });
      }
      if (!validDecision(latest, input.contributionId)) return { status: "unavailable" };
      return latest;
    } catch {
      return { status: "unavailable" };
    }
  }
}
