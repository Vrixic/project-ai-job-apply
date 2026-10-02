import { COVER_LETTER_DISCLOSURE_VERSION } from "@ai-job-apply/api-contracts";
import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import {
  type AdapterSubmissionResult,
  type ApplicationAttempt,
  AttemptRefusedError,
  type AttemptStatus,
  type ConfirmationEvidence,
  classifySubmissionResult,
  markDispatched,
  planAttemptStart,
  type ReconciliationEvidence,
  reconcileAttempt,
  recoverStaleAttempt,
  submissionScopeKey,
} from "./attempt.js";
import { canonicalHash } from "./canonical.js";
import { type CurrentAction, deriveCurrentAction } from "./current-action.js";
import type { FieldDefinition } from "./field-policy.js";
import {
  type ApplicationPacket,
  type ApprovalInvalidReason,
  type ApprovalRequest,
  type ArtifactHashes,
  approvePacket,
  assemblePacket,
  type CurrentBindings,
  evaluateApproval,
  evaluateBindings,
  type FormBinding,
  type PacketApproval,
  type PacketFieldEntry,
  type PacketInputs,
  PacketInvariantError,
  verifyPacketHash,
} from "./packet.js";
import {
  type GenerationClaim,
  type PreparationContext,
  type PreparationFailureCode,
  PreparationNotFoundError,
  type PreparationRecord,
  type PreparationRequest,
} from "./preparation.js";
import {
  isPreparationFunctionArn,
  MAX_PREPARATION_DISPATCH_BATCH,
  matchesPreparationExecutionArn,
  PREPARATION_DISPATCH_LEASE_MS,
  type PreparationDispatch,
  type PreparationDispatchClaim,
  PreparationDispatchError,
  type PreparationNudge,
  type PreparationTerminalInput,
  preparationExecutionName,
} from "./preparation-dispatch.js";
import {
  type ApplicationEvent,
  type ApplicationStatus,
  assertHistoryKind,
  type HistoryKind,
  nextStatus,
} from "./state-machine.js";

type Sql = postgres.Sql;
type Tx = postgres.TransactionSql;

export const MAX_APPLICATIONS_PER_OWNER = 500;
export const MAX_LIST_PAGE = 50;
export const MAX_HISTORY_PAGE = 200;

export interface ApplicationRecord {
  id: string;
  ownerUserId: string;
  canonicalJobId: string;
  status: ApplicationStatus;
  revision: number;
  currentPacketId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApprovalRecord extends PacketApproval {
  id: string;
  invalidatedAt?: Date;
  invalidationReason?: string;
}

export interface AttemptRecord extends ApplicationAttempt {
  approvalId: string;
}

export interface HistoryEntry {
  seq: number;
  kind: HistoryKind;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  packetId: string | null;
  attemptId: string | null;
  reasonCode: string | null;
  occurredAt: Date;
}

export interface ApplicationView {
  application: ApplicationRecord;
  currentPacket: ApplicationPacket | null;
  approval: ApprovalRecord | null;
  attempts: AttemptRecord[];
  currentAction: CurrentAction;
}

export interface CommandResult {
  replayed: boolean;
  view: ApplicationView;
}

export type StartAttemptResult =
  | (CommandResult & { kind: "started"; attempt: AttemptRecord })
  | (CommandResult & { kind: "approval_invalidated"; reasons: readonly ApprovalInvalidReason[] });

export class ApplicationNotFoundError extends Error {
  constructor() {
    super("Application was not found");
    this.name = "ApplicationNotFoundError";
  }
}

export class ApplicationRevisionConflictError extends Error {
  constructor() {
    super("Application changed since it was last read");
    this.name = "ApplicationRevisionConflictError";
  }
}

export class ApplicationIdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency key was already used for a different application request");
    this.name = "ApplicationIdempotencyConflictError";
  }
}

export class ApplicationAlreadyExistsError extends Error {
  constructor() {
    super("A live application already exists for this job");
    this.name = "ApplicationAlreadyExistsError";
  }
}

export class ApplicationLimitError extends Error {
  constructor() {
    super(`A candidate can retain at most ${MAX_APPLICATIONS_PER_OWNER} applications`);
    this.name = "ApplicationLimitError";
  }
}

export class ApplicationIntegrityError extends Error {
  constructor(what: string) {
    super(`Stored application data failed integrity verification: ${what}`);
    this.name = "ApplicationIntegrityError";
  }
}

export class AttemptNotFoundError extends Error {
  constructor() {
    super("Attempt was not found");
    this.name = "AttemptNotFoundError";
  }
}

interface ApplicationRow {
  id: string;
  owner_user_id: string;
  canonical_job_id: string;
  status: ApplicationStatus;
  revision: string | number;
  current_packet_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface PacketRow {
  id: string;
  application_id: string;
  owner_user_id: string;
  version: number;
  packet_hash: string;
  job_revision: string;
  form_adapter_id: string | null;
  form_variant_id: string | null;
  form_hash: string | null;
  resume_hash: string | null;
  cover_letter_hash: string | null;
  fields: PacketFieldEntry[];
  created_at: Date;
}

interface ApprovalRow {
  id: string;
  packet_id: string;
  packet_hash: string;
  consent_id: string;
  acknowledged_field_keys: string[];
  approved_at: Date;
  expires_at: Date;
  invalidated_at: Date | null;
  invalidation_reason: string | null;
}

interface AttemptRow {
  id: string;
  application_id: string;
  packet_id: string;
  packet_hash: string;
  approval_id: string;
  sequence: number;
  scope_key: string;
  status: AttemptStatus;
  adapter_id: string;
  adapter_version: string;
  started_at: Date;
  dispatched_at: Date | null;
  resolved_at: Date | null;
  evidence_kind: ConfirmationEvidence["kind"] | null;
  evidence_fingerprint: string | null;
  evidence_observed_at: Date | null;
  evidence_provider_reference: string | null;
}

function toApplication(row: ApplicationRow): ApplicationRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    canonicalJobId: row.canonical_job_id,
    status: row.status,
    revision: Number(row.revision),
    currentPacketId: row.current_packet_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPacket(row: PacketRow, application: ApplicationRow): ApplicationPacket {
  const form: FormBinding | null =
    row.form_adapter_id && row.form_variant_id && row.form_hash
      ? { adapterId: row.form_adapter_id, variantId: row.form_variant_id, formHash: row.form_hash }
      : null;
  const artifactHashes: ArtifactHashes = {
    ...(row.resume_hash ? { resume: row.resume_hash } : {}),
    ...(row.cover_letter_hash ? { coverLetter: row.cover_letter_hash } : {}),
  };
  const packet: ApplicationPacket = {
    id: row.id,
    userId: row.owner_user_id,
    applicationId: row.application_id,
    canonicalJobId: application.canonical_job_id,
    version: row.version,
    jobRevision: row.job_revision,
    form,
    fields: row.fields,
    artifactHashes,
    packetHash: row.packet_hash,
    createdAt: row.created_at,
  };
  if (!verifyPacketHash(packet)) throw new ApplicationIntegrityError("packet hash");
  return packet;
}

function toApproval(row: ApprovalRow): ApprovalRecord {
  return {
    id: row.id,
    packetId: row.packet_id,
    packetHash: row.packet_hash,
    consentId: row.consent_id,
    acknowledgedFieldKeys: row.acknowledged_field_keys,
    approvedAt: row.approved_at,
    expiresAt: row.expires_at,
    ...(row.invalidated_at ? { invalidatedAt: row.invalidated_at } : {}),
    ...(row.invalidation_reason ? { invalidationReason: row.invalidation_reason } : {}),
  };
}

function toAttempt(row: AttemptRow, applicationId = row.application_id): AttemptRecord {
  return {
    id: row.id,
    applicationId,
    packetId: row.packet_id,
    packetHash: row.packet_hash,
    approvalId: row.approval_id,
    sequence: row.sequence,
    scopeKey: row.scope_key,
    status: row.status,
    adapterId: row.adapter_id,
    adapterVersion: row.adapter_version,
    startedAt: row.started_at,
    ...(row.dispatched_at ? { dispatchedAt: row.dispatched_at } : {}),
    ...(row.resolved_at ? { resolvedAt: row.resolved_at } : {}),
    ...(row.evidence_kind && row.evidence_fingerprint && row.evidence_observed_at
      ? {
          evidence: {
            kind: row.evidence_kind,
            observedAt: row.evidence_observed_at,
            fingerprintSha256: row.evidence_fingerprint,
            ...(row.evidence_provider_reference
              ? { providerReference: row.evidence_provider_reference }
              : {}),
          },
        }
      : {}),
  };
}

interface CommandNote {
  code: string;
  subjectId: string | null;
}

type CommandOperation =
  | "queue_preparation"
  | "create_application"
  | "create_packet"
  | "approve"
  | "cancel"
  | "start_attempt"
  | "start_manual_attempt"
  | "record_result"
  | "reconcile"
  | "takeover";

const STATUS_TO_HISTORY_EVENT: Partial<Record<ApplicationEvent, HistoryKind>> = {
  packet_created: "packet_created",
  approved: "approval_recorded",
  approval_invalidated: "approval_invalidated",
  attempt_started: "attempt_started",
  attempt_failed_no_effect: "attempt_failed_no_effect",
  attempt_failed_requires_review: "attempt_failed_requires_review",
  takeover_requested: "takeover_requested",
  takeover_abandoned: "takeover_abandoned",
  submission_confirmed: "submission_confirmed",
  submission_ambiguous: "submission_ambiguous",
  reconciled_not_submitted: "reconciliation_recorded",
  cancelled: "application_cancelled",
};

interface ChangeOptions {
  packetId?: string;
  attemptId?: string;
  reasonCode?: string;
  currentPacketId?: string;
  kind?: HistoryKind;
}

export interface ApplicationStoreOptions {
  definitions: ReadonlyMap<string, FieldDefinition>;
  confidenceThreshold?: number;
}

export class PostgresApplicationStore {
  constructor(
    private readonly client: Sql,
    private readonly clock: () => Date = () => new Date(),
    private readonly options: ApplicationStoreOptions = { definitions: new Map() },
  ) {}

