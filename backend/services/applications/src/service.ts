import { createHash } from "node:crypto";
import type {
  ApplicationAttempt as ApiApplicationAttempt,
  Application,
  ApplicationCoverLetterFile,
  ApplicationCoverLetterPreview,
  ApplicationHistoryPage,
  ApplicationPacketPreparation,
  ApplicationPage,
  ApplicationResumeFile,
  ApplicationResumePreview,
  ApplicationSubmissionResultRequest,
  ApplicationSubmissionStart,
  ApplicationTemporaryMaterialAuthorization,
  ApplicationTemporaryMaterialLocation,
  ReconcileApplicationAttemptRequest,
} from "@ai-job-apply/api-contracts";
import { compileComponentValidator } from "@ai-job-apply/api-contracts";
import type { TemporaryMaterialReference } from "@ai-job-apply/domain";
import type {
  AdapterSubmissionResult,
  ConfirmationEvidence,
  ReconciliationEvidence,
} from "./attempt.js";
import type { FieldValue, ProposedField } from "./field-policy.js";
import {
  attemptMetrics,
  correctionMetrics,
  type MetricSink,
  safeRecord,
  versionToken,
} from "./metrics.js";
import { authorizeNativeMaterialRead } from "./native-material-read.js";
import {
  type ArtifactHashes,
  type CurrentBindings,
  type FormBinding,
  verifyPacketHash,
} from "./packet.js";
import type { PreparationContext, PreparationRecord, PreparationRequest } from "./preparation.js";
import type { RestrictedPacketPlaintext } from "./restricted-packet-cipher.js";
import { type ResumePreviewSource, tailoredFileName, withPacketMatch } from "./resume-preview.js";
import type {
  ApplicationRecord,
  ApplicationView,
  AttemptRecord,
  CommandResult,
  PostgresApplicationStore,
  StartAttemptResult,
} from "./store.js";
import { ApplicationIntegrityError, AttemptNotFoundError, StalePacketError } from "./store.js";
import {
  type ApplicationTemporaryMaterials,
  readBoundTemporaryCoverLetter,
} from "./temporary-cover-letter-read.js";
import { temporaryMaterialReasons } from "./temporary-material.js";

const validateMaterialLocation = compileComponentValidator("ApplicationTemporaryMaterialLocation");

/** The subset of the store the service needs; a fake implements it in unit tests. */
export type ApplicationStorePort = Pick<
  PostgresApplicationStore,
  | "createApplication"
  | "createPacket"
  | "approve"
  | "reopenForEdit"
  | "cancel"
  | "startAttempt"
  | "dispatchAttempt"
  | "recordResult"
  | "reconcile"
  | "getApplication"
  | "listApplications"
  | "getHistory"
>;

export interface PacketPreparation {
  /** SHA-256 of the job facts the packet is prepared against. */
  jobRevision: string;
  form: FormBinding | null;
  /** Proposals derived only from confirmed facts, the answer vault, and generated drafts. */
  fields: readonly ProposedField[];
  artifactHashes: ArtifactHashes;
  temporaryMaterials?: readonly TemporaryMaterialReference[];
}

import type { VaultSelection } from "./vault.js";

export interface UserEntry {
  fieldKey: string;
  value: FieldValue;
}

/**
 * Assembles packet proposals from owner truth (Profile facts and vault, Jobs, Documents). The
 * Applications service never reads another module's tables; adapters use versioned owner APIs.
 */
export interface PacketPreparationSource {
  prepare(input: {
    ownerUserId: string;
    application: ApplicationRecord;
    userEntries: readonly UserEntry[];
    vaultSelections?: readonly VaultSelection[];
    /** The form structure the extension observed and mapped against, when known. */
    form: FormBinding | null;
  }): Promise<PacketPreparation>;
}

/** Documents-owned read/context API. Generation is never performed by an HTTP read. */
export interface ApplicationCoverLetters {
  context(identity: { ownerUserId: string; applicationId: string }): Promise<PreparationContext>;
  preview(
    ownerUserId: string,
    applicationId: string,
    packetHash: string | undefined,
  ): Promise<ApplicationCoverLetterPreview>;
  file(
    ownerUserId: string,
    applicationId: string,
    packetHash: string,
    format: "pdf" | "docx",
  ): Promise<ApplicationCoverLetterFile>;
  binding(
    ownerUserId: string,
    applicationId: string,
    packetHash: string | undefined,
  ): Promise<string | undefined>;
}
export type ApplicationPreparations = Pick<
  PostgresApplicationStore,
  "queuePreparation" | "getPreparation" | "replayPreparation"
>;

/** Live job and artifact hashes that an approval must still match. */
export interface LiveBindingsSource {
  resolve(input: {
    ownerUserId: string;
    application: ApplicationRecord;
    formHash: string | null;
  }): Promise<CurrentBindings>;
}

/** Confirms an explicitly chosen job is a live canonical job before an application starts. */
export interface ApplicationJobGate {
  isActive(jobId: string, at: Date): Promise<boolean>;
}

export class ApplicationJobUnavailableError extends Error {
  constructor() {
    super("The job is not available to apply to");
    this.name = "ApplicationJobUnavailableError";
  }
}

