import type {
  ApplicationCoverLetterFile,
  ApplicationCoverLetterPreview,
} from "@ai-job-apply/api-contracts";
import { compileComponentValidator } from "@ai-job-apply/api-contracts";
import {
  sameTemporaryMaterialReference,
  type TemporaryMaterialReference,
} from "@ai-job-apply/domain";
import { describe, expect, it, vi } from "vitest";
import { assemblePacket } from "./packet.js";
import {
  type ApplicationStorePort,
  ApplicationsService,
  ApplicationsUnavailableError,
} from "./service.js";
import { type ApplicationView, StalePacketError } from "./store.js";
import type { ApplicationTemporaryMaterials } from "./temporary-cover-letter-read.js";
import { temporaryResponseControl, temporaryResponseGuard } from "./temporary-response.js";
import {
  APPLICATION_ID,
  definitions,
  FACT_A,
  HASH_A,
  HASH_B,
  JOB_ID,
  NOW,
  PACKET_ID,
  packetInputs,
  USER_ID,
} from "./test-support.js";

function fixture() {
  let now = NOW.getTime();
  const reference: TemporaryMaterialReference = {
    schemaVersion: 1,
    kind: "cover_letter",
    generationId: JOB_ID,
    ownerUserId: USER_ID,
    applicationId: APPLICATION_ID,
    version: 1,
    contentSha256: HASH_A,
    completedAtMs: now - 1,
    expiresAtMs: now - 1 + 1_800_000,
  };
  const view: ApplicationView = {
    application: {
      id: APPLICATION_ID,
      ownerUserId: USER_ID,
      canonicalJobId: JOB_ID,
      status: "review_required",
      revision: 2,
      currentPacketId: PACKET_ID,
      createdAt: NOW,
      updatedAt: NOW,
    },
    currentPacket: assemblePacket(
      packetInputs({ artifactHashes: { coverLetter: HASH_A }, temporaryMaterials: [reference] }),
      definitions,
    ),
    approval: null,
    attempts: [],
    currentAction: "review_and_approve",
  };
  let latest = view;
  const preview: ApplicationCoverLetterPreview = {
    status: "ready",
    documentId: reference.generationId,
    version: 1,
    contentSha256: HASH_A,
    matchesPacket: true,
    reviewRequired: true,
    paragraphs: [{ text: "Synthetic TypeScript experience.", factIds: [FACT_A] }],
    model: { provider: "openai", model: "gpt-6-luna", version: "gpt-6-luna" },
    promptVersion: "cover_letter.v1",
  };
  const file: ApplicationCoverLetterFile = {
    format: "pdf",
    mediaType: "application/pdf",
    fileName: "cover-letter.pdf",
    sha256: HASH_B,
    sizeBytes: 4,
    contentSha256: HASH_A,
    contentBase64: "dGVzdA==",
  };
  const current = vi.fn(async () => ({ ...reference }));
  const release = vi.fn();
  const revalidate = vi.fn(async () => {
    const value = await current();
    return value !== null && sameTemporaryMaterialReference(reference, value);
  });
  const leased = { release, revalidate, signal: new AbortController().signal };
  const readPreview = vi.fn<NonNullable<ApplicationTemporaryMaterials["coverLetterPreview"]>>(
    async () => ({
      reference: { ...reference },
      value: preview,
      ...leased,
      isCurrent: () => true,
    }),
  );
  const readFile = vi.fn<NonNullable<ApplicationTemporaryMaterials["coverLetterFile"]>>(
    async () => ({
      reference: { ...reference },
      value: file,
      ...leased,
      isCurrent: () => true,
    }),
  );
  const materials: ApplicationTemporaryMaterials = {
    current,
    coverLetterPreview: readPreview,
    coverLetterFile: readFile,
  };
  const legacyPreview = vi.fn(async () => {
    throw Error("LegacyContentMustNotRun");
  });
  const legacyFile = vi.fn(async () => {
    throw Error("LegacyContentMustNotRun");
  });
  const getApplication = vi.fn(async () => latest);
  const dependencies = {
    store: { getApplication } as unknown as ApplicationStorePort,
    clock: () => new Date(now),
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
    temporaryMaterials: materials,
    coverLetters: {
      context: async () => {
        throw Error();
      },
      preview: legacyPreview,
      file: legacyFile,
      binding: async () => {
        throw Error();
      },
    },
    resumes: { preview: legacyPreview, file: legacyFile },
  };
  return {
    service: new ApplicationsService(dependencies),
    dependencies,
    view,
    reference,
    preview,
    file,
    current,
    leased,
    release,
    revalidate,
    readPreview,
    readFile,
    legacyPreview,
    legacyFile,
    getApplication,
    setNow: (at: number) => {
      now = at;
    },
    setLatest: (next: ApplicationView) => {
      latest = next;
    },
  };
}

