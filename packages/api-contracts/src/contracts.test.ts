import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { compileComponentValidator, contract } from "./index.js";

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

describe("job search contracts", () => {
  const validateRequest = compileComponentValidator("JobSearchRequest");
  const validatePage = compileComponentValidator("JobSearchPage");
  const summary = {
    id: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c1",
    company: {
      id: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c2",
      name: "Synthetic Company",
      verifiedDomain: "example.test",
    },
    title: "Software Engineer",
    locations: ["Remote - US"],
    department: "Engineering",
    status: "active",
    firstObservedAt: "2026-08-11T12:00:00.000Z",
    lastVerifiedAt: "2026-08-11T12:00:00.000Z",
    expiresAt: "2026-09-10T12:00:00.000Z",
  };

  it("accepts a bounded filter request and active redacted page", () => {
    expect(
      validateRequest({
        query: "distributed systems",
        filters: {
          title: "Software Engineer",
          company: "Synthetic Company",
          location: "Remote - US",
          verifiedWithinDays: 30,
        },
        sort: "relevance",
        pageSize: 25,
      }),
    ).toBe(true);
    expect(validatePage({ items: [summary], nextCursor: "opaque_cursor_v1.signature_v1" })).toBe(
      true,
    );
  });

  it("rejects unbounded, unsupported, terminal, and internal search data", () => {
    expect(validateRequest({ query: " ", pageSize: 26 })).toBe(false);
    expect(validateRequest({ sort: "match" })).toBe(false);
    expect(validateRequest({ filters: { workMode: "remote" } })).toBe(false);
    expect(validateRequest({ query: "engineer", rawQuery: true })).toBe(false);
    expect(validateRequest({ cursor: "unsigned-cursor" })).toBe(false);
    expect(validatePage({ items: [{ ...summary, status: "blocked" }] })).toBe(false);
    expect(validatePage({ items: [{ ...summary, description: "not returned by search" }] })).toBe(
      false,
    );
  });
});

describe("saved-job contracts", () => {
  const validateCreate = compileComponentValidator("CreateSavedJobRequest");
  const validateSearch = compileComponentValidator("SavedJobSearchRequest");
  const validatePage = compileComponentValidator("SavedJobPage");
  const savedJob = {
    id: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c3",
    requestedJobId: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c1",
    snapshot: {
      jobIdAtSave: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c1",
      company: {
        id: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c2",
        name: "Synthetic Company",
      },
      title: "Software Engineer",
      locations: ["Remote - US"],
      firstObservedAt: "2026-08-11T12:00:00.000Z",
      lastVerifiedAt: "2026-08-11T12:00:00.000Z",
      expiresAt: "2026-09-10T12:00:00.000Z",
    },
    availability: {
      state: "available",
      currentJob: {
        id: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c1",
        company: {
          id: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c2",
          name: "Synthetic Company",
        },
        title: "Software Engineer",
        locations: ["Remote - US"],
        status: "active",
        firstObservedAt: "2026-08-11T12:00:00.000Z",
        lastVerifiedAt: "2026-08-11T12:00:00.000Z",
        expiresAt: "2026-09-10T12:00:00.000Z",
      },
    },
    savedAt: "2026-08-15T12:00:00.000Z",
  };

  it("accepts bounded owner-private commands and pages", () => {
    expect(validateCreate({ jobId: savedJob.requestedJobId })).toBe(true);
    expect(validateSearch({ pageSize: 25 })).toBe(true);
    expect(validatePage({ items: [savedJob], nextCursor: "opaque_cursor.signature" })).toBe(true);
  });

  it("separates read and mutation permissions", () => {
    expect(contract.paths["/jobs/search"].post.security).toEqual([{ oidc: ["jobs:read"] }]);
    expect(contract.paths["/saved-jobs/search"].post.security).toEqual([{ oidc: ["jobs:read"] }]);
    expect(contract.paths["/saved-jobs"].post.security).toEqual([{ oidc: ["jobs:write"] }]);
    expect(contract.paths["/saved-jobs/{savedJobId}"].delete.security).toEqual([
      { oidc: ["jobs:write"] },
    ]);
    expect(
      contract.paths["/saved-jobs"].post.responses["201"].headers["Cache-Control"].schema.enum,
    ).toEqual(["no-store"]);
    expect(
      contract.paths["/saved-jobs/{savedJobId}"].delete.responses["204"].headers["Cache-Control"]
        .schema.enum,
    ).toEqual(["no-store"]);
  });

  it("rejects owner injection, terminal snapshots, and post-submission outcomes", () => {
    expect(validateCreate({ jobId: savedJob.requestedJobId, ownerUserId: savedJob.id })).toBe(
      false,
    );
    expect(validateSearch({ pageSize: 26 })).toBe(false);
    expect(
      validatePage({
        items: [
          {
            ...savedJob,
            availability: {
              state: "available",
              currentJob: { ...savedJob.availability.currentJob, status: "expired" },
            },
          },
        ],
      }),
    ).toBe(false);
    expect(validatePage({ items: [{ ...savedJob, recruiterResponse: "interview" }] })).toBe(false);
  });
});

