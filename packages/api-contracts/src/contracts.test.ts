import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { compileComponentValidator, contract } from "./index.js";

describe("RestrictedAnswer creation metadata compatibility", () => {
  const validate = compileComponentValidator("RestrictedAnswer");
  const metadata = {
    id: "019d04cf-1f80-7000-8000-000000000071",
    fieldKey: "authorization.us_authorized",
    valueType: "boolean",
    sensitivity: "restricted",
    state: "active",
    version: 1,
    confirmedAt: "2026-01-01T12:00:00.000Z",
  };

  it("accepts unchanged save metadata and precise creation metadata in owner lists", () => {
    expect(validate(metadata)).toBe(true);
    expect(validate({ ...metadata, createdAt: "2026-09-30T12:00:00.123456+00:00" })).toBe(true);
  });

  it.each([null, 123, "not-a-time", "2026-02-30T12:00:00Z"])(
    "rejects invalid creation metadata %s",
    (createdAt) => {
      expect(validate({ ...metadata, createdAt })).toBe(false);
    },
  );

  it("continues rejecting values and ciphertext in metadata responses", () => {
    expect(validate({ ...metadata, createdAt: metadata.confirmedAt, value: "true" })).toBe(false);
    expect(validate({ ...metadata, createdAt: metadata.confirmedAt, ciphertext: "private" })).toBe(
      false,
    );
  });
});

describe("PutJobPreferencesRequest", () => {
  const validate = compileComponentValidator("PutJobPreferencesRequest");
  const minimalPreferences = {
    targetRoles: ["Software Engineer"],
    locations: [],
    workModes: ["remote"],
    employmentTypes: ["full_time"],
  };

  it("accepts a minimal valid preference set", () => {
    expect(validate(minimalPreferences)).toBe(true);
  });

  it("rejects response metadata and unknown post-submission fields", () => {
    expect(
      validate({
        ...minimalPreferences,
        id: "019c0000-0000-7000-8000-000000000001",
      }),
    ).toBe(false);
    expect(
      validate({
        ...minimalPreferences,
        interviewStatus: "scheduled",
      }),
    ).toBe(false);
  });

  it("requires salary amount and currency together", () => {
    expect(validate({ ...minimalPreferences, salaryMinimum: 100_000 })).toBe(false);
    expect(validate({ ...minimalPreferences, salaryCurrency: "USD" })).toBe(false);
    expect(validate({ ...minimalPreferences, salaryMinimum: 100_000, salaryCurrency: "USD" })).toBe(
      true,
    );
  });
});