  async ping(): Promise<void> {
    await this.client`SELECT 1`;
  }

  async close(): Promise<void> {
    await this.client.end({ timeout: 5 });
  }

  // ---- Commands ---------------------------------------------------------------------------

  async createApplication(command: {
    ownerUserId: string;
    canonicalJobId: string;
    idempotencyKey: string;
  }): Promise<CommandResult> {
    const requestHash = canonicalHash({
      operation: "create_application",
      canonicalJobId: command.canonicalJobId,
    });
    return this.retryOnKeyRace(command.ownerUserId, async () =>
      this.client.begin(async (tx) => {
        await this.lockOwner(tx, command.ownerUserId);
        const receipt = await this.findReceipt(
          tx,
          command.ownerUserId,
          command.idempotencyKey,
          "create_application",
          requestHash,
        );
        if (receipt) return this.replay(tx, command.ownerUserId, receipt.applicationId);
        const [{ count } = { count: 0 }] = await tx<{ count: number }[]>`
          SELECT count(*)::int AS count FROM applications.applications
          WHERE owner_user_id = ${command.ownerUserId}
        `;
        if (count >= MAX_APPLICATIONS_PER_OWNER) throw new ApplicationLimitError();
        const now = this.clock();
        const id = uuidv7();
        try {
          await tx`
            INSERT INTO applications.applications
              (id, owner_user_id, canonical_job_id, status, revision, created_at, updated_at)
            VALUES (${id}, ${command.ownerUserId}, ${command.canonicalJobId}, 'preparing', 1, ${now}, ${now})
          `;
        } catch (error) {
          if (isUniqueViolation(error, "applications_owner_job_live_uq")) {
            throw new ApplicationAlreadyExistsError();
          }
          throw error;
        }
        await this.appendHistory(tx, {
          applicationId: id,
          ownerUserId: command.ownerUserId,
          kind: "application_created",
          fromStatus: null,
          toStatus: "preparing",
          occurredAt: now,
        });
        await this.enqueue(tx, id, command.ownerUserId, 1, "preparing", now, false);
        await this.writeReceipt(tx, command, "create_application", requestHash, id, 1, now);
        return { replayed: false, view: await this.readView(tx, command.ownerUserId, id) };
      }),
    );
  }

  async createPacket(command: {
    ownerUserId: string;
    applicationId: string;
    expectedRevision: number;
    idempotencyKey: string;
    packet: Pick<PacketInputs, "jobRevision" | "form" | "fields" | "artifactHashes">;
  }): Promise<CommandResult> {
    const requestHash = canonicalHash({
      operation: "create_packet",
      applicationId: command.applicationId,
      expectedRevision: command.expectedRevision,
      jobRevision: command.packet.jobRevision,
      form: command.packet.form,
      artifactHashes: command.packet.artifactHashes,
      fields: command.packet.fields,
    });
    return this.commandResult(command, "create_packet", requestHash, async (tx, app, now) => {
      return this.writePacket(tx, app, now, command.packet);
    });
  }

  async approve(command: {
    ownerUserId: string;
    applicationId: string;
    expectedRevision: number;
    idempotencyKey: string;
    request: ApprovalRequest;
    current: CurrentBindings;
  }): Promise<CommandResult> {
    const requestHash = canonicalHash({
      operation: "approve",
      applicationId: command.applicationId,
      expectedRevision: command.expectedRevision,
      packetHash: command.request.packetHash,
      consentId: command.request.consentId,
      acknowledgedFieldKeys: [...command.request.acknowledgedFieldKeys].sort(),
      current: command.current,
    });
    return this.commandResult(command, "approve", requestHash, async (tx, app, now) => {
      nextStatus(app.status, "approved");
      const packet = await this.loadCurrentPacket(tx, app);
      if (!packet) throw new ApplicationIntegrityError("missing current packet");
      const stale = evaluateBindings(packet, command.current);
      const approval = approvePacket(packet, command.request, now);
      if (stale.length > 0) {
        // The packet no longer matches the live job/form/artifacts: it can never be approved.
        throw new StalePacketError(stale);
      }
      const approvalId = uuidv7();
      await tx`
        INSERT INTO applications.approvals
          (id, packet_id, application_id, owner_user_id, packet_hash, consent_id,
           acknowledged_field_keys, approved_at, expires_at)
        VALUES (${approvalId}, ${packet.id}, ${app.id}, ${app.owner_user_id}, ${packet.packetHash},
          ${approval.consentId}, ${[...approval.acknowledgedFieldKeys]}, ${approval.approvedAt},
          ${approval.expiresAt})
      `;
      return this.change(tx, app, "approved", now, { packetId: packet.id });
    });
  }

  /** Withdraws a live approval so the candidate can edit; the next packet needs new approval. */
  async reopenForEdit(command: {
    ownerUserId: string;
    applicationId: string;
    expectedRevision: number;
    idempotencyKey: string;
  }): Promise<CommandResult> {
    const requestHash = canonicalHash({
      operation: "approve",
      reopen: true,
      applicationId: command.applicationId,
      expectedRevision: command.expectedRevision,
    });
    return this.commandResult(command, "approve", requestHash, async (tx, app, now) => {
      nextStatus(app.status, "approval_invalidated");
      await this.invalidateLiveApproval(tx, app.id, "superseded", now);
      return this.change(tx, app, "approval_invalidated", now, { reasonCode: "superseded" });
    });
  }

  async cancel(command: {
    ownerUserId: string;
    applicationId: string;
    expectedRevision: number;
    idempotencyKey: string;
  }): Promise<CommandResult> {
    const requestHash = canonicalHash({
      operation: "cancel",
      applicationId: command.applicationId,
      expectedRevision: command.expectedRevision,
    });
    return this.commandResult(command, "cancel", requestHash, async (tx, app, now) => {
      nextStatus(app.status, "cancelled");
      await this.invalidateLiveApproval(tx, app.id, "cancelled", now);
      return this.change(tx, app, "cancelled", now, {});
    });
  }

