import { describe, expect, it } from "vitest";
import { compileComponentValidator } from "./index.js";

describe("PutJobPreferencesRequest", () => {
  const validate = compileComponentValidator("PutJobPreferencesRequest");

  it("accepts a minimal valid preference set", () => {
    expect(
      validate({
        targetRoles: ["Software Engineer"],
        locations: [],
        workModes: ["remote"],
        employmentTypes: ["full_time"],
      }),
    ).toBe(true);
  });

  it("rejects unknown fields and incomplete salary values", () => {
    expect(
      validate({
        targetRoles: ["Software Engineer"],
        locations: [],
        workModes: ["remote"],
        employmentTypes: ["full_time"],
        salaryMinimum: 100_000,
        interviewStatus: "scheduled",
      }),
    ).toBe(false);
  });
});

describe("CanonicalJobDetail", () => {
  const validate = compileComponentValidator("CanonicalJobDetail");
  const activeJob = {
    id: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c1",
    company: {
      id: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c2",
      name: "Synthetic Company",
      verifiedDomain: "example.test",
    },
    title: "Software Engineer",
    locations: ["Remote - US"],
    department: "Engineering",
    description: "A synthetic job used for contract verification.",
    status: "active",
    firstObservedAt: "2026-08-11T12:00:00.000Z",
    lastVerifiedAt: "2026-08-11T12:00:00.000Z",
    expiresAt: "2026-09-10T12:00:00.000Z",
    sources: [
      {
        provider: "greenhouse",
        provenance: "authorized_fixture",
        canonicalUrl: "https://jobs.example.test/synthetic/1",
        firstObservedAt: "2026-08-11T12:00:00.000Z",
        lastVerifiedAt: "2026-08-11T12:00:00.000Z",
      },
    ],
  };

  it("accepts an active redacted canonical job detail", () => {
    expect(validate(activeJob)).toBe(true);
  });

  it("rejects terminal states and internal source metadata", () => {
    expect(validate({ ...activeJob, status: "blocked" })).toBe(false);
    expect(
      validate({
        ...activeJob,
        sources: [{ ...activeJob.sources[0], rawSnapshot: { private: true } }],
      }),
    ).toBe(false);
  });
});
