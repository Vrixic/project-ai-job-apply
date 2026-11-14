import { compileComponentValidator } from "@ai-job-apply/api-contracts";
import { describe, expect, it, vi } from "vitest";
import { assemblePacket } from "./packet.js";
import type { PreparationRecord, PreparationRequest } from "./preparation.js";
import {
  type ApplicationCoverLetters,
  type ApplicationStorePort,
  ApplicationsService,
  type ApplicationsServiceDependencies,
  ApplicationsUnavailableError,
  toApiPreparation,
} from "./service.js";
import { ApplicationNotFoundError, type ApplicationView, StalePacketError } from "./store.js";
import {
  APPLICATION_ID,
  definitions,
  HASH_A,
  HASH_B,
  JOB_ID,
  NOW,
  PACKET_ID,
  packetInputs,
  USER_ID,
} from "./test-support.js";

const preparation: PreparationRecord = {
  id: PACKET_ID,
  ownerUserId: USER_ID,
  applicationId: APPLICATION_ID,
  basePacketId: PACKET_ID,
  expectedRevision: 2,
  jobContextHash: HASH_A,
  confirmedFactsHash: HASH_B,
  noticeVersion: "bedrock-cover-letter.v1",
  approvedAt: NOW,
  expiresAt: new Date(NOW.getTime() + 900_000),
  generationClaimedAt: null,
  state: "queued",
  resultPacketId: null,
  errorCode: null,
  createdAt: NOW,
  updatedAt: NOW,
};
const request: PreparationRequest = {
  expectedRevision: 1,
  coverLetter: { disclosure: { noticeVersion: "bedrock-cover-letter.v1", acknowledged: true } },
};
const validateOperation = compileComponentValidator("ApplicationPacketPreparation");

