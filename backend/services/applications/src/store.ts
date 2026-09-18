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
  verifyPacketHash,
} from "./packet.js";
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
  | "create_application"
  | "create_packet"
  | "approve"
  | "cancel"
  | "start_attempt"
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
      nextStatus(app.status, "packet_created");
      const [{ version } = { version: 0 }] = await tx<{ version: number }[]>`
        SELECT coalesce(max(version), 0)::int AS version FROM applications.packets
        WHERE application_id = ${app.id}
      `;
      const packet = assemblePacket(
        {
          ...command.packet,
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

  async startAttempt(command: {
    ownerUserId: string;
    applicationId: string;
    expectedRevision: number;
    idempotencyKey: string;
    current: CurrentBindings;
    adapterId: string;
    adapterVersion: string;
  }): Promise<StartAttemptResult> {
    const requestHash = canonicalHash({
      operation: "start_attempt",
      applicationId: command.applicationId,
      expectedRevision: command.expectedRevision,
      current: command.current,
      adapterId: command.adapterId,
      adapterVersion: command.adapterVersion,
    });
    const result = await this.mutate(
      command,
      "start_attempt",
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
          await tx`
            INSERT INTO applications.attempts
              (id, application_id, owner_user_id, packet_id, packet_hash, approval_id, sequence,
               scope_key, status, adapter_id, adapter_version, started_at)
            VALUES (${attemptId}, ${app.id}, ${app.owner_user_id}, ${packet.id}, ${packet.packetHash},
              ${approval.id}, ${sequence},
              ${submissionScopeKey(app.owner_user_id, app.id, packet.packetHash)}, 'started',
              ${command.adapterId}, ${command.adapterVersion}, ${now})
          `;
        } catch (error) {
          if (isUniqueViolation(error, "attempts_scope_holding_uq")) {
            throw new AttemptRefusedError("ATTEMPT_IN_FLIGHT");
          }
          throw error;
        }
        note({ code: "started", subjectId: attemptId });
        return this.change(tx, app, "attempt_started", now, { packetId: packet.id, attemptId });
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
    page: { limit?: number; after?: { updatedAt: Date; id: string } } = {},
  ): Promise<{ items: ApplicationView[]; hasMore: boolean }> {
    const limit = Math.min(Math.max(page.limit ?? 25, 1), MAX_LIST_PAGE);
    return this.client.begin("READ ONLY", async (tx) => {
      const after = page.after;
      const rows = await tx<ApplicationRow[]>`
        SELECT id, owner_user_id, canonical_job_id, status, revision, current_packet_id, created_at, updated_at
        FROM applications.applications
        WHERE owner_user_id = ${ownerUserId}
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