describe("Job contribution intake contract", () => {
  const validate = compileComponentValidator("CreateJobContributionRequest");
  const input = {
    schemaVersion: 1,
    contributionId: "019c0000-0000-7000-8000-000000000010",
    client: { surface: "browser_extension", version: "0.1.0" },
    source: {
      provider: "greenhouse",
      pageVariant: "greenhouse-board-v1",
      sourceUrl: "https://job-boards.greenhouse.io/synthetic/jobs/123",
      externalJobId: "123",
      adapterVersion: "d2-job-page-v1",
    },
    posting: {
      companyName: "Synthetic Company",
      title: "Software Engineer",
      locations: ["Remote - US"],
      description: "Generated public job text for contract verification.",
    },
    observation: {
      observedAt: "2026-09-01T12:00:00.000Z",
      contentSha256: "a".repeat(64),
    },
    approval: {
      consentId: "019c0000-0000-7000-8000-000000000011",
      consentVersion: "ugc-contribution-preview.v1",
      policyVersion: "ugc-policy-v1",
      approvedAt: "2026-09-01T12:01:00.000Z",
      approvedFields: [
        "provider",
        "pageVariant",
        "sourceUrl",
        "externalJobId",
        "companyName",
        "title",
        "locations",
        "description",
      ],
      previewDigestSha256: "c".repeat(64),
    },
  };

  it("requires the dedicated scope and idempotency for queued intake and owner status", () => {
    expect(contract.paths["/jobs/contributions"].post.security).toEqual([
      { oidc: ["jobs:contribute"] },
    ]);
    expect(contract.paths["/jobs/contributions"].post.parameters[0]).toMatchObject({
      name: "Idempotency-Key",
      required: true,
    });
    expect(contract.paths["/jobs/contributions/{contributionId}"].get.security).toEqual([
      { oidc: ["jobs:contribute"] },
    ]);
  });

  it("accepts only strict public posting data with explicit preview evidence", () => {
    expect(validate(input)).toBe(true);
    expect(validate({ ...input, rawHtml: "<form>private</form>" })).toBe(false);
    expect(validate({ ...input, client: { surface: "web", version: "0.1.0" } })).toBe(false);
    expect(
      validate({ ...input, client: { surface: "browser_extension", version: "latest" } }),
    ).toBe(false);
    expect(
      validate({
        ...input,
        source: { ...input.source, sourceUrl: "http://boards.example.test/jobs/123" },
      }),
    ).toBe(false);
  });

  it("accepts Lever EU postings and rejects provider-to-page boundary mismatches", () => {
    expect(
      validate({
        ...input,
        source: {
          provider: "lever",
          pageVariant: "lever-posting-v1",
          sourceUrl: "https://jobs.eu.lever.co/synthetic/synthetic-123",
          adapterVersion: "d2-job-page-v1",
        },
        approval: {
          ...input.approval,
          approvedFields: input.approval.approvedFields.filter(
            (field) => field !== "externalJobId",
          ),
        },
      }),
    ).toBe(true);
    expect(
      validate({
        ...input,
        source: {
          ...input.source,
          sourceUrl: "https://jobs.lever.co/synthetic/synthetic-123",
        },
      }),
    ).toBe(false);
  });
});

describe("Job contribution owner history contract", () => {
  const validate = compileComponentValidator("JobContributionHistory");
  const contribution = {
    id: "019c0000-0000-7000-8000-000000000010",
    state: "awaiting_trust",
    submittedAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:01:00.000Z",
  };

  it("declares an owner-authenticated, bodyless no-store read with no caller filters", () => {
    const route = contract.paths["/jobs/contributions"].get;
    expect(route.security).toEqual([{ oidc: ["jobs:contribute"] }]);
    expect(route).not.toHaveProperty("parameters");
    expect(route).not.toHaveProperty("requestBody");
    expect(route.responses["200"].headers["Cache-Control"].schema.enum).toEqual(["no-store"]);
    expect(route.responses).toHaveProperty("503");
  });

  it("accepts genuine empty history and at most 25 minimal status records", () => {
    expect(validate({ items: [] })).toBe(true);
    expect(validate({ items: [contribution] })).toBe(true);
    expect(validate({ items: Array.from({ length: 25 }, () => contribution) })).toBe(true);
    expect(validate({ items: Array.from({ length: 26 }, () => contribution) })).toBe(false);
  });

  it("rejects malformed responses and confidential fields at either level", () => {
    for (const value of [
      null,
      {},
      [],
      { items: null },
      { items: [], ownerUserId: contribution.id },
    ]) {
      expect(validate(value)).toBe(false);
    }
    for (const extra of [
      { ownerUserId: contribution.id },
      { requestHash: "a".repeat(64) },
      { payload: { title: "private association" } },
      { reviewerId: contribution.id },
      { state: "accepted" },
      { submittedAt: "invalid" },
    ]) {
      expect(validate({ items: [{ ...contribution, ...extra }] })).toBe(false);
    }
  });
});

