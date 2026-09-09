import type { D2LambdaGatewayTrustConfiguration } from "@ai-job-apply/config";
import { PostgresContributionReviewEvidenceReader } from "@ai-job-apply/jobs-service";
import {
  PostgresTrustStore,
  TrustApplicationService,
  type TrustEvidencePurpose,
  type TrustReviewerRole,
} from "@ai-job-apply/trust-service";
import type postgres from "postgres";
import { type TrustReviewerAssignment, trustReviewerId } from "./trust-reviewer-authority.js";

type ConfiguredEvidencePurpose = TrustEvidencePurpose | "verified_requester_takedown";

function evidenceKey(
  contributionId: string,
  evidenceDigestSha256: string,
  purpose: ConfiguredEvidencePurpose,
): string {
  return `${contributionId}\0${evidenceDigestSha256}\0${purpose}`;
}

export interface ConfiguredD2TrustRuntime {
  service: TrustApplicationService;
  reviewerAssignments: readonly TrustReviewerAssignment[];
}

/**
 * Composes Trust only from explicit reviewed configuration and authoritative Profile/Jobs rows.
 * No caller identity, evidence digest, policy duration, or reviewer authority is inferred.
 */
export function createConfiguredD2TrustRuntime(
  client: postgres.Sql,
  configuration: D2LambdaGatewayTrustConfiguration,
): ConfiguredD2TrustRuntime {
  const reviewerAssignments = Object.freeze(
    configuration.reviewerAssignments.map(({ issuer, subject, roles }) =>
      Object.freeze({ issuer, subject, roles: Object.freeze([...roles]) }),
    ),
  );
  const reviewerRoles = new Map<string, ReadonlySet<TrustReviewerRole>>();
  const verifiedRequesterReviewers = new Set<string>();
  for (const assignment of configuration.reviewerAssignments) {
    const reviewerId = trustReviewerId(assignment.issuer, assignment.subject);
    reviewerRoles.set(reviewerId, new Set(assignment.roles));
    if (assignment.verifiedRequesterTakedown) verifiedRequesterReviewers.add(reviewerId);
  }
  const evidence = new Set(
    configuration.evidenceAllowlist.flatMap((item) =>
      item.purposes.map((purpose) =>
        evidenceKey(item.contributionId, item.evidenceDigestSha256, purpose),
      ),
    ),
  );

  const service = new TrustApplicationService({
    store: new PostgresTrustStore(client),
    contributorAccountAuthority: {
      async authorize({ contributorUserId }) {
        const [row] = await client<{ active: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM identity.users
            WHERE id = ${contributorUserId}::uuid AND account_state = 'active'
          ) AS active
        `;
        return row?.active === true;
      },
    },
    reviewerAuthority: {
      async authorize({ reviewerId, role }) {
        return reviewerRoles.get(reviewerId)?.has(role) === true;
      },
    },
    verifiedRequesterTakedownAuthority: {
      async authorize({ reviewerId, contributionId, evidenceDigestSha256 }) {
        return (
          verifiedRequesterReviewers.has(reviewerId) &&
          evidence.has(
            evidenceKey(contributionId, evidenceDigestSha256, "verified_requester_takedown"),
          )
        );
      },
    },
    contributionEvidence: {
      readReviewEvidence: (input) =>
        new PostgresContributionReviewEvidenceReader(client).read(input),
      async readEligibility(contributionId) {
        const [row] = await client<
          { contributionId: string; contributorUserId: string; independentlyVerified: boolean }[]
        >`
          SELECT contribution.id AS "contributionId",
            contribution.owner_user_id AS "contributorUserId",
            EXISTS (
              SELECT 1 FROM jobs.job_contribution_independent_verifications AS verification
              WHERE verification.contribution_id = contribution.id
            ) AS "independentlyVerified"
          FROM jobs.job_contributions AS contribution
          WHERE contribution.id = ${contributionId}
        `;
        return row
          ? Object.freeze({
              contributionId: row.contributionId,
              contributorUserId: row.contributorUserId,
              eligibleForTrustReview: row.independentlyVerified,
            })
          : null;
      },
      async verifyEvidence({ contributionId, evidenceDigestSha256, purpose, freshAt }) {
        if (
          purpose === "initial_review" &&
          evidence.has(evidenceKey(contributionId, evidenceDigestSha256, purpose))
        )
          return true;
        if (purpose !== "independent_verification" && purpose !== "initial_review") {
          return evidence.has(evidenceKey(contributionId, evidenceDigestSha256, purpose));
        }
        const [row] = await client<{ verified: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM jobs.job_contribution_independent_verifications AS verification
            WHERE contribution_id = ${contributionId}
              AND evidence_digest_sha256 = ${evidenceDigestSha256}
              AND (${freshAt ?? null}::timestamptz IS NULL OR (
                verification.verified_at <= ${freshAt ?? null}::timestamptz
                AND verification.verified_at >= ${freshAt ?? null}::timestamptz - interval '24 hours'
                AND NOT EXISTS (SELECT 1 FROM jobs.job_contribution_independent_verifications AS newer
                  WHERE newer.contribution_id = verification.contribution_id
                    AND (newer.verified_at, newer.id) > (verification.verified_at, verification.id))
              ))
          ) AS verified
        `;
        return row?.verified === true;
      },
    },
    approvedPolicy: {
      async readApprovedPolicy() {
        return Object.freeze({
          version: configuration.policyVersion,
          appealWindowMilliseconds: configuration.appealWindowMilliseconds,
        });
      },
    },
    systemActorId: configuration.systemActorId,
  });
  return Object.freeze({ service, reviewerAssignments });
}
