import { createHash } from "node:crypto";
import type postgres from "postgres";
import type { TrustReviewQueueInput } from "./review-queue.js";
import {
  decideContributionReview,
  decideTrustAppeal,
  fileTrustAppeal,
  openTrustCase,
  type TrustCase,
  type TrustSignalCode,
  type TrustTransition,
  takeDownContribution,
  validateTrustSignalForCase,
  withdrawContribution,
} from "./policy.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

interface CaseRow {
  id: string;
  contributionId: string;
  contributorUserId: string;
  policyVersion: string;
  appealWindowMilliseconds: string;
  state: TrustCase["state"];
  version: number;
  appealCount: 0 | 1;
  adverseState: "rejected" | "taken_down" | null;
  adverseReviewerId: string | null;
  adverseDecisionAt: Date | string | null;
  appealDeadlineAt: Date | string | null;
  pendingAppealEvidenceDigestSha256: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface OwnerTrustCaseView {
  id: string;
  contributionId: string;
  state: TrustCase["state"];
  policyVersion: string;
  version: number;
  appealed: boolean;
  appealDeadlineAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OwnerReputationEvidenceView {
  id: string;
  contributionId: string;
  signalCode: Extract<
    TrustSignalCode,
    | "contributor_submission_verified"
    | "contributor_submission_incorrect"
    | "contributor_abuse_detected"
    | "adverse_decision_reversed"
  >;
  occurredAt: string;
}

export class TrustVersionConflictError extends Error {
  constructor() {
    super("Trust case version changed");
    this.name = "TrustVersionConflictError";
  }
}

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${field} must be a lowercase UUID`);
}

function assertDigest(value: string, field: string): void {
  if (!SHA256_PATTERN.test(value)) throw new Error(`${field} must be a SHA-256 digest`);
}

function reputationEvidenceId(
  caseId: string,
  caseVersion: number,
  signalCode: TrustSignalCode,
): string {
  const bytes = createHash("sha256")
    .update("ai-job-apply/trust-reputation-evidence/v1\0")
    .update(caseId)
    .update("\0")
    .update(String(caseVersion))
    .update("\0")
    .update(signalCode)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function contributorSignal(transition: TrustTransition): TrustSignalCode | null {
  if (transition.action === "review_accepted") return "contributor_submission_verified";
  if (transition.action === "appeal_reversed") return "adverse_decision_reversed";
  if (transition.action === "review_rejected") {
    if (transition.reasonCode === "content_mismatch") return "contributor_submission_incorrect";
    if (transition.reasonCode === "malicious_or_deceptive") return "contributor_abuse_detected";
  }
  return null;
}

function date(value: Date | string, field: string): Date {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Stored ${field} is invalid`);
  return parsed;
}

function mapCase(row: CaseRow): TrustCase {
  const hasAdverse = row.adverseState !== null;
  if (
    hasAdverse !==
    (row.adverseReviewerId !== null &&
      row.adverseDecisionAt !== null &&
      row.appealDeadlineAt !== null)
  ) {
    throw new Error("Stored trust adverse decision is malformed");
  }
  return {
    id: row.id,
    contributionId: row.contributionId,
    contributorUserId: row.contributorUserId,
    policyVersion: row.policyVersion,
    appealWindowMilliseconds: Number(row.appealWindowMilliseconds),
    state: row.state,
    version: row.version,
    appealCount: row.appealCount,
    adverseDecision: hasAdverse
      ? {
          state: row.adverseState as "rejected" | "taken_down",
          reviewerId: row.adverseReviewerId as string,
          decidedAt: date(row.adverseDecisionAt as Date | string, "adverse decision timestamp"),
          appealDeadlineAt: date(row.appealDeadlineAt as Date | string, "appeal deadline"),
        }
      : null,
    pendingAppealEvidenceDigestSha256: row.pendingAppealEvidenceDigestSha256,
    createdAt: date(row.createdAt, "creation timestamp"),
    updatedAt: date(row.updatedAt, "update timestamp"),
  };
}

function ownerView(trustCase: TrustCase): OwnerTrustCaseView {
  return {
    id: trustCase.id,
    contributionId: trustCase.contributionId,
    state: trustCase.state,
    policyVersion: trustCase.policyVersion,
    version: trustCase.version,
    appealed: trustCase.appealCount === 1,
    appealDeadlineAt: trustCase.adverseDecision?.appealDeadlineAt.toISOString() ?? null,
    createdAt: trustCase.createdAt.toISOString(),
    updatedAt: trustCase.updatedAt.toISOString(),
  };
}

