import {
  compileComponentValidator,
  type IndependentJobReviewEvidence,
} from "@ai-job-apply/api-contracts";
import type postgres from "postgres";

const validate = compileComponentValidator("IndependentJobReviewEvidence");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const domains: Record<string, readonly string[]> = {
  greenhouse: ["boards.greenhouse.io", "job-boards.greenhouse.io"],
  lever: ["jobs.lever.co", "jobs.eu.lever.co"],
  ashby: ["jobs.ashbyhq.com"],
};

export function projectIndependentJobReviewEvidence(input: {
  contributionId: string;
  evidenceDigestSha256: string;
  verifiedAt: Date | string;
  observation: unknown;
}): IndependentJobReviewEvidence {
  if (
    !input.observation ||
    typeof input.observation !== "object" ||
    Array.isArray(input.observation)
  )
    throw new Error("Review evidence unavailable");
  const value = input.observation as Record<string, unknown>;
  const source = new URL(String(value.sourceUrl));
  if (
    source.protocol !== "https:" ||
    source.username ||
    source.password ||
    source.port ||
    source.search ||
    source.hash ||
    !domains[String(value.provider)]?.includes(source.hostname)
  )
    throw new Error("Review evidence unavailable");
  const projection = {
    contributionId: input.contributionId,
    evidenceDigestSha256: input.evidenceDigestSha256,
    verifiedAt: new Date(input.verifiedAt).toISOString(),
    provider: value.provider,
    sourceUrl: source.href,
    title: value.title,
    companyName: value.companyName,
    description: value.description,
    locations: value.locations,
    ...(value.department ? { department: value.department } : {}),
    ...(value.workMode ? { workMode: value.workMode } : {}),
    ...(value.employmentType ? { employmentType: value.employmentType } : {}),
  };
  const texts = [
    projection.title,
    projection.companyName,
    projection.description,
    projection.department,
    ...(Array.isArray(projection.locations) ? projection.locations : []),
  ];
  if (
    !validate(projection) ||
    texts.some(
      (text) =>
        typeof text === "string" &&
        (/<\/?[a-z][^>]*>|<!--/iu.test(text) ||
          [...text].some((character) => {
            const code = character.charCodeAt(0);
            return code === 127 || (code < 32 && ![9, 10, 13].includes(code));
          })),
    )
  )
    throw new Error("Review evidence unavailable");
  return structuredClone(projection) as IndependentJobReviewEvidence;
}

/** Jobs owns this projection; Trust supplies its already-authorized exact case-owner binding. */
export class PostgresContributionReviewEvidenceReader {
  constructor(private readonly client: postgres.Sql) {}

  async read(input: {
    contributionId: string;
    contributorUserId: string;
  }): Promise<IndependentJobReviewEvidence | null> {
    if (!UUID.test(input.contributionId) || !UUID.test(input.contributorUserId))
      throw new Error("Review evidence unavailable");
    const [row] = await this.client<
      {
        contributionId: string;
        evidenceDigestSha256: string;
        verifiedAt: Date | string;
        observation: unknown;
      }[]
    >`
      SELECT verification.contribution_id AS "contributionId",
        verification.evidence_digest_sha256 AS "evidenceDigestSha256",
        verification.verified_at AS "verifiedAt", verification.provider_observation AS observation
      FROM jobs.job_contribution_independent_verifications AS verification
      INNER JOIN jobs.job_contributions AS contribution ON contribution.id = verification.contribution_id
      WHERE contribution.id = ${input.contributionId}::uuid
        AND contribution.owner_user_id = ${input.contributorUserId}::uuid
      ORDER BY verification.verified_at DESC, verification.id DESC LIMIT 1
    `;
    return row ? projectIndependentJobReviewEvidence(row) : null;
  }
}
