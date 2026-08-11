import { describe, expect, it } from "vitest";
import {
  canonicalizeJobUrl,
  canonicalizeObservation,
  classifyDuplicate,
  evaluateLifecycle,
  exactIdentityKeys,
  toMinimalTombstone,
  type JobObservation,
} from "./canonical-job.js";

const observedAt = new Date("2026-08-11T12:00:00.000Z");

function observation(overrides: Partial<JobObservation> = {}): JobObservation {
  return {
    provider: "greenhouse",
    provenance: "authorized_fixture",
    companyName: "Example Corp",
    title: "Staff Software Engineer",
    locations: ["New York, NY", "Remote - US"],
    description: "Build reliable systems for candidates.",
    sourceUrl: "http://jobs.example.test/opening/42/?utm_source=test&b=2&a=1#apply",
    observedAt,
    atsTenant: "example",
    externalJobId: "42",
    employerRequisitionId: "REQ-42",
    verifiedCompanyDomain: "Example.Test",
    department: "Engineering",
    ...overrides,
  };
}

describe("canonical job domain", () => {
  it("canonicalizes URLs without marketing identity noise", () => {
    expect(canonicalizeJobUrl(observation().sourceUrl)).toBe(
      "https://jobs.example.test/opening/42?a=1&b=2",
    );
  });

  it("removes credential-like query values and rejects URL userinfo", () => {
    expect(
      canonicalizeJobUrl(
        "https://jobs.example.test/opening/42?token=do-not-store&department=engineering",
      ),
    ).toBe("https://jobs.example.test/opening/42?department=engineering");
    expect(() => canonicalizeJobUrl("https://user:password@jobs.example.test/opening/42")).toThrow(
      "must not contain credentials",
    );
  });

  it("uses ATS, requisition, and canonical URL identity in precedence order", () => {
    const keys = exactIdentityKeys(canonicalizeObservation(observation()));
    expect(keys[0]).toBe("ats:greenhouse:example:42");
    expect(keys[1]).toBe("requisition:example.test:req-42");
    expect(keys[2]).toMatch(/^url:[a-f0-9]{64}$/);
  });

  it("never treats title and company alone as an exact duplicate", () => {
    const left = canonicalizeObservation(observation());
    const right = canonicalizeObservation(
      observation({
        sourceUrl: "https://jobs.example.test/opening/84",
        externalJobId: "84",
        employerRequisitionId: "REQ-84",
        locations: ["Chicago, IL"],
        description: "A materially different role with the same display title.",
      }),
    );
    expect(classifyDuplicate(left, right)).toBe("not_duplicate");
  });

  it("flags matching fuzzy fingerprints for review without declaring an exact merge", () => {
    const left = canonicalizeObservation(observation());
    const mirrored = observation({ sourceUrl: "https://mirror.example.test/jobs/42" });
    delete mirrored.atsTenant;
    delete mirrored.externalJobId;
    delete mirrored.employerRequisitionId;
    const right = canonicalizeObservation(mirrored);
    expect(classifyDuplicate(left, right)).toBe("probable");
  });

  it("classifies a same-location replacement as a related repost, never an automatic merge", () => {
    const left = canonicalizeObservation(observation());
    const right = canonicalizeObservation(
      observation({
        sourceUrl: "https://jobs.example.test/opening/84",
        externalJobId: "84",
        employerRequisitionId: "REQ-84",
        description: "A replacement posting with materially changed responsibilities.",
      }),
    );
    expect(classifyDuplicate(left, right)).toBe("related_repost");
  });

  it("honors a later source validity date over the default freshness window", () => {
    const validThrough = new Date("2026-10-20T12:00:00.000Z");
    const canonical = canonicalizeObservation(observation({ validThrough }));
    expect(canonical.expiresAt).toEqual(validThrough);
  });

  it("supports suspect recovery and deterministic terminal controls", () => {
    const expiresAt = new Date("2026-09-10T12:00:00.000Z");
    expect(
      evaluateLifecycle({
        currentStatus: "active",
        now: observedAt,
        expiresAt,
        consecutiveVerificationFailures: 3,
      }),
    ).toBe("suspect_stale");
    expect(
      evaluateLifecycle({
        currentStatus: "suspect_stale",
        now: observedAt,
        expiresAt,
        positiveVerification: true,
      }),
    ).toBe("active");
    expect(
      evaluateLifecycle({
        currentStatus: "blocked",
        now: observedAt,
        expiresAt,
        positiveVerification: true,
      }),
    ).toBe("blocked");
  });

  it("retains only minimal, stable tombstone fields", () => {
    const tombstone = toMinimalTombstone({
      id: "job-1",
      companyId: "company-1",
      title: "Staff Software Engineer",
      locations: ["Remote - US"],
      status: "expired",
      firstObservedAt: observedAt,
      lastVerifiedAt: observedAt,
      expiresAt: observedAt,
      sourceReferences: ["source-2", "source-1", "source-1"],
      reason: "freshness_window_elapsed",
    });
    expect(tombstone.sourceReferences).toEqual(["source-1", "source-2"]);
    expect(tombstone).not.toHaveProperty("description");
    expect(tombstone).not.toHaveProperty("rawSnapshot");
  });
});
