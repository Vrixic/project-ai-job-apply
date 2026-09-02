import type { JobContributionConsentVerifier } from "@ai-job-apply/jobs-service";
import type { UgcContributionConsentVerifier } from "@ai-job-apply/profile-service";

const POLICY_VERSION = /^[a-z0-9][a-z0-9._-]{2,99}$/u;

export function configuredUgcContributionPolicyVersion(
  value: string | undefined,
): string | undefined {
  const candidate = value?.trim();
  return candidate && POLICY_VERSION.test(candidate) ? candidate : undefined;
}

export class ProfileJobContributionConsentVerifier implements JobContributionConsentVerifier {
  constructor(
    private readonly profileConsents: UgcContributionConsentVerifier,
    private readonly policyVersion: string | undefined,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async verify(input: Parameters<JobContributionConsentVerifier["verify"]>[0]): Promise<boolean> {
    if (!this.policyVersion || input.policyVersion !== this.policyVersion) return false;
    const result = await this.profileConsents.verify({
      consentId: input.consentId,
      documentVersion: input.consentVersion,
      ownerUserId: input.ownerUserId,
      policyVersion: input.policyVersion,
      previewPayloadSha256: input.previewDigestSha256,
      verifiedAt: this.clock().toISOString(),
    });
    return result.valid && result.consent.grantedAt === input.approvedAt;
  }
}