  /**
   * `manual: true` is D3-018's candidate-initiated path: the candidate never used an adapter at
   * all, so there is nothing to dispatch. The attempt is created already `taken_over` (the schema's
   * own dispatch/resolution constraints already allow this: "An attempt taken over by the candidate
   * before dispatch may later be confirmed without ever being dispatched"), and the application
   * moves through the same two already-legal events an automated challenge would produce
   * (`attempt_started` then `takeover_requested`), so reconciliation afterward is the exact same
   * code path, with the exact same duplicate-risk safeguards, as the extension's ambiguous-result
   * recovery.
   */
  async startAttempt(command: {
    ownerUserId: string;
    applicationId: string;
    expectedRevision: number;
    idempotencyKey: string;
    current: CurrentBindings;
    adapterId: string;
    adapterVersion: string;
    manual?: boolean;
  }): Promise<StartAttemptResult> {
    const requestHash = canonicalHash({
      operation: command.manual ? "start_manual_attempt" : "start_attempt",
      applicationId: command.applicationId,
      expectedRevision: command.expectedRevision,
      current: command.current,
      adapterId: command.adapterId,
      adapterVersion: command.adapterVersion,
    });
    const result = await this.mutate(
      command,
      command.manual ? "start_manual_attempt" : "start_attempt",
      requestHash,
      async (tx, app, now, note) => {
        if (app.status !== "approved") throw new AttemptRefusedError("NOT_APPROVED");
        const packet = await this.loadCurrentPacket(tx, app);
        const approval = await this.loadLiveApproval(tx, app.id);
        if (!packet || !approval) {
          throw new ApplicationIntegrityError("approved application without packet or approval");
        }
        const validity = evaluateApproval(packet, approval, command.current, now);
        if (!validity.valid) {
          // Commit the invalidation so a stale approval can never be reused, then report it.
          const reason = firstReason(validity.reasons);
          await this.invalidateLiveApproval(tx, app.id, reason, now);
          note({ code: `approval_invalidated:${validity.reasons.join(",")}`, subjectId: null });
          return this.change(tx, app, "approval_invalidated", now, {
            packetId: packet.id,
            reasonCode: reason,
          });
        }
        const sequence = planAttemptStart({
          applicationStatus: app.status,
          approval: validity,
          attempts: await this.loadAttempts(tx, app.id),
          packetHash: packet.packetHash,
        });
        const attemptId = uuidv7();
        try {
          if (command.manual) {
            await tx`
              INSERT INTO applications.attempts
                (id, application_id, owner_user_id, packet_id, packet_hash, approval_id, sequence,
                 scope_key, status, adapter_id, adapter_version, started_at, resolved_at)
              VALUES (${attemptId}, ${app.id}, ${app.owner_user_id}, ${packet.id}, ${packet.packetHash},
                ${approval.id}, ${sequence},
                ${submissionScopeKey(app.owner_user_id, app.id, packet.packetHash)}, 'taken_over',
                ${command.adapterId}, ${command.adapterVersion}, ${now}, ${now})
            `;
          } else {
            await tx`
              INSERT INTO applications.attempts
                (id, application_id, owner_user_id, packet_id, packet_hash, approval_id, sequence,
                 scope_key, status, adapter_id, adapter_version, started_at)
              VALUES (${attemptId}, ${app.id}, ${app.owner_user_id}, ${packet.id}, ${packet.packetHash},
                ${approval.id}, ${sequence},
                ${submissionScopeKey(app.owner_user_id, app.id, packet.packetHash)}, 'started',
                ${command.adapterId}, ${command.adapterVersion}, ${now})
            `;
          }
        } catch (error) {
          if (isUniqueViolation(error, "attempts_scope_holding_uq")) {
            throw new AttemptRefusedError("ATTEMPT_IN_FLIGHT");
          }
          throw error;
        }
        note({ code: "started", subjectId: attemptId });
        const started = await this.change(tx, app, "attempt_started", now, {
          packetId: packet.id,
          attemptId,
        });
        if (!command.manual) return started;
        return this.change(tx, started, "takeover_requested", now, {
          packetId: packet.id,
          attemptId,
        });
      },
    );
    const { note, ...commandResult } = result;
    if (note?.code.startsWith("approval_invalidated")) {
      const reasons = (note.code.split(":")[1] ?? "").split(",") as ApprovalInvalidReason[];
      return { kind: "approval_invalidated", reasons, ...commandResult };
    }
    const attempt = commandResult.view.attempts.find(
      (candidate) => candidate.id === note?.subjectId,
    );
    if (!attempt) throw new ApplicationIntegrityError("attempt missing after start");
    return { kind: "started", attempt, ...commandResult };
  }

  /**
   * Write-ahead dispatch. This must commit before the provider effect; a second call always
   * fails, so a crashed worker can never send the same submission twice.
   */
  async dispatchAttempt(command: {
    ownerUserId: string;
    applicationId: string;
    attemptId: string;
  }): Promise<AttemptRecord> {
    return this.client.begin(async (tx) => {
      const app = await this.lockApplication(tx, command.ownerUserId, command.applicationId);
      if (app.status !== "submitting") throw new AttemptRefusedError("ILLEGAL_ATTEMPT_TRANSITION");
      const row = await this.lockAttempt(tx, app.id, command.attemptId);
      const now = this.clock();
      const dispatched = markDispatched(toAttempt(row), now);
      await tx`
        UPDATE applications.attempts
        SET status = 'dispatched', dispatched_at = ${dispatched.dispatchedAt ?? now}
        WHERE id = ${command.attemptId} AND status = 'started'
      `;
      await this.appendHistory(tx, {
        applicationId: app.id,
        ownerUserId: app.owner_user_id,
        kind: "attempt_dispatched",
        fromStatus: app.status,
        toStatus: app.status,
        attemptId: command.attemptId,
        occurredAt: now,
      });
      return { ...toAttempt(row), ...dispatched, approvalId: row.approval_id };
    });
  }

  async recordResult(command: {
    ownerUserId: string;
    applicationId: string;
    attemptId: string;
    idempotencyKey: string;
    result: AdapterSubmissionResult;
  }): Promise<CommandResult> {
    const requestHash = canonicalHash({
      operation: "record_result",
      applicationId: command.applicationId,
      attemptId: command.attemptId,
      result: resultFingerprint(command.result),
    });
    return this.commandResult(
      { ...command, expectedRevision: undefined },
      "record_result",
      requestHash,
      async (tx, app, now) => {
        const row = await this.lockAttempt(tx, app.id, command.attemptId);
        const attempt = toAttempt(row);
        if (app.status !== "submitting" || !["started", "dispatched"].includes(attempt.status)) {
          throw new AttemptRefusedError("ILLEGAL_ATTEMPT_TRANSITION");
        }
        const outcome = classifySubmissionResult(attempt, command.result);
        const evidence = command.result.kind === "confirmed" ? command.result.evidence : undefined;
        return this.settleAttempt(tx, app, row, outcome, evidence, now);
      },
    );
  }

  async reconcile(command: {
    ownerUserId: string;
    applicationId: string;
    attemptId: string;
    idempotencyKey: string;
    reconciliation: ReconciliationEvidence;
  }): Promise<CommandResult> {
    const requestHash = canonicalHash({
      operation: "reconcile",
      applicationId: command.applicationId,
      attemptId: command.attemptId,
      reconciliation: reconciliationFingerprint(command.reconciliation),
    });
    return this.commandResult(
      { ...command, expectedRevision: undefined },
      "reconcile",
      requestHash,
      async (tx, app, now) => {
        const row = await this.lockAttempt(tx, app.id, command.attemptId);
        const resolved = reconcileAttempt(toAttempt(row), command.reconciliation, now);
        const evidence =
          command.reconciliation.kind === "provider_confirmation" ||
          command.reconciliation.kind === "user_attested_submitted"
            ? command.reconciliation.evidence
            : undefined;
        return this.settleAttempt(tx, app, row, resolved.status as SettledStatus, evidence, now);
      },
    );
  }

  /**
   * Crash/replay recovery. A dispatched attempt whose worker vanished becomes ambiguous and
   * needs reconciliation; it is never dispatched again.
   */
  async recoverStaleAttempts(staleAfterMs: number, limit = 50): Promise<{ recovered: number }> {
    const cutoff = new Date(this.clock().getTime() - staleAfterMs);
    const candidates = await this.client<
      { id: string; owner_user_id: string; application_id: string }[]
    >`
      SELECT id, owner_user_id, application_id FROM applications.attempts
      WHERE status IN ('started', 'dispatched')
        AND coalesce(dispatched_at, started_at) <= ${cutoff}
      ORDER BY started_at
      LIMIT ${limit}
    `;
    let recovered = 0;
    for (const candidate of candidates) {
      await this.client.begin(async (tx) => {
        const app = await this.lockApplication(
          tx,
          candidate.owner_user_id,
          candidate.application_id,
        );
        const row = await this.lockAttempt(tx, app.id, candidate.id);
        const now = this.clock();
        const next = recoverStaleAttempt(toAttempt(row), now, staleAfterMs);
        if (next.status === row.status) return;
        await this.settleAttempt(tx, app, row, next.status as SettledStatus, undefined, now);
        recovered += 1;
      });
    }
    return { recovered };
  }

  // ---- Reads (owner-scoped) ---------------------------------------------------------------

  async getApplication(ownerUserId: string, applicationId: string): Promise<ApplicationView> {
    return this.client.begin("READ ONLY", (tx) => this.readView(tx, ownerUserId, applicationId));
  }

  async listApplications(
    ownerUserId: string,
    page: {
      limit?: number;
      after?: { updatedAt: Date; id: string };
      canonicalJobId?: string;
    } = {},
  ): Promise<{ items: ApplicationView[]; hasMore: boolean }> {
    const limit = Math.min(Math.max(page.limit ?? 25, 1), MAX_LIST_PAGE);
    return this.client.begin("READ ONLY", async (tx) => {
      const after = page.after;
      const rows = await tx<ApplicationRow[]>`
        SELECT id, owner_user_id, canonical_job_id, status, revision, current_packet_id, created_at, updated_at
        FROM applications.applications
        WHERE owner_user_id = ${ownerUserId}
          ${page.canonicalJobId ? tx`AND canonical_job_id = ${page.canonicalJobId}` : tx``}
          ${after ? tx`AND (updated_at, id) < (${after.updatedAt}, ${after.id})` : tx``}
        ORDER BY updated_at DESC, id DESC
        LIMIT ${limit + 1}
      `;
      const items: ApplicationView[] = [];
      for (const row of rows.slice(0, limit)) {
        items.push(await this.readView(tx, ownerUserId, row.id));
      }
      return { items, hasMore: rows.length > limit };
    });
  }

