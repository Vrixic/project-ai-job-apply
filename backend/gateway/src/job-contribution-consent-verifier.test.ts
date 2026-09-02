import type { UgcContributionConsentVerifier } from "@ai-job-apply/profile-service";
import { describe, expect, it, vi } from "vitest";
import {
  configuredUgcContributionPolicyVersion,
  ProfileJobContributionConsentVerifier,
} from "./job-contribution-consent-verifier.js";

const ownerUserId = "019d04cf-1f80-7000-8000-000000000001";
const consentId = "019d04cf-1f80-7000-8000-000000000002";
const grantedAt = "2026-09-01T12:00:00.000Z";

function input() {
  return {
    approvedAt: grantedAt,
    clientSurface: "browser_extension" as const,
    consentId,
    consentVersion: "ugc-contribution-preview.v1" as const,
    contributionId: "019d04cf-1f80-7000-8000-000000000003",
    ownerUserId,
    policyVersion: "ugc-contribution-policy.v1",
    previewDigestSha256: "a".repeat(64),
    purpose: "ugc_contribution" as const,
  };
}

describe("ProfileJobContributionConsentVerifier", () => {
  it("keeps the accountable policy default-dark unless an exact version is injected", () => {
    expect(configuredUgcContributionPolicyVersion(undefined)).toBeUndefined();
    expect(configuredUgcContributionPolicyVersion("NOT APPROVED")).toBeUndefined();
    expect(configuredUgcContributionPolicyVersion(" d2-synthetic-policy.v1 ")).toBe(
      "d2-synthetic-policy.v1",
    );
  });
  it("maps the Jobs binding to the Profile document and exact server timestamp", async () => {
    const verify = vi.fn(async () => ({
      consent: {
        client: "extension" as const,
        documentVersion: "ugc-contribution-preview.v1",
        grantedAt,
        id: consentId,
        ownerUserId,
        policyVersion: "ugc-contribution-policy.v1",
        previewPayloadSha256: "a".repeat(64),
        purpose: "ugc_contribution" as const,
        recordedAt: grantedAt,
        schemaVersion: 1 as const,
        state: "granted" as const,
      },
      valid: true as const,
    }));
    const profile = { verify } satisfies UgcContributionConsentVerifier;
    const verifier = new ProfileJobContributionConsentVerifier(
      profile,
      "ugc-contribution-policy.v1",
      () => new Date("2026-09-01T12:01:00.000Z"),
    );

    await expect(verifier.verify(input())).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith({
      consentId,
      documentVersion: "ugc-contribution-preview.v1",
      ownerUserId,
      policyVersion: "ugc-contribution-policy.v1",
      previewPayloadSha256: "a".repeat(64),
      verifiedAt: "2026-09-01T12:01:00.000Z",
    });
  });

  it("rejects a mismatched client-fabricated approval timestamp", async () => {
    const profile: UgcContributionConsentVerifier = {
      async verify() {
        return {
          consent: {
            client: "extension",
            documentVersion: "ugc-contribution-preview.v1",
            grantedAt,
            id: consentId,
            ownerUserId,
            policyVersion: "ugc-contribution-policy.v1",
            previewPayloadSha256: "a".repeat(64),
            purpose: "ugc_contribution",
            recordedAt: grantedAt,
            schemaVersion: 1,
            state: "granted",
          },
          valid: true,
        };
      },
    };
    const verifier = new ProfileJobContributionConsentVerifier(
      profile,
      "ugc-contribution-policy.v1",
    );
    await expect(
      verifier.verify({ ...input(), approvedAt: "2026-09-01T12:00:01.000Z" }),
    ).resolves.toBe(false);
  });

  it("does not consult Profile when the accountable policy is absent or mismatched", async () => {
    const verify = vi.fn();
    const profile = { verify } satisfies UgcContributionConsentVerifier;
    await expect(
      new ProfileJobContributionConsentVerifier(profile, undefined).verify(input()),
    ).resolves.toBe(false);
    await expect(
      new ProfileJobContributionConsentVerifier(profile, "different-policy.v1").verify(input()),
    ).resolves.toBe(false);
    expect(verify).not.toHaveBeenCalled();
  });
});
