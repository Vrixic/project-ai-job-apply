import { describe, expect, it, vi } from "vitest";
import type { FieldDefinition } from "./field-policy.js";
import { type ApplicationPacket, assemblePacket } from "./packet.js";
import { FactBackedPacketSource, jobRevisionHash } from "./packet-source.js";
import {
  type ApplicationStorePort,
  ApplicationsService,
  ApplicationsUnavailableError,
} from "./service.js";
import { type ApplicationRecord, type ApplicationView, StalePacketError } from "./store.js";
import {
  APPLICATION_ID,
  definitions as baseDefinitions,
  HASH_A,
  HASH_B,
  HASH_C,
  JOB_ID,
  NOW,
  PACKET_ID,
  packetInputs,
  USER_ID,
} from "./test-support.js";
import {
  packetUsesUploadedResume,
  UPLOADED_RESUME_MAXIMUM_BYTES,
  type UploadedResumeFileBody,
  type UploadedResumeSource,
  UploadedResumeTooLargeError,
} from "./uploaded-resume.js";

const DOCUMENT_ID = "0192f7c2-0000-7000-8000-0000000000d1";
const definitions: ReadonlyMap<string, FieldDefinition> = new Map([
  ...baseDefinitions,
  [
    "documents.resume",
    {
      key: "documents.resume",
      label: "Resume",
      valueType: "file",
      sensitivity: "confidential",
      answerPolicy: "explicit_each_time",
    } satisfies FieldDefinition,
  ],
]);

