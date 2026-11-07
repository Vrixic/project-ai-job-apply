import { readdir, readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import * as addFormatsModule from "ajv-formats";
import { describe, expect, it, vi } from "vitest";
import {
  candidateDataExportValidationIssue,
  restrictedAnswerExportFieldKeys,
  validateCandidateDataExportV1,
} from "./candidate-data-export.js";

async function exportDefinition(name: string) {
  const schema = JSON.parse(
    await readFile(
      new URL("../schemas/v1/candidate-data-export.schema.json", import.meta.url),
      "utf8",
    ),
  ) as { $defs: object };
  const ajv = new Ajv2020({ strict: true });
  const addFormats = addFormatsModule.default as unknown as (instance: Ajv2020) => Ajv2020;
  addFormats(ajv);
  return ajv.compile({ $ref: `#/$defs/${name}`, $defs: schema.$defs });
}

describe("portable export safe validation diagnostics", () => {
  const canary = "synthetic-private-canary-do-not-log";
  const at = "2026-10-13T18:00:00.000Z";
  const base = {
    schemaVersion: 1,
    format: "candidate-data-export-v1",
    exportId: "019d04cf-1f80-7000-8000-000000000001",
    policyVersion: "synthetic-v1",
    generatedAt: at,
    candidate: { createdAt: at, connectedAccounts: [] },
    profile: { preferences: null, facts: [] },
    documents: { resumes: [] },
    jobs: { reports: [] },
    matching: { savedJobs: [] },
    billing: { entitlement: { plan: "free", version: 0, effectiveAt: at } },
    audit: { events: [] },
  };
  it.each(["required", "enum", "additionalProperties"])(
    "returns only a trusted static schema location for %s failure",
    (keyword) => {
      const value: Record<string, unknown> = structuredClone(base);
      if (keyword === "required") value.profile = { facts: [] };
      else if (keyword === "enum")
        value.billing = { entitlement: { plan: canary, version: 0, effectiveAt: at } };
      else value[canary] = { value: canary };
      const issue = candidateDataExportValidationIssue(value);
      expect(issue).toBeDefined();
      expect(Object.keys(issue ?? {}).sort()).toEqual(["keyword", "schemaPath", "section"]);
      expect(issue?.keyword).toBe(keyword);
      expect(issue?.section).toBe(
        keyword === "required" ? "profile" : keyword === "enum" ? "billing" : "root",
      );
      expect(issue?.schemaPath.startsWith("#/")).toBe(true);
      expect(Object.isFrozen(issue)).toBe(true);
      const encoded = JSON.stringify(issue);
      for (const forbidden of [canary, "instancePath", "params", "message", base.exportId])
        expect(encoded).not.toContain(forbidden);
      expect(candidateDataExportValidationIssue(base)).toBeUndefined();
      expect(JSON.stringify(issue)).toBe(encoded);
    },
  );

  it("attributes invalid Applications to its fixed owner when optional Trust is absent", () => {
    expect(candidateDataExportValidationIssue(base)).toBeUndefined();
    const value = { ...base, applications: { schemaVersion: 1 } };
    expect(value).not.toHaveProperty("trust");
    expect(candidateDataExportValidationIssue(value)).toMatchObject({
      section: "applications",
      keyword: "required",
    });
  });

  it("uses root for a missing required field while all present sections are valid", () => {
    const value: Record<string, unknown> = structuredClone(base);
    delete value.profile;
    expect(candidateDataExportValidationIssue(value)).toEqual({
      section: "root",
      schemaPath: "#/required",
      keyword: "required",
    });
  });

  it("retains a trusted section-relative constraint for an invalid owner array", () => {
    expect(
      candidateDataExportValidationIssue({
        ...base,
        documents: { resumes: [], coverLetters: { value: canary } },
      }),
    ).toEqual({
      section: "documents",
      schemaPath: "#/properties/coverLetters/type",
      keyword: "type",
    });
  });

  it("falls back for untrusted paths/keywords and never reads input-bearing Ajv details", async () => {
    const raw: Record<string, unknown> = {
      schemaPath: "#/additionalProperties",
      keyword: "additionalProperties",
    };
    for (const name of ["params", "message", "instancePath", "data"]) {
      Object.defineProperty(raw, name, {
        get: () => {
          throw new Error(canary);
        },
      });
    }
    const compiled = Object.assign(() => false, { errors: [raw] });
    const compile = vi.spyOn(Ajv2020.prototype, "compile").mockReturnValue(compiled as never);
    const getSchema = vi
      .spyOn(Ajv2020.prototype, "getSchema")
      .mockReturnValue((() => true) as never);
    vi.doMock("ajv/dist/2020.js", () => ({ Ajv2020 }));
    vi.resetModules();
    try {
      const fresh = await import("./candidate-data-export.js");
      expect(fresh.candidateDataExportValidationIssue({ [canary]: canary })).toEqual({
        section: "root",
        schemaPath: "#/additionalProperties",
        keyword: "additionalProperties",
      });
      for (const unsafe of [
        { schemaPath: `#/properties/${canary}`, keyword: "additionalProperties" },
        { schemaPath: "#/additionalProperties", keyword: canary },
        { schemaPath: `#/${"x".repeat(257)}`, keyword: "required" },
        { schemaPath: "#/required", keyword: "x".repeat(41) },
      ]) {
        Object.assign(raw, unsafe);
        expect(fresh.candidateDataExportValidationIssue({ [canary]: canary })).toEqual({
          section: "root",
          schemaPath: "#",
          keyword: "validation",
        });
      }
    } finally {
      compile.mockRestore();
      getSchema.mockRestore();
      vi.doUnmock("ajv/dist/2020.js");
      vi.resetModules();
    }
  });
});

describe("portable Profile SQL projection", () => {
  const at = "2026-10-13T18:00:00.000Z";
  const preferences = {
    version: 1,
    targetRoles: ["Synthetic engineer"],
    locations: ["Synthetic location"],
    workModes: ["remote"],
    employmentTypes: ["full_time"],
    updatedAt: at,
  };
  it.each([undefined, true, false])(
    "preserves the existing optional sponsorship preference (%s)",
    async (requiresSponsorship) => {
      const validate = await exportDefinition("preferences");
      expect(
        validate({
          ...preferences,
          ...(requiresSponsorship === undefined ? {} : { requiresSponsorship }),
        }),
      ).toBe(true);
    },
  );
  it("matches the preference producer contract without coercing or accepting unknown fields", async () => {
    const api = JSON.parse(
      await readFile(
        new URL("../../api-contracts/openapi/platform.v1.json", import.meta.url),
        "utf8",
      ),
    );
    expect(api.components.schemas.JobPreferenceFields.properties.requiresSponsorship).toEqual({
      type: "boolean",
    });
    const sql = await readFile(
      new URL(
        "../../../backend/services/profile/migrations/0010_restricted_answer_vault.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(sql).toContain(
      "SELECT preferences || jsonb_build_object('version', version, 'updatedAt', updated_at)",
    );
    const validate = await exportDefinition("preferences");
    for (const requiresSponsorship of ["true", "false", 0, 1, null, {}])
      expect(validate({ ...preferences, requiresSponsorship })).toBe(false);
    expect(validate({ ...preferences, unknownField: true })).toBe(false);
  });
});

describe("portable native lifecycle metadata", () => {
  const id = "019d04cf-1f80-7000-8000-000000000001";
  const at = "2026-10-13T18:00:00.000Z";
  async function producerValues(path: string, column: string) {
    const sql = await readFile(new URL(`../../../${path}`, import.meta.url), "utf8");
    const values = new RegExp(`\\b${column} IN \\(([^)]+)\\)`, "u").exec(sql)?.[1];
    if (!values) throw new Error("SyntheticProducerEnumNotFound");
    return [...values.matchAll(/'([a-z_]+)'/gu)].map((match) => match[1] as string);
  }
  it.each([
    [
      "nativeMaterialAllocation",
      "backend/services/documents/migrations/0016_native_application_disposal.sql",
    ],
    [
      "nativeResumeGeneration",
      "backend/services/documents/migrations/0017_native_resume_launch_rejection.sql",
    ],
  ])(
    "accepts every existing SQL producer state in %s while refusing content and unknown states",
    async (definition, path) => {
      const validate = await exportDefinition(definition);
      const metadata =
        definition === "nativeMaterialAllocation"
          ? { id, applicationId: id, generationId: id, epochId: id, createdAt: at }
          : {
              id,
              applicationId: id,
              version: 1,
              baseDocumentId: id,
              baseVersion: 1,
              baseSha256: "a".repeat(64),
              jobContextSha256: "b".repeat(64),
              createdAt: at,
            };
      const states = await producerValues(path, "state");
      expect(states.length).toBeGreaterThan(3);
      for (const state of states) {
        expect(validate({ ...metadata, state }), state).toBe(true);
        for (const forbidden of [
          "text",
          "paragraphs",
          "taskArn",
          "configurationSha256",
          "launchRequestSha256",
        ]) {
          expect(
            validate({ ...metadata, state, [forbidden]: "synthetic-forbidden" }),
            forbidden,
          ).toBe(false);
        }
      }
      for (const state of ["submitted", "unknown", null, 0])
        expect(validate({ ...metadata, state })).toBe(false);
    },
  );

  it("accepts every existing approval invalidation reason without relaxing closed metadata", async () => {
    const validate = await exportDefinition("applicationsApproval");
    const approval = {
      id,
      applicationId: id,
      packetId: id,
      packetHash: "a".repeat(64),
      acknowledgedFieldKeys: [],
      approvedAt: at,
      expiresAt: at,
      invalidatedAt: at,
    };
    const reasons = await producerValues(
      "backend/services/applications/migrations/0008_temporary_material_bindings.sql",
      "invalidation_reason",
    );
    expect(reasons).toContain("temporary_material_expired");
    expect(reasons).toContain("temporary_material_changed");
    for (const invalidationReason of reasons) {
      expect(validate({ ...approval, invalidationReason }), invalidationReason).toBe(true);
      expect(
        validate({ ...approval, invalidationReason, generatedText: "synthetic-forbidden" }),
      ).toBe(false);
    }
    for (const invalidationReason of ["unknown", "submission_confirmed", null, 0]) {
      expect(validate({ ...approval, invalidationReason })).toBe(false);
    }
  });
});

describe("portable report review status", () => {
  const report = {
    id: "018f1e02-1a11-7abc-8abc-1234567890ab",
    requestedJobId: "018f1e02-1a11-7abc-8abc-1234567890ac",
    canonicalJobId: "018f1e02-1a11-7abc-8abc-1234567890ac",
    reason: "job_inaccurate",
    createdAt: "2026-10-06T12:00:00Z",
  };
  it("accepts old exports and only fixed linked-case statuses without privileged metadata", async () => {
    const validate = await exportDefinition("jobReport");
    expect(validate(report)).toBe(true);
    for (const status of ["received", "under_review", "resolved"])
      expect(validate({ ...report, status })).toBe(true);
    for (const status of [null, "approved", "open", 0])
      expect(validate({ ...report, status })).toBe(false);
    for (const field of [
      "operatorId",
      "reporterUserId",
      "caseId",
      "idempotencyKeyHash",
      "requestHash",
    ])
      expect(validate({ ...report, status: "resolved", [field]: "synthetic-forbidden" })).toBe(
        false,
      );
  });
});

describe("domain schema registry", () => {
  it("exports only portable original material metadata, without ownership or content", async () => {
    const validate = await exportDefinition("applicationsPacket");
    const id = "019d04cf-1f80-7000-8000-000000000001";
    const reference = {
      schemaVersion: 1,
      kind: "tailored_resume",
      generationId: id,
      version: 1,
      contentSha256: "a".repeat(64),
      completedAtMs: 1_000,
      expiresAtMs: 1_801_000,
    };
    const packet = {
      id,
      applicationId: id,
      version: 1,
      packetHash: "a".repeat(64),
      jobRevision: "b".repeat(64),
      resumeHash: "a".repeat(64),
      fields: [],
      createdAt: "2026-10-05T12:00:00Z",
      temporaryMaterials: [reference],
    };
    expect(validate(packet)).toBe(true);
    for (const patch of [
      { ownerUserId: id },
      { applicationId: id },
      { text: "synthetic forbidden content" },
      { schemaVersion: 2 },
      { contentSha256: "invalid" },
    ]) {
      expect(validate({ ...packet, temporaryMaterials: [{ ...reference, ...patch }] })).toBe(false);
    }
    expect(validate({ ...packet, temporaryMaterials: [reference, reference] })).toBe(false);
    expect(validate({ ...packet, temporaryMaterials: [] })).toBe(false);
  });

  it("preserves optional selected-answer provenance in portable packet fields with mandatory review", async () => {
    const validate = await exportDefinition("applicationsPacketField");
    const id = "019d04cf-1f80-7000-8000-000000000001";
    const field = {
      fieldKey: "authorization.us_authorized",
      value: false,
      origin: "answer_vault",
      sourceFactIds: [id],
      confidence: 1,
      disposition: "review",
      reasons: ["restricted_answer"],
      requiresReview: true,
      vaultReference: {
        id,
        version: 1,
        context: "us",
        questionHash: "a".repeat(64),
        meaningConfirmed: true,
        validUntilEpochMs: null,
      },
    };
    expect(validate(field)).toBe(true);
    for (const patch of [
      { requiresReview: false },
      { disposition: "auto" },
      { origin: "confirmed_fact" },
    ]) {
      expect(validate({ ...field, ...patch })).toBe(false);
    }
    expect(
      validate({ ...field, vaultReference: { ...field.vaultReference, value: "private" } }),
    ).toBe(false);
  });

  it("allows optional bounded saved paragraphs only with mandatory review metadata", async () => {
    const validate = await exportDefinition("coverLetter");
    const ready = {
      id: "019d04cf-1f80-7000-8000-000000000070",
      applicationId: "019d04cf-1f80-7000-8000-000000000071",
      version: 1,
      status: "ready",
      jobRevision: "a".repeat(64),
      confirmedFactsHash: "b".repeat(64),
      contentSha256: "c".repeat(64),
      model: { provider: "openai", model: "gpt-6-luna", version: "gpt-6-luna" },
      promptVersion: "1.0.0",
      createdAt: "2026-10-04T12:00:00Z",
    };
    const content = {
      paragraphs: [{ text: "I build synthetic systems.", factIds: [ready.id] }],
      reviewRequired: true,
    };
    expect(validate(ready)).toBe(true);
    expect(validate({ ...ready, ...content })).toBe(true);
    for (const extra of [
      { paragraphs: content.paragraphs },
      { reviewRequired: true },
      { ...content, reviewRequired: false },
      { ...content, paragraphs: [] },
      { ...content, paragraphs: Array.from({ length: 7 }, () => content.paragraphs[0]) },
      { ...content, paragraphs: [{ text: "x".repeat(1201), factIds: [ready.id] }] },
      { ...content, paragraphs: [{ text: "synthetic", factIds: [ready.id, ready.id] }] },
      { ...content, paragraphs: [{ ...content.paragraphs[0], objectKey: "private-key" }] },
    ])
      expect(validate({ ...ready, ...extra })).toBe(false);
    const { contentSha256: _hash, model: _model, promptVersion: _prompt, ...pending } = ready;
    expect(validate({ ...pending, status: "pending", ...content })).toBe(false);
  });
  it("exports cover-letter metadata without candidate text or object capabilities", async () => {
    const validate = await exportDefinition("coverLetter");
    const pending = {
      id: "019d04cf-1f80-7000-8000-000000000070",
      applicationId: "019d04cf-1f80-7000-8000-000000000071",
      version: 1,
      status: "pending",
      jobRevision: "a".repeat(64),
      confirmedFactsHash: "b".repeat(64),
      createdAt: "2026-10-02T12:00:00.000Z",
    };
    const ready = {
      ...pending,
      status: "ready",
      contentSha256: "c".repeat(64),
      model: { provider: "openai", model: "gpt-6-luna", version: "gpt-6-luna" },
      promptVersion: "cover_letter.v1",
    };
    expect(validate(pending)).toBe(true);
    expect(validate(ready)).toBe(true);
    expect(validate({ ...pending, status: "ready" })).toBe(false);
    expect(validate({ ...ready, status: "pending" })).toBe(false);
    for (const field of [
      "paragraphs",
      "prompt",
      "ownerUserId",
      "objectKey",
      "objectVersion",
      "kmsKeyArn",
    ]) {
      expect(validate({ ...ready, [field]: "synthetic-private-value" })).toBe(false);
    }
  });
  it("allowlists vault export metadata and optional active values without encryption material", async () => {
    const validate = await exportDefinition("restrictedAnswerMetadata");
    const metadata = {
      id: "019d04cf-1f80-7000-8000-000000000070",
      fieldKey: "authorization.us_authorized",
      version: 1,
      valueType: "boolean",
      sensitivity: "restricted",
      state: "active",
      confirmedAt: "2026-09-28T12:00:00.000Z",
      createdAt: "2026-09-28T12:00:00.000Z",
    };
    expect(validate(metadata)).toBe(true);
    for (const valueType of ["string", "text", "boolean", "date", "decimal", "enum"]) {
      for (const sensitivity of ["confidential", "restricted"]) {
        expect(validate({ ...metadata, valueType, sensitivity })).toBe(true);
      }
    }
    expect(
      validate({
        ...metadata,
        state: "deleted",
        version: 2,
        context: "us",
        expiresAt: metadata.createdAt,
      }),
    ).toBe(true);
    for (const field of [
      "plaintext",
      "ciphertext",
      "kmsKeyId",
      "kms_key_id",
      "encryptionAlgorithm",
      "sourceReference",
      "userId",
      "ownerId",
    ]) {
      expect(validate({ ...metadata, [field]: "synthetic" }), field).toBe(false);
    }
    expect(validate({ ...metadata, value: "true" })).toBe(true);
    expect(validate({ ...metadata, value: "true", state: "deleted" })).toBe(false);
    expect(validate({ ...metadata, value: "" })).toBe(false);
    expect(validate({ ...metadata, value: "x".repeat(3901) })).toBe(false);
    for (const fieldKey of restrictedAnswerExportFieldKeys)
      expect(validate({ ...metadata, fieldKey, value: "synthetic" })).toBe(true);
    for (const fieldKey of [
      "credential.password",
      "oauth.token",
      "attestation.truthful",
      "signature.name",
      "challenge.captcha",
      "custom.unknown",
    ]) {
      expect(validate({ ...metadata, fieldKey, value: "synthetic" })).toBe(false);
      expect(validate({ ...metadata, fieldKey })).toBe(true);
    }
    const taxonomy = JSON.parse(
      await readFile(
        new URL("../../../data/taxonomies/application-fields.v1.json", import.meta.url),
        "utf8",
      ),
    ) as { fields: Array<{ key: string; sensitivity: string; answerPolicy: string }> };
    expect([...restrictedAnswerExportFieldKeys].sort()).toEqual(
      taxonomy.fields
        .filter(
          (field) => field.sensitivity === "restricted" && field.answerPolicy === "never_infer",
        )
        .map((field) => field.key)
        .sort(),
    );
    for (const field of Object.keys(metadata)) {
      const incomplete: Record<string, unknown> = { ...metadata };
      delete incomplete[field];
      expect(validate(incomplete), field).toBe(false);
    }
    for (const invalid of [
      { version: 0 },
      { version: 1.5 },
      { version: 2147483648 },
      { sensitivity: "standard" },
      { valueType: "object" },
      { state: "expired" },
      { fieldKey: "" },
      { fieldKey: "x".repeat(121) },
      { context: "" },
      { context: null },
      { context: "x".repeat(121) },
      { confirmedAt: "invalid" },
      { createdAt: "invalid" },
      { expiresAt: "invalid" },
      { id: "not-a-uuid" },
    ]) {
      expect(validate({ ...metadata, ...invalid }), JSON.stringify(invalid)).toBe(false);
    }
  });

  it("exports the exact bounded contribution-consent history without owner or preview digests", async () => {
    const validate = await exportDefinition("contributionConsent");
    const consent = {
      consentId: "019d04cf-1f80-7000-8000-000000000060",
      purpose: "ugc_contribution",
      client: "extension",
      documentVersion: "ugc-contribution-preview.v1",
      policyVersion: "synthetic-v1",
      state: "granted",
      grantedAt: "2026-09-09T12:00:00.000Z",
      recordedAt: "2026-09-09T12:00:00.000Z",
    };
    expect(validate(consent)).toBe(true);
    expect(validate({ ...consent, state: "revoked", expiresAt: "2026-09-10T12:00:00.000Z" })).toBe(
      true,
    );
    expect(
      validate({
        ...consent,
        state: "superseded",
        replacementConsentId: "019d04cf-1f80-7000-8000-000000000061",
      }),
    ).toBe(true);
    for (const extra of [
      { state: "superseded" },
      { replacementConsentId: consent.consentId },
      { ownerUserId: consent.consentId },
      { previewPayloadSha256: "a".repeat(64) },
      { documentVersion: "A".repeat(101) },
      { client: "web" },
    ]) {
      expect(validate({ ...consent, ...extra })).toBe(false);
    }
  });

  it("exports public contribution fields and separate bounded processing and Trust history", async () => {
    const validate = await exportDefinition("jobContribution");
    const at = "2026-09-09T12:00:00.000Z";
    const contribution = {
      id: "019d04cf-1f80-7000-8000-000000000060",
      state: "published",
      source: {
        provider: "greenhouse",
        pageVariant: "greenhouse-board-v1",
        sourceUrl: "https://job-boards.greenhouse.io/synthetic/jobs/123",
        adapterVersion: "d2-job-page-v1",
      },
      posting: { title: "Synthetic engineer" },
      observation: { observedAt: at },
      approval: {
        consentId: "019d04cf-1f80-7000-8000-000000000061",
        consentVersion: "ugc-contribution-preview.v1",
        policyVersion: "synthetic-v1",
        approvedAt: at,
      },
      processingHistory: [
        {
          state: "published",
          reasonCode: "publication_complete",
          policyVersion: "synthetic-v1",
          occurredAt: at,
        },
      ],
      trustHistory: [{ status: "accepted", policyVersion: "synthetic-v1", decidedAt: at }],
      createdAt: at,
      updatedAt: at,
    };
    expect(validate(contribution)).toBe(true);
    expect(
      validate({
        ...contribution,
        state: "awaiting_independent_verification",
        processingHistory: [
          {
            state: "awaiting_independent_verification",
            reasonCode: "provider_probable_duplicate",
            policyVersion: "synthetic-v1",
            occurredAt: at,
          },
        ],
      }),
    ).toBe(true);
    expect(
      validate({
        ...contribution,
        publication: { state: "prepared", createdAt: at, updatedAt: at },
      }),
    ).toBe(true);
    expect(
      validate({
        ...contribution,
        publication: { state: "applied", createdAt: at, updatedAt: at },
      }),
    ).toBe(false);
    expect(
      validate({
        ...contribution,
        client: { surface: "browser_extension", version: "0.2.0" },
        posting: {
          title: "Synthetic engineer",
          companyName: "Synthetic",
          description: "Synthetic public description",
          locations: ["Remote"],
          workMode: "remote",
          employmentType: "full_time",
          department: "Engineering",
          applicationUrl: "https://job-boards.greenhouse.io/synthetic/jobs/123",
        },
        publication: { jobId: contribution.id, state: "applied", createdAt: at, updatedAt: at },
      }),
    ).toBe(true);
    for (const extra of [
      { ownerUserId: contribution.id },
      { accessToken: "secret" },
      { posting: { title: "Synthetic", rawHtml: "forbidden" } },
      { source: { ...contribution.source, provider: "lever" } },
      { source: { ...contribution.source, sourceUrl: "https://unrelated.example.test/secret" } },
      { approval: { ...contribution.approval, previewDigestSha256: "a".repeat(64) } },
      { trustHistory: [{ ...contribution.trustHistory[0], reviewerId: contribution.id }] },
      {
        processingHistory: [{ ...contribution.processingHistory[0], reasonCode: "arbitrary_text" }],
      },
    ]) {
      expect(validate({ ...contribution, ...extra })).toBe(false);
    }
  });

  it("exports nullable private captures and exact resolutions without object or owner identities", async () => {
    const validate = await exportDefinition("privateSavedPageCapture");
    const at = "2026-09-09T12:00:00.000Z";
    const capture = {
      id: "019d04cf-1f80-7000-8000-000000000060",
      provider: "lever",
      pageVariant: "lever-posting-v1",
      sourceUrl: "https://jobs.eu.lever.co/synthetic/123",
      adapterVersion: "d2-job-page-v1",
      title: "Synthetic engineer",
      company: null,
      location: null,
      description: null,
      externalJobId: null,
      capturedAt: at,
      savedAt: at,
      resolution: null,
    };
    expect(validate(capture)).toBe(true);
    const resolved = {
      canonicalJobId: capture.id,
      verificationEvidenceId: "019d04cf-1f80-7000-8000-000000000061",
      resolvedAt: at,
    };
    expect(
      validate({
        ...capture,
        company: "Synthetic",
        location: "Remote",
        description: "Synthetic public job",
        externalJobId: "123",
        resolution: resolved,
      }),
    ).toBe(true);
    for (const extra of [
      { ownerUserId: capture.id },
      { requestHash: "a".repeat(64) },
      { location: "x".repeat(501) },
      { description: "x".repeat(12001) },
      { sourceUrl: "https://jobs.eu.lever.co/synthetic/123?token=secret" },
      { resolution: { ...resolved, rawObjectKey: "private/artifact" } },
      { company: "" },
    ]) {
      expect(validate({ ...capture, ...extra })).toBe(false);
    }
  });

  it("keeps the application packet additive and bound to reviewable field evidence", async () => {
    const schema = JSON.parse(
      await readFile(
        new URL("../schemas/v1/application-packet.schema.json", import.meta.url),
        "utf8",
      ),
    ) as object;
    const ajv = new Ajv2020({ strict: true });
    const addFormats = addFormatsModule.default as unknown as (instance: Ajv2020) => Ajv2020;
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const legacy = {
      id: "019d04cf-1f80-7000-8000-000000000070",
      userId: "019d04cf-1f80-7000-8000-000000000071",
      canonicalJobId: "019d04cf-1f80-7000-8000-000000000072",
      version: 1,
      state: "review_required",
      fields: [
        {
          fieldKey: "contact.email",
          value: "candidate@example.test",
          sourceFactIds: ["019d04cf-1f80-7000-8000-000000000073"],
          confidence: 0.99,
          review: "not_required",
        },
      ],
      artifactHashes: { resume: "a".repeat(64) },
      packetHash: "b".repeat(64),
    };
    // Version-one packets written before the additive fields remain valid.
    expect(validate(legacy)).toBe(true);
    const detailed = {
      ...legacy,
      applicationId: "019d04cf-1f80-7000-8000-000000000074",
      jobRevision: "c".repeat(64),
      form: { adapterId: "greenhouse", variantId: "synthetic-v1", formHash: "d".repeat(64) },
      createdAt: "2026-09-18T12:00:00.000Z",
      fields: [
        {
          ...legacy.fields[0],
          origin: "confirmed_fact",
          disposition: "auto",
          reasons: [],
          requiresReview: false,
        },
      ],
    };
    expect(validate(detailed)).toBe(true);
    for (const bad of [
      { ...detailed, outcome: "offer" },
      { ...detailed, form: { adapterId: "greenhouse" } },
      { ...detailed, fields: [{ ...detailed.fields[0], origin: "guessed" }] },
      {
        ...detailed,
        fields: [{ ...detailed.fields[0], reasons: ["restricted_answer", "restricted_answer"] }],
      },
    ]) {
      expect(validate(bad)).toBe(false);
    }
  });

  it("compiles every version-one JSON Schema", async () => {
    const directory = new URL("../schemas/v1/", import.meta.url);
    const files = (await readdir(directory)).filter((file) => file.endsWith(".schema.json"));
    const ajv = new Ajv2020({ strict: true });
    const addFormats = addFormatsModule.default as unknown as (instance: Ajv2020) => Ajv2020;
    addFormats(ajv);

    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const file of files) {
      const schema = JSON.parse(await readFile(new URL(file, directory), "utf8")) as object;
      expect(() => ajv.compile(schema)).not.toThrow();
    }
  });

  it("enforces live descriptions while permitting minimal canonical-job tombstones", async () => {
    const schema = JSON.parse(
      await readFile(new URL("../schemas/v1/canonical-job.schema.json", import.meta.url), "utf8"),
    ) as object;
    const ajv = new Ajv2020({ strict: true });
    const addFormats = addFormatsModule.default as unknown as (instance: Ajv2020) => Ajv2020;
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const base = {
      id: "019d04cf-1f80-7000-8000-000000000001",
      companyId: "019d04cf-1f80-7000-8000-000000000002",
      title: "Synthetic Engineer",
      locations: ["Remote - US"],
      sources: [
        {
          provider: "other",
          url: "https://jobs.example.test/synthetic/1",
          canonicalUrl: "https://jobs.example.test/synthetic/1",
          observedAt: "2026-08-11T12:00:00.000Z",
          provenance: "authorized_fixture",
          contentHash: "a".repeat(64),
        },
      ],
      freshness: {
        firstObservedAt: "2026-08-11T12:00:00.000Z",
        lastVerifiedAt: "2026-08-11T12:00:00.000Z",
        expiresAt: "2026-09-10T12:00:00.000Z",
      },
    };

    expect(validate({ ...base, status: "active" })).toBe(false);
    expect(validate({ ...base, status: "active", description: "Synthetic fixture." })).toBe(true);
    expect(validate({ ...base, status: "expired" })).toBe(true);
    expect(validate({ ...base, status: "removed" })).toBe(false);
  });

  it("keeps saved-job ownership private and snapshots bounded to public job fields", async () => {
    const schema = JSON.parse(
      await readFile(new URL("../schemas/v1/saved-job.schema.json", import.meta.url), "utf8"),
    ) as object;
    const ajv = new Ajv2020({ strict: true });
    const addFormats = addFormatsModule.default as unknown as (instance: Ajv2020) => Ajv2020;
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const savedJob = {
      id: "019d04cf-1f80-7000-8000-000000000010",
      ownerUserId: "019d04cf-1f80-7000-8000-000000000011",
      requestedJobId: "019d04cf-1f80-7000-8000-000000000012",
      resolvedCanonicalJobIdAtSave: "019d04cf-1f80-7000-8000-000000000012",
      jobSnapshot: {
        jobIdAtSave: "019d04cf-1f80-7000-8000-000000000012",
        company: {
          id: "019d04cf-1f80-7000-8000-000000000013",
          name: "Synthetic Company",
        },
        title: "Synthetic Engineer",
        locations: ["Remote - US"],
        firstObservedAt: "2026-08-15T12:00:00.000Z",
        lastVerifiedAt: "2026-08-15T12:00:00.000Z",
        expiresAt: "2026-09-14T12:00:00.000Z",
      },
      savedAt: "2026-08-15T12:00:00.000Z",
    };

    expect(validate(savedJob)).toBe(true);
    expect(
      validate({
        ...savedJob,
        jobSnapshot: { ...savedJob.jobSnapshot, description: "must not be copied" },
      }),
    ).toBe(false);
    expect(validate({ ...savedJob, recruiterResponse: "interview" })).toBe(false);
  });

  it("binds UGC contribution consent to one owner and exact preview digest", async () => {
    const schema = JSON.parse(
      await readFile(
        new URL("../schemas/v1/ugc-contribution-consent.schema.json", import.meta.url),
        "utf8",
      ),
    ) as object;
    const ajv = new Ajv2020({ strict: true });
    const addFormats = addFormatsModule.default as unknown as (instance: Ajv2020) => Ajv2020;
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const consent = {
      schemaVersion: 1,
      id: "019d04cf-1f80-7000-8000-000000000030",
      ownerUserId: "019d04cf-1f80-7000-8000-000000000031",
      purpose: "ugc_contribution",
      client: "extension",
      documentVersion: "ugc-contribution-preview.v1",
      policyVersion: "d2-ugc-policy.v1",
      previewPayloadSha256: "a".repeat(64),
      state: "granted",
      grantedAt: "2026-09-01T12:00:00.000Z",
      recordedAt: "2026-09-01T12:00:00.000Z",
    };
    expect(validate(consent)).toBe(true);
    expect(validate({ ...consent, client: "web" })).toBe(false);
    expect(validate({ ...consent, previewPayloadSha256: "raw-preview" })).toBe(false);
    expect(validate({ ...consent, payload: { title: "must not be copied" } })).toBe(false);
  });

  it("keeps entitlement accounts provider-neutral with exact Free and Pro schedules", async () => {
    const schema = JSON.parse(
      await readFile(
        new URL("../schemas/v1/entitlement-account.schema.json", import.meta.url),
        "utf8",
      ),
    ) as object;
    const ajv = new Ajv2020({ strict: true });
    const addFormats = addFormatsModule.default as unknown as (instance: Ajv2020) => Ajv2020;
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const base = {
      schemaVersion: 1,
      id: "019d04cf-1f80-7000-8000-000000000020",
      userId: "019d04cf-1f80-7000-8000-000000000021",
      version: 1,
      effectiveAt: "2026-08-15T12:00:00.000Z",
    };

    expect(validate({ ...base, plan: "free" })).toBe(true);
    expect(
      validate({
        ...base,
        plan: "pro",
        accessThrough: "2026-09-15T12:00:00.000Z",
        graceThrough: "2026-09-18T12:00:00.000Z",
      }),
    ).toBe(true);
    expect(validate({ ...base, plan: "free", accessThrough: "2026-09-15T12:00:00.000Z" })).toBe(
      false,
    );
    expect(validate({ ...base, plan: "pro" })).toBe(false);
    expect(validate({ ...base, plan: "pro", accessThrough: "not-a-date" })).toBe(false);
    expect(validate({ ...base, plan: "pro", provider: "stripe" })).toBe(false);
    expect(validate({ ...base, version: Number.MAX_SAFE_INTEGER + 1, plan: "free" })).toBe(false);
  });

  it("keeps the portable candidate export complete and free of provider or object credentials", async () => {
    const schema = JSON.parse(
      await readFile(
        new URL("../schemas/v1/candidate-data-export.schema.json", import.meta.url),
        "utf8",
      ),
    ) as object;
    const ajv = new Ajv2020({ strict: true });
    const addFormats = addFormatsModule.default as unknown as (instance: Ajv2020) => Ajv2020;
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const exported = {
      schemaVersion: 1,
      format: "candidate-data-export-v1",
      exportId: "019d04cf-1f80-7000-8000-000000000040",
      policyVersion: "d1-synthetic-v1",
      generatedAt: "2026-08-25T15:00:00.000Z",
      candidate: {
        email: "candidate@example.test",
        createdAt: "2026-08-01T15:00:00.000Z",
        connectedAccounts: [],
      },
      profile: { preferences: null, facts: [] },
      documents: { resumes: [] },
      jobs: { reports: [] },
      matching: { savedJobs: [] },
      billing: {
        entitlement: {
          plan: "free",
          version: 0,
          effectiveAt: "2026-08-25T15:00:00.000Z",
        },
      },
      trust: {
        schemaVersion: 1,
        cases: [],
        caseEvents: [],
        contributorReputationEvidence: [],
      },
      audit: { events: [] },
    };

    expect(validate(exported)).toBe(true);
    expect(validateCandidateDataExportV1(exported)).toBe(true);
    const nativeResume = {
      id: exported.exportId,
      applicationId: exported.exportId,
      version: 1,
      baseDocumentId: exported.exportId,
      baseVersion: 1,
      baseSha256: "a".repeat(64),
      jobContextSha256: "b".repeat(64),
      state: "bound",
      createdAt: exported.generatedAt,
      contentSha256: "c".repeat(64),
      completedAtMs: 1,
      expiresAtMs: 1_800_001,
    };
    const withResume = (generation: object = nativeResume) => ({
      ...exported,
      documents: { ...exported.documents, nativeResumeGenerations: [generation] },
    });
    expect(validateCandidateDataExportV1(withResume())).toBe(true);
    expect(validateCandidateDataExportV1(withResume({ ...nativeResume, state: "abandoned" }))).toBe(
      true,
    );
    for (const forbidden of ["taskArn", "clusterArn", "configurationSha256", "blocks", "text"])
      expect(
        validateCandidateDataExportV1(withResume({ ...nativeResume, [forbidden]: "synthetic" })),
      ).toBe(false);
    expect(validateCandidateDataExportV1(withResume({ ...nativeResume, state: "missing" }))).toBe(
      false,
    );
    expect(validateCandidateDataExportV1(withResume({ ...nativeResume, baseVersion: 0 }))).toBe(
      false,
    );
    const partialResume: Record<string, unknown> = { ...nativeResume };
    delete partialResume.contentSha256;
    expect(validateCandidateDataExportV1(withResume(partialResume))).toBe(false);
    const nativeAdmission = {
      applicationId: exported.exportId,
      epochId: exported.exportId,
      createdAt: exported.generatedAt,
      sealedAt: exported.generatedAt,
    };
    const nativeAllocation = {
      id: exported.exportId,
      applicationId: exported.exportId,
      generationId: exported.exportId,
      epochId: exported.exportId,
      state: "retired",
      createdAt: exported.generatedAt,
      boundAt: exported.generatedAt,
      stoppedAtEpochMs: 1,
      observedAtEpochMs: 2,
    };
    const withNative = (
      allocation: object = nativeAllocation,
      admission: object = nativeAdmission,
    ) => ({
      ...exported,
      documents: {
        ...exported.documents,
        nativeMaterialAdmissions: [admission],
        nativeMaterialAllocations: [allocation],
      },
    });
    expect(validateCandidateDataExportV1(withNative())).toBe(true);
    for (const forbidden of ["taskArn", "clusterArn", "workId", "requestSha256", "paragraphs"])
      expect(
        validateCandidateDataExportV1(
          withNative({ ...nativeAllocation, [forbidden]: "synthetic" }),
        ),
      ).toBe(false);
    expect(
      validateCandidateDataExportV1(withNative({ ...nativeAllocation, state: "missing" })),
    ).toBe(false);
    expect(
      validateCandidateDataExportV1(withNative({ ...nativeAllocation, stoppedAtEpochMs: 0 })),
    ).toBe(false);
    expect(
      validateCandidateDataExportV1(
        withNative(nativeAllocation, { ...nativeAdmission, createdAt: "invalid" }),
      ),
    ).toBe(false);
    const trustCase = {
      id: "019d04cf-1f80-7000-8000-000000000050",
      contributionId: "019d04cf-1f80-7000-8000-000000000051",
      policyVersion: "synthetic-trust-v1",
      appealWindowMilliseconds: 1_000,
      state: "accepted",
      version: 4,
      appealCount: 1,
      adverseState: "rejected",
      adverseDecisionAt: exported.generatedAt,
      appealDeadlineAt: exported.generatedAt,
      pendingAppealEvidenceDigestSha256: null,
      lastAction: "appeal_reversed",
      lastActorKind: "reviewer",
      lastReasonCode: "decision_reversed",
      lastEvidenceDigestSha256: "a".repeat(64),
      createdAt: exported.generatedAt,
      updatedAt: exported.generatedAt,
    };
    const trustEvent = {
      caseId: trustCase.id,
      caseVersion: 4,
      contributionId: trustCase.contributionId,
      policyVersion: trustCase.policyVersion,
      priorState: "appeal_pending",
      resultingState: "accepted",
      action: "appeal_reversed",
      actorKind: "reviewer",
      reasonCode: "decision_reversed",
      evidenceDigestSha256: "a".repeat(64),
      occurredAt: exported.generatedAt,
    };
    for (const basis of [undefined, null, "b".repeat(64)]) {
      const additive = basis === undefined ? {} : { independentEvidenceDigestSha256: basis };
      const withTrust = {
        ...exported,
        trust: {
          ...exported.trust,
          cases: [{ ...trustCase, ...additive }],
          caseEvents: [{ ...trustEvent, ...additive }],
        },
      };
      expect(validateCandidateDataExportV1(withTrust)).toBe(true);
      expect(
        validateCandidateDataExportV1({
          ...withTrust,
          trust: {
            ...withTrust.trust,
            caseEvents: [
              { ...trustEvent, ...additive, eventId: "019d04cf-1f80-8000-8000-000000000052" },
            ],
          },
        }),
      ).toBe(true);
    }
    for (const extra of [
      { independentEvidenceDigestSha256: "bad" },
      { independentEvidenceDigestSha256: "A".repeat(64) },
      { reviewerId: trustCase.id },
      { secret: "forbidden" },
    ]) {
      expect(
        validateCandidateDataExportV1({
          ...exported,
          trust: { ...exported.trust, cases: [{ ...trustCase, ...extra }] },
        }),
      ).toBe(false);
      expect(
        validateCandidateDataExportV1({
          ...exported,
          trust: { ...exported.trust, caseEvents: [{ ...trustEvent, ...extra }] },
        }),
      ).toBe(false);
    }
    expect(validate({ ...exported, accessToken: "secret" })).toBe(false);
    expect(validateCandidateDataExportV1({ ...exported, accessToken: "secret" })).toBe(false);
    const { trust: _trust, ...withoutTrust } = exported;
    expect(validateCandidateDataExportV1(withoutTrust)).toBe(true);
    expect(
      validateCandidateDataExportV1({
        ...exported,
        trust: { ...exported.trust, reviewerId: "must-not-be-exported" },
      }),
    ).toBe(false);
    expect(
      validate({
        ...exported,
        candidate: { ...exported.candidate, subject: "provider-subject" },
      }),
    ).toBe(false);
    expect(
      validate({
        ...exported,
        documents: {
          resumes: [
            {
              id: "019d04cf-1f80-7000-8000-000000000041",
              fileName: "resume.pdf",
              mediaType: "application/pdf",
              sizeBytes: 10,
              sha256: "a".repeat(64),
              status: "parsed",
              createdAt: "2026-08-25T15:00:00.000Z",
              updatedAt: "2026-08-25T15:00:00.000Z",
              objectKey: "private/object",
            },
          ],
        },
      }),
    ).toBe(false);
  });

  it("exports the Applications section without internal identifiers, scope keys, or hiring outcomes", async () => {
    const schema = JSON.parse(
      await readFile(
        new URL("../schemas/v1/candidate-data-export.schema.json", import.meta.url),
        "utf8",
      ),
    ) as object;
    const ajv = new Ajv2020({ strict: true });
    const addFormats = addFormatsModule.default as unknown as (instance: Ajv2020) => Ajv2020;
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const at = "2026-09-18T12:00:00.000Z";
    const id = (suffix: string) => `019d04cf-1f80-7000-8000-0000000000${suffix}`;
    const base = {
      schemaVersion: 1,
      format: "candidate-data-export-v1",
      exportId: id("a0"),
      policyVersion: "d3-development-synthetic-v1",
      generatedAt: at,
      candidate: { email: "candidate@example.test", createdAt: at, connectedAccounts: [] },
      profile: { preferences: null, facts: [] },
      documents: { resumes: [] },
      jobs: { reports: [] },
      matching: { savedJobs: [] },
      billing: { entitlement: { plan: "free", version: 0, effectiveAt: at } },
      audit: { events: [] },
    };
    const field = {
      fieldKey: "contact.email",
      value: "candidate@example.test",
      origin: "confirmed_fact",
      sourceFactIds: [id("a1")],
      confidence: 0.99,
      disposition: "auto",
      reasons: [],
      requiresReview: false,
    };
    const applications = {
      schemaVersion: 1,
      applications: [
        {
          id: id("b0"),
          canonicalJobId: id("b1"),
          status: "applied",
          revision: 7,
          currentPacketId: id("b2"),
          createdAt: at,
          updatedAt: at,
        },
      ],
      packets: [
        {
          id: id("b2"),
          applicationId: id("b0"),
          version: 1,
          packetHash: "a".repeat(64),
          jobRevision: "b".repeat(64),
          formAdapterId: "greenhouse",
          formVariantId: "board-v1",
          formHash: "c".repeat(64),
          resumeHash: "d".repeat(64),
          createdAt: at,
          fields: [field, { ...field, fieldKey: "job.remote_preference", value: null }],
        },
      ],
      approvals: [
        {
          id: id("b3"),
          packetId: id("b2"),
          applicationId: id("b0"),
          packetHash: "a".repeat(64),
          acknowledgedFieldKeys: ["contact.email"],
          approvedAt: at,
          expiresAt: "2026-09-19T12:00:00.000Z",
        },
      ],
      attempts: [
        {
          id: id("b4"),
          applicationId: id("b0"),
          packetId: id("b2"),
          sequence: 1,
          status: "confirmed",
          adapterId: "greenhouse",
          adapterVersion: "1.0.0",
          startedAt: at,
          dispatchedAt: at,
          resolvedAt: at,
          evidenceKind: "provider_confirmation_page",
          evidenceObservedAt: at,
          evidenceProviderReference: "confirmation-123",
        },
      ],
      history: [
        {
          applicationId: id("b0"),
          seq: 1,
          kind: "application_created",
          toStatus: "preparing",
          occurredAt: at,
        },
      ],
    };
    const exported = {
      ...base,
      applications,
      audit: {
        events: [
          {
            owner: "applications",
            action: "applications.application_created",
            resourceType: "application",
            resourceId: id("b0"),
            occurredAt: at,
          },
        ],
      },
    };

    expect(validateCandidateDataExportV1(exported)).toBe(true);
    expect(validate(exported)).toBe(true);
    // Older exports never had the section, so its absence stays valid.
    expect(validateCandidateDataExportV1(base)).toBe(true);

    const rejected: Array<[string, unknown]> = [
      [
        "owner id",
        {
          ...applications,
          applications: [{ ...applications.applications[0], ownerUserId: id("c0") }],
        },
      ],
      [
        "scope key",
        { ...applications, attempts: [{ ...applications.attempts[0], scopeKey: "e".repeat(64) }] },
      ],
      [
        "consent id",
        { ...applications, approvals: [{ ...applications.approvals[0], consentId: id("c1") }] },
      ],
      [
        "evidence fingerprint",
        {
          ...applications,
          attempts: [{ ...applications.attempts[0], evidenceFingerprint: "f".repeat(64) }],
        },
      ],
      [
        "hiring outcome status",
        {
          ...applications,
          applications: [{ ...applications.applications[0], status: "interview_scheduled" }],
        },
      ],
      [
        "hiring outcome history",
        { ...applications, history: [{ ...applications.history[0], kind: "offer_received" }] },
      ],
      [
        "unknown packet field key",
        {
          ...applications,
          packets: [{ ...applications.packets[0], fields: [{ ...field, rawHtml: "<b>" }] }],
        },
      ],
      [
        "oversized value",
        {
          ...applications,
          packets: [
            { ...applications.packets[0], fields: [{ ...field, value: "x".repeat(20001) }] },
          ],
        },
      ],
      ["extra section key", { ...applications, recruiterMessages: [] }],
    ];
    for (const [label, section] of rejected) {
      expect(validateCandidateDataExportV1({ ...exported, applications: section }), label).toBe(
        false,
      );
    }
    expect(
      validateCandidateDataExportV1({
        ...exported,
        audit: { events: [{ ...exported.audit.events[0], owner: "recruiter" }] },
      }),
    ).toBe(false);
  });
});

describe("portable one-off document metadata", () => {
  it("exports only hashes or unresolved null document values", async () => {
    const validate = await exportDefinition("applicationsPacketField");
    const field = {
      fieldKey: "documents.cover_letter",
      value: "a".repeat(64),
      origin: "generated",
      sourceFactIds: ["019d04cf-1f80-7000-8000-000000000064"],
      confidence: 1,
      disposition: "review",
      reasons: ["generated_content"],
      requiresReview: true,
    };
    expect(validate(field)).toBe(true);
    expect(validate({ ...field, value: null })).toBe(true);
    expect(validate({ ...field, value: "Synthetic forbidden letter material" })).toBe(false);
    expect(
      validate({
        ...field,
        fieldKey: "documents.resume",
        value: "Synthetic forbidden resume material",
      }),
    ).toBe(false);
  });
});

describe("resume document layout", () => {
  async function validator() {
    const schema = JSON.parse(
      await readFile(new URL("../schemas/v1/resume-document.schema.json", import.meta.url), "utf8"),
    );
    const ajv = new Ajv2020({ strict: true });
    const addFormats = addFormatsModule.default as unknown as (instance: Ajv2020) => Ajv2020;
    addFormats(ajv);
    return ajv.compile(schema);
  }
  const block = (extra: Record<string, unknown> = {}) => ({
    index: 0,
    text: "Alex Example",
    startOffset: 0,
    endOffset: 12,
    ...extra,
  });
  const document = (blocks: unknown[], extra: Record<string, unknown> = {}) => ({
    documentId: "019d04cf-1f80-7000-8000-000000000001",
    version: 1,
    parserVersion: "synthetic-1",
    mediaType: "application/pdf",
    sourceSha256: "a".repeat(64),
    blocks,
    createdAt: "2026-10-21T12:00:00.000Z",
    ...extra,
  });
  const layout = {
    y: 52.9,
    runs: [{ x: 36, w: 92.1, size: 26, text: "Alex Example", bold: true, color: "#1155cc" }],
    rules: [{ x0: 36, x1: 576, dy: 6, h: 0.7 }],
  };

  it("accepts documents with and without layout", async () => {
    const validate = await validator();
    expect(validate(document([block()]))).toBe(true);
    expect(validate(document([block({ layout })], { page: { width: 612, height: 792 } }))).toBe(
      true,
    );
  });

  it.each([
    ["an unknown layout property", { ...layout, href: "https://example.test" }],
    ["a color that is not #rrggbb", { ...layout, runs: [{ ...layout.runs[0], color: "blue" }] }],
    ["a run without text", { ...layout, runs: [{ x: 1, w: 2, size: 12 }] }],
    ["no runs", { ...layout, runs: [] }],
    ["a rule below the allowed height", { ...layout, rules: [{ x0: 0, x1: 9, dy: 1, h: 40 }] }],
    ["a zone below 1", { ...layout, zone: 0 }],
    ["a zone above 32", { ...layout, zone: 33 }],
    ["a fractional zone", { ...layout, zone: 1.5 }],
  ])("refuses %s", async (_name, value) => {
    const validate = await validator();
    expect(
      validate(document([block({ layout: value })], { page: { width: 612, height: 792 } })),
    ).toBe(false);
  });

  it("accepts a reading zone from 1 to 32", async () => {
    const validate = await validator();
    for (const zone of [1, 2, 32])
      expect(
        validate(
          document([block({ layout: { ...layout, zone } })], { page: { width: 612, height: 792 } }),
        ),
      ).toBe(true);
  });

  it("refuses an absurd page size", async () => {
    const validate = await validator();
    expect(validate(document([block({ layout })], { page: { width: 90000, height: 792 } }))).toBe(
      false,
    );
  });
});

describe("portable export Notifications section (ADR-056)", () => {
  const at = "2026-10-23T12:00:00.000Z";
  const id = (suffix: string) => `019d04cf-1f80-7000-8000-0000000000${suffix}`;
  const base = {
    schemaVersion: 1,
    format: "candidate-data-export-v1",
    exportId: id("01"),
    policyVersion: "d4-development-synthetic-v1",
    generatedAt: at,
    candidate: { createdAt: at, connectedAccounts: [] },
    profile: { preferences: null, facts: [] },
    documents: { resumes: [] },
    jobs: { reports: [] },
    matching: { savedJobs: [] },
    billing: { entitlement: { plan: "free", version: 0, effectiveAt: at } },
    audit: { events: [] },
  };
  const notifications = {
    preferences: {
      version: 2,
      inAppEnabled: true,
      emailEnabled: true,
      pushEnabled: false,
      quietHours: { enabled: true, startMinute: 1320, endMinute: 420, timeZone: "UTC" },
      updatedAt: at,
    },
    inbox: [
      {
        id: id("10"),
        kind: "application_review_needed",
        urgency: "normal",
        state: "unread",
        applicationId: id("11"),
        createdAt: at,
        expiresAt: "2026-11-22T12:00:00.000+00:00",
      },
    ],
    emailDestination: {
      address: "person@example.com",
      state: "verified",
      verifiedAt: at,
      createdAt: at,
    },
    pushSubscriptions: [
      {
        id: id("12"),
        endpointHost: "fcm.googleapis.com",
        state: "active",
        createdAt: at,
        lastSuccessAt: null,
      },
    ],
    deliveries: [
      {
        inboxItemId: id("10"),
        channel: "email",
        state: "sent",
        outcomeCode: "delivered",
        createdAt: at,
        sentAt: at,
      },
    ],
  };

  it("accepts the exact export of the Notifications owner and its empty form", () => {
    expect(validateCandidateDataExportV1({ ...base, notifications })).toBe(true);
    expect(
      validateCandidateDataExportV1({
        ...base,
        notifications: {
          preferences: null,
          inbox: [],
          emailDestination: null,
          pushSubscriptions: [],
          deliveries: [],
        },
      }),
    ).toBe(true);
    // Exports from before the section existed stay valid.
    expect(validateCandidateDataExportV1(base)).toBe(true);
  });

  it.each([
    ["owner id", { inbox: [{ ...notifications.inbox[0], ownerUserId: id("20") }] }],
    [
      "push endpoint",
      {
        pushSubscriptions: [
          {
            ...notifications.pushSubscriptions[0],
            endpoint: "https://fcm.googleapis.com/fcm/send/x",
          },
        ],
      },
    ],
    [
      "dedupe key",
      { inbox: [{ ...notifications.inbox[0], dedupeKey: "application_review_needed:x:2" }] },
    ],
    [
      "verification code hash",
      {
        emailDestination: { ...notifications.emailDestination, codeHash: "a".repeat(64) },
      },
    ],
    [
      "provider reference",
      { deliveries: [{ ...notifications.deliveries[0], providerReference: "m" }] },
    ],
    ["unknown kind", { inbox: [{ ...notifications.inbox[0], kind: "interview_scheduled" }] }],
    ["unknown channel", { deliveries: [{ ...notifications.deliveries[0], channel: "sms" }] }],
    ["in-app switched off", { preferences: { ...notifications.preferences, inAppEnabled: false } }],
    ["missing part", { deliveries: undefined }],
  ])("rejects %s", (_label, override) => {
    expect(
      validateCandidateDataExportV1({ ...base, notifications: { ...notifications, ...override } }),
    ).toBe(false);
    expect(
      validateCandidateDataExportV1({
        ...base,
        notifications: { ...notifications, extra: true },
      }),
    ).toBe(false);
  });
});
