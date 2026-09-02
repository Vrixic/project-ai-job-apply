import { describe, expect, it } from "vitest";
import { parseContributionReceipts, receiptFromContribution, receiptsForIdentity, updateTrustStatus, upsertContributionReceipt } from "../lib/contribution-receipts";

const contribution = { id: "018f0000-0000-7000-8000-000000000004", state: "queued" as const, submittedAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-01T12:00:00.000Z" };
const identityFence = "a".repeat(43);

describe("identifier-only durable contribution receipts", () => {
  it("survives serialization without page content and remains account fenced", () => {
    const receipt = receiptFromContribution(contribution, identityFence);
    const restarted = parseContributionReceipts(JSON.parse(JSON.stringify(upsertContributionReceipt([], receipt))));
    expect(receiptsForIdentity(restarted, identityFence)).toEqual([receipt]);
    expect(receiptsForIdentity(restarted, "b".repeat(43))).toEqual([]);
    expect(JSON.stringify(restarted)).not.toContain("sourceUrl");
  });
  it("stores only the owner projection of Trust state", () => {
    const receipt = receiptFromContribution(contribution, identityFence);
    const updated = updateTrustStatus(receipt, { id: "018f0000-0000-8000-8000-000000000005", contributionId: contribution.id, state: "rejected", policyVersion: "policy.v1", version: 2, appealed: false, appealDeadlineAt: null, createdAt: contribution.submittedAt, updatedAt: contribution.updatedAt });
    expect(updated.trust).toEqual({ appealed: false, state: "rejected", updatedAt: contribution.updatedAt, version: 2, appealDeadlineAt: null });
    expect(updated).not.toHaveProperty("trust.policyVersion");
  });
  it("fails closed when local receipt storage is malformed", () => {
    expect(parseContributionReceipts([{ contributionId: contribution.id, identityFence, state: "published", submittedAt: contribution.submittedAt, updatedAt: contribution.updatedAt, sourceUrl: "https://private.invalid" }])).toEqual([]);
  });
});