describe("UGC contribution consent contract", () => {
  const validateGrant = compileComponentValidator("GrantUgcContributionConsentRequest");
  const validateResponse = compileComponentValidator("UgcContributionConsentGrant");

  it("requires jobs:contribute, stable idempotency, and no-store", () => {
    const grant = contract.paths["/profile/ugc-contribution-consents"].post;
    const revoke = contract.paths["/profile/ugc-contribution-consents/{consentId}/revoke"].post;
    expect(grant.security).toEqual([{ oidc: ["jobs:contribute"] }]);
    expect(revoke.security).toEqual([{ oidc: ["jobs:contribute"] }]);
    expect(grant.parameters[0]).toMatchObject({ name: "Idempotency-Key", required: true });
    expect(revoke.parameters[1]).toMatchObject({ name: "Idempotency-Key", required: true });
    expect(grant.responses["201"].headers["Cache-Control"].schema.enum).toEqual(["no-store"]);
    expect(revoke.responses["204"].headers["Cache-Control"].schema.enum).toEqual(["no-store"]);
  });

  it("does not accept client-issued consent identity or time and keeps policy externally selected", () => {
    const request = {
      schemaVersion: 1,
      documentVersion: "ugc-contribution-preview.v1",
      policyVersion: "d2-synthetic-policy.v1",
      previewDigestSha256: "a".repeat(64),
    };
    expect(validateGrant(request)).toBe(true);
    expect(validateGrant({ ...request, id: "019c0000-0000-7000-8000-000000000011" })).toBe(false);
    expect(validateGrant({ ...request, grantedAt: "2026-09-01T12:00:00.000Z" })).toBe(false);
    expect(validateGrant({ ...request, policyVersion: "NOT APPROVED" })).toBe(false);
    expect(
      validateResponse({
        schemaVersion: 1,
        id: "019c0000-0000-7000-8000-000000000011",
        state: "granted",
        documentVersion: "ugc-contribution-preview.v1",
        policyVersion: "d2-synthetic-policy.v1",
        grantedAt: "2026-09-01T12:00:00.000Z",
      }),
    ).toBe(true);
  });
});

describe("job preference response contracts", () => {
  const validateSet = compileComponentValidator("JobPreferenceSet");
  const validateResponse = compileComponentValidator("PutJobPreferencesResponse");
  const preferences = {
    id: "019c0000-0000-7000-8000-000000000001",
    version: 1,
    updatedAt: "2026-08-17T12:00:00.000Z",
    targetRoles: ["Software Engineer"],
    locations: [],
    workModes: ["remote"],
    employmentTypes: ["full_time"],
    salaryMinimum: 100_000,
    salaryCurrency: "USD",
  };

  it("accepts the metadata-bearing set produced by the profile service", () => {
    expect(validateSet(preferences)).toBe(true);
    expect(
      validateResponse({
        preferences,
        operationId: "019c0000-0000-7000-8000-000000000002",
      }),
    ).toBe(true);
  });

  it("requires valid response metadata without weakening field strictness", () => {
    const { id: _id, ...withoutId } = preferences;
    const { salaryCurrency: _salaryCurrency, ...withoutSalaryCurrency } = preferences;
    expect(validateSet(withoutId)).toBe(false);
    expect(validateSet({ ...preferences, id: "not-a-uuid" })).toBe(false);
    expect(validateSet({ ...preferences, version: 0 })).toBe(false);
    expect(validateSet({ ...preferences, updatedAt: "not-a-date" })).toBe(false);
    expect(validateSet({ ...preferences, privateNote: "do not expose" })).toBe(false);
    expect(validateSet(withoutSalaryCurrency)).toBe(false);
    expect(
      validateResponse({
        preferences: { ...preferences, privateNote: "do not expose" },
        operationId: "019c0000-0000-7000-8000-000000000002",
      }),
    ).toBe(false);
    expect(
      validateResponse({
        preferences,
        operationId: "not-a-uuid",
      }),
    ).toBe(false);
    expect(
      validateResponse({
        preferences,
        operationId: "019c0000-0000-7000-8000-000000000002",
        internalTrace: "do not expose",
      }),
    ).toBe(false);
  });
});

