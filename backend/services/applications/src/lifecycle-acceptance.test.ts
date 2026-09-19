import { describe, expect, it } from "vitest";
import {
  APPLICATIONS_ACCEPTANCE_CONFIRMATION,
  applicationsAcceptanceSubject,
  assertRecentApplicationsAcceptanceTime,
  parseApplicationsAcceptanceEnvironment,
} from "./lifecycle-acceptance.js";

const RUN = "0f6f2d5e-6a54-4d27-9c3a-4b0f2b8e8c11";
const OWNER = "019d04cf-1f80-7000-8000-000000000001";
const OTHER = "019d04cf-1f80-7000-8000-000000000002";
const ISSUER = "https://example-tenant.us.auth0.com/";

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    APPLICATIONS_ACCEPTANCE_CONFIRMATION: APPLICATIONS_ACCEPTANCE_CONFIRMATION,
    APPLICATIONS_ACCEPTANCE_ACTION: "prepare",
    APPLICATIONS_ACCEPTANCE_RUN_ID: RUN,
    APPLICATIONS_ACCEPTANCE_ISSUER: ISSUER,
    APPLICATIONS_ACCEPTANCE_OWNER_USER_ID: OWNER,
    APPLICATIONS_ACCEPTANCE_OTHER_USER_ID: OTHER,
    APPLICATIONS_ACCEPTANCE_AT: "2026-09-18T12:00:00.000Z",
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe("Applications lifecycle acceptance boundary", () => {
  it("accepts exactly one prepare or cleanup request", () => {
    expect(parseApplicationsAcceptanceEnvironment(environment())).toMatchObject({
      action: "prepare",
      runId: RUN,
      ownerUserId: OWNER,
      otherUserId: OTHER,
    });
    const cleanup = parseApplicationsAcceptanceEnvironment(
      environment({ APPLICATIONS_ACCEPTANCE_ACTION: "cleanup", APPLICATIONS_ACCEPTANCE_AT: "" }),
    );
    expect(cleanup.action).toBe("cleanup");
    expect(cleanup.at).toBeUndefined();
  });

  it.each([
    ["missing confirmation", { APPLICATIONS_ACCEPTANCE_CONFIRMATION: undefined }],
    ["wrong confirmation", { APPLICATIONS_ACCEPTANCE_CONFIRMATION: "yes" }],
    ["unknown action", { APPLICATIONS_ACCEPTANCE_ACTION: "mutate" }],
    ["non-v4 run id", { APPLICATIONS_ACCEPTANCE_RUN_ID: OWNER }],
    ["issuer with path", { APPLICATIONS_ACCEPTANCE_ISSUER: "https://example.test/tenant/" }],
    ["http issuer", { APPLICATIONS_ACCEPTANCE_ISSUER: "http://example.test/" }],
    ["issuer with credentials", { APPLICATIONS_ACCEPTANCE_ISSUER: "https://u:p@example.test/" }],
    ["non-v7 owner", { APPLICATIONS_ACCEPTANCE_OWNER_USER_ID: RUN }],
    ["same owner and other", { APPLICATIONS_ACCEPTANCE_OTHER_USER_ID: OWNER }],
    ["prepare without a timestamp", { APPLICATIONS_ACCEPTANCE_AT: undefined }],
    ["non-canonical timestamp", { APPLICATIONS_ACCEPTANCE_AT: "2026-09-18T12:00:00Z" }],
    [
      "cleanup with a timestamp",
      {
        APPLICATIONS_ACCEPTANCE_ACTION: "cleanup",
        APPLICATIONS_ACCEPTANCE_AT: "2026-09-18T12:00:00.000Z",
      },
    ],
  ])("refuses %s", (_label, overrides) => {
    expect(() => parseApplicationsAcceptanceEnvironment(environment(overrides))).toThrow();
  });

  it("derives fixed subjects and bounds the clock window", () => {
    expect(applicationsAcceptanceSubject("owner", RUN)).toBe(
      `d3-applications-acceptance:owner:${RUN}`,
    );
    expect(applicationsAcceptanceSubject("other", RUN)).toBe(
      `d3-applications-acceptance:other:${RUN}`,
    );
    expect(() => applicationsAcceptanceSubject("owner", "not-a-run")).toThrow();
    const now = new Date("2026-09-18T12:00:00.000Z");
    expect(() =>
      assertRecentApplicationsAcceptanceTime(new Date(now.getTime() + 60_000), now),
    ).not.toThrow();
    expect(() =>
      assertRecentApplicationsAcceptanceTime(new Date(now.getTime() - 16 * 60_000), now),
    ).toThrow();
  });
});
