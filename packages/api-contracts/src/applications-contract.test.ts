import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { compileComponentValidator, contract } from "./index.js";

const hash = "a".repeat(64);
const now = "2026-09-18T12:00:00.000Z";

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    canonicalJobId: randomUUID(),
    status: "review_required",
    revision: 2,
    currentAction: "review_and_approve",
    attempts: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("Applications OpenAPI contract", () => {
  it("accepts scalar public material metadata and refuses content or private authority fields", () => {
    const validate = compileComponentValidator("ApplicationTemporaryMaterial");
    const reference = {
      schemaVersion: 1,
      kind: "tailored_resume",
      generationId: randomUUID(),
      version: 1,
      contentSha256: hash,
      completedAtMs: 1_000,
      expiresAtMs: 1_801_000,
    };
    expect(validate(reference)).toBe(true);
    expect(validate({ ...reference, kind: "cover_letter" })).toBe(true);
    for (const patch of [
      { text: "synthetic forbidden content" },
      { contentBase64: "c3ludGhldGlj" },
      { ownerUserId: randomUUID() },
      { applicationId: randomUUID() },
      { version: 0 },
      { version: 1.5 },
      { completedAtMs: -1 },
      { expiresAtMs: 8_640_000_000_000_001 },
      { generationId: "invalid" },
      { kind: "original_resume" },
    ]) {
      expect(validate({ ...reference, ...patch })).toBe(false);
    }
    const request = compileComponentValidator("PrepareApplicationPacketRequest");
    expect(request({ expectedRevision: 1, temporaryMaterials: [reference] })).toBe(false);
  });

  it("accepts legacy and native resume responses while refusing private metadata", () => {
    const temporaryMaterial = {
      schemaVersion: 1,
      kind: "tailored_resume",
      generationId: randomUUID(),
      version: 1,
      contentSha256: hash,
      completedAtMs: 1000,
      expiresAtMs: 1801000,
    };
    for (const [name, response] of [
      ["ApplicationResumePreview", { status: "ready", matchesPacket: true, contentSha256: hash }],
      [
        "ApplicationResumeFile",
        {
          format: "pdf",
          mediaType: "application/pdf",
          fileName: "resume.pdf",
          sha256: hash,
          sizeBytes: 4,
          contentSha256: hash,
          contentBase64: "dGVzdA==",
        },
      ],
    ] as const) {
      const validate = compileComponentValidator(name);
      expect(validate(response)).toBe(true);
      expect(validate({ ...response, temporaryMaterial })).toBe(true);
      expect(
        validate({
          ...response,
          temporaryMaterial: { ...temporaryMaterial, ownerUserId: randomUUID() },
        }),
      ).toBe(false);
      expect(
        validate({ ...response, temporaryMaterial: { ...temporaryMaterial, generationId: "bad" } }),
      ).toBe(false);
    }
  });

  it("accepts explicit bounded question/context selections and refuses unconfirmed or unbound requests", () => {
    const validate = compileComponentValidator("PrepareApplicationPacketRequest");
    const selection = {
      id: randomUUID(),
      version: 1,
      fieldKey: "authorization.us_authorized",
      context: "us",
      questionHash: hash,
      meaningConfirmed: true,
    };
    const request = {
      expectedRevision: 1,
      form: { adapterId: "greenhouse", variantId: "synthetic", formHash: hash },
      vaultSelections: [selection],
    };
    expect(validate(request)).toBe(true);
    expect(validate({ expectedRevision: 1 })).toBe(true);
    expect(validate({ ...request, form: undefined })).toBe(false);
    for (const patch of [
      { meaningConfirmed: false },
      { version: 0 },
      { version: 1.5 },
      { context: "x".repeat(121) },
      { questionHash: "not-a-hash" },
      { value: "private" },
    ]) {
      expect(validate({ ...request, vaultSelections: [{ ...selection, ...patch }] })).toBe(false);
    }
    expect(
      validate({ ...request, vaultSelections: Array.from({ length: 21 }, () => selection) }),
    ).toBe(false);
  });

  it("carries selected provenance only on explicitly reviewed vault fields", () => {
    const validate = compileComponentValidator("ApplicationPacketField");
    const id = randomUUID();
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
        questionHash: hash,
        meaningConfirmed: true,
        validUntilEpochMs: null,
      },
    };
    expect(validate(field)).toBe(true);
    expect(validate({ ...field, requiresReview: false })).toBe(false);
    expect(validate({ ...field, origin: "user_entered" })).toBe(false);
    expect(validate({ ...field, disposition: "auto" })).toBe(false);
    expect(
      validate({ ...field, vaultReference: { ...field.vaultReference, ciphertext: "opaque" } }),
    ).toBe(false);
  });

  it("never carries document material in a packet field", () => {
    const validate = compileComponentValidator("ApplicationPacketField");
    const field = {
      fieldKey: "documents.cover_letter",
      value: hash,
      origin: "generated",
      sourceFactIds: [randomUUID()],
      confidence: 1,
      disposition: "review",
      reasons: ["generated_content"],
      requiresReview: true,
    };
    for (const fieldKey of ["documents.cover_letter", "documents.resume"]) {
      expect(validate({ ...field, fieldKey })).toBe(true);
      expect(validate({ ...field, fieldKey, value: null })).toBe(true);
      for (const value of [
        "Synthetic forbidden material",
        "https://example.test/material",
        "A".repeat(64),
        [hash],
        true,
      ])
        expect(validate({ ...field, fieldKey, value })).toBe(false);
    }
  });

  it("guards every route with an exact applications scope and no-store responses", () => {
    const applicationPaths = Object.entries(contract.paths).filter(([path]) =>
      path.startsWith("/applications"),
    );
    expect(applicationPaths.length).toBe(25);
    for (const [, item] of applicationPaths) {
      for (const operation of Object.values(item) as Array<{
        security: Array<{ oidc: string[] }>;
        responses: Record<string, { headers?: Record<string, unknown> }>;
        parameters?: Array<{ name: string }>;
      }>) {
        const scopes = operation.security.flatMap((entry) => entry.oidc);
        expect(scopes).toHaveLength(1);
        expect(["applications:read", "applications:write"]).toContain(scopes[0]);
        const success = Object.entries(operation.responses).find(([code]) => code.startsWith("2"));
        expect(success?.[1].headers).toHaveProperty("Cache-Control");
      }
    }
  });

  it("requires an idempotency key on every state-changing command", () => {
    const commands = Object.entries(contract.paths)
      .filter(([path]) => path.startsWith("/applications"))
      .flatMap(([path, item]) =>
        Object.entries(item as Record<string, { parameters?: Array<{ name: string }> }>).map(
          ([method, operation]) => ({ path, method, operation }),
        ),
      );
    const withoutKey = commands
      .filter(({ operation }) => !operation.parameters?.some((p) => p.name === "Idempotency-Key"))
      .map(({ method, path }) => `${method.toUpperCase()} ${path}`)
      .sort();
    // Reads, the once-only write-ahead dispatch (which the store makes exactly-once itself), and
    // narrative answers, which store nothing so there is no result to replay (ADR-057).
    expect(withoutKey).toEqual([
      "GET /applications/{applicationId}",
      "GET /applications/{applicationId}/cover-letter",
      "GET /applications/{applicationId}/cover-letter/authorization",
      "GET /applications/{applicationId}/cover-letter/file",
      "GET /applications/{applicationId}/cover-letter/location",
      "GET /applications/{applicationId}/history",
      "GET /applications/{applicationId}/packet-preparations/{preparationId}",
      "GET /applications/{applicationId}/resume",
      "GET /applications/{applicationId}/resume/authorization",
      "GET /applications/{applicationId}/resume/file",
      "GET /applications/{applicationId}/resume/location",
      "GET /applications/{applicationId}/resume/original",
      "GET /applications/{applicationId}/resume/uploaded",
      "POST /applications/search",
      "POST /applications/{applicationId}/attempts/{attemptId}/dispatch",
      "POST /applications/{applicationId}/narrative-answers",
    ]);
  });

  it("has no route, schema, or enum that models a post-submission hiring outcome", () => {
    const serialized = JSON.stringify(
      Object.fromEntries(
        Object.entries(contract.paths).filter(([p]) => p.startsWith("/applications")),
      ),
    ).concat(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(contract.components.schemas).filter(
            ([name]) => name.startsWith("Application") || name.includes("Application"),
          ),
        ),
      ),
    );
    // `validation_rejected` is a provider form-validation result, not a hiring decision.
    const found = serialized
      .replaceAll("validation_rejected", "")
      .match(/interview|offer|reject|recruiter|hired|shortlist/gi);
    expect(found).toBeNull();
  });
});