describe("entitlement read contract", () => {
  const validate = compileComponentValidator("EntitlementSummary");
  const common = {
    grants: ["profile.manage", "jobs.search", "jobs.save", "applications.history"],
    version: 7,
    evaluatedAt: "2026-08-16T12:00:00.000Z",
  };

  it("accepts only the three derived Free, active Pro, and grace Pro projections", () => {
    expect(validate({ ...common, plan: "free", accessState: "active" })).toBe(true);
    expect(
      validate({
        ...common,
        plan: "pro",
        accessState: "active",
        accessThrough: "2026-09-16T12:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      validate({
        ...common,
        plan: "pro",
        accessState: "grace",
        accessThrough: "2026-08-15T12:00:00.000Z",
        graceThrough: "2026-08-20T12:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("rejects owner, provider, price, invalid-state, and malformed schedule projections", () => {
    for (const candidate of [
      { ...common, plan: "free", accessState: "grace", graceThrough: common.evaluatedAt },
      { ...common, plan: "free", accessState: "active", accessThrough: common.evaluatedAt },
      { ...common, plan: "pro", accessState: "active" },
      { ...common, plan: "pro", accessState: "grace", accessThrough: common.evaluatedAt },
      { ...common, plan: "free", accessState: "active", userId: randomUUID() },
      { ...common, plan: "free", accessState: "active", provider: "synthetic" },
      { ...common, plan: "free", accessState: "active", price: 0 },
      {
        ...common,
        plan: "free",
        accessState: "active",
        grants: ["profile.manage", "jobs.search", "jobs.save"],
      },
      {
        ...common,
        plan: "free",
        accessState: "active",
        grants: ["jobs.search", "profile.manage", "jobs.save", "applications.history"],
      },
    ]) {
      expect(validate(candidate)).toBe(false);
    }
  });

  it("keeps self-entitlement reads private, exact, and non-cacheable", () => {
    const operation = contract.paths["/entitlements"].get;
    expect(operation.security).toEqual([{ oidc: ["profile:read"] }]);
    expect(operation).not.toHaveProperty("parameters");
    expect(operation).not.toHaveProperty("requestBody");
    expect(operation.responses["200"].headers["Cache-Control"].schema.enum).toEqual(["no-store"]);
    expect(Object.keys(operation.responses).sort()).toEqual(["200", "400", "401", "403", "503"]);
  });
});

describe("profile fact commands", () => {
  const validateCreate = compileComponentValidator("CreateProfileFactRequest");
  const validateUpdate = compileComponentValidator("UpdateProfileFactRequest");
  const validateFact = compileComponentValidator("ProfileFact");

  it("accepts a truthful direct-entry fact and an optimistic correction", () => {
    expect(
      validateCreate({
        kind: "skill",
        key: "programming_language",
        value: "TypeScript",
        sensitivity: "standard",
      }),
    ).toBe(true);
    expect(validateUpdate({ expectedVersion: 1, value: "TypeScript and JavaScript" })).toBe(true);
  });

  it("rejects empty facts, unrecognized fields, and no-op corrections", () => {
    expect(
      validateCreate({
        kind: "skill",
        key: "programming_language",
        value: "   ",
        sensitivity: "standard",
      }),
    ).toBe(false);
    expect(validateUpdate({ expectedVersion: 1 })).toBe(false);
    expect(validateUpdate({ expectedVersion: 1, interviewOutcome: "offer" })).toBe(false);
  });

  it("allows bounded resume evidence locators without candidate text or object keys", () => {
    const fact = {
      id: "019b4e12-7ea3-7c36-9357-aea35ab542cc",
      kind: "skill",
      key: "skill",
      value: "TypeScript",
      verification: "proposed",
      sensitivity: "standard",
      source: { type: "resume", reference: "resume:opaque" },
      evidence: {
        supportingSpans: [
          {
            documentId: "019b4e12-7ea3-7c36-9357-aea35ab542ca",
            documentVersion: 1,
            parserVersion: "resume-parser-v1",
            blockIndex: 2,
            startOffset: 0,
            endOffset: 10,
            page: 1,
          },
        ],
      },
      version: 1,
      createdAt: "2026-08-12T12:00:00.000Z",
      updatedAt: "2026-08-12T12:00:00.000Z",
    };
    expect(validateFact(fact)).toBe(true);
    expect(
      validateFact({
        ...fact,
        availability: { state: "invalidated", reasonCode: "source_security_hold" },
      }),
    ).toBe(true);
    expect(validateFact({ ...fact, availability: { state: "invalidated" } })).toBe(false);
    expect(
      validateFact({
        ...fact,
        availability: { state: "available", reasonCode: "source_security_hold" },
      }),
    ).toBe(false);
    expect(validateFact({ ...fact, verification: "invalidated" })).toBe(false);
    const { evidence: _evidence, ...withoutEvidence } = fact;
    expect(validateFact(withoutEvidence)).toBe(false);
    expect(
      validateFact({
        ...fact,
        evidence: {
          supportingSpans: [{ ...fact.evidence.supportingSpans[0], excerpt: "TypeScript" }],
        },
      }),
    ).toBe(false);
  });
});

describe("resume upload commands", () => {
  const validate = compileComponentValidator("CreateResumeUploadRequest");

  it("accepts one bounded PDF or DOCX upload declaration", () => {
    expect(
      validate({
        fileName: "synthetic-resume.pdf",
        mediaType: "application/pdf",
        sizeBytes: 4096,
        sha256: "a".repeat(64),
      }),
    ).toBe(true);
    expect(
      validate({
        fileName: "synthetic-resume.docx",
        mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 5242880,
        sha256: "b".repeat(64),
      }),
    ).toBe(true);
  });

  it("rejects traversal names, unsupported media, oversize objects, and unknown fields", () => {
    expect(
      validate({
        fileName: "../resume.pdf",
        mediaType: "application/pdf",
        sizeBytes: 4096,
        sha256: "a".repeat(64),
      }),
    ).toBe(false);
    expect(
      validate({
        fileName: "resume.txt",
        mediaType: "text/plain",
        sizeBytes: 4096,
        sha256: "a".repeat(64),
      }),
    ).toBe(false);
    expect(
      validate({
        fileName: "resume.pdf",
        mediaType: "application/pdf",
        sizeBytes: 5242881,
        sha256: "a".repeat(64),
        extractedText: "must not cross this contract",
      }),
    ).toBe(false);
  });
});