export class ApplicationsUnavailableError extends Error {
  constructor() {
    super("Applications are unavailable");
    this.name = "ApplicationsUnavailableError";
  }
}

export class InvalidApplicationCursorError extends Error {
  constructor() {
    super("The application cursor is invalid");
    this.name = "InvalidApplicationCursorError";
  }
}

/** Owner-scoped API used by the gateway. Every method takes the authenticated owner. */
export interface ApplicationsApi {
  temporaryMaterialLocation?(
    ownerUserId: string,
    applicationId: string,
    generationId: string,
    signal?: AbortSignal,
  ): Promise<ApplicationTemporaryMaterialLocation>;
  temporaryMaterialAuthorization?(
    ownerUserId: string,
    applicationId: string,
    generationId: string,
    signal?: AbortSignal,
  ): Promise<ApplicationTemporaryMaterialAuthorization>;
  create(ownerUserId: string, jobId: string, idempotencyKey: string): Promise<Application>;
  search(
    ownerUserId: string,
    request: { limit?: number; cursor?: string; jobId?: string },
  ): Promise<ApplicationPage>;
  get(ownerUserId: string, applicationId: string): Promise<Application>;
  prepareCoverLetter(
    ownerUserId: string,
    applicationId: string,
    request: PreparationRequest,
    idempotencyKey: string,
  ): Promise<ApplicationPacketPreparation>;
  preparation(
    ownerUserId: string,
    applicationId: string,
    preparationId: string,
  ): Promise<ApplicationPacketPreparation>;
  coverLetterPreview(
    ownerUserId: string,
    applicationId: string,
    signal?: AbortSignal,
  ): Promise<ApplicationCoverLetterPreview>;
  coverLetterFile(
    ownerUserId: string,
    applicationId: string,
    format: "pdf" | "docx",
    signal?: AbortSignal,
  ): Promise<ApplicationCoverLetterFile>;
  /** The resume tailored for this application's job and whether the packet already carries it. */
  resumePreview(ownerUserId: string, applicationId: string): Promise<ApplicationResumePreview>;
  /** The tailored resume file the current packet carries; refused if it no longer matches. */
  resumeFile(
    ownerUserId: string,
    applicationId: string,
    format: ApplicationResumeFile["format"],
  ): Promise<ApplicationResumeFile>;
  history(
    ownerUserId: string,
    applicationId: string,
    page: { afterSeq?: number; limit?: number },
  ): Promise<ApplicationHistoryPage>;
  preparePacket(
    ownerUserId: string,
    applicationId: string,
    request: {
      expectedRevision: number;
      userEntries?: readonly UserEntry[];
      vaultSelections?: readonly VaultSelection[];
      form?: FormBinding;
    },
    idempotencyKey: string,
  ): Promise<Application>;
  approve(
    ownerUserId: string,
    applicationId: string,
    request: { expectedRevision: number; packetHash: string; acknowledgedFieldKeys: string[] },
    idempotencyKey: string,
  ): Promise<Application>;
  reopen(
    ownerUserId: string,
    applicationId: string,
    expectedRevision: number,
    idempotencyKey: string,
  ): Promise<Application>;
  cancel(
    ownerUserId: string,
    applicationId: string,
    expectedRevision: number,
    idempotencyKey: string,
  ): Promise<Application>;
  startSubmission(
    ownerUserId: string,
    applicationId: string,
    request: {
      expectedRevision: number;
      adapterId: string;
      adapterVersion: string;
      observedFormHash: string;
    },
    idempotencyKey: string,
  ): Promise<ApplicationSubmissionStart>;
  /**
   * D3-018: the candidate never used an adapter at all (no extension, no observed form) and is
   * recording a submission they completed by hand. The attempt starts already taken over; the
   * candidate then reconciles it exactly like an automated attempt's ambiguous result.
   */
  startManualSubmission(
    ownerUserId: string,
    applicationId: string,
    request: { expectedRevision: number },
    idempotencyKey: string,
  ): Promise<ApplicationSubmissionStart>;
  dispatchAttempt(
    ownerUserId: string,
    applicationId: string,
    attemptId: string,
  ): Promise<ApiApplicationAttempt>;
  recordResult(
    ownerUserId: string,
    applicationId: string,
    attemptId: string,
    result: ApplicationSubmissionResultRequest,
    idempotencyKey: string,
  ): Promise<Application>;
  reconcile(
    ownerUserId: string,
    applicationId: string,
    attemptId: string,
    reconciliation: ReconcileApplicationAttemptRequest,
    idempotencyKey: string,
  ): Promise<Application>;
}

export interface ApplicationsServiceDependencies {
  store: ApplicationStorePort;
  /** Exact owning JIT reader; absent until restricted storage/key capabilities are composed. */
  restrictedPackets?: Pick<PostgresApplicationStore, "readCurrentPacketValues">;
  packets: PacketPreparationSource;
  bindings: LiveBindingsSource;
  jobs: ApplicationJobGate;
  /** Tailored-resume preview; when absent the preview reports the service as unavailable. */
  resumes?: ResumePreviewSource;
  /** Absent until preparation persistence and owned Documents context/read boundaries are wired. */
  preparations?: ApplicationPreparations;
  coverLetters?: ApplicationCoverLetters;
  temporaryMaterials?: ApplicationTemporaryMaterials;
  /** Scalar native-read authorization only; independent of content ports, default off. */
  nativeReadAuthorizationsEnabled?: () => boolean;
  nativeMaterialLocations?: {
    resolve(reference: TemporaryMaterialReference, signal: AbortSignal): Promise<string | null>;
  };
  /** Optional privacy-safe measurement sink. Failures never affect a request. */
  metrics?: MetricSink;
  clock?: () => Date;
}

