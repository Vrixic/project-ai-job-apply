import { describe, expect, it } from "vitest";
import {
  assertRecentPrivateFeatureMatchingTime,
  parsePrivateFeatureMatchingAcceptanceEnvironment,
} from "./private-feature-acceptance.js";

const payload = {
  runId: "12345678-1234-4234-8234-123456789abc",
  ownerUserId: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c1",
  savedJobId: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c2",
  requestedJobId: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c3",
  resolvedCanonicalJobIdAtSave: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c3",
  companyId: "5109bd67-ab6e-5e2a-8b83-7cb2c11d632a",
  companyName: "Synthetic Company",
  verifiedDomain: "synthetic.example.test",
  title: "Synthetic Search Fixture Alpha",
  locations: ["Synthetic Remote"],
  department: "Synthetic Acceptance",
  firstObservedAt: "2026-08-23T12:00:00.000Z",
  lastVerifiedAt: "2026-08-23T12:00:00.000Z",
  expiresAt: "2026-09-22T12:00:00.000Z",
  savedAt: "2026-08-23T12:01:00.000Z",
};

const environment = {
  PRIVATE_FEATURE_ACCEPTANCE_CONFIRMATION: "generated-synthetic-private-feature-acceptance",
  PRIVATE_FEATURE_ACCEPTANCE_ACTION: "prepare",
  PRIVATE_FEATURE_ACCEPTANCE_PAYLOAD: JSON.stringify(payload),
};

describe("private-feature Matching acceptance", () => {
  it("parses an exact generated-synthetic fixture", () => {
    expect(parsePrivateFeatureMatchingAcceptanceEnvironment(environment)).toMatchObject({
      action: "prepare",
      runId: payload.runId,
      ownerUserId: payload.ownerUserId,
      locations: payload.locations,
    });
  });

  it("rejects unknown fields and invalid snapshot chronology", () => {
    expect(() =>
      parsePrivateFeatureMatchingAcceptanceEnvironment({
        ...environment,
        PRIVATE_FEATURE_ACCEPTANCE_PAYLOAD: JSON.stringify({ ...payload, unexpected: true }),
      }),
    ).toThrow("payload is invalid");
    expect(() =>
      parsePrivateFeatureMatchingAcceptanceEnvironment({
        ...environment,
        PRIVATE_FEATURE_ACCEPTANCE_PAYLOAD: JSON.stringify({
          ...payload,
          expiresAt: payload.lastVerifiedAt,
        }),
      }),
    ).toThrow("chronology");
  });

  it("rejects stale clocks and accepts the inclusive boundary", () => {
    const at = new Date(payload.savedAt);
    expect(() =>
      assertRecentPrivateFeatureMatchingTime(at, new Date(at.getTime() + 15 * 60_000)),
    ).not.toThrow();
    expect(() =>
      assertRecentPrivateFeatureMatchingTime(at, new Date(at.getTime() + 15 * 60_000 + 1)),
    ).toThrow("clock window");
  });
});