function setup() {
  const view: ApplicationView = {
    application: {
      id: APPLICATION_ID,
      ownerUserId: USER_ID,
      canonicalJobId: JOB_ID,
      revision: 1,
      status: "preparing",
      currentPacketId: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    currentPacket: null,
    approval: null,
    attempts: [],
    currentAction: "prepare_packet",
  };
  const getApplication = vi.fn(async () => view);
  const packets = {
    prepare: vi.fn(async () => ({
      jobRevision: HASH_A,
      form: null,
      fields: [],
      artifactHashes: {},
    })),
  };
  const preparations = {
    replayPreparation: vi.fn<
      NonNullable<ApplicationsServiceDependencies["preparations"]>["replayPreparation"]
    >(async () => null),
    queuePreparation: vi.fn(async () => ({ replayed: false, preparation, view })),
    getPreparation: vi.fn(async () => preparation),
  };
  const letters: ApplicationCoverLetters = {
    context: vi.fn(async () => ({ jobContextHash: HASH_A, confirmedFactsHash: HASH_B })),
    preview: vi.fn(async () => ({ status: "no_cover_letter", matchesPacket: false }) as const),
    binding: vi.fn(async () => HASH_A),
    file: vi.fn<ApplicationCoverLetters["file"]>(async (_owner, _app, _hash, format) => ({
      format,
      mediaType:
        format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fileName: `cover-letter.${format}`,
      sha256: HASH_B,
      sizeBytes: 4,
      contentSha256: HASH_A,
      contentBase64: "dGVzdA==",
    })),
  };
  const dependencies: ApplicationsServiceDependencies = {
    store: { getApplication } as unknown as ApplicationStorePort,
    packets,
    bindings: { resolve: async () => ({ jobRevision: HASH_A, formHash: null }) },
    jobs: { isActive: async () => true },
    preparations,
    coverLetters: letters,
  };
  return {
    dependencies,
    service: new ApplicationsService(dependencies),
    view,
    getApplication,
    packets,
    preparations,
    letters,
  };
}

describe("owner-scoped cover-letter service", () => {
  it("accepts explicit opt-in through atomic persistence without generating inside HTTP", async () => {
    const fixture = setup();
    const operation = await fixture.service.prepareCoverLetter(
      USER_ID,
      APPLICATION_ID,
      request,
      "synthetic-key",
    );
    expect(operation).toEqual(toApiPreparation(preparation));
    expect(validateOperation(operation)).toBe(true);
    expect(fixture.preparations.queuePreparation).toHaveBeenCalledWith({
      ownerUserId: USER_ID,
      applicationId: APPLICATION_ID,
      request,
      idempotencyKey: "synthetic-key",
      context: { jobContextHash: HASH_A, confirmedFactsHash: HASH_B },
      packet: { jobRevision: HASH_A, form: null, fields: [], artifactHashes: {} },
    });
    expect(fixture.letters.file).not.toHaveBeenCalled();
  });

  it("replays before volatile evidence/base rendering, even when their ports are absent", async () => {
    const fixture = setup();
    const succeeded = { ...preparation, state: "succeeded" as const, resultPacketId: PACKET_ID };
    fixture.preparations.replayPreparation.mockResolvedValue(succeeded);
    delete fixture.dependencies.coverLetters;
    const result = await fixture.service.prepareCoverLetter(
      USER_ID,
      APPLICATION_ID,
      request,
      "synthetic-key",
    );
    expect(result.result).toEqual({ packetId: PACKET_ID, revision: 3 });
    expect(fixture.getApplication).not.toHaveBeenCalled();
    expect(fixture.packets.prepare).not.toHaveBeenCalled();
    expect(fixture.preparations.queuePreparation).not.toHaveBeenCalled();
    expect(validateOperation(result)).toBe(true);
  });

  it("status returns only immutable operation metadata without reading current application/provider", async () => {
    const fixture = setup();
    fixture.preparations.getPreparation.mockResolvedValue({
      ...preparation,
      state: "succeeded",
      resultPacketId: PACKET_ID,
    });
    expect((await fixture.service.preparation(USER_ID, APPLICATION_ID, PACKET_ID)).result).toEqual({
      packetId: PACKET_ID,
      revision: 3,
    });
    expect(fixture.preparations.getPreparation).toHaveBeenCalledWith(
      USER_ID,
      APPLICATION_ID,
      PACKET_ID,
    );
    expect(fixture.getApplication).not.toHaveBeenCalled();
    expect(fixture.letters.context).not.toHaveBeenCalled();
  });

  it("fails closed before acceptance when the generation context is unavailable", async () => {
    const fixture = setup();
    vi.mocked(fixture.letters.context).mockRejectedValue(new Error("Synthetic private failure"));
    await expect(
      fixture.service.prepareCoverLetter(USER_ID, APPLICATION_ID, request, "synthetic-key"),
    ).rejects.toThrow(ApplicationsUnavailableError);
    expect(fixture.preparations.queuePreparation).not.toHaveBeenCalled();
  });

  it("absent preparation wiring fails closed and never queues work", async () => {
    const fixture = setup();
    delete fixture.dependencies.preparations;
    await expect(
      fixture.service.prepareCoverLetter(USER_ID, APPLICATION_ID, request, "synthetic-key"),
    ).rejects.toThrow(ApplicationsUnavailableError);
    await expect(fixture.service.preparation(USER_ID, APPLICATION_ID, PACKET_ID)).rejects.toThrow(
      ApplicationsUnavailableError,
    );
    expect(fixture.preparations.queuePreparation).not.toHaveBeenCalled();
  });

  it("checks application ownership before absence or document reads", async () => {
    const fixture = setup();
    fixture.getApplication.mockRejectedValue(new ApplicationNotFoundError());
    await expect(fixture.service.coverLetterPreview(USER_ID, APPLICATION_ID)).rejects.toThrow(
      ApplicationNotFoundError,
    );
    await expect(fixture.service.coverLetterFile(USER_ID, APPLICATION_ID, "pdf")).rejects.toThrow(
      ApplicationNotFoundError,
    );
    expect(fixture.letters.preview).not.toHaveBeenCalled();
    expect(fixture.letters.file).not.toHaveBeenCalled();
  });

  it("reports absence without inventing a draft and refuses a file without a packet binding", async () => {
    const fixture = setup();
    expect(await fixture.service.coverLetterPreview(USER_ID, APPLICATION_ID)).toEqual({
      status: "no_cover_letter",
      matchesPacket: false,
    });
    await expect(fixture.service.coverLetterFile(USER_ID, APPLICATION_ID, "pdf")).rejects.toThrow(
      StalePacketError,
    );
    expect(fixture.letters.preview).not.toHaveBeenCalled();
    expect(fixture.letters.file).not.toHaveBeenCalled();
  });

  it("serves only the exact current packet hash and selected format", async () => {
    const fixture = setup();
    fixture.view.currentPacket = assemblePacket(
      packetInputs({ artifactHashes: { coverLetter: HASH_A } }),
      definitions,
    );
    expect(await fixture.service.coverLetterFile(USER_ID, APPLICATION_ID, "pdf")).toMatchObject({
      contentSha256: HASH_A,
      format: "pdf",
    });
    expect(fixture.letters.file).toHaveBeenCalledWith(USER_ID, APPLICATION_ID, HASH_A, "pdf");
    vi.mocked(fixture.letters.binding).mockResolvedValue(undefined);
    await expect(fixture.service.coverLetterFile(USER_ID, APPLICATION_ID, "pdf")).rejects.toThrow(
      StalePacketError,
    );
    expect(fixture.letters.file).toHaveBeenCalledTimes(1);
  });

  it("missing Documents port or transport failure cannot silently invalidate a present draft", async () => {
    const fixture = setup();
    fixture.view.currentPacket = assemblePacket(
      packetInputs({ artifactHashes: { coverLetter: HASH_A } }),
      definitions,
    );
    vi.mocked(fixture.letters.binding).mockRejectedValue(new Error("Synthetic private failure"));
    await expect(fixture.service.coverLetterFile(USER_ID, APPLICATION_ID, "pdf")).rejects.toThrow(
      ApplicationsUnavailableError,
    );
    delete fixture.dependencies.coverLetters;
    await expect(fixture.service.coverLetterPreview(USER_ID, APPLICATION_ID)).rejects.toThrow(
      ApplicationsUnavailableError,
    );
    await expect(fixture.service.coverLetterFile(USER_ID, APPLICATION_ID, "pdf")).rejects.toThrow(
      ApplicationsUnavailableError,
    );
  });

  it.each(["hash", "format"] as const)(
    "withholds a Documents file with the wrong %s",
    async (kind) => {
      const fixture = setup();
      fixture.view.currentPacket = assemblePacket(
        packetInputs({ artifactHashes: { coverLetter: HASH_A } }),
        definitions,
      );
      const file = await fixture.letters.file(USER_ID, APPLICATION_ID, HASH_A, "pdf");
      vi.mocked(fixture.letters.file).mockResolvedValue({
        ...file,
        ...(kind === "hash" ? { contentSha256: HASH_B } : { format: "docx" }),
      });
      await expect(fixture.service.coverLetterFile(USER_ID, APPLICATION_ID, "pdf")).rejects.toThrow(
        StalePacketError,
      );
    },
  );

  it("permits a stale preview for review but withholds a foreign hash or private transport failure", async () => {
    const fixture = setup();
    fixture.view.currentPacket = assemblePacket(
      packetInputs({ artifactHashes: { coverLetter: HASH_A } }),
      definitions,
    );
    const ready = {
      status: "ready",
      documentId: PACKET_ID,
      version: 1,
      contentSha256: HASH_A,
      matchesPacket: false,
      reviewRequired: true,
      paragraphs: [{ text: "Synthetic draft.", factIds: [PACKET_ID] }],
      model: {
        provider: "bedrock",
        model: "us.anthropic.claude-sonnet-4-6",
        version: "us.anthropic.claude-sonnet-4-6",
      },
      promptVersion: "cover_letter.v1",
    } as const;
    vi.mocked(fixture.letters.preview).mockResolvedValue({
      ...ready,
      paragraphs: ready.paragraphs.map((paragraph) => ({
        ...paragraph,
        factIds: [...paragraph.factIds],
      })),
    });
    expect(await fixture.service.coverLetterPreview(USER_ID, APPLICATION_ID)).toMatchObject({
      status: "ready",
      matchesPacket: false,
    });
    vi.mocked(fixture.letters.preview).mockResolvedValue({
      ...ready,
      contentSha256: HASH_B,
      paragraphs: [],
    });
    await expect(fixture.service.coverLetterPreview(USER_ID, APPLICATION_ID)).rejects.toThrow(
      ApplicationsUnavailableError,
    );
    vi.mocked(fixture.letters.preview).mockRejectedValue(
      new Error("Synthetic private transport failure"),
    );
    await expect(fixture.service.coverLetterPreview(USER_ID, APPLICATION_ID)).rejects.toThrow(
      ApplicationsUnavailableError,
    );
  });

  it("withholds provider text from failed or incomplete operation projections", () => {
    for (const state of ["queued", "running", "failed"] as const) {
      const projected = toApiPreparation({
        ...preparation,
        state,
        errorCode: state === "failed" ? "grounding_failed" : null,
      });
      expect(validateOperation(projected)).toBe(true);
      expect(projected.result).toBeUndefined();
      expect(JSON.stringify(projected)).not.toContain(USER_ID);
    }
  });
});
