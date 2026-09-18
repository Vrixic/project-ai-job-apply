import { readdir, readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import * as addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";
import { validateCandidateDataExportV1 } from "./candidate-data-export.js";

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

describe("domain schema registry", () => {
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
