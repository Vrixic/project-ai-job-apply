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