const caseSelection = `
  id, contribution_id AS "contributionId", contributor_user_id AS "contributorUserId",
  policy_version AS "policyVersion", appeal_window_milliseconds::text AS "appealWindowMilliseconds",
  state, version, appeal_count AS "appealCount", adverse_state AS "adverseState",
  adverse_reviewer_id AS "adverseReviewerId", adverse_decision_at AS "adverseDecisionAt",
  appeal_deadline_at AS "appealDeadlineAt",
  pending_appeal_evidence_digest_sha256 AS "pendingAppealEvidenceDigestSha256",
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

export class PostgresTrustStore {
  constructor(private readonly client: postgres.Sql) {}

  async ping(): Promise<void> {
    const [result] = await this.client<{ ready: boolean }[]>`
      SELECT (
        to_regclass('trust.contribution_cases') IS NOT NULL
        AND to_regclass('trust.case_events') IS NOT NULL
        AND to_regclass('trust.reputation_evidence') IS NOT NULL
        AND to_regclass('trust.contribution_decision_outbox') IS NOT NULL
        AND to_regclass('trust.contribution_decision_deliveries') IS NOT NULL
        AND EXISTS (SELECT 1 FROM trust.schema_migrations
          WHERE version = '0003_decision_signals')
      ) AS ready
    `;
    if (!result?.ready) throw new Error("The Trust persistence boundary is unavailable");
  }

  async open(input: Parameters<typeof openTrustCase>[0]): Promise<TrustCase> {
    const transition = openTrustCase(input);
    const value = transition.trustCase;
    const [inserted] = await this.client<CaseRow[]>`
      INSERT INTO trust.contribution_cases (
        id, contribution_id, contributor_user_id, policy_version, appeal_window_milliseconds,
        state, version, appeal_count,
        adverse_state, adverse_reviewer_id, adverse_decision_at, appeal_deadline_at,
        pending_appeal_evidence_digest_sha256, last_action, last_actor_kind, last_actor_id,
        last_reason_code, last_evidence_digest_sha256, created_at, updated_at
      ) VALUES (
        ${value.id}, ${value.contributionId}, ${value.contributorUserId}, ${value.policyVersion},
        ${value.appealWindowMilliseconds}, ${value.state},
        ${value.version}, ${value.appealCount}, null, null, null, null, null,
        ${transition.action}, ${transition.actorKind}, ${transition.actorId},
        ${transition.reasonCode}, null, ${value.createdAt}, ${value.updatedAt}
      ) ON CONFLICT (contribution_id) DO NOTHING
      RETURNING ${this.client.unsafe(caseSelection)}
    `;
    if (inserted) return mapCase(inserted);
    const [existing] = await this.client<CaseRow[]>`
      SELECT ${this.client.unsafe(caseSelection)} FROM trust.contribution_cases
      WHERE contribution_id = ${value.contributionId}
    `;
    if (
      !existing ||
      existing.id !== value.id ||
      existing.contributorUserId !== value.contributorUserId
    ) {
      throw new Error("Trust case idempotent open conflicted with stored identity");
    }
    return mapCase(existing);
  }

  async review(
    caseId: string,
    expectedVersion: number,
    input: Parameters<typeof decideContributionReview>[1],
  ): Promise<TrustCase> {
    return this.transition(caseId, expectedVersion, (current) =>
      decideContributionReview(current, input),
    );
  }

  async withdraw(
    caseId: string,
    expectedVersion: number,
    input: Parameters<typeof withdrawContribution>[1],
  ): Promise<TrustCase> {
    return this.transition(caseId, expectedVersion, (current) =>
      withdrawContribution(current, input),
    );
  }

  async takeDown(
    caseId: string,
    expectedVersion: number,
    input: Parameters<typeof takeDownContribution>[1],
  ): Promise<TrustCase> {
    return this.transition(caseId, expectedVersion, (current) =>
      takeDownContribution(current, input),
    );
  }

  async appeal(
    caseId: string,
    expectedVersion: number,
    input: Parameters<typeof fileTrustAppeal>[1],
  ): Promise<TrustCase> {
    return this.transition(caseId, expectedVersion, (current) => fileTrustAppeal(current, input));
  }

  async resolveAppeal(
    caseId: string,
    expectedVersion: number,
    input: Parameters<typeof decideTrustAppeal>[1],
  ): Promise<TrustCase> {
    return this.transition(caseId, expectedVersion, (current) => decideTrustAppeal(current, input));
  }

  async readOwnerCase(ownerUserId: string, caseId: string): Promise<OwnerTrustCaseView | null> {
    assertUuid(ownerUserId, "ownerUserId");
    assertUuid(caseId, "caseId");
    const [row] = await this.client<CaseRow[]>`
      SELECT ${this.client.unsafe(caseSelection)} FROM trust.contribution_cases
      WHERE id = ${caseId} AND contributor_user_id = ${ownerUserId}
    `;
    return row ? ownerView(mapCase(row)) : null;
  }

  async readOwnerCaseByContribution(
    ownerUserId: string,
    contributionId: string,
  ): Promise<OwnerTrustCaseView | null> {
    assertUuid(ownerUserId, "ownerUserId");
    assertUuid(contributionId, "contributionId");
    const [row] = await this.client<CaseRow[]>`
      SELECT ${this.client.unsafe(caseSelection)} FROM trust.contribution_cases
      WHERE contribution_id = ${contributionId} AND contributor_user_id = ${ownerUserId}
    `;
    return row ? ownerView(mapCase(row)) : null;
  }

  async readReviewerCase(caseId: string): Promise<TrustCase | null> {
    assertUuid(caseId, "caseId");
    const [row] = await this.client<CaseRow[]>`
      SELECT ${this.client.unsafe(caseSelection)} FROM trust.contribution_cases WHERE id = ${caseId}
    `;
    return row ? mapCase(row) : null;
  }

  async listReviewerCases(input: TrustReviewQueueInput): Promise<TrustCase[]> {
    if (
      !["needs_review", "appeal_pending"].includes(input.state) ||
      !Number.isInteger(input.pageSize) ||
      input.pageSize < 1 ||
      input.pageSize > 25
    )
      throw new Error("Invalid review queue request");
    const after = input.after;
    const rows = await this.client<CaseRow[]>`
      SELECT ${this.client.unsafe(caseSelection)} FROM trust.contribution_cases
      WHERE state = ${input.state}
        ${after ? this.client`AND (updated_at, id) > (${after.updatedAt}::timestamptz, ${after.id}::uuid)` : this.client``}
      ORDER BY updated_at, id LIMIT ${input.pageSize + 1}
    `;
    return rows.map(mapCase);
  }

  async recordReputationEvidence(input: {
    id: string;
    caseId: string;
    expectedCaseVersion: number;
    reviewerId: string;
    subject: { kind: "contributor" } | { kind: "source"; sourceKeySha256: string };
    signalCode: TrustSignalCode;
    referenceDigestSha256: string;
    occurredAt: Date;
  }): Promise<void> {
    assertUuid(input.id, "id");
    assertUuid(input.caseId, "caseId");
    assertUuid(input.reviewerId, "reviewerId");
    if (input.subject.kind === "source") {
      assertDigest(input.subject.sourceKeySha256, "sourceKeySha256");
    }
    await this.client.begin(async (transaction) => {
      const [row] = await transaction<CaseRow[]>`
        SELECT ${transaction.unsafe(caseSelection)} FROM trust.contribution_cases
        WHERE id = ${input.caseId} FOR UPDATE
      `;
      if (!row || row.version !== input.expectedCaseVersion) throw new TrustVersionConflictError();
      validateTrustSignalForCase(mapCase(row), {
        subjectKind: input.subject.kind,
        signalCode: input.signalCode,
        referenceDigestSha256: input.referenceDigestSha256,
      });
      await transaction`
        INSERT INTO trust.reputation_evidence (
          id, case_id, case_version, contribution_id, subject_kind, contributor_user_id,
          source_key_sha256, signal_code, reference_digest_sha256,
          recorded_by_reviewer_id, occurred_at
        ) VALUES (
          ${input.id}, ${row.id}, ${row.version}, ${row.contributionId}, ${input.subject.kind},
          ${input.subject.kind === "contributor" ? row.contributorUserId : null},
          ${input.subject.kind === "source" ? input.subject.sourceKeySha256 : null},
          ${input.signalCode}, ${input.referenceDigestSha256}, ${input.reviewerId},
          ${input.occurredAt}
        )
      `;
    });
  }

  async readOwnerReputationEvidence(
    ownerUserId: string,
    caseId: string,
  ): Promise<OwnerReputationEvidenceView[]> {
    assertUuid(ownerUserId, "ownerUserId");
    assertUuid(caseId, "caseId");
    const rows = await this.client<
      {
        id: string;
        contributionId: string;
        signalCode: OwnerReputationEvidenceView["signalCode"];
        occurredAt: Date | string;
      }[]
    >`
      SELECT evidence.id, evidence.contribution_id AS "contributionId",
        evidence.signal_code AS "signalCode", evidence.occurred_at AS "occurredAt"
      FROM trust.reputation_evidence AS evidence
      INNER JOIN trust.contribution_cases AS trust_case ON trust_case.id = evidence.case_id
      WHERE evidence.case_id = ${caseId} AND evidence.subject_kind = 'contributor'
        AND evidence.contributor_user_id = ${ownerUserId}
        AND trust_case.contributor_user_id = ${ownerUserId}
      ORDER BY evidence.occurred_at, evidence.id
    `;
    return rows.map((row) => ({
      id: row.id,
      contributionId: row.contributionId,
      signalCode: row.signalCode,
      occurredAt: date(row.occurredAt, "reputation evidence timestamp").toISOString(),
    }));
  }

  private async transition(
    caseId: string,
    expectedVersion: number,
    decide: (current: TrustCase) => TrustTransition,
  ): Promise<TrustCase> {
    assertUuid(caseId, "caseId");
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new TrustVersionConflictError();
    }
    return this.client.begin(async (transaction) => {
      const [row] = await transaction<CaseRow[]>`
        SELECT ${transaction.unsafe(caseSelection)} FROM trust.contribution_cases
        WHERE id = ${caseId} FOR UPDATE
      `;
      if (!row || row.version !== expectedVersion) throw new TrustVersionConflictError();
      const transition = decide(mapCase(row));
      const value = transition.trustCase;
      const adverse = value.adverseDecision;
      const [updated] = await transaction<CaseRow[]>`
        UPDATE trust.contribution_cases SET
          state = ${value.state}, version = ${value.version}, appeal_count = ${value.appealCount},
          adverse_state = ${adverse?.state ?? null},
          adverse_reviewer_id = ${adverse?.reviewerId ?? null},
          adverse_decision_at = ${adverse?.decidedAt ?? null},
          appeal_deadline_at = ${adverse?.appealDeadlineAt ?? null},
          pending_appeal_evidence_digest_sha256 = ${value.pendingAppealEvidenceDigestSha256},
          last_action = ${transition.action}, last_actor_kind = ${transition.actorKind},
          last_actor_id = ${transition.actorId}, last_reason_code = ${transition.reasonCode},
          last_evidence_digest_sha256 = ${transition.evidenceDigestSha256},
          updated_at = ${value.updatedAt}
        WHERE id = ${caseId} AND version = ${expectedVersion}
        RETURNING ${transaction.unsafe(caseSelection)}
      `;
      if (!updated) throw new TrustVersionConflictError();
      const signalCode = contributorSignal(transition);
      if (signalCode) {
        if (transition.actorKind !== "reviewer" || !transition.evidenceDigestSha256) {
          throw new Error(
            "Contributor reputation evidence requires an authoritative reviewer transition",
          );
        }
        const id = reputationEvidenceId(value.id, value.version, signalCode);
        await transaction`
          INSERT INTO trust.reputation_evidence (
            id, case_id, case_version, contribution_id, subject_kind, contributor_user_id,
            source_key_sha256, signal_code, reference_digest_sha256,
            recorded_by_reviewer_id, occurred_at
          ) VALUES (
            ${id}, ${value.id}, ${value.version}, ${value.contributionId}, 'contributor',
            ${value.contributorUserId}, null, ${signalCode},
            ${transition.evidenceDigestSha256}, ${transition.actorId}, ${value.updatedAt}
          )
        `;
      }
      return mapCase(updated);
    });
  }
}