  async getHistory(
    ownerUserId: string,
    applicationId: string,
    page: { afterSeq?: number; limit?: number } = {},
  ): Promise<{ entries: HistoryEntry[]; hasMore: boolean }> {
    const limit = Math.min(Math.max(page.limit ?? 100, 1), MAX_HISTORY_PAGE);
    return this.client.begin("READ ONLY", async (tx) => {
      await this.requireOwned(tx, ownerUserId, applicationId);
      const rows = await tx<
        {
          seq: string;
          kind: string;
          from_status: ApplicationStatus | null;
          to_status: ApplicationStatus;
          packet_id: string | null;
          attempt_id: string | null;
          reason_code: string | null;
          occurred_at: Date;
        }[]
      >`
        SELECT seq, kind, from_status, to_status, packet_id, attempt_id, reason_code, occurred_at
        FROM applications.history
        WHERE application_id = ${applicationId} AND owner_user_id = ${ownerUserId}
          AND seq > ${page.afterSeq ?? 0}
        ORDER BY seq
        LIMIT ${limit + 1}
      `;
      return {
        entries: rows.slice(0, limit).map((row) => {
          assertHistoryKind(row.kind);
          return {
            seq: Number(row.seq),
            kind: row.kind,
            fromStatus: row.from_status,
            toStatus: row.to_status,
            packetId: row.packet_id,
            attemptId: row.attempt_id,
            reasonCode: row.reason_code,
            occurredAt: row.occurred_at,
          };
        }),
        hasMore: rows.length > limit,
      };
    });
  }

  // ---- Internals --------------------------------------------------------------------------

  /** Replay before loading volatile owner evidence or rendering another base packet. */
  async replayPreparation(command: {
    ownerUserId: string;
    applicationId: string;
    idempotencyKey: string;
    request: PreparationRequest;
  }): Promise<PreparationRecord | null> {
    const requestHash = canonicalHash({
      operation: "queue_preparation",
      applicationId: command.applicationId,
      request: command.request,
    });
    return this.client.begin(async (tx) => {
      await tx`SELECT identity.require_active_candidate(${command.ownerUserId}::uuid)`;
      await this.lockApplication(tx, command.ownerUserId, command.applicationId);
      const receipt = await this.findReceipt(
        tx,
        command.ownerUserId,
        command.idempotencyKey,
        "queue_preparation",
        requestHash,
      );
      if (!receipt) return null;
      if (!receipt.note?.subjectId) throw new ApplicationIntegrityError("preparation receipt");
      return this.readPreparation(
        tx,
        command.ownerUserId,
        command.applicationId,
        receipt.note.subjectId,
      );
    });
  }

  async queuePreparation(command: {
    ownerUserId: string;
    applicationId: string;
    idempotencyKey: string;
    request: PreparationRequest;
    context: PreparationContext;
    packet: Pick<PacketInputs, "jobRevision" | "form" | "fields" | "artifactHashes">;
  }): Promise<{ replayed: boolean; preparation: PreparationRecord; view: ApplicationView }> {
    const requestHash = canonicalHash({
      operation: "queue_preparation",
      applicationId: command.applicationId,
      request: command.request,
    });
    return this.retryOnKeyRace(command.ownerUserId, () =>
      this.client.begin(async (tx) => {
        await tx`SELECT identity.require_active_candidate(${command.ownerUserId}::uuid)`;
        const app = await this.lockApplication(tx, command.ownerUserId, command.applicationId);
        const prior = await this.findReceipt(
          tx,
          command.ownerUserId,
          command.idempotencyKey,
          "queue_preparation",
          requestHash,
        );
        if (prior) {
          if (!prior.note?.subjectId) throw new ApplicationIntegrityError("preparation receipt");
          return {
            replayed: true,
            preparation: await this.readPreparation(
              tx,
              command.ownerUserId,
              app.id,
              prior.note.subjectId,
            ),
            view: await this.readView(tx, command.ownerUserId, app.id),
          };
        }
        if (Number(app.revision) !== command.request.expectedRevision)
          throw new ApplicationRevisionConflictError();
        const active = await tx`
        SELECT id FROM applications.packet_preparations WHERE application_id = ${app.id}
          AND state IN ('queued', 'running')
      `;
        if (active.length) throw new ApplicationRevisionConflictError();
        if (
          command.request.coverLetter?.disclosure.noticeVersion !==
            COVER_LETTER_DISCLOSURE_VERSION ||
          command.request.coverLetter.disclosure.acknowledged !== true ||
          !/^[a-f0-9]{64}$/u.test(command.context.jobContextHash) ||
          !/^[a-f0-9]{64}$/u.test(command.context.confirmedFactsHash) ||
          command.packet.fields.some((field) => field.fieldKey === "documents.cover_letter")
        )
          throw new PacketInvariantError("Invalid explicit cover-letter preparation");
        const now = this.clock();
        if (!Number.isFinite(now.getTime()))
          throw new PacketInvariantError("Invalid preparation clock");
        const updated = await this.writePacket(tx, app, now, command.packet);
        if (!updated.current_packet_id) throw new ApplicationIntegrityError("base packet");
        const id = uuidv7();
        await tx`
        INSERT INTO applications.packet_preparations (
          id, application_id, owner_user_id, base_packet_id, expected_revision,
          job_context_hash, confirmed_facts_hash, notice_version, approved_at, expires_at, created_at, updated_at
        ) VALUES (${id}, ${app.id}, ${app.owner_user_id}, ${updated.current_packet_id},
          ${Number(updated.revision)}, ${command.context.jobContextHash},
          ${command.context.confirmedFactsHash}, ${COVER_LETTER_DISCLOSURE_VERSION}, ${now},
          ${new Date(now.getTime() + 15 * 60_000)}, ${now}, ${now})
      `;
        await tx`
        INSERT INTO applications.preparation_outbox (id, preparation_id, owner_user_id, payload, created_at)
        VALUES (${uuidv7()}, ${id}, ${app.owner_user_id},
          ${tx.json({ preparationId: id })}, ${now})
      `;
        await this.auditPreparation(tx, id, app.owner_user_id, "queued", now);
        await this.writeReceipt(
          tx,
          command,
          "queue_preparation",
          requestHash,
          app.id,
          Number(updated.revision),
          now,
          { code: "preparation_queued", subjectId: id },
        );
        return {
          replayed: false,
          preparation: await this.readPreparation(tx, command.ownerUserId, app.id, id),
          view: await this.readView(tx, command.ownerUserId, app.id),
        };
      }),
    );
  }

  async getPreparation(
    ownerUserId: string,
    applicationId: string,
    id: string,
  ): Promise<PreparationRecord> {
    return this.readPreparation(this.client, ownerUserId, applicationId, id);
  }

  /** Internal worker boundary: the immutable event must name the exact owned operation. */
  async getPreparationForEvent(eventId: string, preparationId: string): Promise<PreparationRecord> {
    const [target] = await this.client<Array<{ owner: string; applicationId: string }>>`
      SELECT preparation.owner_user_id AS owner, preparation.application_id AS "applicationId"
      FROM applications.preparation_outbox event
      JOIN applications.packet_preparations preparation ON preparation.id = event.preparation_id
      WHERE event.id = ${eventId} AND preparation.id = ${preparationId}
    `;
    if (!target) throw new PreparationNotFoundError();
    return this.readPreparation(this.client, target.owner, target.applicationId, preparationId);
  }

  async claimPreparationGeneration(
    eventId: string,
    preparationId: string,
    current: PreparationContext,
  ): Promise<GenerationClaim> {
    const target = await this.getPreparationForEvent(eventId, preparationId);
    return this.client.begin(async (tx) => {
      await tx`SELECT identity.require_active_candidate(${target.ownerUserId}::uuid)`;
      const app = await this.lockApplication(tx, target.ownerUserId, target.applicationId);
      const preparation = await this.readPreparation(
        tx,
        target.ownerUserId,
        app.id,
        preparationId,
        true,
      );
      if (preparation.state === "succeeded" || preparation.state === "failed")
        return { kind: "terminal", preparation };
      if (preparation.state === "running") return { kind: "already_claimed", preparation };
      const now = this.clock();
      const age = now.getTime() - preparation.approvedAt.getTime();
      const errorCode: PreparationFailureCode | null =
        !Number.isFinite(age) || age < 0 || now > preparation.expiresAt
          ? "disclosure_expired"
          : Number(app.revision) !== preparation.expectedRevision ||
              app.current_packet_id !== preparation.basePacketId ||
              app.status !== "review_required"
            ? "application_changed"
            : preparation.jobContextHash !== current.jobContextHash ||
                preparation.confirmedFactsHash !== current.confirmedFactsHash
              ? "bindings_changed"
              : null;
      if (errorCode) {
        await this.failPreparationRow(
          tx,
          preparation,
          errorCode,
          Number.isFinite(now.getTime()) && now >= preparation.createdAt
            ? now
            : preparation.createdAt,
        );
        return {
          kind: "terminal",
          preparation: await this.readPreparation(tx, target.ownerUserId, app.id, preparationId),
        };
      }
      await tx`
        UPDATE applications.packet_preparations SET state = 'running', generation_claimed_at = ${now},
          updated_at = ${now} WHERE id = ${preparationId}
      `;
      await this.auditPreparation(tx, preparationId, target.ownerUserId, "generation_claimed", now);
      return {
        kind: "claimed",
        preparation: await this.readPreparation(tx, target.ownerUserId, app.id, preparationId),
      };
    });
  }

