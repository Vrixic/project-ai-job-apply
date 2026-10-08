import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import type { NativeResumePreparationScope } from "./native-resume-admission.js";
import {
  isPreparationFunctionArn,
  matchesPreparationExecutionArn,
} from "./preparation-dispatch.js";

const unavailable = () => Error("NativeResumeRequestUnavailable");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
export const nativeResumeExecutionName = (eventId: string) => {
  if (!uuid.test(eventId)) throw unavailable();
  return `resume-${eventId}`;
};
export interface NativeResumeRequestClaim {
  eventId: string;
  claimToken: string;
  workflowArn: string;
  application: NativeResumePreparationScope;
}
export type NativeResumeExecutionTerminalStatus = "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "STOPPED";
export interface NativeResumeExecutionObservationClaim {
  eventId: string;
  workflowArn: string;
  executionArn: string;
  inspectionToken: string;
  terminalStatus: NativeResumeExecutionTerminalStatus | null;
}
/** Owns only Applications metadata. Delivery retries retain the original numeric workflow
 * version; source/generation capture is a Documents responsibility. No AWS calls in SQL. */
export class PostgresNativeResumeRequestStore {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly enabled: () => boolean = () => false,
  ) {}
  private check() {
    if (!this.enabled()) throw unavailable();
  }
  /** Delivery exhaustion is not proof that the original durable execution or task stopped. */
  async failExpiredDeliveries(limit = 25): Promise<number> {
    this.check();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) throw unavailable();
    return this.sql.begin(async (tx) => {
      const rows = await tx<Array<{ id: string }>>`
        WITH expired AS (
          SELECT id FROM applications.outbox
          WHERE event_type='application.resume-preparation.requested.v1'
            AND status='processing' AND attempt_count=5
            AND lease_expires_at <= clock_timestamp()
          ORDER BY lease_expires_at,id LIMIT ${limit} FOR UPDATE SKIP LOCKED
        )
        UPDATE applications.outbox e SET status='failed',failed_at=clock_timestamp(),
          claim_token=NULL,lease_expires_at=NULL,last_error_code='lease_expired'
        FROM expired WHERE e.id=expired.id RETURNING e.id`;
      this.check();
      return rows.length;
    });
  }
  async pending(limit = 25): Promise<string[]> {
    this.check();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) throw unavailable();
    const rows = await this.sql<Array<{ id: string }>>`
      SELECT e.id FROM applications.outbox e
      JOIN applications.applications a ON a.id=e.application_id AND a.owner_user_id=e.owner_user_id
      WHERE e.event_type='application.resume-preparation.requested.v1'
        AND a.current_packet_id=e.resume_packet_id AND a.revision=e.application_revision AND a.status='review_required'
        AND e.attempt_count < 5 AND e.available_at <= clock_timestamp()
        AND (e.status='pending' OR (e.status='processing' AND e.lease_expires_at <= clock_timestamp()))
      ORDER BY e.occurred_at,e.id LIMIT ${limit}`;
    this.check();
    return rows.map((row) => row.id);
  }
  async claim(eventId: string, target: string): Promise<NativeResumeRequestClaim | null> {
    this.check();
    if (
      !uuid.test(eventId) ||
      !isPreparationFunctionArn(target) ||
      !target.startsWith("arn:aws:lambda:us-east-2:")
    )
      throw unavailable();
    return this.sql.begin(async (tx) => {
      const [original] = await tx<Array<{ owner_user_id: string; application_id: string }>>`
        SELECT owner_user_id,application_id FROM applications.outbox
        WHERE id=${eventId} AND event_type='application.resume-preparation.requested.v1'`;
      if (!original) return null;
      await tx`SELECT identity.require_active_candidate(${original.owner_user_id}::uuid)`;
      await tx`SELECT id FROM applications.applications WHERE id=${original.application_id} AND owner_user_id=${original.owner_user_id} FOR UPDATE`;
      const [row] = await tx<
        Array<{
          owner_user_id: string;
          application_id: string;
          canonical_job_id: string;
          application_revision: number;
          resume_packet_id: string;
          packet_hash: string;
          job_revision: string;
          resume_workflow_arn: string | null;
        }>
      >`
        SELECT e.owner_user_id,e.application_id,a.canonical_job_id,e.application_revision,
          e.resume_packet_id,p.packet_hash,p.job_revision,e.resume_workflow_arn
        FROM applications.outbox e JOIN applications.applications a ON a.id=e.application_id AND a.owner_user_id=e.owner_user_id
        JOIN applications.packets p ON p.id=e.resume_packet_id AND p.application_id=a.id AND p.owner_user_id=a.owner_user_id
        WHERE e.id=${eventId} AND e.event_type='application.resume-preparation.requested.v1'
          AND a.current_packet_id=p.id AND a.revision=e.application_revision AND a.status='review_required'
          AND e.attempt_count < 5 AND e.available_at <= clock_timestamp()
          AND (e.status='pending' OR (e.status='processing' AND e.lease_expires_at <= clock_timestamp()))
        FOR UPDATE OF e`;
      if (!row) return null;
      const workflowArn = row.resume_workflow_arn ?? target;
      if (
        workflowArn.slice(0, workflowArn.lastIndexOf(":")) !==
        target.slice(0, target.lastIndexOf(":"))
      )
        throw unavailable();
      const claimToken = uuidv7();
      this.check();
      await tx`UPDATE applications.outbox SET status='processing',claim_token=${claimToken},
        lease_expires_at=clock_timestamp()+interval '60 seconds',attempt_count=attempt_count+1,last_error_code=NULL,
        resume_workflow_arn=${workflowArn} WHERE id=${eventId}`;
      this.check();
      return {
        eventId,
        claimToken,
        workflowArn,
        application: {
          ownerUserId: row.owner_user_id,
          applicationId: row.application_id,
          canonicalJobId: row.canonical_job_id,
          expectedRevision: Number(row.application_revision),
          packetId: row.resume_packet_id,
          packetHash: row.packet_hash,
          jobRevision: row.job_revision,
        },
      };
    });
  }
  async started(claim: NativeResumeRequestClaim, executionArn: string): Promise<boolean> {
    this.check();
    const fixed = structuredClone(claim);
    if (
      !uuid.test(fixed.claimToken) ||
      !matchesPreparationExecutionArn(
        executionArn,
        fixed.workflowArn,
        nativeResumeExecutionName(fixed.eventId),
      )
    )
      throw unavailable();
    return this.finish(fixed, executionArn);
  }
  /** Documents observed no eligible original source; delivery is complete without a task. */
  async withoutResume(claim: NativeResumeRequestClaim): Promise<boolean> {
    return this.finish(structuredClone(claim), null);
  }
  /** Bounded original-version inventory for private recovery, independent of candidate activity.
   * Null receipts are unknown (including legacy publications), never proof of non-dispatch. */
  async executionReceipts(workflowArn: string, afterEventId: string | null = null, limit = 25) {
    this.check();
    if (
      !isPreparationFunctionArn(workflowArn) ||
      !workflowArn.startsWith("arn:aws:lambda:us-east-2:") ||
      (afterEventId !== null && !uuid.test(afterEventId)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 25
    )
      throw unavailable();
    const rows = await this.sql<
      Array<{
        id: string;
        resume_workflow_arn: string;
        resume_execution_arn: string | null;
        resume_dispatch_result: "started" | "no_resume" | null;
      }>
    >`
      SELECT id,resume_workflow_arn,resume_execution_arn,resume_dispatch_result
      FROM applications.outbox WHERE event_type='application.resume-preparation.requested.v1'
        AND resume_workflow_arn=${workflowArn} AND (${afterEventId}::uuid IS NULL OR id>${afterEventId}::uuid)
      ORDER BY id LIMIT ${limit}`;
    this.check();
    return rows.map((row) => ({
      eventId: row.id,
      workflowArn: row.resume_workflow_arn,
      executionArn: row.resume_execution_arn,
      dispatchResult: row.resume_dispatch_result,
    }));
  }
  /** Fair, bounded observation independent of candidate/packet changes. A crash leaves a
   * five-minute lease; the next claim changes its token and fences an older acknowledgement. */
  async claimExecutionObservations(
    workflowArns: readonly string[],
  ): Promise<NativeResumeExecutionObservationClaim[]> {
    this.check();
    const arns = [...workflowArns];
    if (
      !arns.length ||
      arns.length > 8 ||
      new Set(arns).size !== arns.length ||
      arns.some(
        (arn) => !isPreparationFunctionArn(arn) || !arn.startsWith("arn:aws:lambda:us-east-2:"),
      )
    )
      throw unavailable();
    return this.sql.begin(async (tx) => {
      const token = uuidv7();
      const rows = await tx<
        Array<{
          id: string;
          resume_workflow_arn: string;
          resume_execution_arn: string;
          resume_execution_terminal_status: NativeResumeExecutionTerminalStatus | null;
        }>
      >`
        WITH due AS (
          SELECT id FROM applications.outbox
          WHERE event_type='application.resume-preparation.requested.v1' AND status='published'
            AND resume_dispatch_result='started' AND resume_workflow_arn IN ${tx(arns)}
            AND resume_execution_notified_at IS NULL
            AND resume_execution_terminal_status IS DISTINCT FROM 'SUCCEEDED'
            AND (resume_execution_checked_at IS NULL OR resume_execution_checked_at <= clock_timestamp()-interval '5 minutes')
          ORDER BY resume_execution_checked_at NULLS FIRST,id LIMIT 2 FOR UPDATE SKIP LOCKED
        )
        UPDATE applications.outbox e SET resume_execution_checked_at=clock_timestamp(),resume_execution_inspection_token=${token}
        FROM due WHERE e.id=due.id
        RETURNING e.id,e.resume_workflow_arn,e.resume_execution_arn,e.resume_execution_terminal_status`;
      this.check();
      return rows.map((row) => ({
        eventId: row.id,
        workflowArn: row.resume_workflow_arn,
        executionArn: row.resume_execution_arn,
        inspectionToken: token,
        terminalStatus: row.resume_execution_terminal_status,
      }));
    });
  }
  /** Persist positive terminal observation before notice delivery. Null is unresolved and never
   * erases an earlier positive observation. A notice receipt is recorded only after queue ACK. */
  async recordExecutionObservation(
    claim: NativeResumeExecutionObservationClaim,
    terminalStatus: NativeResumeExecutionTerminalStatus | null,
    notified = false,
  ): Promise<boolean> {
    this.check();
    const fixed = structuredClone(claim);
    if (
      !uuid.test(fixed.inspectionToken) ||
      !matchesPreparationExecutionArn(
        fixed.executionArn,
        fixed.workflowArn,
        nativeResumeExecutionName(fixed.eventId),
      ) ||
      (terminalStatus !== null &&
        !["SUCCEEDED", "FAILED", "TIMED_OUT", "STOPPED"].includes(terminalStatus)) ||
      (notified && (terminalStatus === null || terminalStatus === "SUCCEEDED"))
    )
      throw unavailable();
    return this.sql.begin(async (tx) => {
      const rows = await tx`
        UPDATE applications.outbox SET resume_execution_terminal_status=COALESCE(resume_execution_terminal_status,${terminalStatus}),
          resume_execution_notified_at=CASE WHEN ${notified} THEN COALESCE(resume_execution_notified_at,clock_timestamp()) ELSE resume_execution_notified_at END
        WHERE id=${fixed.eventId} AND event_type='application.resume-preparation.requested.v1'
          AND resume_dispatch_result='started' AND resume_workflow_arn=${fixed.workflowArn}
          AND resume_execution_arn=${fixed.executionArn} AND resume_execution_inspection_token=${fixed.inspectionToken}
          AND (resume_execution_terminal_status IS NULL OR ${terminalStatus}::text IS NULL OR resume_execution_terminal_status=${terminalStatus})
        RETURNING id`;
      this.check();
      return rows.length === 1;
    });
  }
  private async finish(
    fixed: NativeResumeRequestClaim,
    executionArn: string | null,
  ): Promise<boolean> {
    this.check();
    const rows = await this
      .sql`UPDATE applications.outbox SET status='published',published_at=clock_timestamp(),
      claim_token=NULL,lease_expires_at=NULL,last_error_code=NULL,
      resume_execution_arn=${executionArn},resume_dispatch_result=${executionArn === null ? "no_resume" : "started"}
      WHERE id=${fixed.eventId} AND event_type='application.resume-preparation.requested.v1'
        AND owner_user_id=${fixed.application.ownerUserId} AND application_id=${fixed.application.applicationId}
        AND resume_packet_id=${fixed.application.packetId} AND application_revision=${fixed.application.expectedRevision}
        AND resume_workflow_arn=${fixed.workflowArn} AND status='processing' AND claim_token=${fixed.claimToken}
        AND lease_expires_at>clock_timestamp() RETURNING id`;
    this.check();
    return rows.length === 1;
  }
}