export class ApplicationsService implements ApplicationsApi {
  private readonly clock: () => Date;

  constructor(private readonly dependencies: ApplicationsServiceDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  async temporaryMaterialLocation(
    ownerUserId: string,
    applicationId: string,
    generationId: string,
    signal = new AbortController().signal,
  ): Promise<ApplicationTemporaryMaterialLocation> {
    const locations = this.dependencies.nativeMaterialLocations;
    if (!locations) throw new ApplicationsUnavailableError();
    const proof = await this.temporaryMaterialAuthorization(
      ownerUserId,
      applicationId,
      generationId,
      signal,
    );
    let origin: string | null;
    try {
      origin = await locations.resolve(
        { ...proof.temporaryMaterial, ownerUserId, applicationId },
        signal,
      );
    } catch {
      throw new ApplicationsUnavailableError();
    }
    if (!origin || signal.aborted) throw new ApplicationsUnavailableError();
    const current = await this.temporaryMaterialAuthorization(
      ownerUserId,
      applicationId,
      generationId,
      signal,
    );
    if (JSON.stringify(proof) !== JSON.stringify(current))
      throw new StalePacketError(["temporary_material_changed"]);
    const result = { ...current, origin };
    if (!validateMaterialLocation(result)) throw new ApplicationsUnavailableError();
    return result;
  }

  async temporaryMaterialAuthorization(
    ownerUserId: string,
    applicationId: string,
    generationId: string,
    signal = new AbortController().signal,
  ): Promise<ApplicationTemporaryMaterialAuthorization> {
    const enabled = this.dependencies.nativeReadAuthorizationsEnabled ?? (() => false);
    if (!enabled() || signal.aborted) throw new ApplicationsUnavailableError();
    const view = await this.dependencies.store.getApplication(ownerUserId, applicationId);
    const reference = view.currentPacket?.temporaryMaterials?.find(
      (ref) => ref.kind === "cover_letter" && ref.generationId === generationId,
    );
    if (!reference) throw new StalePacketError(["temporary_material_changed"]);
    const proof = await authorizeNativeMaterialRead({
      store: this.dependencies.store,
      ownerUserId,
      reference,
      signal,
      clock: this.clock,
    });
    if (!enabled() || signal.aborted) throw new ApplicationsUnavailableError();
    if (!proof) throw new StalePacketError(["temporary_material_changed"]);
    const { ownerUserId: _owner, applicationId: _application, ...metadata } = proof.reference;
    return {
      schemaVersion: 1,
      packetId: proof.packetId,
      packetHash: proof.packetHash,
      temporaryMaterial: metadata,
    };
  }

  async create(ownerUserId: string, jobId: string, idempotencyKey: string): Promise<Application> {
    if (!(await this.dependencies.jobs.isActive(jobId, this.clock()))) {
      throw new ApplicationJobUnavailableError();
    }
    const result = await this.dependencies.store.createApplication({
      ownerUserId,
      canonicalJobId: jobId,
      idempotencyKey,
    });
    if (!result.replayed) this.funnel("created");
    return this.present(ownerUserId, result.view);
  }

  async search(
    ownerUserId: string,
    request: { limit?: number; cursor?: string; jobId?: string },
  ): Promise<ApplicationPage> {
    const limit = request.limit ?? 25;
    const page = await this.dependencies.store.listApplications(ownerUserId, {
      limit,
      ...(request.cursor ? { after: decodeCursor(request.cursor) } : {}),
      ...(request.jobId ? { canonicalJobId: request.jobId } : {}),
    });
    const last = page.items.at(-1)?.application;
    const items: Application[] = [];
    for (const view of page.items) items.push(await this.present(ownerUserId, view));
    return {
      items,
      ...(page.hasMore && last ? { nextCursor: encodeCursor(last) } : {}),
    };
  }

  async get(ownerUserId: string, applicationId: string): Promise<Application> {
    return this.present(
      ownerUserId,
      await this.dependencies.store.getApplication(ownerUserId, applicationId),
    );
  }

  async resumePreview(
    ownerUserId: string,
    applicationId: string,
  ): Promise<ApplicationResumePreview> {
    const view = await this.dependencies.store.getApplication(ownerUserId, applicationId);
    const temporaryResume = view.currentPacket?.temporaryMaterials?.find(
      (reference) => reference.kind === "tailored_resume",
    );
    if (temporaryResume) {
      const reasons = temporaryMaterialReasons([temporaryResume], [temporaryResume], this.clock());
      if (reasons.length) throw new StalePacketError(reasons);
      if (view.application.status === "applied" || view.application.status === "cancelled")
        throw new StalePacketError(["temporary_material_changed"]);
      throw new ApplicationsUnavailableError();
    }
    const resumes = this.dependencies.resumes;
    if (!resumes) {
      return {
        status: "unavailable",
        unavailableReason: "service_unavailable",
        matchesPacket: false,
      };
    }
    let body: Awaited<ReturnType<ResumePreviewSource["preview"]>>;
    try {
      body = await resumes.preview({ ownerUserId, jobId: view.application.canonicalJobId });
    } catch {
      throw new ApplicationsUnavailableError();
    }
    return withPacketMatch(body, view.currentPacket?.artifactHashes.resume);
  }

  async prepareCoverLetter(
    ownerUserId: string,
    applicationId: string,
    request: PreparationRequest,
    idempotencyKey: string,
  ): Promise<ApplicationPacketPreparation> {
    const preparations = this.dependencies.preparations;
    if (!preparations) throw new ApplicationsUnavailableError();
    const command = {
      ownerUserId,
      applicationId,
      request: structuredClone(request),
      idempotencyKey,
    };
    // Owner and request identity are checked before volatile dependencies. A retry neither
    // renews disclosure nor assembles another packet, even after the application has changed.
    const prior = await preparations.replayPreparation(command);
    if (prior) return toApiPreparation(prior);
    const current = await this.dependencies.store.getApplication(ownerUserId, applicationId);
    const letters = this.dependencies.coverLetters;
    if (!letters) throw new ApplicationsUnavailableError();
    let context: PreparationContext;
    try {
      context = await letters.context({ ownerUserId, applicationId });
    } catch {
      throw new ApplicationsUnavailableError();
    }
    const packet = await this.dependencies.packets.prepare({
      ownerUserId,
      application: current.application,
      userEntries: command.request.userEntries ?? [],
      ...(command.request.vaultSelections
        ? { vaultSelections: command.request.vaultSelections }
        : {}),
      form: command.request.form ?? null,
    });
    const accepted = await preparations.queuePreparation({ ...command, context, packet });
    if (!accepted.replayed) this.funnel("packet_preparation_queued");
    return toApiPreparation(accepted.preparation);
  }

  async preparation(
    ownerUserId: string,
    applicationId: string,
    preparationId: string,
  ): Promise<ApplicationPacketPreparation> {
    const preparations = this.dependencies.preparations;
    if (!preparations) throw new ApplicationsUnavailableError();
    return toApiPreparation(
      await preparations.getPreparation(ownerUserId, applicationId, preparationId),
    );
  }

  async coverLetterPreview(
    ownerUserId: string,
    applicationId: string,
    signal?: AbortSignal,
  ): Promise<ApplicationCoverLetterPreview> {
    const view = await this.dependencies.store.getApplication(ownerUserId, applicationId);
    const hash = view.currentPacket?.artifactHashes.coverLetter;
    const reference = view.currentPacket?.temporaryMaterials?.find(
      (item) => item.kind === "cover_letter",
    );
    if (reference)
      return readBoundTemporaryCoverLetter({
        store: this.dependencies.store,
        materials: this.dependencies.temporaryMaterials,
        view,
        reference,
        clock: this.clock,
        ...(signal ? { signal } : {}),
        read: (port, fixed) => {
          if (!port.coverLetterPreview) throw new ApplicationsUnavailableError();
          return port.coverLetterPreview(ownerUserId, applicationId, fixed, signal);
        },
      });
    if (!hash) return { status: "no_cover_letter", matchesPacket: false };
    const letters = this.dependencies.coverLetters;
    if (!letters) throw new ApplicationsUnavailableError();
    try {
      const result = await letters.preview(ownerUserId, applicationId, hash);
      if (result.status === "ready" && result.contentSha256 !== hash)
        throw new ApplicationsUnavailableError();
      return result;
    } catch {
      throw new ApplicationsUnavailableError();
    }
  }

  async coverLetterFile(
    ownerUserId: string,
    applicationId: string,
    format: "pdf" | "docx",
    signal?: AbortSignal,
  ): Promise<ApplicationCoverLetterFile> {
    const view = await this.dependencies.store.getApplication(ownerUserId, applicationId);
    const hash = view.currentPacket?.artifactHashes.coverLetter;
    const reference = view.currentPacket?.temporaryMaterials?.find(
      (item) => item.kind === "cover_letter",
    );
    if (reference)
      return readBoundTemporaryCoverLetter({
        store: this.dependencies.store,
        materials: this.dependencies.temporaryMaterials,
        view,
        reference,
        clock: this.clock,
        ...(signal ? { signal } : {}),
        format,
        read: (port, fixed) => {
          if (!port.coverLetterFile) throw new ApplicationsUnavailableError();
          return port.coverLetterFile(ownerUserId, applicationId, fixed, format, signal);
        },
      });
    if (!hash) throw new StalePacketError(["cover_letter_changed"]);
    const letters = this.dependencies.coverLetters;
    if (!letters) throw new ApplicationsUnavailableError();
    try {
      if ((await letters.binding(ownerUserId, applicationId, hash)) !== hash)
        throw new StalePacketError(["cover_letter_changed"]);
      const file = await letters.file(ownerUserId, applicationId, hash, format);
      if (file.contentSha256 !== hash || file.format !== format)
        throw new StalePacketError(["cover_letter_changed"]);
      return file;
    } catch (error) {
      if (error instanceof StalePacketError) throw error;
      throw new ApplicationsUnavailableError();
    }
  }

  async resumeFile(
    ownerUserId: string,
    applicationId: string,
    format: ApplicationResumeFile["format"],
  ): Promise<ApplicationResumeFile> {
    const view = await this.dependencies.store.getApplication(ownerUserId, applicationId);
    const temporaryResume = view.currentPacket?.temporaryMaterials?.find(
      (reference) => reference.kind === "tailored_resume",
    );
    if (temporaryResume) {
      const reasons = temporaryMaterialReasons([temporaryResume], [temporaryResume], this.clock());
      if (reasons.length) throw new StalePacketError(reasons);
      if (view.application.status === "applied" || view.application.status === "cancelled")
        throw new StalePacketError(["temporary_material_changed"]);
      throw new ApplicationsUnavailableError();
    }
    const resumes = this.dependencies.resumes;
    if (!resumes) throw new ApplicationsUnavailableError();
    const packetHash = view.currentPacket?.artifactHashes.resume;
    // A file is served only for the exact resume the current packet carries, never a newer one.
    if (!packetHash) throw new StalePacketError(["resume_changed"]);
    let file: Awaited<ReturnType<ResumePreviewSource["file"]>>;
    try {
      file = await resumes.file({
        ownerUserId,
        jobId: view.application.canonicalJobId,
        format,
      });
    } catch {
      throw new ApplicationsUnavailableError();
    }
    if (!file || file.contentSha256 !== packetHash) throw new StalePacketError(["resume_changed"]);
    const { baseFileName, ...rest } = file;
    return { ...rest, fileName: tailoredFileName(baseFileName, format) };
  }

  async history(
    ownerUserId: string,
    applicationId: string,
    page: { afterSeq?: number; limit?: number },
  ): Promise<ApplicationHistoryPage> {
    const result = await this.dependencies.store.getHistory(ownerUserId, applicationId, page);
    return {
      entries: result.entries.map((entry) => ({
        seq: entry.seq,
        kind: entry.kind,
        ...(entry.fromStatus ? { fromStatus: entry.fromStatus } : {}),
        toStatus: entry.toStatus,
        ...(entry.packetId ? { packetId: entry.packetId } : {}),
        ...(entry.attemptId ? { attemptId: entry.attemptId } : {}),
        ...(entry.reasonCode ? { reasonCode: entry.reasonCode } : {}),
        occurredAt: entry.occurredAt.toISOString(),
      })),
      hasMore: result.hasMore,
    };
  }

  async preparePacket(
    ownerUserId: string,
    applicationId: string,
    request: {
      expectedRevision: number;
      userEntries?: readonly UserEntry[];
      vaultSelections?: readonly VaultSelection[];
      form?: FormBinding;
    },
    idempotencyKey: string,
  ): Promise<Application> {
    const snapshot = structuredClone(request);
    const current = await this.dependencies.store.getApplication(ownerUserId, applicationId);
    const preparation = await this.dependencies.packets.prepare({
      ownerUserId,
      application: current.application,
      userEntries: snapshot.userEntries ?? [],
      form: snapshot.form ?? null,
      ...(snapshot.vaultSelections ? { vaultSelections: snapshot.vaultSelections } : {}),
    });
    const result = await this.dependencies.store.createPacket({
      ownerUserId,
      applicationId,
      expectedRevision: snapshot.expectedRevision,
      idempotencyKey,
      packet: {
        jobRevision: preparation.jobRevision,
        form: preparation.form,
        fields: preparation.fields,
        artifactHashes: preparation.artifactHashes,
        ...(preparation.temporaryMaterials?.length
          ? { temporaryMaterials: preparation.temporaryMaterials }
          : {}),
      },
    });
    if (!result.replayed) {
      this.funnel("packet_prepared");
      const next = result.view.currentPacket;
      if (current.currentPacket && next) {
        const dimensions = {
          adapter: versionToken(next.form?.adapterId),
          adapterVersion: "unknown",
          variant: versionToken(next.form?.variantId),
        };
        for (const event of correctionMetrics(
          current.currentPacket.fields,
          next.fields,
          dimensions,
        )) {
          safeRecord(this.dependencies.metrics, event);
        }
      }
    }
    return this.present(ownerUserId, result.view);
  }

  async approve(
    ownerUserId: string,
    applicationId: string,
    request: { expectedRevision: number; packetHash: string; acknowledgedFieldKeys: string[] },
    idempotencyKey: string,
  ): Promise<Application> {
    const current = await this.dependencies.store.getApplication(ownerUserId, applicationId);
    const live = await this.dependencies.bindings.resolve({
      ownerUserId,
      application: current.application,
      formHash: current.currentPacket?.form?.formHash ?? null,
    });
    const result = await this.dependencies.store.approve({
      ownerUserId,
      applicationId,
      expectedRevision: request.expectedRevision,
      idempotencyKey,
      // The approval evidence is this single-use record; it is not a Profile consent reference.
      request: {
        packetHash: request.packetHash,
        consentId: approvalConsentId(idempotencyKey, applicationId),
        acknowledgedFieldKeys: request.acknowledgedFieldKeys,
      },
      current: live,
    });
    if (!result.replayed) {
      this.funnel("approved");
      const packet = result.view.currentPacket;
      const approval = result.view.approval;
      if (packet && approval) {
        safeRecord(this.dependencies.metrics, {
          name: "review_latency_ms",
          value: Math.max(0, approval.approvedAt.getTime() - packet.createdAt.getTime()),
          dimensions: { stage: "review_to_approval" },
        });
      }
    }
    return this.present(ownerUserId, result.view);
  }

  async reopen(
    ownerUserId: string,
    applicationId: string,
    expectedRevision: number,
    idempotencyKey: string,
  ): Promise<Application> {
    return this.command(
      ownerUserId,
      this.dependencies.store.reopenForEdit({
        ownerUserId,
        applicationId,
        expectedRevision,
        idempotencyKey,
      }),
    );
  }

  async cancel(
    ownerUserId: string,
    applicationId: string,
    expectedRevision: number,
    idempotencyKey: string,
  ): Promise<Application> {
    return this.command(
      ownerUserId,
      this.dependencies.store.cancel({
        ownerUserId,
        applicationId,
        expectedRevision,
        idempotencyKey,
      }),
    );
  }

  async startSubmission(
    ownerUserId: string,
    applicationId: string,
    request: {
      expectedRevision: number;
      adapterId: string;
      adapterVersion: string;
      observedFormHash: string;
    },
    idempotencyKey: string,
  ): Promise<ApplicationSubmissionStart> {
    const current = await this.dependencies.store.getApplication(ownerUserId, applicationId);
    const live = await this.dependencies.bindings.resolve({
      ownerUserId,
      application: current.application,
      formHash: request.observedFormHash,
    });
    const result: StartAttemptResult = await this.dependencies.store.startAttempt({
      ownerUserId,
      applicationId,
      expectedRevision: request.expectedRevision,
      idempotencyKey,
      current: live,
      adapterId: request.adapterId,
      adapterVersion: request.adapterVersion,
    });
    if (!result.replayed) {
      this.funnel(
        result.kind === "started" ? "submission_started" : "approval_invalidated",
        result.kind === "approval_invalidated" ? { reason: versionToken(result.reasons[0]) } : {},
      );
    }
    return result.kind === "started"
      ? {
          outcome: "started",
          attemptId: result.attempt.id,
          application: await this.present(ownerUserId, result.view),
        }
      : {
          outcome: "approval_invalidated",
          invalidationReasons: [...result.reasons] as NonNullable<
            ApplicationSubmissionStart["invalidationReasons"]
          >,
          application: await this.present(ownerUserId, result.view),
        };
  }

  async startManualSubmission(
    ownerUserId: string,
    applicationId: string,
    request: { expectedRevision: number },
    idempotencyKey: string,
  ): Promise<ApplicationSubmissionStart> {
    const current = await this.dependencies.store.getApplication(ownerUserId, applicationId);
    // No adapter observed anything, so there is no form to compare; a packet bound to an observed
    // form (the candidate did use the extension to prepare it) correctly invalidates approval here,
    // the same as any other changed binding.
    const live = await this.dependencies.bindings.resolve({
      ownerUserId,
      application: current.application,
      formHash: null,
    });
    const result: StartAttemptResult = await this.dependencies.store.startAttempt({
      ownerUserId,
      applicationId,
      expectedRevision: request.expectedRevision,
      idempotencyKey,
      current: live,
      adapterId: "manual",
      adapterVersion: "none",
      manual: true,
    });
    if (!result.replayed) {
      this.funnel(
        result.kind === "started" ? "manual_submission_started" : "approval_invalidated",
        result.kind === "approval_invalidated" ? { reason: versionToken(result.reasons[0]) } : {},
      );
    }
    return result.kind === "started"
      ? {
          outcome: "started",
          attemptId: result.attempt.id,
          application: await this.present(ownerUserId, result.view),
        }
      : {
          outcome: "approval_invalidated",
          invalidationReasons: [...result.reasons] as NonNullable<
            ApplicationSubmissionStart["invalidationReasons"]
          >,
          application: await this.present(ownerUserId, result.view),
        };
  }

  async dispatchAttempt(
    ownerUserId: string,
    applicationId: string,
    attemptId: string,
  ): Promise<ApiApplicationAttempt> {
    const current = await this.dependencies.store.getApplication(ownerUserId, applicationId);
    if (!current.attempts.some((attempt) => attempt.id === attemptId))
      throw new AttemptNotFoundError();
    const live = await this.dependencies.bindings.resolve({
      ownerUserId,
      application: current.application,
      // The dispatch endpoint carries no new observed form. Its original packet form binding
      // remains the context; the adapter must separately verify the live destination structure.
      formHash: current.currentPacket?.form?.formHash ?? null,
    });
    return toApiAttempt(
      await this.dependencies.store.dispatchAttempt({
        ownerUserId,
        applicationId,
        attemptId,
        current: live,
      }),
    );
  }

  async recordResult(
    ownerUserId: string,
    applicationId: string,
    attemptId: string,
    result: ApplicationSubmissionResultRequest,
    idempotencyKey: string,
  ): Promise<Application> {
    const settled = await this.dependencies.store.recordResult({
      ownerUserId,
      applicationId,
      attemptId,
      idempotencyKey,
      result: toAdapterResult(result),
    });
    if (!settled.replayed) this.attemptSettled(settled.view, attemptId);
    await this.discardTerminalMaterials(settled.view);
    return this.present(ownerUserId, settled.view);
  }

  async reconcile(
    ownerUserId: string,
    applicationId: string,
    attemptId: string,
    reconciliation: ReconcileApplicationAttemptRequest,
    idempotencyKey: string,
  ): Promise<Application> {
    const settled = await this.dependencies.store.reconcile({
      ownerUserId,
      applicationId,
      attemptId,
      idempotencyKey,
      reconciliation: toReconciliation(reconciliation),
    });
    if (!settled.replayed) this.attemptSettled(settled.view, attemptId);
    await this.discardTerminalMaterials(settled.view);
    return this.present(ownerUserId, settled.view);
  }

  private funnel(stage: string, extra: { reason?: string } = {}): void {
    safeRecord(this.dependencies.metrics, {
      name: "application_funnel",
      value: 1,
      dimensions: { stage, ...extra },
    });
  }

  private attemptSettled(view: ApplicationView, attemptId: string): void {
    const attempt = view.attempts.find((candidate) => candidate.id === attemptId);
    if (!attempt) return;
    const variant = view.currentPacket?.form?.variantId ?? "unknown";
    for (const event of attemptMetrics(attempt, variant)) {
      safeRecord(this.dependencies.metrics, event);
    }
    if (view.application.status === "applied") this.funnel("applied");
  }

  private async present(ownerUserId: string, view: ApplicationView): Promise<Application> {
    const fixed = structuredClone(view);
    if (fixed.application.ownerUserId !== ownerUserId) throw new ApplicationsUnavailableError();
    const packet = fixed.currentPacket;
    if (!packet?.restrictedValues) return toApiApplication(fixed);
    const reader = this.dependencies.restrictedPackets;
    if (!reader) throw new ApplicationsUnavailableError();
    let plaintext: RestrictedPacketPlaintext | undefined;
    try {
      plaintext = await reader.readCurrentPacketValues({
        ownerUserId,
        applicationId: fixed.application.id,
        packetId: packet.id,
        packetHash: packet.packetHash,
        expectedRevision: fixed.application.revision,
      });
      return toApiApplication(fixed, plaintext);
    } catch {
      throw new ApplicationsUnavailableError();
    } finally {
      if (plaintext?.values instanceof Map) plaintext.values.clear();
    }
  }

  private async command(
    ownerUserId: string,
    pending: Promise<CommandResult>,
  ): Promise<Application> {
    const result = await pending;
    await this.discardTerminalMaterials(result.view);
    return this.present(ownerUserId, result.view);
  }

  private async discardTerminalMaterials(view: ApplicationView): Promise<void> {
    if (view.application.status !== "applied" && view.application.status !== "cancelled") return;
    const owner = this.dependencies.temporaryMaterials;
    if (!owner?.discardApplication) {
      if (view.currentPacket?.temporaryMaterials?.length) throw new ApplicationsUnavailableError();
      return;
    }
    try {
      if (
        (await owner.discardApplication(view.application.ownerUserId, view.application.id)) !==
        "discarded"
      )
        throw new ApplicationsUnavailableError();
    } catch {
      throw new ApplicationsUnavailableError();
    }
  }
}

function approvalConsentId(idempotencyKey: string, applicationId: string): string {
  // Deterministic UUID-shaped identifier so an idempotent replay produces an identical request.
  const hex = createHash("sha256")
    .update(`approval
${applicationId}
${idempotencyKey}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function toAdapterResult(
  result: ApplicationSubmissionResultRequest,
): AdapterSubmissionResult {
  if (result.kind === "confirmed") {
    return {
      kind: "confirmed",
      evidence: {
        kind: result.confirmation.kind,
        observedAt: new Date(result.confirmation.observedAt),
        fingerprintSha256: result.confirmation.fingerprintSha256,
        ...(result.confirmation.providerReference
          ? { providerReference: result.confirmation.providerReference }
          : {}),
      },
    };
  }
  return { kind: result.kind };
}

export function toReconciliation(
  reconciliation: ReconcileApplicationAttemptRequest,
): ReconciliationEvidence {
  if (reconciliation.kind === "user_attested_submitted") {
    const evidence: ConfirmationEvidence = {
      kind: "user_attested",
      observedAt: new Date(reconciliation.observedAt),
      fingerprintSha256: reconciliation.fingerprintSha256,
    };
    return { kind: "user_attested_submitted", evidence };
  }
  return { kind: "user_attested_not_submitted", acknowledgesDuplicateRisk: true };
}

function toApiAttempt(attempt: AttemptRecord): ApiApplicationAttempt {
  return {
    id: attempt.id,
    sequence: attempt.sequence,
    status: attempt.status,
    adapterId: attempt.adapterId,
    adapterVersion: attempt.adapterVersion,
    startedAt: attempt.startedAt.toISOString(),
    ...(attempt.dispatchedAt ? { dispatchedAt: attempt.dispatchedAt.toISOString() } : {}),
    ...(attempt.resolvedAt ? { resolvedAt: attempt.resolvedAt.toISOString() } : {}),
    ...(attempt.evidence
      ? {
          confirmation: {
            kind: attempt.evidence.kind,
            observedAt: attempt.evidence.observedAt.toISOString(),
          },
        }
      : {}),
  };
}

/** Public projection accepts only an exact immediate owning read. Unwired protected reads
 * fail unavailable rather than rendering a saved answer as null or exposing storage metadata. */
export function toApiApplication(
  view: ApplicationView,
  plaintext?: RestrictedPacketPlaintext,
): Application {
  const packet = view.currentPacket;
  const approval = view.approval;
  const protectedFields = packet?.fields.filter((field) => field.protectedValue === true) ?? [];
  if (protectedFields.length) {
    if (
      !packet ||
      !verifyPacketHash(packet) ||
      !plaintext ||
      packet.userId !== view.application.ownerUserId ||
      packet.applicationId !== view.application.id ||
      view.application.currentPacketId !== packet.id ||
      plaintext.ownerUserId !== packet.userId ||
      plaintext.applicationId !== packet.applicationId ||
      plaintext.packetId !== packet.id ||
      plaintext.packetHash !== packet.packetHash ||
      plaintext.values.size !== protectedFields.length ||
      protectedFields.some((field) => !plaintext.values.has(field.fieldKey))
    )
      throw new ApplicationsUnavailableError();
    for (const field of protectedFields) {
      const value = plaintext.values.get(field.fieldKey);
      if (
        !(
          typeof value === "string" ||
          typeof value === "boolean" ||
          (typeof value === "number" && Number.isFinite(value)) ||
          (Array.isArray(value) &&
            value.every(
              (item) =>
                typeof item === "string" ||
                typeof item === "boolean" ||
                (typeof item === "number" && Number.isFinite(item)),
            ))
        )
      )
        throw new ApplicationsUnavailableError();
    }
  } else if (plaintext) throw new ApplicationsUnavailableError();
  return {
    id: view.application.id,
    canonicalJobId: view.application.canonicalJobId,
    status: view.application.status,
    revision: view.application.revision,
    currentAction: view.currentAction,
    ...(packet
      ? {
          currentPacket: {
            id: packet.id,
            version: packet.version,
            packetHash: packet.packetHash,
            jobRevision: packet.jobRevision,
            ...(packet.form ? { form: { ...packet.form } } : {}),
            fields: packet.fields.map((field) => ({
              ...(field.vaultReference ? { vaultReference: { ...field.vaultReference } } : {}),
              fieldKey: field.fieldKey,
              value: cloneValue(
                field.protectedValue === true
                  ? (plaintext?.values.get(field.fieldKey) as FieldValue)
                  : field.value,
              ),
              origin: field.origin,
              sourceFactIds: [...field.sourceFactIds],
              confidence: field.confidence,
              disposition: field.disposition,
              reasons: [...field.reasons],
              requiresReview: field.requiresReview,
            })),
            artifactHashes: { ...packet.artifactHashes },
            ...(packet.temporaryMaterials?.length
              ? {
                  temporaryMaterials: packet.temporaryMaterials.map(
                    ({ ownerUserId: _owner, applicationId: _application, ...reference }) => ({
                      ...reference,
                    }),
                  ),
                }
              : {}),
            createdAt: packet.createdAt.toISOString(),
          },
        }
      : {}),
    ...(approval
      ? {
          approval: {
            id: approval.id,
            packetHash: approval.packetHash,
            acknowledgedFieldKeys: [...approval.acknowledgedFieldKeys],
            approvedAt: approval.approvedAt.toISOString(),
            expiresAt: approval.expiresAt.toISOString(),
          },
        }
      : {}),
    attempts: view.attempts.map(toApiAttempt),
    createdAt: view.application.createdAt.toISOString(),
    updatedAt: view.application.updatedAt.toISOString(),
  };
}

/** Stable operation output: never substitute the application's newer mutable state. */
export function toApiPreparation(row: PreparationRecord): ApplicationPacketPreparation {
  if (
    (row.state === "succeeded" && !row.resultPacketId) ||
    (row.state === "failed" && !row.errorCode)
  )
    throw new ApplicationIntegrityError("preparation result");
  return {
    id: row.id,
    applicationId: row.applicationId,
    state: row.state,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.state === "succeeded" && row.resultPacketId
      ? { result: { packetId: row.resultPacketId, revision: row.expectedRevision + 1 } }
      : {}),
    ...(row.state === "failed" && row.errorCode ? { errorCode: row.errorCode } : {}),
  };
}

function cloneValue(
  value: FieldValue,
): string | number | boolean | (string | number | boolean)[] | null {
  return Array.isArray(value) ? [...value] : (value as string | number | boolean | null);
}

interface CursorPayload {
  u: string;
  i: string;
}

const CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function encodeCursor(record: ApplicationRecord): string {
  const payload: CursorPayload = { u: record.updatedAt.toISOString(), i: record.id };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeCursor(cursor: string): { updatedAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as CursorPayload;
    const updatedAt = new Date(parsed.u);
    if (
      typeof parsed.u !== "string" ||
      typeof parsed.i !== "string" ||
      Number.isNaN(updatedAt.getTime()) ||
      updatedAt.toISOString() !== parsed.u ||
      !CURSOR_ID.test(parsed.i)
    ) {
      throw new InvalidApplicationCursorError();
    }
    return { updatedAt, id: parsed.i };
  } catch {
    throw new InvalidApplicationCursorError();
  }
}