  async completePreparation(
    eventId: string,
    preparationId: string,
    current: PreparationContext,
    letter: { contentSha256: string; sourceFactIds: readonly string[]; confidence: number },
  ): Promise<PreparationRecord> {
    const target = await this.getPreparationForEvent(eventId, preparationId);
    return this.client.begin(async (tx) => {
      await tx`SELECT identity.require_active_candidate(${target.ownerUserId}::uuid)`;
      const app = await this.lockApplication(tx, target.ownerUserId, target.applicationId);
      const preparation = await this.readPreparation(
        tx,
        target.ownerUserId,
        app.id,
        preparationId,
        true,
      );
      if (preparation.state === "succeeded" || preparation.state === "failed") return preparation;
      if (preparation.state !== "running")
        throw new ApplicationIntegrityError("generation not claimed");
      const now = this.clock();
      const failure =
        Number(app.revision) !== preparation.expectedRevision ||
        app.current_packet_id !== preparation.basePacketId ||
        app.status !== "review_required"
          ? "application_changed"
          : preparation.jobContextHash !== current.jobContextHash ||
              preparation.confirmedFactsHash !== current.confirmedFactsHash
            ? "bindings_changed"
            : null;
      if (failure) {
        await this.failPreparationRow(tx, preparation, failure, now);
        return this.readPreparation(tx, target.ownerUserId, app.id, preparationId);
      }
      if (
        !/^[a-f0-9]{64}$/u.test(letter.contentSha256) ||
        letter.sourceFactIds.length < 1 ||
        letter.sourceFactIds.length > 40 ||
        !Number.isFinite(letter.confidence) ||
        letter.confidence < 0 ||
        letter.confidence > 1 ||
        letter.sourceFactIds.some((id) => !/^[a-f0-9-]{36}$/u.test(id))
      )
        throw new PacketInvariantError("Invalid grounded cover-letter binding");
      const base = (await this.readView(tx, target.ownerUserId, app.id)).currentPacket;
      if (!base) throw new ApplicationIntegrityError("preparation packet");
      const updated = await this.writePacket(tx, app, now, {
        jobRevision: base.jobRevision,
        form: base.form,
        artifactHashes: { ...base.artifactHashes, coverLetter: letter.contentSha256 },
        fields: [
          ...base.fields
            .filter((field) => field.fieldKey !== "documents.cover_letter")
            .map((field) => ({
              fieldKey: field.fieldKey,
              value: field.value,
              origin: field.origin,
              sourceFactIds: field.sourceFactIds,
              confidence: field.confidence,
              sourceConfirmed: !field.reasons.includes("unconfirmed_source"),
            })),
          {
            fieldKey: "documents.cover_letter",
            value: letter.contentSha256,
            origin: "generated",
            sourceFactIds: [...letter.sourceFactIds],
            sourceConfirmed: true,
            confidence: letter.confidence,
          },
        ],
      });
      const packet = (await this.readView(tx, target.ownerUserId, app.id)).currentPacket;
      if (
        !packet?.fields.some(
          (field) =>
            field.fieldKey === "documents.cover_letter" &&
            field.requiresReview &&
            field.reasons.includes("generated_content"),
        )
      )
        throw new PacketInvariantError("Generated cover letter must require review");
      await tx`
        UPDATE applications.packet_preparations SET state = 'succeeded',
          result_packet_id = ${updated.current_packet_id}, updated_at = ${now} WHERE id = ${preparationId}
      `;
      await this.auditPreparation(tx, preparationId, target.ownerUserId, "succeeded", now);
      return this.readPreparation(tx, target.ownerUserId, app.id, preparationId);
    });
  }

  async failPreparation(
    eventId: string,
    preparationId: string,
    errorCode: PreparationFailureCode,
  ): Promise<PreparationRecord> {
    const target = await this.getPreparationForEvent(eventId, preparationId);
    return this.client.begin(async (tx) => {
      await this.lockApplication(tx, target.ownerUserId, target.applicationId);
      const row = await this.readPreparation(
        tx,
        target.ownerUserId,
        target.applicationId,
        preparationId,
        true,
      );
      if (row.state !== "succeeded" && row.state !== "failed")
        await this.failPreparationRow(tx, row, errorCode, this.clock());
      return this.readPreparation(tx, target.ownerUserId, target.applicationId, preparationId);
    });
  }

  /** Private bounded reconciler: publication is not recorded until durable start is acknowledged. */
  async claimPreparationNudges(limit: number): Promise<PreparationNudge[]> {
    this.preparationBatchLimit(limit);
    const now = this.preparationDispatchNow();
    const stale = new Date(now.getTime() - PREPARATION_DISPATCH_LEASE_MS);
    return this.client.begin(
      async (tx) => tx<PreparationNudge[]>`
      WITH candidates AS (
        SELECT event.id FROM applications.preparation_outbox event
        JOIN applications.packet_preparations preparation ON preparation.id = event.preparation_id
        WHERE event.published_at IS NULL AND event.terminal_status IS NULL
          AND (preparation.state IN ('queued', 'running') OR event.workflow_function_arn IS NOT NULL)
          AND (event.nudge_claimed_at IS NULL OR event.nudge_claimed_at <= ${stale})
        ORDER BY event.nudge_claimed_at NULLS FIRST, event.created_at, event.id FOR UPDATE OF event SKIP LOCKED LIMIT ${limit}
      )
      UPDATE applications.preparation_outbox event SET nudge_claimed_at = ${now}
      FROM candidates WHERE event.id = candidates.id
      RETURNING event.id AS "eventId", event.preparation_id AS "preparationId"
    `,
    );
  }

  /** Bind a stable exact version before external start. Recovery never retargets a bound event. */
  async claimPreparationDispatch(
    eventId: string,
    functionArn: string,
    expectedPreparationId?: string,
  ): Promise<PreparationDispatchClaim> {
    const name = preparationExecutionName(eventId);
    if (!isPreparationFunctionArn(functionArn)) throw new PreparationDispatchError();
    const now = this.preparationDispatchNow();
    const [target] = await this.client<
      Array<{ owner: string; applicationId: string; preparationId: string }>
    >`
      SELECT preparation.owner_user_id AS owner, preparation.application_id AS "applicationId", preparation.id AS "preparationId"
      FROM applications.preparation_outbox event
      JOIN applications.packet_preparations preparation ON preparation.id = event.preparation_id
      WHERE event.id = ${eventId}
        AND (${expectedPreparationId ?? null}::uuid IS NULL OR preparation.id = ${expectedPreparationId ?? null}::uuid)
    `;
    if (!target) return { kind: "missing" };
    return this.client.begin(async (tx) => {
      await tx`SELECT identity.require_active_candidate(${target.owner}::uuid)`;
      const app = await this.lockApplication(tx, target.owner, target.applicationId);
      const preparation = await this.readPreparation(
        tx,
        target.owner,
        app.id,
        target.preparationId,
        true,
      );
      const [event] = await tx<
        Array<{
          functionArn: string | null;
          leaseExpiresAt: Date | null;
          executionArn: string | null;
          terminalStatus: string | null;
        }>
      >`
        SELECT workflow_function_arn AS "functionArn", dispatch_expires_at AS "leaseExpiresAt",
          durable_execution_arn AS "executionArn", terminal_status AS "terminalStatus"
        FROM applications.preparation_outbox WHERE id = ${eventId} FOR UPDATE
      `;
      if (!event) return { kind: "missing" };
      if (event.terminalStatus) return { kind: "terminal" };
      const operationTerminal = preparation.state === "succeeded" || preparation.state === "failed";
      if (operationTerminal && !event.functionArn) return { kind: "terminal" };
      if (event.executionArn)
        return { kind: "started", dispatch: await this.readPreparationDispatch(tx, eventId) };
      if (
        !operationTerminal &&
        (Number(app.revision) !== preparation.expectedRevision ||
          app.current_packet_id !== preparation.basePacketId ||
          app.status !== "review_required")
      ) {
        await this.failPreparationRow(tx, preparation, "application_changed", now);
        return { kind: "terminal" };
      }
      if (preparation.state === "queued" && now.getTime() > preparation.expiresAt.getTime()) {
        await this.failPreparationRow(tx, preparation, "disclosure_expired", now);
        return { kind: "terminal" };
      }
      if (event.leaseExpiresAt && event.leaseExpiresAt.getTime() > now.getTime())
        return { kind: "busy" };
      if (
        event.functionArn &&
        event.functionArn.replace(/:\d+$/u, "") !== functionArn.replace(/:\d+$/u, "")
      )
        throw new PreparationDispatchError();
      await tx`
        UPDATE applications.preparation_outbox SET
          workflow_function_arn = COALESCE(workflow_function_arn, ${functionArn}),
          durable_execution_name = COALESCE(durable_execution_name, ${name}),
          bound_at = COALESCE(bound_at, ${now}), dispatch_lease_id = ${uuidv7()},
          dispatch_claimed_at = ${now}, dispatch_expires_at = ${new Date(now.getTime() + PREPARATION_DISPATCH_LEASE_MS)}
        WHERE id = ${eventId}
      `;
      return { kind: "claimed", dispatch: await this.readPreparationDispatch(tx, eventId) };
    });
  }

