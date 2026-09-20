import { createHash } from "node:crypto";
import type {
  ApplicationAttempt as ApiApplicationAttempt,
  Application,
  ApplicationHistoryPage,
  ApplicationPage,
  ApplicationResumeFile,
  ApplicationResumePreview,
  ApplicationSubmissionResultRequest,
  ApplicationSubmissionStart,
  ReconcileApplicationAttemptRequest,
} from "@ai-job-apply/api-contracts";
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
import type { ArtifactHashes, CurrentBindings, FormBinding } from "./packet.js";
import { type ResumePreviewSource, tailoredFileName, withPacketMatch } from "./resume-preview.js";
import type {
  ApplicationRecord,
  ApplicationView,
  AttemptRecord,
  CommandResult,
  PostgresApplicationStore,
  StartAttemptResult,
} from "./store.js";
import { StalePacketError } from "./store.js";

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
}

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
    /** The form structure the extension observed and mapped against, when known. */
    form: FormBinding | null;
  }): Promise<PacketPreparation>;
}

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
  create(ownerUserId: string, jobId: string, idempotencyKey: string): Promise<Application>;
  search(
    ownerUserId: string,
    request: { limit?: number; cursor?: string; jobId?: string },
  ): Promise<ApplicationPage>;
  get(ownerUserId: string, applicationId: string): Promise<Application>;
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
  packets: PacketPreparationSource;
  bindings: LiveBindingsSource;
  jobs: ApplicationJobGate;
  /** Tailored-resume preview; when absent the preview reports the service as unavailable. */
  resumes?: ResumePreviewSource;
  /** Optional privacy-safe measurement sink. Failures never affect a request. */
  metrics?: MetricSink;
  clock?: () => Date;
}

export class ApplicationsService implements ApplicationsApi {
  private readonly clock: () => Date;

  constructor(private readonly dependencies: ApplicationsServiceDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
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
    return toApiApplication(result.view);
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
    return {
      items: page.items.map(toApiApplication),
      ...(page.hasMore && last ? { nextCursor: encodeCursor(last) } : {}),
    };
  }

  async get(ownerUserId: string, applicationId: string): Promise<Application> {
    return toApiApplication(
      await this.dependencies.store.getApplication(ownerUserId, applicationId),
    );
  }

  async resumePreview(
    ownerUserId: string,
    applicationId: string,
  ): Promise<ApplicationResumePreview> {
    const view = await this.dependencies.store.getApplication(ownerUserId, applicationId);
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

  async resumeFile(
    ownerUserId: string,
    applicationId: string,
    format: ApplicationResumeFile["format"],
  ): Promise<ApplicationResumeFile> {
    const view = await this.dependencies.store.getApplication(ownerUserId, applicationId);
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
      form?: FormBinding;
    },
    idempotencyKey: string,
  ): Promise<Application> {
    const current = await this.dependencies.store.getApplication(ownerUserId, applicationId);
    const preparation = await this.dependencies.packets.prepare({
      ownerUserId,
      application: current.application,
      userEntries: request.userEntries ?? [],
      form: request.form ?? null,
    });
    const result = await this.dependencies.store.createPacket({
      ownerUserId,
      applicationId,
      expectedRevision: request.expectedRevision,
      idempotencyKey,
      packet: {
        jobRevision: preparation.jobRevision,
        form: preparation.form,
        fields: preparation.fields,
        artifactHashes: preparation.artifactHashes,
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
    return toApiApplication(result.view);
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
    return toApiApplication(result.view);
  }

  async reopen(
    ownerUserId: string,
    applicationId: string,
    expectedRevision: number,
    idempotencyKey: string,
  ): Promise<Application> {
    return this.command(
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
          application: toApiApplication(result.view),
        }
      : {
          outcome: "approval_invalidated",
          invalidationReasons: [...result.reasons] as NonNullable<
            ApplicationSubmissionStart["invalidationReasons"]
          >,
          application: toApiApplication(result.view),
        };
  }

  async dispatchAttempt(
    ownerUserId: string,
    applicationId: string,
    attemptId: string,
  ): Promise<ApiApplicationAttempt> {
    return toApiAttempt(
      await this.dependencies.store.dispatchAttempt({ ownerUserId, applicationId, attemptId }),
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
    return toApiApplication(settled.view);
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
    return toApiApplication(settled.view);
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

  private async command(pending: Promise<CommandResult>): Promise<Application> {
    return toApiApplication((await pending).view);
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

export function toApiApplication(view: ApplicationView): Application {
  const packet = view.currentPacket;
  const approval = view.approval;
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
              fieldKey: field.fieldKey,
              value: cloneValue(field.value),
              origin: field.origin,
              sourceFactIds: [...field.sourceFactIds],
              confidence: field.confidence,
              disposition: field.disposition,
              reasons: [...field.reasons],
              requiresReview: field.requiresReview,
            })),
            artifactHashes: { ...packet.artifactHashes },
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
