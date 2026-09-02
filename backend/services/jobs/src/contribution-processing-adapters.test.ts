import { createHash } from "node:crypto";
import {
  type OutboxNudgeV1,
  outboxNudgeIntegrityInput,
  validateOutboxNudge,
} from "@ai-job-apply/event-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  IdentifierOnlyContributionProcessingEventPublisher,
  ProfileCurrentContributionConsentAdapter,
} from "./contribution-processing-adapters.js";
import type { ContributionConsentBinding } from "./contribution-processing.js";

const ownerUserId = "01990b00-0000-7000-8000-000000000001";
const contributionId = "01990b00-0000-7000-8000-000000000002";
const consentId = "01990b00-0000-7000-8000-000000000003";
const approvedAt = "2026-09-02T12:00:00.000Z";

function binding(): ContributionConsentBinding {
  return {
    ownerUserId,
    consentId,
    purpose: "ugc_contribution",
    clientSurface: "browser_extension",
    clientVersion: "0.2.0",
    contributionId,
    consentVersion: "ugc-contribution-preview.v1",
    policyVersion: "synthetic-ugc-v1",
    previewDigestSha256: "a".repeat(64),
    approvedAt,
    checkedAt: "2026-09-02T12:05:00.000Z",
  };
}

function consent() {
  return {
    client: "extension" as const,
    documentVersion: "ugc-contribution-preview.v1",
    grantedAt: approvedAt,
    id: consentId,
    ownerUserId,
    policyVersion: "synthetic-ugc-v1",
    previewPayloadSha256: "a".repeat(64),
    purpose: "ugc_contribution" as const,
    recordedAt: approvedAt,
    schemaVersion: 1 as const,
    state: "granted" as const,
  };
}

describe("contribution processing runtime adapters", () => {
  it("maps Profile's exact current consent and fails malformed authority closed", async () => {
    const verify = vi.fn(async () => ({ consent: consent(), valid: true as const }));
    const adapter = new ProfileCurrentContributionConsentAdapter({ verify });
    await expect(adapter.verifyCurrent(binding())).resolves.toEqual({ status: "current" });
    expect(verify).toHaveBeenCalledWith({
      consentId,
      documentVersion: "ugc-contribution-preview.v1",
      ownerUserId,
      policyVersion: "synthetic-ugc-v1",
      previewPayloadSha256: "a".repeat(64),
      verifiedAt: "2026-09-02T12:05:00.000Z",
    });

    await expect(
      new ProfileCurrentContributionConsentAdapter({
        verify: vi.fn(async () => ({
          consent: { ...consent(), ownerUserId: contributionId },
            valid: true as const,
        })),
      }).verifyCurrent(binding()),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      new ProfileCurrentContributionConsentAdapter({
        verify: vi.fn(async () => ({ reason: "not_current" as const, valid: false as const })),
      }).verifyCurrent(binding()),
    ).resolves.toEqual({ status: "invalid" });
    await expect(
      new ProfileCurrentContributionConsentAdapter({
        verify: vi.fn(async () => Promise.reject(new Error("private"))),
      }).verifyCurrent(binding()),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("publishes only an integrity-bound identifier nudge through the existing transport seam", async () => {
    const transport = { publish: vi.fn(async (_nudge: OutboxNudgeV1) => undefined) };
    const publisher = new IdentifierOnlyContributionProcessingEventPublisher(transport);
    const event = {
      id: "01990b00-0000-7000-8000-000000000004",
      type: "job.normalized.v1" as const,
      subject: contributionId,
      data: {
        contributionId,
        normalizationId: "01990b00-0000-7000-8000-000000000005",
      },
    };
    await publisher.publish({ idempotencyKey: event.id, event });
    expect(transport.publish).toHaveBeenCalledOnce();
    const [nudge] = transport.publish.mock.calls[0] ?? [];
    expect(validateOutboxNudge(nudge)).toBe(true);
    expect(nudge).toEqual({
      schemaVersion: 1,
      eventId: event.id,
      eventType: event.type,
      integrity: {
        algorithm: "sha256",
        digest: createHash("sha256")
          .update(
            outboxNudgeIntegrityInput({
              schemaVersion: 1,
              eventId: event.id,
              eventType: event.type,
            }),
          )
          .digest("hex"),
      },
    });
    expect(JSON.stringify(nudge)).not.toContain(contributionId);
    expect(JSON.stringify(nudge)).not.toContain("normalizationId");
  });
});