  /** A late old claimant cannot overwrite a newer lease; acknowledged starts are immutable. */
  async markPreparationStarted(
    eventId: string,
    leaseId: string,
    executionArn: string,
  ): Promise<boolean> {
    preparationExecutionName(eventId);
    const now = this.preparationDispatchNow();
    return this.client.begin(async (tx) => {
      const [row] = await tx<
        Array<{
          functionArn: string | null;
          executionName: string | null;
          executionArn: string | null;
          leaseId: string | null;
        }>
      >`
        SELECT workflow_function_arn AS "functionArn", durable_execution_name AS "executionName",
          durable_execution_arn AS "executionArn", dispatch_lease_id AS "leaseId"
        FROM applications.preparation_outbox WHERE id = ${eventId} FOR UPDATE
      `;
      if (
        !row?.functionArn ||
        !row.executionName ||
        !matchesPreparationExecutionArn(executionArn, row.functionArn, row.executionName)
      )
        throw new PreparationDispatchError();
      if (row.executionArn) return row.executionArn === executionArn;
      if (row.leaseId !== leaseId) return false;
      await tx`
        UPDATE applications.preparation_outbox SET durable_execution_arn = ${executionArn},
          durable_started_at = ${now}, published_at = ${now},
          dispatch_lease_id = NULL, dispatch_claimed_at = NULL, dispatch_expires_at = NULL
        WHERE id = ${eventId}
      `;
      return true;
    });
  }

  /** Bounded status-poll recovery for a lost terminal event; no prompts/provider state leave SQL. */
  async claimPreparationExecutionsForReconciliation(limit: number): Promise<PreparationDispatch[]> {
    this.preparationBatchLimit(limit);
    const now = this.preparationDispatchNow();
    const stale = new Date(now.getTime() - PREPARATION_DISPATCH_LEASE_MS);
    const events = await this.client<Array<{ id: string }>>`
      WITH due AS (
        SELECT id FROM applications.preparation_outbox
        WHERE durable_started_at <= ${stale} AND terminal_status IS NULL
          AND (nudge_claimed_at IS NULL OR nudge_claimed_at <= ${stale})
        ORDER BY nudge_claimed_at NULLS FIRST, durable_started_at, id
        LIMIT ${limit} FOR UPDATE SKIP LOCKED
      )
      UPDATE applications.preparation_outbox event SET nudge_claimed_at = ${now}
      FROM due WHERE event.id = due.id RETURNING event.id
    `;
    return Promise.all(events.map((event) => this.readPreparationDispatch(this.client, event.id)));
  }

  async getPreparationDispatch(eventId: string): Promise<PreparationDispatch | undefined> {
    preparationExecutionName(eventId);
    const [event] = await this.client<Array<{ id: string }>>`
      SELECT id FROM applications.preparation_outbox WHERE id = ${eventId} AND workflow_function_arn IS NOT NULL
    `;
    return event ? this.readPreparationDispatch(this.client, event.id) : undefined;
  }

  /** Owned settlement and terminal receipt commit together, including a lost start acknowledgement. */
  async settlePreparationExecution(input: PreparationTerminalInput): Promise<boolean> {
    const now = this.preparationDispatchNow();
    const name = preparationExecutionName(input.eventId);
    if (
      !isPreparationFunctionArn(input.functionArn) ||
      input.executionName !== name ||
      !matchesPreparationExecutionArn(input.executionArn, input.functionArn, name) ||
      !["SUCCEEDED", "FAILED", "STOPPED", "TIMED_OUT"].includes(input.status) ||
      !(input.startTimestamp instanceof Date) ||
      !(input.endTimestamp instanceof Date) ||
      !Number.isFinite(input.startTimestamp.getTime()) ||
      !Number.isFinite(input.endTimestamp.getTime()) ||
      input.endTimestamp < input.startTimestamp ||
      input.endTimestamp.getTime() > now.getTime() + 300_000
    )
      throw new PreparationDispatchError();
    const target = await this.getPreparationForEvent(input.eventId, input.preparationId);
    return this.client.begin(async (tx) => {
      await this.lockApplication(tx, target.ownerUserId, target.applicationId);
      const preparation = await this.readPreparation(
        tx,
        target.ownerUserId,
        target.applicationId,
        input.preparationId,
        true,
      );
      const [row] = await tx<
        Array<{
          functionArn: string | null;
          executionName: string | null;
          boundAt: Date | null;
          executionArn: string | null;
          terminalStatus: string | null;
          terminalStart: Date | null;
          terminalEnd: Date | null;
        }>
      >`
        SELECT workflow_function_arn AS "functionArn", durable_execution_name AS "executionName", bound_at AS "boundAt",
          durable_execution_arn AS "executionArn", terminal_status AS "terminalStatus",
          terminal_start_at AS "terminalStart", terminal_end_at AS "terminalEnd"
        FROM applications.preparation_outbox WHERE id = ${input.eventId} FOR UPDATE
      `;
      if (
        !row ||
        row.functionArn !== input.functionArn ||
        row.executionName !== input.executionName ||
        !row.boundAt ||
        input.startTimestamp.getTime() < row.boundAt.getTime() - 300_000 ||
        (row.executionArn && row.executionArn !== input.executionArn)
      )
        throw new PreparationDispatchError();
      if (row.terminalStatus) {
        if (
          row.terminalStatus !== input.status ||
          row.terminalStart?.getTime() !== input.startTimestamp.getTime() ||
          row.terminalEnd?.getTime() !== input.endTimestamp.getTime()
        )
          throw new PreparationDispatchError();
        return true;
      }
      // AWS SUCCEEDED only proves workflow processing. Never promote a still-active operation.
      if (preparation.state === "queued" || preparation.state === "running")
        await this.failPreparationRow(tx, preparation, "generation_unavailable", now);
      await tx`
        UPDATE applications.preparation_outbox SET durable_execution_arn = ${input.executionArn},
          durable_started_at = COALESCE(durable_started_at, ${now}), published_at = COALESCE(published_at, ${now}),
          dispatch_lease_id = NULL, dispatch_claimed_at = NULL, dispatch_expires_at = NULL,
          terminal_status = ${input.status}, terminal_start_at = ${input.startTimestamp}, terminal_end_at = ${input.endTimestamp}
        WHERE id = ${input.eventId}
      `;
      return true;
    });
  }

  private preparationBatchLimit(limit: number): void {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PREPARATION_DISPATCH_BATCH)
      throw new PreparationDispatchError();
  }
  private preparationDispatchNow(): Date {
    const now = this.clock();
    if (!Number.isFinite(now.getTime())) throw new PreparationDispatchError();
    return now;
  }
  private async readPreparationDispatch(
    tx: Sql | Tx,
    eventId: string,
  ): Promise<PreparationDispatch> {
    const [row] = await tx<PreparationDispatch[]>`
      SELECT id AS "eventId", preparation_id AS "preparationId", workflow_function_arn AS "functionArn",
        durable_execution_name AS "executionName", bound_at AS "boundAt", dispatch_lease_id AS "leaseId",
        dispatch_expires_at AS "leaseExpiresAt", durable_execution_arn AS "executionArn",
        durable_started_at AS "startedAt", terminal_status AS "terminalStatus"
      FROM applications.preparation_outbox WHERE id = ${eventId} AND workflow_function_arn IS NOT NULL
    `;
    if (!row) throw new PreparationDispatchError();
    return row;
  }

  private async readPreparation(
    tx: Sql | Tx,
    ownerUserId: string,
    applicationId: string,
    id: string,
    lock = false,
  ): Promise<PreparationRecord> {
    const [row] = await tx<PreparationRecord[]>`
      SELECT id, owner_user_id AS "ownerUserId", application_id AS "applicationId",
        base_packet_id AS "basePacketId", expected_revision::float8 AS "expectedRevision",
        job_context_hash AS "jobContextHash", confirmed_facts_hash AS "confirmedFactsHash",
        notice_version AS "noticeVersion", approved_at AS "approvedAt", expires_at AS "expiresAt",
        generation_claimed_at AS "generationClaimedAt", state, result_packet_id AS "resultPacketId",
        error_code AS "errorCode", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM applications.packet_preparations
      WHERE id = ${id} AND owner_user_id = ${ownerUserId} AND application_id = ${applicationId}
      ${lock ? tx`FOR UPDATE` : tx``}
    `;
    if (!row) throw new PreparationNotFoundError();
    return row;
  }

