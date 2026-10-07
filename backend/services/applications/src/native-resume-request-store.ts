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
    return this.finish(fixed);
  }
  /** Documents observed no eligible original source; delivery is complete without a task. */
  async withoutResume(claim: NativeResumeRequestClaim): Promise<boolean> {
    return this.finish(structuredClone(claim));
  }
  private async finish(fixed: NativeResumeRequestClaim): Promise<boolean> {
    this.check();
    const rows = await this
      .sql`UPDATE applications.outbox SET status='published',published_at=clock_timestamp(),
      claim_token=NULL,lease_expires_at=NULL,last_error_code=NULL
      WHERE id=${fixed.eventId} AND event_type='application.resume-preparation.requested.v1'
        AND owner_user_id=${fixed.application.ownerUserId} AND application_id=${fixed.application.applicationId}
        AND resume_packet_id=${fixed.application.packetId} AND application_revision=${fixed.application.expectedRevision}
        AND resume_workflow_arn=${fixed.workflowArn} AND status='processing' AND claim_token=${fixed.claimToken}
        AND lease_expires_at>clock_timestamp() RETURNING id`;
    this.check();
    return rows.length === 1;
  }
}