describe("generated resume delivery is PDF only", () => {
  const material = {
    schemaVersion: 1,
    kind: "tailored_resume",
    generationId: randomUUID(),
    version: 1,
    contentSha256: hash,
    completedAtMs: 1_000,
    expiresAtMs: 1_801_000,
  };
  const file = {
    format: "pdf",
    mediaType: "application/pdf",
    fileName: "tailored-resume.pdf",
    sha256: hash,
    sizeBytes: 4,
    contentSha256: hash,
    contentBase64: "JVBERg==",
    temporaryMaterial: material,
  };

  it("accepts a PDF resume file and refuses Word in every resume delivery shape", () => {
    const resume = compileComponentValidator("ApplicationResumeFile");
    expect(resume(file), JSON.stringify(resume.errors)).toBe(true);
    const word = {
      ...file,
      format: "docx",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
    expect(resume(word)).toBe(false);
    expect(resume({ ...file, mediaType: word.mediaType })).toBe(false);
    const transferFile = compileComponentValidator("ApplicationNativeTransferFile");
    expect(transferFile(file)).toBe(true);
    expect(transferFile(word)).toBe(false);
    const begin = compileComponentValidator("ApplicationNativeTransferBegin");
    const request = {
      schema: "application-native-transfer-begin.v1",
      applicationId: randomUUID(),
      packetId: randomUUID(),
      packetHash: hash,
      format: "pdf",
    };
    expect(begin(request)).toBe(true);
    expect(begin({ ...request, format: "docx" })).toBe(false);
    const admission = compileComponentValidator("ApplicationNativeTransferAdmission");
    const granted = {
      schema: "application-native-transfer-admission.v1",
      nonce: hash,
      expiresAtMs: 5_000,
      applicationId: randomUUID(),
      packetId: randomUUID(),
      packetHash: hash,
      approvalId: randomUUID(),
      revision: 3,
      format: "pdf",
      materials: [material],
    };
    expect(admission(granted)).toBe(true);
    expect(admission({ ...granted, format: "docx" })).toBe(false);
  });

  it("accepts only the PDF query on the resume file route", () => {
    const route = contract.paths["/applications/{applicationId}/resume/file"].get;
    const format = route.parameters.find(
      (parameter: { name: string }) => parameter.name === "format",
    );
    expect(format?.schema.enum).toEqual(["pdf"]);
    expect(route.description).not.toMatch(/docx|word/iu);
  });

  it("keeps the candidate's own uploaded resume in its original format", () => {
    const uploaded = compileComponentValidator("ApplicationUploadedResumeFile");
    const original = {
      documentId: randomUUID(),
      fileName: "Candidate Resume.docx",
      format: "docx",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sha256: hash,
      sizeBytes: 1_200_000,
      contentBase64: "UEsDBA==",
    };
    expect(uploaded(original), JSON.stringify(uploaded.errors)).toBe(true);
    expect(uploaded({ ...original, format: "pdf", mediaType: "application/pdf" })).toBe(true);
    for (const bad of [
      { ...original, sizeBytes: 2 * 1024 * 1024 + 1 },
      { ...original, mediaType: "text/plain" },
      { ...original, format: "txt" },
      { ...original, fileName: "../resume.docx" },
      { ...original, fileName: "a\u0000b.docx" },
      { ...original, sha256: "short" },
      { ...original, generationId: randomUUID() },
      { ...original, contentBase64: "A".repeat(2_796_213) },
    ])
      expect(uploaded(bad), JSON.stringify(bad).slice(0, 80)).toBe(false);
  });

  it("allows an uploaded resume in an execution file only without a generation", () => {
    const execution = compileComponentValidator("ApplicationExecutionFile");
    const base = {
      format: "docx",
      mediaType: "application/octet-stream",
      sha256: hash,
      contentBase64: "UEsDBA==",
    };
    expect(execution({ ...base, kind: "uploaded_resume" })).toBe(true);
    expect(execution({ ...base, kind: "uploaded_resume", generationId: randomUUID() })).toBe(false);
    expect(execution({ ...base, kind: "tailored_resume" })).toBe(false);
    expect(execution({ ...base, kind: "tailored_resume", generationId: randomUUID() })).toBe(true);
    expect(execution({ ...base, kind: "cover_letter", generationId: randomUUID() })).toBe(true);
  });
});

describe("resume generation status and the apply intent", () => {
  it("accepts only coherent generation states", () => {
    const status = compileComponentValidator("ApplicationResumeGeneration");
    const at = "2026-10-20T12:00:00.000Z";
    for (const good of [
      { state: "not_requested" },
      { state: "preparing", requestedAt: at },
      { state: "ready", requestedAt: at },
      { state: "expired", requestedAt: at },
      { state: "failed", errorCode: "generation_failed", requestedAt: at },
      { state: "failed", errorCode: "no_resume" },
    ])
      expect(status(good), JSON.stringify(good)).toBe(true);
    for (const bad of [
      { state: "failed" },
      { state: "ready", errorCode: "generation_failed" },
      { state: "not_requested", requestedAt: at },
      { state: "running" },
      { state: "failed", errorCode: "boom" },
      { state: "preparing", taskArn: "arn:aws:ecs:x" },
    ])
      expect(status(bad), JSON.stringify(bad)).toBe(false);
  });

  it("lets a packet request an uploaded resume and nothing else", () => {
    const request = compileComponentValidator("PrepareApplicationPacketRequest");
    expect(request({ expectedRevision: 2 })).toBe(true);
    expect(request({ expectedRevision: 2, resume: "uploaded" })).toBe(true);
    expect(request({ expectedRevision: 2, resume: "generate" })).toBe(true);
    for (const resume of ["docx", "tailored", 1, null])
      expect(request({ expectedRevision: 2, resume }), String(resume)).toBe(false);
  });

  it("arms the extension with identifiers only", () => {
    const intent = compileComponentValidator("ApplicationApplyIntent");
    const value = {
      schema: "application-apply-intent.v1",
      applicationId: randomUUID(),
      jobId: randomUUID(),
      packetId: randomUUID(),
      packetHash: hash,
    };
    expect(intent(value)).toBe(true);
    for (const extra of [
      { token: "x" },
      { url: "https://example.test" },
      { resume: "uploaded" },
      { contentBase64: "AAAA" },
    ])
      expect(intent({ ...value, ...extra })).toBe(false);
    expect(intent({ ...value, schema: "application-apply-intent.v2" })).toBe(false);
    const receipt = compileComponentValidator("ApplicationApplyIntentReceipt");
    expect(receipt({ schema: "application-apply-intent-receipt.v1", expiresAtMs: 10 })).toBe(true);
    expect(receipt({ schema: "application-apply-intent-receipt.v1" })).toBe(false);
  });
});

describe("Application read models", () => {
  const validate = compileComponentValidator("Application");

  it("accepts explicit withheld metadata only and refuses accidental packet, approval or Apply authority", () => {
    const recovery = application({ packetAvailability: "withheld", currentAction: "re_review" });
    expect(validate(recovery), JSON.stringify(validate.errors)).toBe(true);
    for (const extra of [
      { packetAvailability: "unknown" },
      {
        currentPacket: {
          id: randomUUID(),
          version: 1,
          packetHash: hash,
          jobRevision: hash,
          fields: [],
          artifactHashes: {},
          createdAt: now,
        },
      },
      {
        approval: {
          id: randomUUID(),
          packetHash: hash,
          acknowledgedFieldKeys: [],
          approvedAt: now,
          expiresAt: now,
        },
      },
      { currentAction: "ready_to_submit" },
      { withdrawnValue: "synthetic" },
    ]) {
      if ("currentPacket" in extra || "approval" in extra)
        expect(validate(application(extra))).toBe(true);
      expect(validate({ ...recovery, ...extra })).toBe(false);
    }
  });

  it("accepts a minimal application and a full packet/approval/attempt view", () => {
    expect(validate(application())).toBe(true);
    expect(
      validate(
        application({
          status: "applied",
          currentAction: "none",
          currentPacket: {
            id: randomUUID(),
            version: 1,
            packetHash: hash,
            jobRevision: hash,
            form: { adapterId: "greenhouse", variantId: "synthetic-v1", formHash: hash },
            fields: [
              {
                fieldKey: "contact.email",
                value: "candidate@example.test",
                origin: "confirmed_fact",
                sourceFactIds: [randomUUID()],
                confidence: 0.99,
                disposition: "auto",
                reasons: [],
                requiresReview: false,
              },
            ],
            artifactHashes: { resume: hash },
            createdAt: now,
          },
          approval: {
            id: randomUUID(),
            packetHash: hash,
            acknowledgedFieldKeys: [],
            approvedAt: now,
            expiresAt: now,
          },
          attempts: [
            {
              id: randomUUID(),
              sequence: 1,
              status: "confirmed",
              adapterId: "greenhouse",
              adapterVersion: "1.0.0",
              startedAt: now,
              dispatchedAt: now,
              resolvedAt: now,
              confirmation: { kind: "provider_confirmation_page", observedAt: now },
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("rejects unknown statuses, outcome fields, extra properties, and bad revisions", () => {
    expect(validate(application({ status: "interviewing" }))).toBe(false);
    expect(validate(application({ interviewStatus: "scheduled" }))).toBe(false);
    expect(validate(application({ offer: "extended" }))).toBe(false);
    expect(validate(application({ revision: 0 }))).toBe(false);
    expect(validate(application({ currentAction: "wait_for_recruiter" }))).toBe(false);
  });
});

describe("Application command bodies", () => {
  it("creates only from a job identifier", () => {
    const validate = compileComponentValidator("CreateApplicationRequest");
    expect(validate({ jobId: randomUUID() })).toBe(true);
    expect(validate({ jobId: "nope" })).toBe(false);
    expect(validate({ jobId: randomUUID(), status: "applied" })).toBe(false);
  });

  it("prepares a packet with bounded candidate entries and no server-owned fields", () => {
    const validate = compileComponentValidator("PrepareApplicationPacketRequest");
    expect(validate({ expectedRevision: 1 })).toBe(true);
    expect(
      validate({
        expectedRevision: 1,
        userEntries: [{ fieldKey: "job.relocation", value: true }],
      }),
    ).toBe(true);
    expect(
      validate({ expectedRevision: 1, userEntries: [{ fieldKey: "Bad Key", value: 1 }] }),
    ).toBe(false);
    expect(validate({ expectedRevision: 1, packetHash: hash })).toBe(false);
    // The observed form binding is optional and must be complete when present.
    const form = { adapterId: "greenhouse", variantId: "board-v1", formHash: hash };
    expect(validate({ expectedRevision: 1, form })).toBe(true);
    expect(validate({ expectedRevision: 1, form: { adapterId: "greenhouse" } })).toBe(false);
    expect(validate({ expectedRevision: 1, form: { ...form, formHash: "abc" } })).toBe(false);
    expect(
      validate({
        expectedRevision: 1,
        userEntries: Array.from({ length: 101 }, () => ({ fieldKey: "job.relocation", value: 1 })),
      }),
    ).toBe(false);
  });

  it("approves one exact packet hash with explicit acknowledgements", () => {
    const validate = compileComponentValidator("ApproveApplicationPacketRequest");
    const valid = {
      expectedRevision: 3,
      packetHash: hash,
      acknowledgedFieldKeys: ["authorization.us_authorized"],
    };
    expect(validate(valid)).toBe(true);
    expect(validate({ ...valid, packetHash: "abc" })).toBe(false);
    expect(validate({ ...valid, acknowledgedFieldKeys: ["a.b", "a.b"] })).toBe(false);
    expect(validate({ ...valid, acknowledgeAll: true })).toBe(false);
    const { acknowledgedFieldKeys: _omitted, ...missing } = valid;
    expect(validate(missing)).toBe(false);
  });

  it("starts a submission only with the observed live form hash", () => {
    const validate = compileComponentValidator("StartApplicationSubmissionRequest");
    const valid = {
      expectedRevision: 4,
      adapterId: "greenhouse",
      adapterVersion: "1.0.0",
      observedFormHash: hash,
    };
    expect(validate(valid)).toBe(true);
    const { observedFormHash: _omitted, ...missing } = valid;
    expect(validate(missing)).toBe(false);
  });

  it("starts a manual submission from only the expected revision, no adapter or form fields at all", () => {
    const validate = compileComponentValidator("StartManualApplicationSubmissionRequest");
    expect(validate({ expectedRevision: 4 })).toBe(true);
    expect(validate({ expectedRevision: 4, adapterId: "greenhouse" })).toBe(false);
    expect(validate({ expectedRevision: 4, observedFormHash: hash })).toBe(false);
    expect(validate({})).toBe(false);
  });

  it("accepts only candidate-observable results and never a provider-asserted outcome", () => {
    const validate = compileComponentValidator("ApplicationSubmissionResultRequest");
    expect(
      validate({
        kind: "confirmed",
        confirmation: {
          kind: "provider_confirmation_page",
          observedAt: now,
          fingerprintSha256: hash,
        },
      }),
    ).toBe(true);
    // The user_attested kind is reserved for the candidate reconciliation route.
    expect(
      validate({
        kind: "confirmed",
        confirmation: { kind: "user_attested", observedAt: now, fingerprintSha256: hash },
      }),
    ).toBe(false);
    for (const kind of [
      "timeout",
      "transport_error",
      "challenge_required",
      "validation_rejected",
    ]) {
      expect(validate({ kind })).toBe(true);
    }
    expect(validate({ kind: "interview_invited" })).toBe(false);
    expect(validate({ kind: "confirmed" })).toBe(false);
  });

  it("requires a duplicate-risk acknowledgement to report not submitted", () => {
    const validate = compileComponentValidator("ReconcileApplicationAttemptRequest");
    expect(validate({ kind: "user_attested_not_submitted", acknowledgesDuplicateRisk: true })).toBe(
      true,
    );
    expect(
      validate({ kind: "user_attested_not_submitted", acknowledgesDuplicateRisk: false }),
    ).toBe(false);
    expect(
      validate({ kind: "user_attested_submitted", observedAt: now, fingerprintSha256: hash }),
    ).toBe(true);
  });
});

describe("Application history page", () => {
  const validate = compileComponentValidator("ApplicationHistoryPage");

  it("accepts technical entries and refuses outcome kinds", () => {
    const entry = { seq: 1, kind: "application_created", toStatus: "preparing", occurredAt: now };
    expect(validate({ entries: [entry], hasMore: false })).toBe(true);
    expect(validate({ entries: [{ ...entry, kind: "interview_scheduled" }], hasMore: false })).toBe(
      false,
    );
    expect(validate({ entries: [{ ...entry, toStatus: "offer_received" }], hasMore: false })).toBe(
      false,
    );
  });
});
