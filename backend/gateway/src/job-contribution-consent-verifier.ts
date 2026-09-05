import type {
  JobContributionConsentRevoker,
  JobContributionConsentVerifier,
} from "@ai-job-apply/jobs-service";
import {
  UgcContributionConsentConflictError,
  type UgcContributionConsentStore,
  type UgcContributionConsentVerifier,
} from "@ai-job-apply/profile-service";

const POLICY_VERSION = /^[a-z0-9][a-z0-9._-]{2,99}$/u;

export class ProfileJobContributionConsentRevoker implements JobContributionConsentRevoker {
  constructor(private readonly profileConsents: UgcContributionConsentStore) {}

  async revoke(input: Parameters<JobContributionConsentRevoker["revoke"]>[0]): Promise<void> {
    try {
      await this.profileConsents.revoke({
        consentId: input.consentId,
        ownerUserId: input.ownerUserId,
        idempotencyKey: `contribution-cancel-${input.contributionId}`,
        occurredAt: input.occurredAt,
        traceId: input.traceId,
      });
    } catch (error) {
      if (!(error instanceof UgcContributionConsentConflictError)) throw error;
      // A prior direct revocation or supersession is also permanently invalid.
      // Never turn not-found, expiry, mismatch or dependency failure into success.
      const current = await this.profileConsents.verify({
        consentId: input.consentId,
        documentVersion: input.consentVersion,
        ownerUserId: input.ownerUserId,
        policyVersion: input.policyVersion,
        previewPayloadSha256: input.previewDigestSha256,
        verifiedAt: input.occurredAt,
      });
      if (current.valid || current.reason !== "not_current") throw error;
    }
  }
}

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