describe("candidate rights contracts", () => {
  const exportId = "019d04cf-1f80-7000-8000-000000000030";
  const deletionId = "019d04cf-1f80-7000-8000-000000000031";
  const requestedAt = "2026-08-25T14:00:00.000Z";
  const laterAt = "2026-08-25T14:01:00.000Z";
  const backupExpiresAt = "2026-09-29T14:01:00.000Z";
  const validateExportRequest = compileComponentValidator("CreateCandidateDataExportRequest");
  const validateExport = compileComponentValidator("CandidateDataExport");
  const validateExportAccess = compileComponentValidator("CandidateDataExportAccess");
  const validateDeletionRequest = compileComponentValidator("CreateAccountDeletionRequest");
  const validateDeletionConfirmation = compileComponentValidator("ConfirmAccountDeletionRequest");
  const validateDeletion = compileComponentValidator("AccountDeletionRequest");

  const queuedExport = {
    id: exportId,
    schemaVersion: 1,
    format: "candidate-data-export-v1",
    policyVersion: "d1-synthetic-v1",
    state: "queued",
    requestedAt,
    updatedAt: requestedAt,
  };

  it("accepts only the versioned portable export request and state-dependent access grant", () => {
    expect(validateExportRequest({ format: "candidate-data-export-v1" })).toBe(true);
    expect(validateExportRequest({ format: "csv" })).toBe(false);
    expect(validateExportRequest({ format: "candidate-data-export-v1", includeTokens: true })).toBe(
      false,
    );
    expect(validateExport(queuedExport)).toBe(true);
    expect(
      validateExport({
        ...queuedExport,
        state: "ready",
        updatedAt: laterAt,
        artifactExpiresAt: backupExpiresAt,
      }),
    ).toBe(true);
    expect(validateExport({ ...queuedExport, state: "ready" })).toBe(false);
    expect(validateExport({ ...queuedExport, failureCode: "owner_unavailable" })).toBe(false);
    expect(validateExportAccess({ export: queuedExport })).toBe(true);
    expect(
      validateExportAccess({
        export: { ...queuedExport, state: "ready", artifactExpiresAt: backupExpiresAt },
        download: {
          url: "https://objects.example.test/exact?signature=synthetic",
          method: "GET",
          expiresAt: laterAt,
        },
      }),
    ).toBe(true);
    expect(
      validateExportAccess({
        export: queuedExport,
        download: {
          url: "https://objects.example.test/exact?signature=synthetic",
          method: "GET",
          expiresAt: laterAt,
        },
      }),
    ).toBe(false);
  });

  it("enforces two-step irreversible deletion and exact state chronology fields", () => {
    expect(validateDeletionRequest({ acknowledgement: "ACCOUNT_DELETION_IS_IRREVERSIBLE" })).toBe(
      true,
    );
    expect(validateDeletionRequest({ acknowledgement: true })).toBe(false);
    expect(
      validateDeletionConfirmation({ expectedVersion: 1, confirmation: "DELETE_MY_ACCOUNT" }),
    ).toBe(true);
    expect(
      validateDeletionConfirmation({
        expectedVersion: 1,
        confirmation: "maybe",
        recoverable: true,
      }),
    ).toBe(false);

    const requested = {
      id: deletionId,
      schemaVersion: 1,
      policyVersion: "d1-synthetic-v1",
      state: "requested",
      version: 1,
      requestedAt,
      updatedAt: requestedAt,
    };
    expect(validateDeletion(requested)).toBe(true);
    expect(
      validateDeletion({
        ...requested,
        state: "quarantined",
        version: 2,
        updatedAt: laterAt,
        confirmedAt: laterAt,
        backupExpiresAt,
      }),
    ).toBe(true);
    expect(validateDeletion({ ...requested, state: "quarantined" })).toBe(false);
    expect(
      validateDeletion({
        ...requested,
        state: "completed",
        version: 5,
        updatedAt: laterAt,
        confirmedAt: laterAt,
        completedAt: laterAt,
        backupExpiresAt,
      }),
    ).toBe(true);
    expect(
      validateDeletion({
        ...requested,
        state: "backup_expired",
        version: 6,
        updatedAt: backupExpiresAt,
        confirmedAt: laterAt,
        completedAt: laterAt,
        backupExpiresAt,
        backupExpiredAt: backupExpiresAt,
      }),
    ).toBe(true);
  });

  it("keeps every rights route owner-scoped, non-cacheable, and mutation-idempotent", () => {
    for (const path of [
      "/me/data-exports",
      "/me/data-exports/{dataExportId}",
      "/me/account-deletion-requests",
      "/me/account-deletion-requests/{deletionRequestId}",
      "/me/account-deletion-requests/{deletionRequestId}/confirm",
    ] as const) {
      for (const operation of Object.values(contract.paths[path])) {
        expect(operation.security).toEqual([{ oidc: ["profile:write"] }]);
        const success =
          operation.responses["200"] ??
          operation.responses["201"] ??
          operation.responses["202"] ??
          operation.responses["204"];
        expect(success.headers["Cache-Control"].schema.enum).toEqual(["no-store"]);
      }
    }
    for (const operation of [
      contract.paths["/me/data-exports"].post,
      contract.paths["/me/account-deletion-requests"].post,
      contract.paths["/me/account-deletion-requests/{deletionRequestId}"].delete,
      contract.paths["/me/account-deletion-requests/{deletionRequestId}/confirm"].post,
    ]) {
      expect(operation.parameters.some((parameter) => parameter.name === "Idempotency-Key")).toBe(
        true,
      );
      const proof = operation.parameters.find(
        (parameter) => parameter.name === "X-AI-Job-Apply-Reauthentication",
      );
      expect(proof).toMatchObject({
        in: "header",
        required: true,
        schema: { type: "string", minLength: 32, maxLength: 16_384 },
      });
    }
    expect(
      contract.paths["/me/job-preferences"].put.parameters.some(
        (parameter) => parameter.name === "X-AI-Job-Apply-Reauthentication",
      ),
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

describe("PublicJobDetailResponse", () => {
  const validate = compileComponentValidator("PublicJobDetailResponse");
  const response = {
    requestedJobId: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c1",
    canonicalJobId: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c2",
    isAlias: true,
    job: {
      id: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c2",
      companyName: "Synthetic Company",
      title: "Software Engineer",
      locations: ["Remote - US"],
      department: "Engineering",
      description: "A synthetic job used for public contract verification.",
      firstObservedAt: "2026-08-11T12:00:00.000Z",
      lastVerifiedAt: "2026-08-16T11:00:00.000Z",
      expiresAt: "2026-09-10T12:00:00.000Z",
      validThrough: "2026-09-01T12:00:00.000Z",
    },
  };

  it("accepts only the anonymous public allowlist and reversible alias identity", () => {
    expect(validate(response)).toBe(true);
    expect(validate({ ...response, sources: [] })).toBe(false);
    expect(
      validate({ ...response, job: { ...response.job, canonicalUrl: "https://secret.test" } }),
    ).toBe(false);
  });

  it("rejects non-v7 and uppercase identifiers", () => {
    expect(validate({ ...response, requestedJobId: response.requestedJobId.toUpperCase() })).toBe(
      false,
    );
    expect(validate({ ...response, canonicalJobId: randomUUID() })).toBe(false);
  });

  it("rejects hidden controls while preserving plain-text description line breaks", () => {
    expect(validate({ ...response, job: { ...response.job, title: "Engineer\u0000Admin" } })).toBe(
      false,
    );
    expect(validate({ ...response, job: { ...response.job, title: "Engineer\u202eAdmin" } })).toBe(
      false,
    );
    expect(
      validate({ ...response, job: { ...response.job, title: "Engineer\u{e0001}Admin" } }),
    ).toBe(false);
    expect(
      validate({ ...response, job: { ...response.job, title: "Engineer\u{e0020}Admin" } }),
    ).toBe(false);
    expect(
      validate({ ...response, job: { ...response.job, description: "Line one\nLine two" } }),
    ).toBe(true);
    expect(
      validate({ ...response, job: { ...response.job, description: "Visible\u0001hidden" } }),
    ).toBe(false);
    expect(
      validate({ ...response, job: { ...response.job, description: "Visible\u{e007f}hidden" } }),
    ).toBe(false);
    expect(validate({ ...response, job: { ...response.job, description: " \n\t " } })).toBe(false);
    expect(
      validate({
        ...response,
        job: { ...response.job, lastVerifiedAt: "2026-08-16T07:00:00-04:00" },
      }),
    ).toBe(false);
  });

  it("freezes anonymous routing and Lambda-owned cache/retry headers", () => {
    const operation = contract.paths["/public/jobs/{jobId}"].get;
    expect(operation.security).toEqual([]);
    expect(operation.responses[200].headers?.["Cache-Control"].schema).toEqual({
      type: "string",
      enum: ["public, max-age=0, must-revalidate"],
    });
    expect(operation.responses[404].$ref).toBe("#/components/responses/PublicJobNotFound");
    expect(operation.responses[503].$ref).toBe("#/components/responses/PublicJobUnavailable");
    expect(operation.responses).not.toHaveProperty("429");
    expect(
      contract.components.responses.PublicJobBadRequest.headers["Cache-Control"].schema,
    ).toEqual({ type: "string", enum: ["no-store"] });
    expect(contract.components.responses.PublicJobNotFound.headers["Cache-Control"].schema).toEqual(
      { type: "string", enum: ["public, max-age=0, must-revalidate"] },
    );
    expect(contract.components.responses.PublicJobUnavailable.headers).toEqual({
      "Cache-Control": {
        required: true,
        schema: { type: "string", enum: ["no-store"] },
      },
      "Retry-After": {
        required: true,
        schema: { type: "integer", minimum: 1, maximum: 60 },
      },
    });
  });
});

describe("PublicJobSitemapFeedResponse", () => {
  const validate = compileComponentValidator("PublicJobSitemapFeedResponse");
  const item = {
    jobId: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c1",
    lastModifiedAt: "2026-08-16T11:00:00.000Z",
  };

  it("accepts only bounded canonical identifiers and public freshness", () => {
    expect(validate({ items: [item] })).toBe(true);
    expect(validate({ items: [item], sourceId: "ashby-linear-v1" })).toBe(false);
    expect(validate({ items: [{ ...item, jobId: randomUUID() }] })).toBe(false);
    expect(validate({ items: [{ ...item, lastModifiedAt: "2026-08-16T07:00:00-04:00" }] })).toBe(
      false,
    );
    expect(validate({ items: Array.from({ length: 101 }, () => item) })).toBe(false);
  });

  it("freezes the anonymous keyset transport and fail-closed errors", () => {
    const operation = contract.paths["/public/jobs/sitemap"].get;
    expect(operation.security).toEqual([]);
    expect(operation.parameters).toEqual([
      {
        in: "query",
        name: "cursor",
        required: false,
        schema: {
          type: "string",
          minLength: 16,
          maxLength: 512,
          pattern: "^[A-Za-z0-9_-]+$",
        },
      },
    ]);
    expect(operation.responses[400].$ref).toBe("#/components/responses/PublicJobBadRequest");
    expect(operation.responses[503].$ref).toBe("#/components/responses/PublicJobUnavailable");
    expect(operation.responses).not.toHaveProperty("404");
    expect(operation.responses).not.toHaveProperty("429");
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

  it("declares a non-cacheable service-unavailable response", () => {
    const responses = contract.paths["/jobs/search"].post.responses;
    expect(Object.keys(responses).sort()).toEqual([
      "200",
      "400",
      "401",
      "403",
      "409",
      "413",
      "415",
      "503",
    ]);
    expect(responses["503"].$ref).toBe("#/components/responses/ServiceUnavailable");
    expect(contract.components.responses.ServiceUnavailable.headers).toEqual({
      "Cache-Control": {
        required: true,
        schema: { type: "string", enum: ["no-store"] },
      },
    });
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

describe("job-report contracts", () => {
  const validateRequest = compileComponentValidator("CreateJobReportRequest");
  const validateReport = compileComponentValidator("JobReport");
  const jobId = "019d04cf-1f80-7000-8000-000000000012";
  const reportId = "019d04cf-1f80-7000-8000-000000000013";

  it("accepts only fixed enum reports without candidate text or owner injection", () => {
    for (const reason of [
      "job_closed",
      "job_not_found",
      "job_inaccurate",
      "suspected_scam",
      "duplicate_listing",
      "other_catalog_issue",
    ]) {
      expect(validateRequest({ reason })).toBe(true);
      expect(
        validateReport({
          id: reportId,
          requestedJobId: jobId,
          canonicalJobId: jobId,
          reason,
          createdAt: "2026-08-16T18:00:00.000Z",
        }),
      ).toBe(true);
    }
    expect(validateRequest({ reason: "other", detail: "candidate-supplied text" })).toBe(false);
    expect(validateRequest({ reason: "job_closed", ownerUserId: jobId })).toBe(false);
    expect(
      validateReport({
        id: reportId,
        requestedJobId: jobId,
        canonicalJobId: jobId,
        reason: "job_closed",
        reporterUserId: jobId,
        createdAt: "2026-08-16T18:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("uses jobs:write, exact lowercase UUIDv7 identity, idempotency, and no-store", () => {
    const operation = contract.paths["/jobs/{jobId}/reports"].post;
    expect(operation.security).toEqual([{ oidc: ["jobs:write"] }]);
    expect(operation.parameters[0]?.schema.pattern).toContain("-7");
    expect(operation.parameters[1]).toMatchObject({
      in: "header",
      name: "Idempotency-Key",
      required: true,
    });
    expect(operation.responses["201"].headers["Cache-Control"].schema.enum).toEqual(["no-store"]);
    expect(Object.keys(operation.responses).sort()).toEqual([
      "201",
      "400",
      "401",
      "403",
      "404",
      "409",
      "413",
      "415",
      "503",
    ]);
  });
});

describe("admin moderation contracts", () => {
  const validateOpen = compileComponentValidator("OpenModerationCaseRequest");
  const validateResolve = compileComponentValidator("ResolveModerationCaseRequest");
  const validateCase = compileComponentValidator("ModerationCase");
  const jobId = "019d04cf-1f80-7000-8000-000000000020";
  const caseId = "019d04cf-1f80-7000-8000-000000000021";

  it("accepts only fixed targets, reasons, decisions, and redacted case projections", () => {
    expect(
      validateOpen({
        target: { kind: "job", jobId },
        reasonCode: "candidate_reports",
      }),
    ).toBe(true);
    expect(
      validateOpen({
        target: {
          kind: "source",
          sourceId: "synthetic-generated",
          adapterVersion: "v1",
          adapterConfigSha256: "a".repeat(64),
        },
        reasonCode: "source_integrity",
      }),
    ).toBe(true);
    expect(
      validateOpen({
        target: { kind: "job", jobId },
        reasonCode: "candidate_reports",
        operatorId: "browser-injected",
      }),
    ).toBe(false);
    expect(
      validateResolve({
        expectedVersion: 0,
        resolution: "block_job",
        reasonCode: "report_confirmed",
      }),
    ).toBe(true);
    expect(
      validateCase({
        id: caseId,
        target: { kind: "job", jobId },
        status: "open",
        version: 0,
        openReasonCode: "candidate_reports",
        openedAt: "2026-08-22T12:00:00.000Z",
        openedBy: "private-operator",
      }),
    ).toBe(false);
  });

  it("requires the dedicated moderation scope and private no-store responses", () => {
    for (const path of [
      "/admin/moderation/cases/search",
      "/admin/moderation/cases",
      "/admin/moderation/cases/{caseId}/resolve",
      "/admin/moderation/jobs/{jobId}/report-summary",
    ] as const) {
      const operation = Object.values(contract.paths[path])[0];
      expect(operation.security).toEqual([{ oidc: ["jobs:moderate"] }]);
      const success = operation.responses["200"] ?? operation.responses["201"];
      expect(success.headers["Cache-Control"].schema.enum).toEqual(["no-store"]);
    }
  });
});

describe("match-assessment contract", () => {
  const validate = compileComponentValidator("MatchAssessment");
  const value = {
    schemaVersion: 1,
    requestedJobId: "019d04cf-1f80-7000-8000-000000000012",
    canonicalJobId: "019d04cf-1f80-7000-8000-000000000013",
    preferenceSetId: "019d04cf-1f80-7000-8000-000000000014",
    preferenceVersion: 3,
    preferenceUpdatedAt: "2026-08-16T11:00:00.000Z",
    catalogRevision: "42",
    assessedAt: "2026-08-16T12:00:00.000Z",
    gate: "review_required",
    evidence: [
      { constraint: "work_mode", state: "satisfied", reasonCode: "work_mode_selected" },
      {
        constraint: "employment_type",
        state: "satisfied",
        reasonCode: "employment_type_selected",
      },
      {
        constraint: "target_role",
        state: "satisfied",
        reasonCode: "target_role_exact_overlap",
      },
      { constraint: "location", state: "unknown", reasonCode: "location_not_established" },
      {
        constraint: "compensation",
        state: "unknown",
        reasonCode: "compensation_semantics_unavailable",
      },
      {
        constraint: "authorization_sponsorship",
        state: "unknown",
        reasonCode: "authorization_sponsorship_unavailable",
      },
      {
        constraint: "seniority",
        state: "unknown",
        reasonCode: "seniority_semantics_unavailable",
      },
      {
        constraint: "blocked_company",
        state: "unknown",
        reasonCode: "blocked_company_preferences_unavailable",
      },
      {
        constraint: "qualifications",
        state: "unknown",
        reasonCode: "qualification_evidence_unavailable",
      },
    ],
  };

  it("accepts only fixed-order, value-free evidence with a relationally correct gate", () => {
    expect(validate(value)).toBe(true);
    expect(
      validate({
        ...value,
        gate: "excluded",
        evidence: [
          { constraint: "work_mode", state: "conflict", reasonCode: "work_mode_conflict" },
          ...value.evidence.slice(1),
        ],
      }),
    ).toBe(true);
  });

  it("rejects reordered, contradictory, unbounded, internal, and candidate-value evidence", () => {
    expect(validate({ ...value, evidence: [...value.evidence].reverse() })).toBe(false);
    expect(validate({ ...value, gate: "excluded" })).toBe(false);
    expect(
      validate({
        ...value,
        evidence: [
          { constraint: "work_mode", state: "conflict", reasonCode: "work_mode_selected" },
          ...value.evidence.slice(1),
        ],
      }),
    ).toBe(false);
    expect(validate({ ...value, score: 0.92 })).toBe(false);
    expect(validate({ ...value, evidence: [...value.evidence, value.evidence[0]] })).toBe(false);
    expect(
      validate({
        ...value,
        evidence: value.evidence.map((item, index) =>
          index === 0 ? { ...item, candidateValue: "remote" } : item,
        ),
      }),
    ).toBe(false);
  });

  it("uses jobs:read, no-store, and exact lowercase UUIDv7 path identity", () => {
    const operation = contract.paths["/jobs/{jobId}/match-assessment"].get;
    expect(operation.security).toEqual([{ oidc: ["jobs:read"] }]);
    expect(operation.parameters[0]?.schema.pattern).toContain("-7");
    for (const response of Object.values(operation.responses)) {
      expect(response.headers["Cache-Control"].schema.enum).toEqual(["no-store"]);
    }
    expect(Object.keys(operation.responses).sort()).toEqual([
      "200",
      "400",
      "401",
      "403",
      "404",
      "409",
      "503",
    ]);
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

describe("fresh candidate-observed manual form command", () => {
  const validate = compileComponentValidator("StartManualApplicationSubmissionRequest");
  const observedForm = {
    form: { adapterId: "generic-assisted-v1", variantId: "generic", formHash: "a".repeat(64) },
    capturedAtEpochMs: 1000,
    confirmed: true,
  };
  it("preserves legacy requests and accepts the closed optional attestation", () => {
    expect(validate({ expectedRevision: 3 })).toBe(true);
    expect(validate({ expectedRevision: 3, observedForm })).toBe(true);
  });
  it.each([
    { ...observedForm, confirmed: false },
    { ...observedForm, capturedAtEpochMs: -1 },
    { ...observedForm, capturedAtEpochMs: 1.5 },
    { ...observedForm, capturedAtEpochMs: Number.MAX_SAFE_INTEGER + 1 },
    { ...observedForm, value: "private" },
    { ...observedForm, form: { ...observedForm.form, questions: [] } },
  ])("refuses invalid or value-bearing attestations %#", (value) => {
    expect(validate({ expectedRevision: 3, observedForm: value })).toBe(false);
  });
});