  private async auditPreparation(
    tx: Tx,
    preparationId: string,
    ownerUserId: string,
    action: "queued" | "generation_claimed" | "succeeded" | "failed",
    now: Date,
  ): Promise<void> {
    await tx`
      INSERT INTO applications.preparation_audit (id, preparation_id, owner_user_id, action, occurred_at)
      VALUES (${uuidv7()}, ${preparationId}, ${ownerUserId}, ${action}, ${now})
    `;
  }

  private async failPreparationRow(
    tx: Tx,
    row: PreparationRecord,
    errorCode: PreparationFailureCode,
    now: Date,
  ): Promise<void> {
    await tx`
      UPDATE applications.packet_preparations SET state = 'failed', error_code = ${errorCode},
        updated_at = ${now} WHERE id = ${row.id}
    `;
    await this.auditPreparation(tx, row.id, row.ownerUserId, "failed", now);
  }

  private async writePacket(
    tx: Tx,
    app: ApplicationRow,
    now: Date,
    inputs: Pick<PacketInputs, "jobRevision" | "form" | "fields" | "artifactHashes">,
  ): Promise<ApplicationRow> {
    nextStatus(app.status, "packet_created");
    const [{ version } = { version: 0 }] = await tx<{ version: number }[]>`
        SELECT coalesce(max(version), 0)::int AS version FROM applications.packets
        WHERE application_id = ${app.id}
      `;
    const packet = assemblePacket(
      {
        ...inputs,
        id: uuidv7(),
        userId: app.owner_user_id,
        applicationId: app.id,
        canonicalJobId: app.canonical_job_id,
        version: version + 1,
        createdAt: now,
      },
      this.options.definitions,
      this.options.confidenceThreshold,
    );
    await tx`
        INSERT INTO applications.packets
          (id, application_id, owner_user_id, version, packet_hash, job_revision, form_adapter_id,
           form_variant_id, form_hash, resume_hash, cover_letter_hash, fields, created_at)
        VALUES (${packet.id}, ${app.id}, ${app.owner_user_id}, ${packet.version}, ${packet.packetHash},
          ${packet.jobRevision}, ${packet.form?.adapterId ?? null}, ${packet.form?.variantId ?? null},
          ${packet.form?.formHash ?? null}, ${packet.artifactHashes.resume ?? null},
          ${packet.artifactHashes.coverLetter ?? null},
          ${tx.json(packet.fields as unknown as postgres.JSONValue)}, ${now})
      `;
    return this.change(tx, app, "packet_created", now, {
      packetId: packet.id,
      currentPacketId: packet.id,
    });
  }

  private async commandResult(
    command: Parameters<PostgresApplicationStore["mutate"]>[0],
    operation: CommandOperation,
    requestHash: string,
    run: (tx: Tx, app: ApplicationRow, now: Date) => Promise<ApplicationRow>,
  ): Promise<CommandResult> {
    const { note: _note, ...result } = await this.mutate(command, operation, requestHash, run);
    return result;
  }

  private async mutate(
    command: {
      ownerUserId: string;
      applicationId: string;
      expectedRevision: number | undefined;
      idempotencyKey: string;
    },
    operation: CommandOperation,
    requestHash: string,
    run: (
      tx: Tx,
      app: ApplicationRow,
      now: Date,
      note: (outcome: CommandNote) => void,
    ) => Promise<ApplicationRow>,
  ): Promise<CommandResult & { note: CommandNote | null }> {
    return this.retryOnKeyRace(command.ownerUserId, () =>
      this.client.begin(async (tx) => {
        const app = await this.lockApplication(tx, command.ownerUserId, command.applicationId);
        const receipt = await this.findReceipt(
          tx,
          command.ownerUserId,
          command.idempotencyKey,
          operation,
          requestHash,
        );
        if (receipt) {
          return {
            ...(await this.replay(tx, command.ownerUserId, receipt.applicationId)),
            note: receipt.note,
          };
        }
        if (
          command.expectedRevision !== undefined &&
          Number(app.revision) !== command.expectedRevision
        ) {
          throw new ApplicationRevisionConflictError();
        }
        const now = this.clock();
        let note: CommandNote | null = null;
        const updated = await run(tx, app, now, (outcome) => {
          note = outcome;
        });
        await this.writeReceipt(
          tx,
          { ownerUserId: command.ownerUserId, idempotencyKey: command.idempotencyKey },
          operation,
          requestHash,
          app.id,
          Number(updated.revision),
          now,
          note,
        );
        return {
          replayed: false,
          view: await this.readView(tx, command.ownerUserId, app.id),
          note,
        };
      }),
    );
  }

  private async settleAttempt(
    tx: Tx,
    app: ApplicationRow,
    row: AttemptRow,
    outcome: SettledStatus,
    evidence: ConfirmationEvidence | undefined,
    now: Date,
  ): Promise<ApplicationRow> {
    await tx`
      UPDATE applications.attempts
      SET status = ${outcome}, resolved_at = ${now},
        evidence_kind = ${evidence?.kind ?? null},
        evidence_fingerprint = ${evidence?.fingerprintSha256 ?? null},
        evidence_observed_at = ${evidence?.observedAt ?? null},
        evidence_provider_reference = ${evidence?.providerReference ?? null}
      WHERE id = ${row.id}
    `;
    const options: ChangeOptions = { packetId: row.packet_id, attemptId: row.id };
    const fromTakeover = app.status === "takeover";
    switch (outcome) {
      case "confirmed":
        return this.change(tx, app, "submission_confirmed", now, options);
      case "ambiguous":
        return this.change(tx, app, "submission_ambiguous", now, options);
      case "failed_no_effect":
        return this.change(tx, app, "attempt_failed_no_effect", now, options);
      case "failed_requires_review":
        await this.invalidateLiveApproval(tx, app.id, "attempt_requires_review", now);
        return this.change(tx, app, "attempt_failed_requires_review", now, options);
      case "taken_over":
        return this.change(tx, app, "takeover_requested", now, options);
      case "abandoned":
      case "reconciled_not_submitted":
        return this.change(
          tx,
          app,
          fromTakeover ? "takeover_abandoned" : "reconciled_not_submitted",
          now,
          options,
        );
    }
  }

  /** Applies one lifecycle event: state, revision, history, and outbox in the same transaction. */
  private async change(
    tx: Tx,
    app: ApplicationRow,
    event: ApplicationEvent,
    now: Date,
    options: ChangeOptions,
  ): Promise<ApplicationRow> {
    const to = nextStatus(app.status, event);
    const revision = Number(app.revision) + 1;
    const [updated] = await tx<ApplicationRow[]>`
      UPDATE applications.applications
      SET status = ${to}, revision = ${revision}, updated_at = greatest(updated_at, ${now}),
        current_packet_id = ${options.currentPacketId ?? app.current_packet_id}
      WHERE id = ${app.id}
      RETURNING id, owner_user_id, canonical_job_id, status, revision, current_packet_id, created_at, updated_at
    `;
    if (!updated) throw new ApplicationNotFoundError();
    const kind = options.kind ?? STATUS_TO_HISTORY_EVENT[event];
    if (!kind) throw new ApplicationIntegrityError("unmapped history event");
    await this.appendHistory(tx, {
      applicationId: app.id,
      ownerUserId: app.owner_user_id,
      kind,
      fromStatus: app.status,
      toStatus: to,
      ...(options.packetId ? { packetId: options.packetId } : {}),
      ...(options.attemptId ? { attemptId: options.attemptId } : {}),
      ...(options.reasonCode ? { reasonCode: options.reasonCode } : {}),
      occurredAt: now,
    });
    if (to !== app.status) {
      await this.enqueue(tx, app.id, app.owner_user_id, revision, to, now, to === "applied");
    }
    return updated;
  }

  private async appendHistory(
    tx: Tx,
    entry: {
      applicationId: string;
      ownerUserId: string;
      kind: HistoryKind;
      fromStatus: ApplicationStatus | null;
      toStatus: ApplicationStatus;
      packetId?: string;
      attemptId?: string;
      reasonCode?: string;
      occurredAt: Date;
    },
  ): Promise<void> {
    assertHistoryKind(entry.kind);
    await tx`
      INSERT INTO applications.history
        (id, application_id, owner_user_id, seq, kind, from_status, to_status, packet_id, attempt_id,
         reason_code, occurred_at)
      VALUES (${uuidv7()}, ${entry.applicationId}, ${entry.ownerUserId},
        (SELECT coalesce(max(seq), 0) + 1 FROM applications.history
          WHERE application_id = ${entry.applicationId}),
        ${entry.kind}, ${entry.fromStatus}, ${entry.toStatus}, ${entry.packetId ?? null},
        ${entry.attemptId ?? null}, ${entry.reasonCode ?? null}, ${entry.occurredAt})
    `;
  }