describe("exact temporary cover-letter owner reads", () => {
  it.each(["preview", "file"] as const)(
    "returns %s with public original-completion metadata and no legacy read",
    async (kind) => {
      const f = fixture();
      const result =
        kind === "preview"
          ? await f.service.coverLetterPreview(USER_ID, APPLICATION_ID)
          : await f.service.coverLetterFile(USER_ID, APPLICATION_ID, "pdf");
      expect(
        compileComponentValidator(
          kind === "preview" ? "ApplicationCoverLetterPreview" : "ApplicationCoverLetterFile",
        )(result),
      ).toBe(true);
      expect(result).toHaveProperty("temporaryMaterial.generationId", f.reference.generationId);
      expect(result).toHaveProperty("temporaryMaterial.expiresAtMs", f.reference.expiresAtMs);
      expect(result).not.toHaveProperty("temporaryMaterial.ownerUserId");
      expect(f.current).toHaveBeenCalledTimes(2);
      expect(f.legacyPreview).not.toHaveBeenCalled();
      expect(f.legacyFile).not.toHaveBeenCalled();
      expect(temporaryResponseGuard(result)?.()).toBe(true);
    },
  );
  it.each(["at_expiry", "before_completion", "invalid_clock"])(
    "refuses %s before content or owner I/O",
    async (fault) => {
      const f = fixture();
      f.setNow(
        fault === "at_expiry"
          ? f.reference.expiresAtMs
          : fault === "before_completion"
            ? f.reference.completedAtMs - 1
            : Number.NaN,
      );
      await expect(f.service.coverLetterPreview(USER_ID, APPLICATION_ID)).rejects.toBeInstanceOf(
        StalePacketError,
      );
      expect(f.current).not.toHaveBeenCalled();
      expect(f.readPreview).not.toHaveBeenCalled();
    },
  );
  it.each(["applied", "cancelled"] as const)(
    "refuses terminal %s before owner reads",
    async (status) => {
      const f = fixture();
      f.view.application.status = status;
      await expect(f.service.coverLetterPreview(USER_ID, APPLICATION_ID)).rejects.toBeInstanceOf(
        StalePacketError,
      );
      expect(f.current).not.toHaveBeenCalled();
    },
  );
  it.each([
    "expiry",
    "cancelled",
    "applied",
    "packet_replaced",
    "memory_lost",
    "same_text_new_generation",
  ])("clears returned content when %s races a read", async (fault) => {
    const f = fixture();
    f.readPreview.mockImplementationOnce(async () => {
      if (fault === "expiry") f.setNow(f.reference.expiresAtMs);
      if (fault === "cancelled" || fault === "applied")
        f.setLatest({ ...f.view, application: { ...f.view.application, status: fault } });
      if (fault === "packet_replaced" && f.view.currentPacket)
        f.setLatest({ ...f.view, currentPacket: { ...f.view.currentPacket, id: JOB_ID } });
      if (fault === "memory_lost") f.current.mockResolvedValueOnce(null as never);
      if (fault === "same_text_new_generation")
        f.current.mockResolvedValueOnce({ ...f.reference, generationId: PACKET_ID });
      return {
        reference: { ...f.reference },
        value: f.preview,
        ...f.leased,
        isCurrent: () => true,
      };
    });
    await expect(f.service.coverLetterPreview(USER_ID, APPLICATION_ID)).rejects.toBeInstanceOf(
      StalePacketError,
    );
    expect(f.preview).toHaveProperty("paragraphs", []);
  });
  it("clears rendered bytes if the final owner recheck fails", async () => {
    const f = fixture();
    f.current
      .mockResolvedValueOnce({ ...f.reference })
      .mockRejectedValueOnce(Error("SyntheticPrivateBody"));
    await expect(f.service.coverLetterFile(USER_ID, APPLICATION_ID, "pdf")).rejects.toBeInstanceOf(
      ApplicationsUnavailableError,
    );
    expect(f.file.contentBase64).toBe("");
  });
  it.each(["preview", "file"] as const)(
    "clears %s if serialization happens at the original deadline",
    async (kind) => {
      const f = fixture();
      const result =
        kind === "preview"
          ? await f.service.coverLetterPreview(USER_ID, APPLICATION_ID)
          : await f.service.coverLetterFile(USER_ID, APPLICATION_ID, "pdf");
      f.setNow(f.reference.expiresAtMs);
      expect(temporaryResponseGuard(result)?.()).toBe(false);
      if ("paragraphs" in result) expect(result.paragraphs).toEqual([]);
      if ("contentBase64" in result) expect(result.contentBase64).toBe("");
    },
  );
  it("refuses a bound resume without invoking deterministic tailoring", async () => {
    const f = fixture();
    f.view.currentPacket = assemblePacket(
      packetInputs({
        artifactHashes: { resume: HASH_A },
        temporaryMaterials: [{ ...f.reference, kind: "tailored_resume" }],
      }),
      definitions,
    );
    await expect(f.service.resumePreview(USER_ID, APPLICATION_ID)).rejects.toBeInstanceOf(
      ApplicationsUnavailableError,
    );
    await expect(f.service.resumeFile(USER_ID, APPLICATION_ID, "pdf")).rejects.toBeInstanceOf(
      ApplicationsUnavailableError,
    );
    expect(f.legacyPreview).not.toHaveBeenCalled();
    expect(f.legacyFile).not.toHaveBeenCalled();
  });
  it("refuses missing content capability without falling back to saved content", async () => {
    const f = fixture();
    delete f.dependencies.temporaryMaterials.coverLetterPreview;
    await expect(f.service.coverLetterPreview(USER_ID, APPLICATION_ID)).rejects.toBeInstanceOf(
      ApplicationsUnavailableError,
    );
    expect(f.legacyPreview).not.toHaveBeenCalled();
  });
  it("refuses a foreign content generation and clears its bytes", async () => {
    const f = fixture();
    f.readFile.mockResolvedValueOnce({
      reference: { ...f.reference, ownerUserId: PACKET_ID },
      value: f.file,
      ...f.leased,
      isCurrent: () => true,
    });
    await expect(f.service.coverLetterFile(USER_ID, APPLICATION_ID, "pdf")).rejects.toBeInstanceOf(
      StalePacketError,
    );
    expect(f.file.contentBase64).toBe("");
  });
  it("withholds content if cancellation commits during the final memory recheck", async () => {
    const f = fixture();
    f.current.mockResolvedValueOnce({ ...f.reference }).mockImplementationOnce(async () => {
      f.setLatest({ ...f.view, application: { ...f.view.application, status: "cancelled" } });
      return { ...f.reference };
    });
    await expect(f.service.coverLetterPreview(USER_ID, APPLICATION_ID)).rejects.toBeInstanceOf(
      StalePacketError,
    );
    expect(f.preview).toHaveProperty("paragraphs", []);
  });
  it("checks the active memory lease after the final SQL read and before sending", async () => {
    const f = fixture();
    let live = true;
    f.readFile.mockResolvedValueOnce({
      reference: { ...f.reference },
      value: f.file,
      ...f.leased,
      isCurrent: () => live,
    });
    const result = await f.service.coverLetterFile(USER_ID, APPLICATION_ID, "pdf");
    live = false;
    expect(temporaryResponseGuard(result)?.()).toBe(false);
    expect(f.file.contentBase64).toBe("");
  });
  it("refuses a lost memory lease during the final SQL read", async () => {
    const f = fixture();
    let live = true;
    f.readFile.mockResolvedValueOnce({
      reference: { ...f.reference },
      value: f.file,
      ...f.leased,
      isCurrent: () => live,
    });
    f.getApplication.mockResolvedValueOnce(f.view).mockImplementationOnce(async () => {
      live = false;
      return f.view;
    });
    await expect(f.service.coverLetterFile(USER_ID, APPLICATION_ID, "pdf")).rejects.toBeInstanceOf(
      StalePacketError,
    );
    expect(f.file.contentBase64).toBe("");
  });
  it("returns expiry refusal for a bound resume before considering reader availability", async () => {
    const f = fixture();
    f.view.currentPacket = assemblePacket(
      packetInputs({
        artifactHashes: { resume: HASH_A },
        temporaryMaterials: [{ ...f.reference, kind: "tailored_resume" }],
      }),
      definitions,
    );
    f.setNow(f.reference.expiresAtMs);
    await expect(f.service.resumePreview(USER_ID, APPLICATION_ID)).rejects.toBeInstanceOf(
      StalePacketError,
    );
    await expect(f.service.resumeFile(USER_ID, APPLICATION_ID, "pdf")).rejects.toBeInstanceOf(
      StalePacketError,
    );
  });
  it("explicit response release clears content and closes the owned lease exactly once", async () => {
    const f = fixture();
    const result = await f.service.coverLetterFile(USER_ID, APPLICATION_ID, "pdf");
    const control = temporaryResponseControl(result);
    control?.release();
    control?.release();
    expect(f.release).toHaveBeenCalledTimes(1);
    expect(f.file.contentBase64).toBe("");
  });
  it("refuses an aborted request before private content I/O", async () => {
    const f = fixture();
    const request = new AbortController();
    request.abort();
    await expect(
      f.service.coverLetterPreview(USER_ID, APPLICATION_ID, request.signal),
    ).rejects.toBeInstanceOf(ApplicationsUnavailableError);
    expect(f.readPreview).not.toHaveBeenCalled();
  });
  it.each(["cancelled", "applied"] as const)(
    "discards %s scope after the owning commit and again on replay",
    async (status) => {
      const f = fixture();
      f.view.application.status = status;
      const command = vi.fn(async () => ({ view: f.view, replayed: false }));
      Object.assign(f.dependencies.store, {
        cancel: command,
        recordResult: command,
        reconcile: command,
      });
      const discardApplication = vi.fn(async () => "discarded" as const);
      f.dependencies.temporaryMaterials.discardApplication = discardApplication;
      if (status === "cancelled")
        await f.service.cancel(USER_ID, APPLICATION_ID, 2, "synthetic-cleanup");
      else
        await f.service.recordResult(
          USER_ID,
          APPLICATION_ID,
          PACKET_ID,
          {
            kind: "confirmed",
            confirmation: {
              kind: "provider_confirmation_page",
              observedAt: NOW.toISOString(),
              fingerprintSha256: HASH_B,
            },
          },
          "synthetic-cleanup",
        );
      expect(discardApplication).toHaveBeenCalledWith(USER_ID, APPLICATION_ID);
      expect(command.mock.invocationCallOrder[0]).toBeLessThan(
        discardApplication.mock.invocationCallOrder[0] ?? 0,
      );
      command.mockResolvedValueOnce({ view: f.view, replayed: true });
      await f.service.cancel(USER_ID, APPLICATION_ID, 2, "synthetic-cleanup");
      expect(discardApplication).toHaveBeenCalledTimes(2);
    },
  );
  it.each(["missing", "unavailable", "outage"])(
    "preserves committed terminal state when cleanup %s",
    async (fault) => {
      const f = fixture();
      const command = vi.fn(async () => {
        f.view.application.status = "cancelled";
        return { view: f.view, replayed: false };
      });
      Object.assign(f.dependencies.store, { cancel: command });
      if (fault !== "missing")
        f.dependencies.temporaryMaterials.discardApplication = async () => {
          if (fault === "outage") throw Error("SyntheticPrivateBody");
          return "unavailable";
        };
      await expect(
        f.service.cancel(USER_ID, APPLICATION_ID, 2, "synthetic-cleanup"),
      ).rejects.toBeInstanceOf(ApplicationsUnavailableError);
      expect(f.view.application.status).toBe("cancelled");
      expect(f.view.currentPacket?.temporaryMaterials).toEqual([f.reference]);
    },
  );
  it("does not dispose ambiguous submission memory or settle its evidence", async () => {
    const f = fixture();
    f.view.application.status = "reconciliation_required";
    const command = vi.fn(async () => ({ view: f.view, replayed: false }));
    Object.assign(f.dependencies.store, { recordResult: command });
    const discardApplication = vi.fn(async () => "discarded" as const);
    f.dependencies.temporaryMaterials.discardApplication = discardApplication;
    const result = await f.service.recordResult(
      USER_ID,
      APPLICATION_ID,
      PACKET_ID,
      { kind: "unrecognized_response" },
      "synthetic-ambiguous",
    );
    expect(result.status).toBe("reconciliation_required");
    expect(discardApplication).not.toHaveBeenCalled();
  });
  it("disposes positively attested submission after reconciliation", async () => {
    const f = fixture();
    f.view.application.status = "applied";
    Object.assign(f.dependencies.store, {
      reconcile: vi.fn(async () => ({ view: f.view, replayed: false })),
    });
    const discardApplication = vi.fn(async () => "discarded" as const);
    f.dependencies.temporaryMaterials.discardApplication = discardApplication;
    const result = await f.service.reconcile(
      USER_ID,
      APPLICATION_ID,
      PACKET_ID,
      { kind: "user_attested_submitted", observedAt: NOW.toISOString(), fingerprintSha256: HASH_B },
      "synthetic-reconcile",
    );
    expect(result.status).toBe("applied");
    expect(discardApplication).toHaveBeenCalledWith(USER_ID, APPLICATION_ID);
  });
});
