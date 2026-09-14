import { describe, expect, it } from "vitest";
import {
  mergeContributionHistory,
  parseContributionReceipts,
  receiptFromContribution,
  receiptsForIdentity,
  updateTrustStatus,
  upsertContributionReceipt,
} from "../lib/contribution-receipts";

const contribution = {
  id: "018f0000-0000-7000-8000-000000000004",
  state: "queued" as const,
  submittedAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-01T12:00:00.000Z",
};
const identityFence = "a".repeat(43);

describe("identifier-only durable contribution receipts", () => {
  it("survives serialization without page content and remains account fenced", () => {
    const receipt = receiptFromContribution(contribution, identityFence);
    const restarted = parseContributionReceipts(
      JSON.parse(JSON.stringify(upsertContributionReceipt([], receipt))),
    );
    expect(receiptsForIdentity(restarted, identityFence)).toEqual([receipt]);
    expect(receiptsForIdentity(restarted, "b".repeat(43))).toEqual([]);
    expect(JSON.stringify(restarted)).not.toContain("sourceUrl");
  });
  it("stores only the owner projection of Trust state", () => {
    const receipt = receiptFromContribution(contribution, identityFence);
    const updated = updateTrustStatus(receipt, {
      id: "018f0000-0000-8000-8000-000000000005",
      contributionId: contribution.id,
      state: "rejected",
      policyVersion: "policy.v1",
      version: 2,
      appealed: false,
      appealDeadlineAt: null,
      createdAt: contribution.submittedAt,
      updatedAt: contribution.updatedAt,
    });
    expect(updated.trust).toEqual({
      appealed: false,
      state: "rejected",
      updatedAt: contribution.updatedAt,
      version: 2,
      appealDeadlineAt: null,
    });
    expect(updated).not.toHaveProperty("trust.policyVersion");
  });
  it("fails closed when local receipt storage is malformed", () => {
    expect(
      parseContributionReceipts([
        {
          contributionId: contribution.id,
          identityFence,
          state: "published",
          submittedAt: contribution.submittedAt,
          updatedAt: contribution.updatedAt,
          sourceUrl: "https://private.invalid",
        },
      ]),
    ).toEqual([]);
  });

  it.each([
    { processing: ["queued"], trust: ["accepted"] },
    { processing: [["queued"]], trust: [["accepted"]] },
    { processing: { toString: "queued" }, trust: { toString: "accepted" } },
    { processing: null, trust: null },
    { processing: false, trust: false },
    { processing: 1, trust: 1 },
  ])("rejects non-string cached states before they can reach the renderer %#", (states) => {
    const valid = receiptFromContribution(contribution, identityFence);
    expect(parseContributionReceipts([{ ...valid, state: states.processing }])).toEqual([]);
    expect(
      parseContributionReceipts([
        {
          ...valid,
          trust: {
            appealed: false,
            state: states.trust,
            version: 2,
            updatedAt: contribution.updatedAt,
          },
        },
      ]),
    ).toEqual([]);
    expect(parseContributionReceipts([valid, { ...valid, state: states.processing }])).toEqual([]);
  });

  it("restores owner history while preserving newer processing and Trust snapshots", () => {
    const current = {
      ...receiptFromContribution(contribution, identityFence),
      state: "published" as const,
      updatedAt: "2026-09-01T12:02:00.000Z",
      trust: {
        appealed: false,
        state: "accepted" as const,
        version: 2,
        updatedAt: "2026-09-01T12:01:00.000Z",
      },
    };
    const otherOwner = { ...current, identityFence: "b".repeat(43) };
    const restored = mergeContributionHistory([current, otherOwner], [contribution], identityFence);
    expect(restored).toEqual([current, otherOwner]);
    expect(mergeContributionHistory([], [contribution], identityFence)).toEqual([
      receiptFromContribution(contribution, identityFence),
    ]);
    const newer = {
      ...contribution,
      state: "removed" as const,
      updatedAt: "2026-09-01T12:03:00.000Z",
    };
    expect(mergeContributionHistory([current], [newer], identityFence)[0]).toEqual({
      ...current,
      state: "removed",
      updatedAt: newer.updatedAt,
    });
  });

  it("does not interpret a bounded empty page as deletion or mix another account's Trust snapshot", () => {
    const receipt = receiptFromContribution(contribution, identityFence);
    expect(mergeContributionHistory([receipt], [], identityFence)).toEqual([receipt]);
    const other = {
      ...receipt,
      identityFence: "b".repeat(43),
      trust: {
        appealed: false,
        state: "accepted" as const,
        version: 2,
        updatedAt: contribution.updatedAt,
      },
    };
    expect(mergeContributionHistory([other], [contribution], identityFence)[0]).toEqual(receipt);
  });

  it("bounds restored history to the latest 25 with deterministic ID tie-breaking", () => {
    const items = Array.from({ length: 25 }, (_, index) => ({
      ...contribution,
      id: `018f0000-0000-7000-8000-${(index + 10).toString().padStart(12, "0")}`,
    }));
    const merged = mergeContributionHistory(
      [receiptFromContribution(contribution, identityFence)],
      items,
      identityFence,
    );
    expect(merged).toHaveLength(25);
    expect(merged.map((item) => item.contributionId)).toEqual(
      items.map((item) => item.id).reverse(),
    );
    expect(parseContributionReceipts(merged)).toEqual(merged);
  });

  it("rejects a contradictory submitted timestamp without changing local records", () => {
    const receipt = receiptFromContribution(contribution, identityFence);
    expect(() =>
      mergeContributionHistory(
        [receipt],
        [{ ...contribution, submittedAt: "2026-09-01T11:00:00.000Z" }],
        identityFence,
      ),
    ).toThrow("identity mismatch");
    expect(receipt.submittedAt).toBe(contribution.submittedAt);
  });
});