const application: ApplicationRecord = {
  id: APPLICATION_ID,
  ownerUserId: USER_ID,
  canonicalJobId: JOB_ID,
  status: "preparing",
  revision: 1,
  currentPacketId: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function source(options: {
  uploaded?: UploadedResumeSource["descriptor"] | undefined;
  artifacts?: () => Promise<{ resume?: string }>;
}) {
  const artifacts = vi.fn(options.artifacts ?? (async () => ({ resume: HASH_C })));
  return {
    artifacts,
    source: new FactBackedPacketSource({
      facts: async () => [],
      jobRevision: async () => jobRevisionHash({ title: "Engineer" }),
      artifacts,
      ...(options.uploaded ? { uploadedResume: options.uploaded } : {}),
      clock: () => NOW,
    }),
  };
}

const prepare = (
  built: ReturnType<typeof source>,
  resume?: "generate" | "uploaded",
  userEntries: Array<{ fieldKey: string; value: string }> = [],
) =>
  built.source.prepare({
    ownerUserId: USER_ID,
    application,
    userEntries,
    form: null,
    ...(resume ? { resume } : {}),
  });

describe("packet preparation with the candidate's uploaded resume", () => {
  it("binds the original file's digest and adds a reviewable resume field, without tailoring", async () => {
    const built = source({
      uploaded: async () => ({ documentId: DOCUMENT_ID, sha256: HASH_A, sizeBytes: 123_456 }),
    });
    const preparation = await prepare(built, "uploaded");
    expect(preparation.artifactHashes).toEqual({ resume: HASH_A });
    expect(preparation.temporaryMaterials).toBeUndefined();
    expect(preparation.fields).toEqual([
      {
        fieldKey: "documents.resume",
        value: HASH_A,
        origin: "confirmed_fact",
        sourceFactIds: [DOCUMENT_ID],
        sourceConfirmed: true,
        confidence: 1,
      },
    ]);
    // The tailoring/generation path is never touched for the candidate's own file.
    expect(built.artifacts).not.toHaveBeenCalled();
  });

  it("assembles into a packet that requires the resume's explicit acknowledgement", async () => {
    const built = source({
      uploaded: async () => ({ documentId: DOCUMENT_ID, sha256: HASH_A, sizeBytes: 1000 }),
    });
    const preparation = await prepare(built, "uploaded");
    const packet = assemblePacket(
      packetInputs({
        jobRevision: preparation.jobRevision,
        fields: preparation.fields,
        artifactHashes: preparation.artifactHashes,
      }),
      definitions,
    );
    expect(packet.fields).toHaveLength(1);
    expect(packet.fields[0]).toMatchObject({
      fieldKey: "documents.resume",
      value: HASH_A,
      disposition: "review",
      requiresReview: true,
      reasons: ["explicit_each_time"],
    });
    expect(packetUsesUploadedResume(packet)).toBe(true);
  });

  it("builds a packet without a resume when the candidate has none", async () => {
    const built = source({ uploaded: async () => undefined });
    const preparation = await prepare(built, "uploaded");
    expect(preparation.artifactHashes).toEqual({});
    expect(preparation.fields).toEqual([]);
  });

  it("refuses a file above the automatic-attachment limit", async () => {
    const built = source({
      uploaded: async () => ({
        documentId: DOCUMENT_ID,
        sha256: HASH_A,
        sizeBytes: UPLOADED_RESUME_MAXIMUM_BYTES + 1,
      }),
    });
    await expect(prepare(built, "uploaded")).rejects.toBeInstanceOf(UploadedResumeTooLargeError);
    const atLimit = source({
      uploaded: async () => ({
        documentId: DOCUMENT_ID,
        sha256: HASH_A,
        sizeBytes: UPLOADED_RESUME_MAXIMUM_BYTES,
      }),
    });
    await expect(prepare(atLimit, "uploaded")).resolves.toMatchObject({
      artifactHashes: { resume: HASH_A },
    });
  });

  it("is unavailable, never 'no resume', when the Documents owner cannot be read", async () => {
    await expect(prepare(source({}), "uploaded")).rejects.toBeInstanceOf(
      ApplicationsUnavailableError,
    );
    const failing = source({
      uploaded: async () => {
        throw new Error("SECRET transport detail");
      },
    });
    await expect(prepare(failing, "uploaded")).rejects.toBeInstanceOf(ApplicationsUnavailableError);
  });

  it("keeps the default and explicit generate paths on the tailoring hash", async () => {
    const uploaded = vi.fn(async () => ({
      documentId: DOCUMENT_ID,
      sha256: HASH_A,
      sizeBytes: 1,
    }));
    const built = source({ uploaded });
    for (const resume of [undefined, "generate"] as const) {
      const preparation = await prepare(built, resume);
      expect(preparation.artifactHashes).toEqual({ resume: HASH_C });
      expect(preparation.fields).toEqual([]);
    }
    expect(uploaded).not.toHaveBeenCalled();
  });

  it("lets a candidate-entered resume field win over the automatic one", async () => {
    const built = source({
      uploaded: async () => ({ documentId: DOCUMENT_ID, sha256: HASH_A, sizeBytes: 1 }),
    });
    const preparation = await prepare(built, "uploaded", [
      { fieldKey: "documents.resume", value: "x" },
    ]);
    expect(
      preparation.fields.filter((field) => field.fieldKey === "documents.resume"),
    ).toHaveLength(1);
  });
});

function packetFor(overrides: Parameters<typeof packetInputs>[0] = {}): ApplicationPacket {
  return assemblePacket(
    packetInputs({
      artifactHashes: { resume: HASH_A },
      fields: [
        {
          fieldKey: "documents.resume",
          value: HASH_A,
          origin: "confirmed_fact",
          sourceFactIds: [DOCUMENT_ID],
          sourceConfirmed: true,
          confidence: 1,
        },
      ],
      ...overrides,
    }),
    definitions,
  );
}

function viewOf(
  packet: ApplicationPacket | null,
  status: ApplicationView["application"]["status"] = "approved",
): ApplicationView {
  return {
    application: {
      id: APPLICATION_ID,
      ownerUserId: USER_ID,
      canonicalJobId: JOB_ID,
      status,
      revision: 3,
      currentPacketId: packet ? PACKET_ID : null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    currentPacket: packet,
    approval: null,
    attempts: [],
    currentAction: "ready_to_submit",
  };
}

function body(overrides: Partial<UploadedResumeFileBody> = {}): UploadedResumeFileBody {
  return {
    documentId: DOCUMENT_ID,
    sha256: HASH_A,
    sizeBytes: 8,
    fileName: "resume.pdf",
    format: "pdf",
    mediaType: "application/pdf",
    contentBase64: "JVBERi0xLjQ=",
    ...overrides,
  };
}

function service(view: ApplicationView, uploaded?: UploadedResumeSource, now: Date = NOW) {
  const store = { getApplication: vi.fn(async () => view) } as unknown as ApplicationStorePort;
  return new ApplicationsService({
    store,
    clock: () => now,
    packets: {
      prepare: async () => {
        throw Error();
      },
    },
    jobs: { isActive: async () => true },
    bindings: {
      resolve: async () => {
        throw Error();
      },
    },
    ...(uploaded ? { uploadedResumes: uploaded } : {}),
  });
}

describe("the uploaded resume file read", () => {
  const sourceOf = (
    file: UploadedResumeSource["file"],
    generationFile: UploadedResumeSource["generationFile"] = async () => undefined,
  ): UploadedResumeSource => ({
    descriptor: async () => undefined,
    file,
    generationFile,
  });

  it("returns the exact original bytes the packet binds, in its original format", async () => {
    const file = vi.fn(async () => body());
    const result = await service(viewOf(packetFor()), sourceOf(file)).uploadedResumeFile?.(
      USER_ID,
      APPLICATION_ID,
    );
    expect(file).toHaveBeenCalledWith(USER_ID, DOCUMENT_ID);
    expect(result).toEqual({
      documentId: DOCUMENT_ID,
      fileName: "resume.pdf",
      format: "pdf",
      mediaType: "application/pdf",
      sha256: HASH_A,
      sizeBytes: 8,
      contentBase64: "JVBERi0xLjQ=",
    });
  });

  it("keeps a Word original in its own format", async () => {
    const word = body({
      format: "docx",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fileName: "resume.docx",
    });
    const result = await service(
      viewOf(packetFor()),
      sourceOf(async () => word),
    ).uploadedResumeFile?.(USER_ID, APPLICATION_ID);
    expect(result).toMatchObject({ format: "docx" });
  });

  it.each([
    ["a changed file", () => body({ sha256: HASH_B })],
    ["another document", () => body({ documentId: "0192f7c2-0000-7000-8000-0000000000d2" })],
    ["an oversized file", () => body({ sizeBytes: UPLOADED_RESUME_MAXIMUM_BYTES + 1 })],
    ["a deleted file", () => undefined],
  ])("refuses %s as a stale packet", async (_name, make) => {
    const read = service(
      viewOf(packetFor()),
      sourceOf(async () => make()),
    );
    await expect(read.uploadedResumeFile?.(USER_ID, APPLICATION_ID)).rejects.toBeInstanceOf(
      StalePacketError,
    );
  });

  it("is unavailable when the Documents owner cannot be reached", async () => {
    const failing = service(
      viewOf(packetFor()),
      sourceOf(async () => {
        throw new Error("SECRET");
      }),
    );
    await expect(failing.uploadedResumeFile?.(USER_ID, APPLICATION_ID)).rejects.toBeInstanceOf(
      ApplicationsUnavailableError,
    );
    await expect(
      service(viewOf(packetFor())).uploadedResumeFile?.(USER_ID, APPLICATION_ID),
    ).rejects.toBeInstanceOf(ApplicationsUnavailableError);
  });

  it("never serves the file for a generated-resume packet, no packet, or a finished application", async () => {
    const read = vi.fn(async () => body());
    const generated = packetFor({
      fields: [],
      artifactHashes: { resume: HASH_A },
      temporaryMaterials: [
        {
          schemaVersion: 1,
          kind: "tailored_resume",
          generationId: JOB_ID,
          ownerUserId: USER_ID,
          applicationId: APPLICATION_ID,
          version: 1,
          contentSha256: HASH_A,
          completedAtMs: NOW.getTime() - 1,
          expiresAtMs: NOW.getTime() - 1 + 1_800_000,
        },
      ],
    });
    for (const view of [
      viewOf(generated),
      viewOf(null),
      viewOf(packetFor(), "applied"),
      viewOf(packetFor(), "cancelled"),
    ]) {
      await expect(
        service(view, sourceOf(read)).uploadedResumeFile?.(USER_ID, APPLICATION_ID),
      ).rejects.toBeInstanceOf(StalePacketError);
    }
    expect(read).not.toHaveBeenCalled();
  });
});

describe("the original behind a generated resume", () => {
  const GENERATION_ID = "0192f7c2-0000-7000-8000-0000000000c1";
  const generatedPacket = (expiresAtMs = NOW.getTime() - 1 + 1_800_000) =>
    packetFor({
      fields: [],
      artifactHashes: { resume: HASH_C },
      temporaryMaterials: [
        {
          schemaVersion: 1,
          kind: "tailored_resume",
          generationId: GENERATION_ID,
          ownerUserId: USER_ID,
          applicationId: APPLICATION_ID,
          version: 1,
          contentSha256: HASH_C,
          completedAtMs: NOW.getTime() - 1,
          expiresAtMs,
        },
      ],
    });
  const sourceOf = (generationFile: UploadedResumeSource["generationFile"]) => {
    const file = vi.fn(async () => body());
    return { file, source: { descriptor: async () => undefined, file, generationFile } };
  };

  it("serves the original of the packet's generated resume, named by its generation", async () => {
    const generationFile = vi.fn(async () => body());
    const { source, file } = sourceOf(generationFile);
    const result = await service(viewOf(generatedPacket()), source).generatedResumeOriginal?.(
      USER_ID,
      APPLICATION_ID,
    );
    expect(generationFile).toHaveBeenCalledWith(USER_ID, APPLICATION_ID, GENERATION_ID);
    // The caller never picks a document: the by-id read is not used.
    expect(file).not.toHaveBeenCalled();
    expect(result).toEqual({
      documentId: DOCUMENT_ID,
      fileName: "resume.pdf",
      format: "pdf",
      mediaType: "application/pdf",
      sha256: HASH_A,
      sizeBytes: 8,
      contentBase64: "JVBERi0xLjQ=",
    });
  });

  it("is the opposite of the attach read: the same packet is served here and refused there", async () => {
    const { source } = sourceOf(async () => body());
    const generated = service(viewOf(generatedPacket()), source);
    await expect(
      generated.generatedResumeOriginal?.(USER_ID, APPLICATION_ID),
    ).resolves.toMatchObject({ documentId: DOCUMENT_ID });
    await expect(generated.uploadedResumeFile?.(USER_ID, APPLICATION_ID)).rejects.toBeInstanceOf(
      StalePacketError,
    );
  });

  const PAST_DEADLINE = new Date(NOW.getTime() + 1_800_000);
  it.each([
    ["a packet bound to the uploaded resume", () => viewOf(packetFor()), NOW],
    ["no packet", () => viewOf(null), NOW],
    ["a generated resume past its deadline", () => viewOf(generatedPacket()), PAST_DEADLINE],
    ["an applied application", () => viewOf(generatedPacket(), "applied"), NOW],
    ["a cancelled application", () => viewOf(generatedPacket(), "cancelled"), NOW],
  ])("refuses %s as a stale packet and reads nothing", async (_name, view, now) => {
    const generationFile = vi.fn(async () => body());
    const { source } = sourceOf(generationFile);
    await expect(
      service(view(), source, now).generatedResumeOriginal?.(USER_ID, APPLICATION_ID),
    ).rejects.toBeInstanceOf(StalePacketError);
    expect(generationFile).not.toHaveBeenCalled();
  });

  it.each([
    ["an original that is gone or has been replaced", () => undefined],
    ["an oversized original", () => body({ sizeBytes: UPLOADED_RESUME_MAXIMUM_BYTES + 1 })],
  ])("refuses %s as a stale packet", async (_name, make) => {
    const { source } = sourceOf(async () => make());
    await expect(
      service(viewOf(generatedPacket()), source).generatedResumeOriginal?.(USER_ID, APPLICATION_ID),
    ).rejects.toBeInstanceOf(StalePacketError);
  });

  it("is unavailable when the Documents owner cannot be reached or is not wired", async () => {
    const { source } = sourceOf(async () => {
      throw new Error("SECRET");
    });
    await expect(
      service(viewOf(generatedPacket()), source).generatedResumeOriginal?.(USER_ID, APPLICATION_ID),
    ).rejects.toBeInstanceOf(ApplicationsUnavailableError);
    await expect(
      service(viewOf(generatedPacket())).generatedResumeOriginal?.(USER_ID, APPLICATION_ID),
    ).rejects.toBeInstanceOf(ApplicationsUnavailableError);
  });
});

describe("uploaded packet recognition", () => {
  it("is false without a packet, for a generated resume, and for legacy tailored hashes", () => {
    expect(packetUsesUploadedResume(null)).toBe(false);
    expect(packetUsesUploadedResume(undefined)).toBe(false);
    const legacy = assemblePacket(
      packetInputs({ artifactHashes: { resume: HASH_C }, fields: [] }),
      definitions,
    );
    expect(packetUsesUploadedResume(legacy)).toBe(false);
  });

  it("requires the field's value to be the bound artifact hash", () => {
    const packet = packetFor();
    const forged = {
      ...packet,
      artifactHashes: { resume: HASH_B },
    } as ApplicationPacket;
    expect(packetUsesUploadedResume(packet)).toBe(true);
    expect(packetUsesUploadedResume(forged)).toBe(false);
  });
});