  private async enqueue(
    tx: Tx,
    applicationId: string,
    ownerUserId: string,
    revision: number,
    status: ApplicationStatus,
    now: Date,
    applied: boolean,
  ): Promise<void> {
    const events = applied
      ? (["application.status_changed.v1", "application.applied.v1"] as const)
      : (["application.status_changed.v1"] as const);
    for (const eventType of events) {
      await tx`
        INSERT INTO applications.outbox
          (id, application_id, owner_user_id, application_revision, event_type, subject, payload,
           occurred_at, available_at)
        VALUES (${uuidv7()}, ${applicationId}, ${ownerUserId}, ${revision}, ${eventType},
          ${`application/${applicationId}`},
          ${tx.json({ applicationId, userId: ownerUserId, revision, status })}, ${now}, ${now})
      `;
    }
  }

  private async invalidateLiveApproval(
    tx: Tx,
    applicationId: string,
    reason: string,
    now: Date,
  ): Promise<void> {
    await tx`
      UPDATE applications.approvals
      SET invalidated_at = greatest(approved_at, ${now}), invalidation_reason = ${reason}
      WHERE application_id = ${applicationId} AND invalidated_at IS NULL
    `;
  }

  private async lockOwner(tx: Tx, ownerUserId: string): Promise<void> {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`applications:owner:${ownerUserId}`}))`;
  }

  private async lockApplication(
    tx: Tx,
    ownerUserId: string,
    applicationId: string,
  ): Promise<ApplicationRow> {
    const [row] = await tx<ApplicationRow[]>`
      SELECT id, owner_user_id, canonical_job_id, status, revision, current_packet_id, created_at, updated_at
      FROM applications.applications
      WHERE id = ${applicationId} AND owner_user_id = ${ownerUserId}
      FOR UPDATE
    `;
    if (!row) throw new ApplicationNotFoundError();
    return row;
  }

  private async lockAttempt(tx: Tx, applicationId: string, attemptId: string): Promise<AttemptRow> {
    const [row] = await tx<AttemptRow[]>`
      SELECT * FROM applications.attempts
      WHERE id = ${attemptId} AND application_id = ${applicationId}
      FOR UPDATE
    `;
    if (!row) throw new AttemptNotFoundError();
    return row;
  }

  private async requireOwned(tx: Tx, ownerUserId: string, applicationId: string): Promise<void> {
    const [row] = await tx`
      SELECT 1 FROM applications.applications
      WHERE id = ${applicationId} AND owner_user_id = ${ownerUserId}
    `;
    if (!row) throw new ApplicationNotFoundError();
  }

  private async loadCurrentPacket(tx: Tx, app: ApplicationRow): Promise<ApplicationPacket | null> {
    if (!app.current_packet_id) return null;
    const [row] = await tx<PacketRow[]>`
      SELECT * FROM applications.packets
      WHERE id = ${app.current_packet_id} AND application_id = ${app.id}
    `;
    return row ? toPacket(row, app) : null;
  }

  private async loadLiveApproval(tx: Tx, applicationId: string): Promise<ApprovalRecord | null> {
    const [row] = await tx<ApprovalRow[]>`
      SELECT id, packet_id, packet_hash, consent_id, acknowledged_field_keys, approved_at,
        expires_at, invalidated_at, invalidation_reason
      FROM applications.approvals
      WHERE application_id = ${applicationId} AND invalidated_at IS NULL
    `;
    return row ? toApproval(row) : null;
  }

  private async loadAttempts(tx: Tx, applicationId: string): Promise<AttemptRecord[]> {
    const rows = await tx<AttemptRow[]>`
      SELECT * FROM applications.attempts WHERE application_id = ${applicationId} ORDER BY sequence
    `;
    return rows.map((row) => toAttempt(row));
  }

  private async readView(
    tx: Tx,
    ownerUserId: string,
    applicationId: string,
  ): Promise<ApplicationView> {
    const [row] = await tx<ApplicationRow[]>`
      SELECT id, owner_user_id, canonical_job_id, status, revision, current_packet_id, created_at, updated_at
      FROM applications.applications
      WHERE id = ${applicationId} AND owner_user_id = ${ownerUserId}
    `;
    if (!row) throw new ApplicationNotFoundError();
    const packet = await this.loadCurrentPacket(tx, row);
    const approval = await this.loadLiveApproval(tx, row.id);
    const attempts = await this.loadAttempts(tx, row.id);
    const now = this.clock();
    return {
      application: toApplication(row),
      currentPacket: packet,
      approval,
      attempts,
      currentAction: deriveCurrentAction({
        status: row.status,
        hasUnresolvedFields:
          packet?.fields.some(
            (field) => field.disposition === "user_action" && field.value === null,
          ) ?? false,
        approvalLive: approval ? now.getTime() < approval.expiresAt.getTime() : false,
      }),
    };
  }

  private async replay(tx: Tx, ownerUserId: string, applicationId: string): Promise<CommandResult> {
    return { replayed: true, view: await this.readView(tx, ownerUserId, applicationId) };
  }

  private async findReceipt(
    tx: Tx,
    ownerUserId: string,
    idempotencyKey: string,
    operation: CommandOperation,
    requestHash: string,
  ): Promise<{ applicationId: string; note: CommandNote | null } | null> {
    const [row] = await tx<
      {
        operation: string;
        request_hash: string;
        application_id: string;
        outcome_code: string | null;
        subject_id: string | null;
      }[]
    >`
      SELECT operation, request_hash, application_id, outcome_code, subject_id
      FROM applications.command_receipts
      WHERE owner_user_id = ${ownerUserId} AND idempotency_key = ${idempotencyKey}
    `;
    if (!row) return null;
    if (row.operation !== operation || row.request_hash !== requestHash) {
      throw new ApplicationIdempotencyConflictError();
    }
    return {
      applicationId: row.application_id,
      note: row.outcome_code ? { code: row.outcome_code, subjectId: row.subject_id } : null,
    };
  }

  private async writeReceipt(
    tx: Tx,
    command: { ownerUserId: string; idempotencyKey: string },
    operation: CommandOperation,
    requestHash: string,
    applicationId: string,
    revision: number,
    now: Date,
    note: CommandNote | null = null,
  ): Promise<void> {
    await tx`
      INSERT INTO applications.command_receipts
        (owner_user_id, idempotency_key, operation, request_hash, application_id, response_revision,
         outcome_code, subject_id, created_at)
      VALUES (${command.ownerUserId}, ${command.idempotencyKey}, ${operation}, ${requestHash},
        ${applicationId}, ${revision}, ${note?.code ?? null}, ${note?.subjectId ?? null}, ${now})
    `;
  }

  /** Two concurrent first uses of one key race on the receipt key; the loser replays. */
  private async retryOnKeyRace<T>(_ownerUserId: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isUniqueViolation(error, "command_receipts_pkey")) return run();
      throw error;
    }
  }
}

type SettledStatus = Extract<
  AttemptStatus,
  | "confirmed"
  | "ambiguous"
  | "failed_no_effect"
  | "failed_requires_review"
  | "taken_over"
  | "abandoned"
  | "reconciled_not_submitted"
>;

export class StalePacketError extends Error {
  readonly reasons: readonly ApprovalInvalidReason[];

  constructor(reasons: readonly ApprovalInvalidReason[]) {
    super("The packet no longer matches the job, form, or artifacts and needs a new version");
    this.name = "StalePacketError";
    this.reasons = reasons;
  }
}

function firstReason(reasons: readonly ApprovalInvalidReason[]): ApprovalInvalidReason {
  return reasons[0] ?? "packet_hash_mismatch";
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const candidate = error as { code?: string; constraint_name?: string } | null;
  return candidate?.code === "23505" && candidate.constraint_name === constraint;
}

function resultFingerprint(result: AdapterSubmissionResult): unknown {
  return result.kind === "confirmed"
    ? { kind: result.kind, evidence: evidenceFingerprint(result.evidence) }
    : { kind: result.kind };
}

function evidenceFingerprint(evidence: ConfirmationEvidence): unknown {
  return {
    kind: evidence.kind,
    fingerprint: evidence.fingerprintSha256,
    observedAt: evidence.observedAt.toISOString(),
    adapterId: evidence.adapterId ?? null,
    adapterVersion: evidence.adapterVersion ?? null,
    providerReference: evidence.providerReference ?? null,
  };
}

function reconciliationFingerprint(reconciliation: ReconciliationEvidence): unknown {
  switch (reconciliation.kind) {
    case "provider_confirmation":
    case "user_attested_submitted":
      return { kind: reconciliation.kind, evidence: evidenceFingerprint(reconciliation.evidence) };
    case "provider_absence_verified":
      return {
        kind: reconciliation.kind,
        fingerprint: reconciliation.fingerprintSha256,
        observedAt: reconciliation.observedAt.toISOString(),
      };
    case "user_attested_not_submitted":
      return { kind: reconciliation.kind, risk: reconciliation.acknowledgesDuplicateRisk };
  }
}
