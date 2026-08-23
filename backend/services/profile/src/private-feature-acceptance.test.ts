import { describe, expect, it } from "vitest";
import {
  assertRecentPrivateFeatureAcceptanceTime,
  parsePrivateFeatureProfileAcceptanceEnvironment,
  privateFeatureAcceptanceSubject,
} from "./private-feature-acceptance.js";

const environment = {
  PRIVATE_FEATURE_ACCEPTANCE_CONFIRMATION: "generated-synthetic-private-feature-acceptance",
  PRIVATE_FEATURE_ACCEPTANCE_ACTION: "prepare",
  PRIVATE_FEATURE_ACCEPTANCE_RUN_ID: "12345678-1234-4234-8234-123456789abc",
  PRIVATE_FEATURE_ACCEPTANCE_ISSUER: "https://identity.example.test/",
  PRIVATE_FEATURE_ACCEPTANCE_OWNER_USER_ID: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c1",
  PRIVATE_FEATURE_ACCEPTANCE_OTHER_USER_ID: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c2",
  PRIVATE_FEATURE_ACCEPTANCE_PREFERENCE_SET_ID: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c3",
  PRIVATE_FEATURE_ACCEPTANCE_AT: "2026-08-23T12:00:00.000Z",
};

describe("private-feature Profile acceptance", () => {
  it("parses an exact generated-synthetic prepare boundary", () => {
    expect(parsePrivateFeatureProfileAcceptanceEnvironment(environment)).toMatchObject({
      action: "prepare",
      runId: environment.PRIVATE_FEATURE_ACCEPTANCE_RUN_ID,
      ownerUserId: environment.PRIVATE_FEATURE_ACCEPTANCE_OWNER_USER_ID,
    });
    expect(
      privateFeatureAcceptanceSubject("owner", environment.PRIVATE_FEATURE_ACCEPTANCE_RUN_ID),
    ).toBe(`d1-private-feature-acceptance:owner:${environment.PRIVATE_FEATURE_ACCEPTANCE_RUN_ID}`);
  });

  it("requires cleanup to omit the timestamp", () => {
    expect(() =>
      parsePrivateFeatureProfileAcceptanceEnvironment({
        ...environment,
        PRIVATE_FEATURE_ACCEPTANCE_ACTION: "cleanup",
      }),
    ).toThrow("Only Profile prepare accepts");
    const { PRIVATE_FEATURE_ACCEPTANCE_AT: _omitted, ...withoutTimestamp } = environment;
    const cleanup = { ...withoutTimestamp, PRIVATE_FEATURE_ACCEPTANCE_ACTION: "cleanup" };
    expect(parsePrivateFeatureProfileAcceptanceEnvironment(cleanup).action).toBe("cleanup");
  });

  it("rejects reused identities and stale clocks", () => {
    expect(() =>
      parsePrivateFeatureProfileAcceptanceEnvironment({
        ...environment,
        PRIVATE_FEATURE_ACCEPTANCE_OTHER_USER_ID:
          environment.PRIVATE_FEATURE_ACCEPTANCE_OWNER_USER_ID,
      }),
    ).toThrow("identity boundary");
    const at = new Date(environment.PRIVATE_FEATURE_ACCEPTANCE_AT);
    expect(() =>
      assertRecentPrivateFeatureAcceptanceTime(at, new Date(at.getTime() + 15 * 60_000)),
    ).not.toThrow();
    expect(() =>
      assertRecentPrivateFeatureAcceptanceTime(at, new Date(at.getTime() + 15 * 60_000 + 1)),
    ).toThrow();
  });
});
